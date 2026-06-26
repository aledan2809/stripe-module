import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { findMappingByApiKey, getCredentials } from '@/lib/data'
import { getCheckoutSession, findSessionBySubscriptionId } from '@/lib/broker'
import { rateLimit } from '@/lib/guard'

/**
 * POST /api/portal — Customer Billing Portal for consumer apps.
 *
 * The subscription's Stripe Customer lives on the company's Stripe account (the
 * broker holds the key), so a consumer app can't open a portal on its own. It
 * asks the broker, which resolves the stored customerId → a billingPortal session.
 *
 * Auth: X-Project-Key. Body: { sessionId | subscriptionId, returnUrl }
 * → 200 { url } | 401 bad key / not your session | 404 unknown session / no creds
 *   | 400 bad body / customer not set yet | 429 rate limited | 502 stripe error
 */
export async function POST(request: NextRequest) {
  const projectKey = request.headers.get('x-project-key') || ''
  const mapping = findMappingByApiKey(projectKey)
  if (!mapping) {
    return NextResponse.json({ error: 'Invalid project key' }, { status: 401 })
  }

  if (!rateLimit('portal', projectKey)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sessionId, subscriptionId, returnUrl } = body || {}
  if (!returnUrl || typeof returnUrl !== 'string') {
    return NextResponse.json({ error: 'returnUrl required' }, { status: 400 })
  }
  try {
    const proto = new URL(returnUrl).protocol
    if (proto !== 'https:' && proto !== 'http:') throw new Error('bad scheme')
  } catch {
    return NextResponse.json({ error: 'returnUrl must be a valid http(s) URL' }, { status: 400 })
  }
  if (!sessionId && !subscriptionId) {
    return NextResponse.json({ error: 'sessionId or subscriptionId required' }, { status: 400 })
  }

  const record = sessionId
    ? getCheckoutSession(String(sessionId))
    : findSessionBySubscriptionId(String(subscriptionId))
  if (!record) {
    return NextResponse.json({ error: 'Unknown session/subscription' }, { status: 404 })
  }
  // A project key may only open portals for its own sessions.
  if (record.projectSlug !== mapping.projectSlug) {
    return NextResponse.json({ error: 'session does not belong to this project' }, { status: 401 })
  }
  if (!record.customerId) {
    return NextResponse.json(
      { error: 'No Stripe customer on this session yet (not activated)' },
      { status: 400 }
    )
  }

  const creds = getCredentials(record.companySlug)
  const secretKey = creds?.[record.env]?.secretKey
  if (!secretKey) {
    return NextResponse.json({ error: `No ${record.env} credentials for "${record.companySlug}"` }, { status: 404 })
  }

  const stripe = new Stripe(secretKey)
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: record.customerId,
      return_url: returnUrl,
    })
    return NextResponse.json({ url: portal.url })
  } catch (e: any) {
    console.error('[portal] stripe error:', e?.message || e)
    return NextResponse.json({ error: e?.message || 'Portal creation failed' }, { status: 502 })
  }
}
