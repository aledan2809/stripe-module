import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCredentials } from '@/lib/data'
import {
  getCheckoutSession,
  findSessionByBrokerRef,
  updateCheckoutSession,
  dispatchCallback,
  type CheckoutSessionRecord,
  type BrokerCallbackEvent,
  type BrokerCallbackPayload,
} from '@/lib/broker'

/**
 * POST /api/stripe/webhook/[companySlug] — Stripe → broker, one endpoint per company.
 *
 * Each company's Stripe webhook points here with its own companySlug so the broker
 * knows which webhook secret to verify against. The signature is checked on the RAW body.
 * Handled events:
 *   checkout.session.completed (only payment_status='paid') → payment.succeeded
 *   checkout.session.expired                                → payment.expired
 *   payment_intent.payment_failed                           → payment.failed
 *
 * Idempotent (Stripe delivers duplicates). On callback-dispatch failure we return 500 so
 * Stripe retries the webhook; the event id is only marked processed AFTER a successful dispatch.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companySlug: string }> }
) {
  const { companySlug } = await params
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const creds = getCredentials(companySlug)

  // A company can have both test + live webhook secrets; try each so one endpoint
  // per company serves both environments.
  const candidates: Array<{ env: 'test' | 'live'; secretKey: string; webhookSecret: string }> = []
  for (const env of ['test', 'live'] as const) {
    const k = creds?.[env]
    if (k?.webhookSecret) {
      candidates.push({ env, secretKey: k.secretKey || 'sk_placeholder', webhookSecret: k.webhookSecret })
    }
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: `No webhook secret for company "${companySlug}"` }, { status: 404 })
  }

  let event: Stripe.Event | null = null
  for (const c of candidates) {
    try {
      const stripe = new Stripe(c.secretKey)
      event = stripe.webhooks.constructEvent(rawBody, signature, c.webhookSecret)
      break
    } catch {
      // try next env's secret
    }
  }
  if (!event) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Map event → record + callback intent.
  let record: CheckoutSessionRecord | undefined
  let callbackEvent: BrokerCallbackEvent | null = null
  let paymentStatus = ''
  let amountTotal: number | null = null
  let currency = ''
  let paymentIntentId: string | null = null
  let newStatus: CheckoutSessionRecord['status'] | null = null

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true, ignored: 'not paid' })
    }
    record = getCheckoutSession(session.id) || findSessionByBrokerRef(session.metadata?.broker_ref || '')
    callbackEvent = 'payment.succeeded'
    paymentStatus = session.payment_status
    amountTotal = session.amount_total
    currency = session.currency || record?.currency || ''
    paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
    newStatus = 'paid'
  } else if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session
    record = getCheckoutSession(session.id) || findSessionByBrokerRef(session.metadata?.broker_ref || '')
    callbackEvent = 'payment.expired'
    paymentStatus = session.payment_status || 'expired'
    amountTotal = session.amount_total
    currency = session.currency || record?.currency || ''
    paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
    newStatus = 'expired'
  } else if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent
    record = findSessionByBrokerRef(pi.metadata?.broker_ref || '')
    callbackEvent = 'payment.failed'
    paymentStatus = pi.status
    amountTotal = pi.amount
    currency = pi.currency || record?.currency || ''
    paymentIntentId = pi.id
    newStatus = 'failed'
  } else {
    // Unhandled event type — acknowledge so Stripe stops retrying.
    return NextResponse.json({ received: true, ignored: event.type })
  }

  if (!record) {
    // No matching record (e.g. a session not created via this broker). Acknowledge.
    return NextResponse.json({ received: true, ignored: 'no matching session' })
  }

  // Idempotency: if this exact Stripe event was already dispatched, ack without re-sending.
  if (record.processedEventIds.includes(event.id)) {
    return NextResponse.json({ received: true, idempotent: true })
  }

  const payload: BrokerCallbackPayload = {
    event: callbackEvent,
    sessionId: record.sessionId,
    projectSlug: record.projectSlug,
    metadata: record.metadata,
    paymentStatus,
    amountTotal,
    currency,
    stripePaymentIntentId: paymentIntentId,
  }

  const result = await dispatchCallback(record, payload)

  const dispatched = [
    ...record.dispatched,
    { event: callbackEvent, at: new Date().toISOString(), ok: result.ok, statusCode: result.statusCode },
  ]

  if (!result.ok) {
    // Persist the attempt but do NOT mark the event processed → return 500 so Stripe retries.
    updateCheckoutSession(record.sessionId, { dispatched })
    return NextResponse.json(
      { error: 'Callback dispatch failed', detail: result.error || result.statusCode },
      { status: 500 }
    )
  }

  updateCheckoutSession(record.sessionId, {
    status: newStatus,
    paymentIntentId: paymentIntentId || record.paymentIntentId,
    processedEventIds: [...record.processedEventIds, event.id],
    dispatched,
  })

  return NextResponse.json({ received: true, dispatched: callbackEvent })
}
