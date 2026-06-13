import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { findMappingByApiKey, getCredentials } from '@/lib/data'
import { getCheckoutSession } from '@/lib/broker'

/**
 * POST /api/refund — money-back guarantee for consumer apps.
 *
 * A consumer app (with its X-Project-Key) refunds a checkout it created. The
 * Stripe key stays in the broker. Resolves session → company → secret key →
 * payment_intent → stripe.refunds.create. Idempotent-ish: refunding an already
 * refunded PI returns Stripe's charge_already_refunded as a 200 no-op.
 *
 * Body: { sessionId, amount? /* MAJOR units; omitted = full refund *​/, reason? }
 * → 200 { ok, refundId, status } | 401 bad key / project mismatch | 404 session/creds | 502 stripe error
 */
export async function POST(request: NextRequest) {
  const projectKey = request.headers.get('x-project-key') || ''
  const mapping = findMappingByApiKey(projectKey)
  if (!mapping) {
    return NextResponse.json({ error: 'Invalid project key' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sessionId, amount, reason } = body || {}
  if (!sessionId || typeof sessionId !== 'string') {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const session = getCheckoutSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'Unknown sessionId' }, { status: 404 })
  }
  // A project key may only refund its own sessions.
  if (session.projectSlug !== mapping.projectSlug) {
    return NextResponse.json({ error: 'sessionId does not belong to this project' }, { status: 401 })
  }

  const creds = getCredentials(session.companySlug)
  const secretKey = creds?.[session.env]?.secretKey
  if (!secretKey) {
    return NextResponse.json({ error: `No ${session.env} credentials for "${session.companySlug}"` }, { status: 404 })
  }

  const stripe = new Stripe(secretKey)
  try {
    // Resolve the payment_intent — from the record, else from the live session.
    let paymentIntentId = session.paymentIntentId
    if (!paymentIntentId) {
      const s = await stripe.checkout.sessions.retrieve(sessionId)
      paymentIntentId = (typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id) || undefined
    }
    if (!paymentIntentId) {
      return NextResponse.json({ error: 'No payment to refund (session not paid)' }, { status: 400 })
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(typeof amount === 'number' && amount > 0 ? { amount: Math.round(amount * 100) } : {}),
      ...(reason ? { metadata: { reason: String(reason).slice(0, 200) } } : {}),
    })
    return NextResponse.json({ ok: true, refundId: refund.id, status: refund.status })
  } catch (e: any) {
    // Already-refunded → treat as success (idempotent for retries).
    if (e?.code === 'charge_already_refunded') {
      return NextResponse.json({ ok: true, alreadyRefunded: true })
    }
    console.error('[refund] stripe error:', e?.message || e)
    return NextResponse.json({ error: e?.message || 'Refund failed' }, { status: 502 })
  }
}
