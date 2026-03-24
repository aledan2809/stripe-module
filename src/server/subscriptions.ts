import Stripe from 'stripe'
import { getStripe } from '../client'

// --- Types ---

export interface CreateSubscriptionInput {
  customerId: string
  /** Stripe Price ID */
  priceId: string
  /** Trial period in days */
  trialDays?: number
  /** Metadata */
  metadata?: Record<string, string>
  /** Payment behavior: 'default_incomplete' requires client-side confirmation */
  paymentBehavior?: 'default_incomplete' | 'allow_incomplete' | 'error_if_incomplete'
  /** Coupon or promotion code */
  couponId?: string
}

export interface UpdateSubscriptionInput {
  subscriptionId: string
  /** New Price ID (for plan changes) */
  priceId?: string
  /** Cancel at period end instead of immediately */
  cancelAtPeriodEnd?: boolean
  /** Metadata */
  metadata?: Record<string, string>
  /** Proration behavior */
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice'
}

export interface SubscriptionInfo {
  id: string
  status: Stripe.Subscription.Status
  customerId: string
  priceId: string
  productId: string
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  trialEnd: Date | null
  metadata: Record<string, string>
}

// --- Functions ---

/**
 * Create a subscription for a customer.
 */
export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<Stripe.Subscription> {
  const stripe = await getStripe()

  const params: Stripe.SubscriptionCreateParams = {
    customer: input.customerId,
    items: [{ price: input.priceId }],
    metadata: input.metadata,
    payment_behavior: input.paymentBehavior || 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  }

  if (input.trialDays) {
    params.trial_period_days = input.trialDays
  }

  if (input.couponId) {
    params.coupon = input.couponId
  }

  return stripe.subscriptions.create(params)
}

/**
 * Get a subscription by ID.
 */
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = await getStripe()
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['latest_invoice.payment_intent', 'default_payment_method'],
  })
}

/**
 * List subscriptions for a customer.
 */
export async function listSubscriptions(
  customerId: string,
  status?: Stripe.SubscriptionListParams.Status
): Promise<Stripe.Subscription[]> {
  const stripe = await getStripe()
  const result = await stripe.subscriptions.list({
    customer: customerId,
    status: status || 'all',
    expand: ['data.default_payment_method'],
  })
  return result.data
}

/**
 * Update a subscription (change plan, cancel at period end, etc.).
 */
export async function updateSubscription(
  input: UpdateSubscriptionInput
): Promise<Stripe.Subscription> {
  const stripe = await getStripe()

  const params: Stripe.SubscriptionUpdateParams = {
    metadata: input.metadata,
    proration_behavior: input.prorationBehavior || 'create_prorations',
  }

  if (input.cancelAtPeriodEnd !== undefined) {
    params.cancel_at_period_end = input.cancelAtPeriodEnd
  }

  if (input.priceId) {
    // Get current subscription to find the item ID
    const sub = await stripe.subscriptions.retrieve(input.subscriptionId)
    params.items = [{
      id: sub.items.data[0].id,
      price: input.priceId,
    }]
  }

  return stripe.subscriptions.update(input.subscriptionId, params)
}

/**
 * Cancel a subscription immediately.
 */
export async function cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = await getStripe()
  return stripe.subscriptions.cancel(subscriptionId)
}

/**
 * Cancel a subscription at the end of the current billing period.
 */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return updateSubscription({
    subscriptionId,
    cancelAtPeriodEnd: true,
  })
}

/**
 * Resume a subscription that was set to cancel at period end.
 */
export async function resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return updateSubscription({
    subscriptionId,
    cancelAtPeriodEnd: false,
  })
}

/**
 * Extract simplified subscription info from a Stripe subscription object.
 */
export function toSubscriptionInfo(sub: Stripe.Subscription): SubscriptionInfo {
  const item = sub.items.data[0]
  return {
    id: sub.id,
    status: sub.status,
    customerId: sub.customer as string,
    priceId: item.price.id,
    productId: item.price.product as string,
    currentPeriodStart: new Date(sub.current_period_start * 1000),
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    metadata: (sub.metadata || {}) as Record<string, string>,
  }
}
