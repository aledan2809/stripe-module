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
// In-process single-flight per cache key: concurrent first-time checkouts for the
// same (company,env,code) share ONE creation instead of racing to create
// duplicate Stripe TaxRate objects + clobbering the JSON cache.
const inflightRates = new Map<string, Promise<string>>()

export async function ensureTaxRate(
  stripe: Stripe,
  companySlug: string,
  env: string,
  vat: InvoiceVat,
): Promise<string> {
  const key = `${companySlug}:${env}:${vat.code}`
  const cached = getCachedTaxRate(key)
  if (cached) return cached
  const existing = inflightRates.get(key)
  if (existing) return existing

  const display = vat.code === 'AE_ZERO_EXPORT' ? 'VAT (export, zero-rated)' : 'VAT'
  const pct = Number((vat.rate * 100).toFixed(4))

  const work = (async (): Promise<string> => {
    // Re-check the cache in case a sibling call just wrote it.
    const c2 = getCachedTaxRate(key)
    if (c2) return c2
    // Reuse a matching active rate if one already exists on the account — survives
    // a lost cache (restart / fresh data dir) without creating duplicates.
    try {
      const list = await stripe.taxRates.list({ active: true, limit: 100 })
      const match = list.data.find(
        (r) => r.display_name === display && r.percentage === pct && r.inclusive === true && r.country === 'AE',
      )
      if (match) {
        cacheTaxRate(key, match.id)
        return match.id
      }
    } catch {
      // list failed — fall through to create
    }
    const rate = await stripe.taxRates.create({
      display_name: display,
      description: vat.note || undefined,
      percentage: pct,
      inclusive: true,
      country: 'AE',
    })
    cacheTaxRate(key, rate.id)
    return rate.id
  })().finally(() => inflightRates.delete(key))

  inflightRates.set(key, work)
  return work
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
  // Only put an address on the Customer when country is a valid ISO-3166 alpha-2.
  // A non-ISO value (e.g. "UK" from a future consumer) would make Stripe reject the
  // create and abort the whole sale — degrade to "no address" instead of failing.
  const iso = typeof customer.country === 'string' && /^[A-Za-z]{2}$/.test(customer.country.trim())
    ? customer.country.trim().toUpperCase()
    : undefined
  const address = iso
    ? {
        country: iso,
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
