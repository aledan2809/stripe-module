import Stripe from 'stripe'
import { getStripe } from '../client'
import { getConfig } from '../config'
import { toStripeAmount } from '../utils'

// --- Types ---

export interface CheckoutLineItem {
  /** Product name */
  name: string
  /** Description (optional) */
  description?: string
  /** Unit amount in real currency (e.g., 49.99), NOT cents */
  amount: number
  /** Quantity (default: 1) */
  quantity?: number
  /** Image URLs (optional) */
  images?: string[]
}

export interface CheckoutPriceItem {
  /** Existing Stripe Price ID */
  priceId: string
  /** Quantity (default: 1) */
  quantity?: number
}

export interface CreateCheckoutSessionInput {
  /** Line items with inline pricing */
  lineItems?: CheckoutLineItem[]
  /** Line items with existing Stripe Price IDs */
  priceItems?: CheckoutPriceItem[]
  /** 'payment' for one-time, 'subscription' for recurring */
  mode: 'payment' | 'subscription' | 'setup'
  /** URL to redirect on success. Use {CHECKOUT_SESSION_ID} placeholder. */
  successUrl: string
  /** URL to redirect on cancel */
  cancelUrl: string
  /** Stripe Customer ID (optional) */
  customerId?: string
  /** Pre-fill customer email (if no customerId) */
  customerEmail?: string
  /** Metadata on the session */
  metadata?: Record<string, string>
  /** Allow promotion codes */
  allowPromotionCodes?: boolean
  /** Collect billing address */
  billingAddressCollection?: 'auto' | 'required'
  /** Tax ID collection */
  taxIdCollection?: boolean
  /** Currency override */
  currency?: string
  /** Trial period in days (subscription mode only) */
  trialDays?: number
  /** Automatic tax calculation */
  automaticTax?: boolean
}

export interface CheckoutSessionResult {
  sessionId: string
  url: string
}

// --- Functions ---

/**
 * Create a Stripe Checkout Session.
 * Supports both inline line items and existing Price IDs.
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<CheckoutSessionResult> {
  const stripe = await getStripe()
  const config = getConfig()
  const currency = input.currency || config.currency

  // Build line items
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []

  // Inline line items (with ad-hoc pricing)
  if (input.lineItems?.length) {
    for (const item of input.lineItems) {
      lineItems.push({
        price_data: {
          currency,
          product_data: {
            name: item.name,
            description: item.description,
            images: item.images,
          },
          unit_amount: toStripeAmount(item.amount),
          ...(input.mode === 'subscription' ? { recurring: { interval: 'month' } } : {}),
        },
        quantity: item.quantity || 1,
      })
    }
  }

  // Existing Price ID line items
  if (input.priceItems?.length) {
    for (const item of input.priceItems) {
      lineItems.push({
        price: item.priceId,
        quantity: item.quantity || 1,
      })
    }
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: input.mode,
    line_items: lineItems,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: input.metadata,
    allow_promotion_codes: input.allowPromotionCodes,
    billing_address_collection: input.billingAddressCollection,
  }

  if (input.customerId) {
    params.customer = input.customerId
  } else if (input.customerEmail) {
    params.customer_email = input.customerEmail
  }

  if (input.taxIdCollection) {
    params.tax_id_collection = { enabled: true }
  }

  if (input.automaticTax) {
    params.automatic_tax = { enabled: true }
  }

  if (input.mode === 'subscription' && input.trialDays) {
    params.subscription_data = {
      trial_period_days: input.trialDays,
    }
  }

  const session = await stripe.checkout.sessions.create(params)

  return {
    sessionId: session.id,
    url: session.url!,
  }
}

/**
 * Retrieve a Checkout Session by ID.
 */
export async function getCheckoutSession(
  sessionId: string,
  expandLineItems = false
): Promise<Stripe.Checkout.Session> {
  const stripe = await getStripe()
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: expandLineItems ? ['line_items'] : [],
  })
}
