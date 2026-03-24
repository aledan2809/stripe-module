import Stripe from 'stripe'
import { getStripe } from '../client'
import { toStripeAmount } from '../utils'

// --- Types ---

export interface CreateRefundInput {
  /** Stripe PaymentIntent ID */
  paymentIntentId: string
  /** Amount to refund in real currency. If omitted, full refund. */
  amount?: number
  /** Reason for refund */
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  /** Metadata */
  metadata?: Record<string, string>
}

export interface RefundInfo {
  id: string
  paymentIntentId: string
  amount: number
  status: string
  reason: string | null
  created: Date
}

// --- Functions ---

/**
 * Create a refund for a payment.
 */
export async function createRefund(input: CreateRefundInput): Promise<Stripe.Refund> {
  const stripe = await getStripe()

  const params: Stripe.RefundCreateParams = {
    payment_intent: input.paymentIntentId,
    reason: input.reason,
    metadata: input.metadata,
  }

  if (input.amount !== undefined) {
    params.amount = toStripeAmount(input.amount)
  }

  return stripe.refunds.create(params)
}

/**
 * Get a refund by ID.
 */
export async function getRefund(refundId: string): Promise<Stripe.Refund> {
  const stripe = await getStripe()
  return stripe.refunds.retrieve(refundId)
}

/**
 * List refunds for a payment intent.
 */
export async function listRefunds(paymentIntentId: string): Promise<Stripe.Refund[]> {
  const stripe = await getStripe()
  const result = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
  })
  return result.data
}
