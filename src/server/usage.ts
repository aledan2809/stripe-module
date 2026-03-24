import Stripe from 'stripe'
import { getStripe } from '../client'

// --- Types ---

export interface ReportUsageInput {
  /** Subscription Item ID (NOT subscription ID) */
  subscriptionItemId: string
  /** Usage quantity to report */
  quantity: number
  /** Timestamp for the usage event (default: now) */
  timestamp?: Date
  /** 'increment' adds to existing, 'set' replaces */
  action?: 'increment' | 'set'
}

export interface UsageSummary {
  subscriptionItemId: string
  totalUsage: number
  period: {
    start: Date
    end: Date
  }
}

// --- Functions ---

/**
 * Report usage for a metered subscription item.
 * Used for usage-based billing (e.g., per audit, per test run).
 */
export async function reportUsage(input: ReportUsageInput): Promise<Stripe.UsageRecord> {
  const stripe = await getStripe()

  return stripe.subscriptionItems.createUsageRecord(input.subscriptionItemId, {
    quantity: input.quantity,
    timestamp: input.timestamp
      ? Math.floor(input.timestamp.getTime() / 1000)
      : 'now' as any,
    action: input.action || 'increment',
  })
}

/**
 * Get usage summary for a subscription item in the current billing period.
 */
export async function getUsageSummary(subscriptionItemId: string): Promise<UsageSummary[]> {
  const stripe = await getStripe()

  const summaries = await stripe.subscriptionItems.listUsageRecordSummaries(
    subscriptionItemId,
    { limit: 10 }
  )

  return summaries.data.map((s) => ({
    subscriptionItemId: s.subscription_item,
    totalUsage: s.total_usage,
    period: {
      start: new Date((s.period.start ?? 0) * 1000),
      end: new Date((s.period.end ?? 0) * 1000),
    },
  }))
}

/**
 * Get the subscription item ID from a subscription (needed for reportUsage).
 */
export async function getSubscriptionItemId(subscriptionId: string): Promise<string> {
  const stripe = await getStripe()
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  return sub.items.data[0].id
}

/**
 * Convenience: report usage directly with a subscription ID.
 */
export async function reportUsageForSubscription(
  subscriptionId: string,
  quantity: number,
  action: 'increment' | 'set' = 'increment'
): Promise<Stripe.UsageRecord> {
  const itemId = await getSubscriptionItemId(subscriptionId)
  return reportUsage({
    subscriptionItemId: itemId,
    quantity,
    action,
  })
}
