import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCredentials, getCompanies } from '@/lib/data'

/**
 * GET /api/invoices — read-only browser of Stripe invoices, per company + env.
 *
 *   (no company)                          → { companies: [{slug,name}] } for the selector
 *   ?company=<slug>&env=test|live
 *     [&status=draft|open|paid|void|uncollectible] [&starting_after=<id>]
 *                                          → { invoices, hasMore, next }
 *
 * Uses the company's Stripe secret key (held in the broker) to list invoices.
 * Read-only — never emits/voids/pays. The secret key is NEVER returned.
 * Gated by middleware (localhost / nginx basic-auth on prod).
 */

const VALID_STATUS = new Set(['draft', 'open', 'paid', 'uncollectible', 'void'])

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const company = searchParams.get('company') || ''
  const env: 'test' | 'live' = searchParams.get('env') === 'live' ? 'live' : 'test'
  const status = searchParams.get('status') || ''
  const startingAfter = searchParams.get('starting_after') || ''

  if (!company) {
    return NextResponse.json({ companies: getCompanies().map(c => ({ slug: c.slug, name: c.name })) })
  }

  const creds = getCredentials(company)
  const secretKey = creds?.[env]?.secretKey
  if (!secretKey) {
    return NextResponse.json({ error: `Firma "${company}" nu are cheie Stripe ${env}` }, { status: 400 })
  }

  try {
    const stripe = new Stripe(secretKey)
    const params: Stripe.InvoiceListParams = { limit: 50 }
    if (status && VALID_STATUS.has(status)) params.status = status as Stripe.InvoiceListParams.Status
    if (startingAfter) params.starting_after = startingAfter

    const list = await stripe.invoices.list(params)
    const invoices = list.data.map(inv => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      customerEmail: inv.customer_email,
      customerName: inv.customer_name,
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      created: inv.created,
      hostedInvoiceUrl: inv.hosted_invoice_url,
      invoicePdf: inv.invoice_pdf,
    }))
    const next = invoices.length ? invoices[invoices.length - 1].id : null
    return NextResponse.json({ invoices, hasMore: list.has_more, next })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
