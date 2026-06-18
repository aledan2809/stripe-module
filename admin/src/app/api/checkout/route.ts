import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { findMappingByApiKey, getCredentials } from '@/lib/data'
import {
  saveCheckoutSession,
  newBrokerRef,
  toStripeAmount,
  type CheckoutSessionRecord,
} from '@/lib/broker'
import { createInvoiceCustomer, ensureTaxRate } from '@/lib/invoicing'

/**
 * POST /api/checkout — Checkout Broker entry point.
 *
 * Consumer apps create Stripe Checkout sessions WITHOUT holding any Stripe key.
 * Auth: X-Project-Key (per-project apiKey). The Stripe key stays here.
 *
 * Body: {
 *   projectSlug, currency, successUrl, cancelUrl, callbackUrl,
 *   lineItems: [{ name, description?, amount /* MAJOR units, 29 = $29 *​/, quantity? }],
 *   metadata?: {...}   // opaque, echoed back unchanged on callbacks
 * }
 * → 200 { url, sessionId } | 401 bad key | 404 unmapped / no creds | 503 disabled | 400 bad body
 */
export async function POST(request: NextRequest) {
  const projectKey = request.headers.get('x-project-key') || ''
  const mapping = findMappingByApiKey(projectKey)
  if (!mapping) {
    return NextResponse.json({ error: 'Invalid project key' }, { status: 401 })
  }

  if (mapping.brokerEnabled === false) {
    return NextResponse.json({ error: 'Broker disabled for this project' }, { status: 503 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { projectSlug, lineItems, currency, successUrl, cancelUrl, callbackUrl, metadata, customerEmail } = body || {}

  if (projectSlug && projectSlug !== mapping.projectSlug) {
    return NextResponse.json({ error: 'projectSlug does not match the project key' }, { status: 401 })
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return NextResponse.json({ error: 'lineItems[] required' }, { status: 400 })
  }
  if (!currency || !successUrl || !cancelUrl || !callbackUrl) {
    return NextResponse.json(
      { error: 'currency, successUrl, cancelUrl, callbackUrl required' },
      { status: 400 }
    )
  }
  // The broker POSTs a signed payload to callbackUrl — restrict to http(s) to avoid
  // file://, data:, and other non-network schemes being passed through.
  try {
    const proto = new URL(callbackUrl).protocol
    if (proto !== 'https:' && proto !== 'http:') throw new Error('bad scheme')
  } catch {
    return NextResponse.json({ error: 'callbackUrl must be a valid http(s) URL' }, { status: 400 })
  }
  for (const item of lineItems) {
    if (!item?.name || typeof item.amount !== 'number' || item.amount < 0) {
      return NextResponse.json(
        { error: 'each lineItem needs name + amount (major units, >= 0)' },
        { status: 400 }
      )
    }
  }

  // Resolve the company whose Stripe key the broker uses for this project.
  const companySlug = mapping.brokerCompany
  const env = mapping.brokerEnv || 'test'
  if (!companySlug) {
    return NextResponse.json({ error: 'Project has no broker company assigned' }, { status: 404 })
  }

  const creds = getCredentials(companySlug)
  const secretKey = creds?.[env]?.secretKey
  if (!secretKey) {
    return NextResponse.json(
      { error: `No ${env} Stripe credentials for company "${companySlug}"` },
      { status: 404 }
    )
  }

  const stripe = new Stripe(secretKey)
  const brokerRef = newBrokerRef()
  const echoMetadata: Record<string, unknown> = metadata && typeof metadata === 'object' ? metadata : {}

  // Stripe metadata values must be strings; carry the broker_ref on both the session
  // and the resulting payment_intent so PI-level failures map back to this record.
  const stripeMetadata: Record<string, string> = { broker_ref: brokerRef, project_slug: mapping.projectSlug }

  try {
    // Invoicing (opt-in via body.invoicing): create a Stripe Customer (+ a
    // best-effort tax id) and a reusable VAT rate, so the session issues + emails
    // a PDF tax invoice. Backward-compatible — skipped entirely when not requested.
    const wantsInvoice = body?.invoicing === true
    let invoiceCustomerId: string | undefined
    let taxRateId: string | undefined
    if (wantsInvoice) {
      // Guard the consumer-supplied VAT rate before it reaches Stripe — a rate
      // outside [0,1] would make taxRates.create throw and abort the sale.
      if (body.vat && typeof body.vat.rate === 'number' && (body.vat.rate < 0 || body.vat.rate > 1)) {
        return NextResponse.json({ error: 'vat.rate must be between 0 and 1' }, { status: 400 })
      }
      invoiceCustomerId = await createInvoiceCustomer(stripe, body.customer || {}, body.taxId || null)
      if (body.vat && typeof body.vat.rate === 'number') {
        taxRateId = await ensureTaxRate(stripe, companySlug, env, body.vat)
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems.map((item: any) => ({
        price_data: {
          currency,
          product_data: {
            name: String(item.name),
            ...(item.description ? { description: String(item.description) } : {}),
          },
          unit_amount: toStripeAmount(item.amount),
        },
        quantity: item.quantity || 1,
        ...(taxRateId ? { tax_rates: [taxRateId] } : {}),
      })),
      success_url: successUrl,
      cancel_url: cancelUrl,
      // A Customer (invoicing) and customer_email are mutually exclusive: when we
      // created a Customer above use it, else keep the optional email prefill.
      ...(invoiceCustomerId
        ? { customer: invoiceCustomerId }
        : typeof customerEmail === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail) && customerEmail.length <= 254
          ? { customer_email: customerEmail }
          : {}),
      ...(wantsInvoice
        ? { invoice_creation: { enabled: true, invoice_data: { footer: body?.vat?.note || undefined, metadata: stripeMetadata } } }
        : {}),
      metadata: stripeMetadata,
      payment_intent_data: { metadata: stripeMetadata },
    })

    const record: CheckoutSessionRecord = {
      sessionId: session.id,
      brokerRef,
      projectSlug: mapping.projectSlug,
      companySlug,
      env,
      callbackUrl,
      callbackSecret: mapping.callbackSecret || '',
      metadata: echoMetadata,
      currency,
      status: 'created',
      createdAt: new Date().toISOString(),
      processedEventIds: [],
      dispatched: [],
    }
    saveCheckoutSession(record)

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (error: any) {
    console.error('[broker] checkout create failed:', error?.message)
    return NextResponse.json(
      { error: error?.message || 'Checkout creation failed' },
      { status: 502 }
    )
  }
}
