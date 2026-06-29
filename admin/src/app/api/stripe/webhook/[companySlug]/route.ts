import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCredentials } from '@/lib/data'
import {
  getCheckoutSession,
  findSessionByBrokerRef,
  findSessionBySubscriptionId,
  updateCheckoutSession,
  dispatchCallback,
  CALLBACK_VERSION,
  type CheckoutSessionRecord,
  type BrokerCallbackEvent,
  type BrokerCallbackPayload,
} from '@/lib/broker'
import { withLock } from '@/lib/locks'
import { maybeSendInvoiceEmail, type InvoiceLike } from '@/lib/email'

/**
 * POST /api/stripe/webhook/[companySlug] — Stripe → broker, one endpoint per company.
 *
 * Each company's Stripe webhook points here with its own companySlug so the broker
 * knows which webhook secret to verify against. The signature is checked on the RAW body.
 * Handled events:
 *   checkout.session.completed (payment, paid)       → payment.succeeded
 *   checkout.session.completed (subscription)        → subscription.activated
 *   checkout.session.expired                         → payment.expired
 *   payment_intent.payment_failed                    → payment.failed
 *   invoice.paid (renewal, not first invoice)        → subscription.renewed
 *   invoice.payment_failed                           → subscription.payment_failed
 *   customer.subscription.deleted                    → subscription.canceled
 *
 * Idempotent (Stripe delivers duplicates). On callback-dispatch failure we return 500 so
 * Stripe retries the webhook; the event id is only marked processed AFTER a successful dispatch.
 */

/** Robustly read the subscription id off an Invoice across Stripe API versions. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } }
  }
  if (typeof inv.subscription === 'string') return inv.subscription
  if (inv.subscription && typeof inv.subscription === 'object' && inv.subscription.id) return inv.subscription.id
  const nested = inv.parent?.subscription_details?.subscription
  if (typeof nested === 'string') return nested
  if (nested && typeof nested === 'object' && nested.id) return nested.id
  return null
}

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
  let matchedSecretKey = ''
  for (const c of candidates) {
    try {
      const stripe = new Stripe(c.secretKey)
      event = stripe.webhooks.constructEvent(rawBody, signature, c.webhookSecret)
      matchedSecretKey = c.secretKey
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
  let subscriptionId: string | null = null
  let subscriptionStatus: string | null = null
  let customerId: string | null = null
  let newStatus: CheckoutSessionRecord['status'] | null = null
  // Invoice-email source: a session's invoice id (retrieved later) or a renewal invoice object.
  let sessionInvoiceId: string | null = null
  let renewalInvoice: Stripe.Invoice | null = null

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    record = getCheckoutSession(session.id) || findSessionByBrokerRef(session.metadata?.broker_ref || '')
    // Persist the Stripe Customer so the consumer can later open a Billing Portal.
    customerId = typeof session.customer === 'string' ? session.customer : null
    // Invoice id (string or expanded) → retrieved later for the invoice email.
    sessionInvoiceId = typeof session.invoice === 'string'
      ? session.invoice
      : (session.invoice && typeof session.invoice === 'object' ? (session.invoice as { id?: string }).id || null : null)
    if (session.mode === 'subscription') {
      // Subscription checkout completed → a Stripe Subscription now exists.
      subscriptionId = typeof session.subscription === 'string' ? session.subscription : null
      callbackEvent = 'subscription.activated'
      paymentStatus = session.payment_status || ''
      amountTotal = session.amount_total
      currency = session.currency || record?.currency || ''
      subscriptionStatus = 'active'
      newStatus = 'active'
    } else {
      if (session.payment_status !== 'paid') {
        return NextResponse.json({ received: true, ignored: 'not paid' })
      }
      callbackEvent = 'payment.succeeded'
      paymentStatus = session.payment_status
      amountTotal = session.amount_total
      currency = session.currency || record?.currency || ''
      paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
      newStatus = 'paid'
    }
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
  } else if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice
    // Skip the first invoice (subscription creation) — activation already notified the consumer.
    if (invoice.billing_reason === 'subscription_create') {
      return NextResponse.json({ received: true, ignored: 'subscription_create invoice' })
    }
    const subId = invoiceSubscriptionId(invoice)
    record = subId ? findSessionBySubscriptionId(subId) : undefined
    renewalInvoice = invoice
    callbackEvent = 'subscription.renewed'
    paymentStatus = invoice.status || 'paid'
    amountTotal = invoice.amount_paid
    currency = invoice.currency || record?.currency || ''
    subscriptionId = subId
    subscriptionStatus = 'active'
    newStatus = 'active'
  } else if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const subId = invoiceSubscriptionId(invoice)
    record = subId ? findSessionBySubscriptionId(subId) : undefined
    callbackEvent = 'subscription.payment_failed'
    paymentStatus = invoice.status || 'open'
    amountTotal = invoice.amount_due
    currency = invoice.currency || record?.currency || ''
    subscriptionId = subId
    subscriptionStatus = 'past_due'
    newStatus = 'past_due'
  } else if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    record = findSessionBySubscriptionId(sub.id) || findSessionByBrokerRef(sub.metadata?.broker_ref || '')
    callbackEvent = 'subscription.canceled'
    paymentStatus = sub.status
    currency = record?.currency || ''
    subscriptionId = sub.id
    subscriptionStatus = sub.status
    newStatus = 'canceled'
  } else {
    // Unhandled event type — acknowledge so Stripe stops retrying.
    return NextResponse.json({ received: true, ignored: event.type })
  }

  if (!record) {
    // No matching record (e.g. a session not created via this broker). Acknowledge.
    return NextResponse.json({ received: true, ignored: 'no matching session' })
  }

  // Serialize the read-modify-write critical section per session (S5): two
  // concurrent webhooks for the same session must not clobber each other's
  // processedEventIds. Re-read the record fresh under the lock so the idempotency
  // check and the final write both see the latest persisted state.
  const sessionId = record.sessionId
  return withLock(sessionId, async () => {
    const fresh = getCheckoutSession(sessionId) || record!

    // Idempotency: if this exact Stripe event was already dispatched, ack without re-sending.
    if (fresh.processedEventIds.includes(event.id)) {
      return NextResponse.json({ received: true, idempotent: true })
    }

    const payload: BrokerCallbackPayload = {
      v: CALLBACK_VERSION,
      t: Math.floor(Date.now() / 1000),
      event: callbackEvent!,
      sessionId: fresh.sessionId,
      projectSlug: fresh.projectSlug,
      metadata: fresh.metadata,
      paymentStatus,
      amountTotal,
      currency,
      stripePaymentIntentId: paymentIntentId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus,
    }

    const result = await dispatchCallback(fresh, payload)

    const dispatched = [
      ...fresh.dispatched,
      { event: callbackEvent!, at: new Date().toISOString(), ok: result.ok, statusCode: result.statusCode },
    ]

    if (!result.ok) {
      // Persist the attempt but do NOT mark the event processed → return 500 so Stripe retries.
      updateCheckoutSession(sessionId, { dispatched })
      return NextResponse.json(
        { error: 'Callback dispatch failed', detail: result.error || result.statusCode },
        { status: 500 }
      )
    }

    updateCheckoutSession(sessionId, {
      status: newStatus,
      paymentIntentId: paymentIntentId || fresh.paymentIntentId,
      ...(subscriptionId ? { subscriptionId } : {}),
      ...(customerId ? { customerId } : {}),
      processedEventIds: [...fresh.processedEventIds, event.id],
      dispatched,
    })

    // ── Invoice email (ADDITIVE, fail-soft) ──────────────────────────────
    // Runs only on money-in events, only after the callback succeeded above.
    // maybeSendInvoiceEmail never throws; the extra try/catch double-guards the
    // Stripe invoice retrieval so an email failure can NEVER change this HTTP status.
    if (callbackEvent === 'payment.succeeded' || callbackEvent === 'subscription.activated' || callbackEvent === 'subscription.renewed') {
      try {
        let invoiceForEmail: InvoiceLike | null = renewalInvoice as InvoiceLike | null
        if (!invoiceForEmail && sessionInvoiceId && matchedSecretKey) {
          const inv = await new Stripe(matchedSecretKey).invoices.retrieve(sessionInvoiceId)
          invoiceForEmail = inv as unknown as InvoiceLike
        }
        await maybeSendInvoiceEmail(fresh.projectSlug, invoiceForEmail)
      } catch (e) {
        console.error('[broker] invoice email step failed (non-blocking):', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({ received: true, dispatched: callbackEvent })
  })
}
