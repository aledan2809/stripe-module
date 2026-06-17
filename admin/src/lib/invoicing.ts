/**
 * Invoicing helpers for the checkout broker — opt-in per checkout (body.invoicing).
 *
 * When a consumer requests an invoice we: (1) create a Stripe Customer carrying
 * the buyer's address + (best-effort) tax id, and (2) ensure a reusable Stripe
 * TaxRate exists for the supplied VAT decision. The route then attaches the
 * customer + tax rate to the Checkout Session and enables invoice_creation so
 * Stripe finalizes + emails a PDF tax invoice / receipt.
 *
 * Tax rates are treated as VAT-INCLUSIVE — UAE consumer prices must include VAT,
 * so a $30 line stays $30 total (≈ $28.57 + $1.43 VAT at 5%). Export 0% leaves
 * the total unchanged. The pure rate/code/note come from @aledan/invoice on the
 * consumer side; the broker only renders what it's given.
 */
import type Stripe from 'stripe'
import { getCachedTaxRate, cacheTaxRate } from './data'

export interface InvoiceVat {
  rate: number
  code: string
  label?: string
  note?: string
}

export interface InvoiceCustomerInput {
  name?: string
  email?: string
  country?: string
  addressLine?: string
  city?: string
  companyName?: string
}

export interface InvoiceTaxId {
  type: string
  value: string
}

/**
 * Ensure a reusable Stripe TaxRate for (company, env, vat.code) exists; cache its
 * id. Inclusive rate (consumer prices include VAT). 0% is a valid rate for the
 * zero-rated export line.
 */
export async function ensureTaxRate(
  stripe: Stripe,
  companySlug: string,
  env: string,
  vat: InvoiceVat,
): Promise<string> {
  const key = `${companySlug}:${env}:${vat.code}`
  const cached = getCachedTaxRate(key)
  if (cached) return cached
  const rate = await stripe.taxRates.create({
    display_name: vat.code === 'AE_ZERO_EXPORT' ? 'VAT (export, zero-rated)' : 'VAT',
    description: vat.note || undefined,
    percentage: Number((vat.rate * 100).toFixed(4)),
    inclusive: true,
    country: 'AE',
  })
  cacheTaxRate(key, rate.id)
  return rate.id
}

/**
 * Create a Stripe Customer with the buyer's address + (best-effort) tax id. An
 * invalid tax id must NOT block the sale — the customer is created without it and
 * a warning is logged (the buyer still gets a valid simplified invoice).
 */
export async function createInvoiceCustomer(
  stripe: Stripe,
  customer: InvoiceCustomerInput,
  taxId: InvoiceTaxId | null | undefined,
): Promise<string> {
  const address = customer.country
    ? {
        country: customer.country,
        ...(customer.addressLine ? { line1: customer.addressLine } : {}),
        ...(customer.city ? { city: customer.city } : {}),
      }
    : undefined

  const created = await stripe.customers.create({
    ...(customer.name ? { name: customer.name } : {}),
    ...(customer.email ? { email: customer.email } : {}),
    ...(address ? { address } : {}),
  })

  if (taxId?.type && taxId?.value) {
    try {
      await stripe.customers.createTaxId(created.id, {
        type: taxId.type as Stripe.TaxIdCreateParams['type'],
        value: taxId.value,
      })
    } catch (e) {
      console.warn('[broker] tax id rejected — customer created without it:', e instanceof Error ? e.message : e)
    }
  }
  return created.id
}
