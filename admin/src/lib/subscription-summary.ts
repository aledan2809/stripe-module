import Stripe from 'stripe'

/**
 * What a consumer app needs to show a subscriber where their billing stands — the paid period, when
 * the next charge is due (or when access ends, if they cancelled), the trial's end and what a period
 * costs. Sent on every subscription.* callback (contract v3, additive) and by POST /api/subscription.
 *
 * Read across Stripe API versions: since 2025-03-31 (basil) the period lives on the subscription
 * items, before that on the subscription itself.
 */
export interface SubscriptionSummary {
  /** Stripe status: trialing | active | past_due | unpaid | canceled | incomplete | ... */
  status: string
  /** End of the period paid for (or of the trial) — the next charge date while it renews. ISO. */
  currentPeriodEnd: string | null
  /** The subscriber asked to stop: it won't renew, access ends at `cancelAt`. */
  cancelAtPeriodEnd: boolean
  /** When it stops (a scheduled cancellation), ISO. */
  cancelAt: string | null
  /** End of the free trial, ISO (null without a trial). */
  trialEnd: string | null
  /** When it ended (a cancelled subscription), ISO. */
  endedAt: string | null
  /** One period at list prices (sum of items × quantity), minor units. Discounts not applied. */
  recurringAmount: number | null
  currency: string | null
  /** month | year | week | day — the first item's. */
  interval: string | null
}

const iso = (sec: unknown): string | null =>
  typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : null

/** Pure: summarize a Stripe Subscription object (from an event or a retrieve). */
export function summarizeSubscription(subscription: Stripe.Subscription): SubscriptionSummary {
  const sub = subscription as unknown as Record<string, any>
  const items: any[] = Array.isArray(sub.items?.data) ? sub.items.data : []
  const periodEnd = sub.current_period_end ?? items.map((i) => i?.current_period_end).find((v) => typeof v === 'number')
  let amount: number | null = null
  for (const item of items) {
    const unit = item?.price?.unit_amount
    if (typeof unit !== 'number') continue
    amount = (amount ?? 0) + unit * (typeof item.quantity === 'number' ? item.quantity : 1)
  }
  const cancelAt = iso(sub.cancel_at)
  return {
    status: typeof sub.status === 'string' ? sub.status : 'unknown',
    currentPeriodEnd: iso(periodEnd),
    // Newer API versions schedule a cancellation with cancel_at instead of the flag.
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) || (cancelAt !== null && sub.status !== 'canceled'),
    cancelAt: cancelAt ?? (sub.cancel_at_period_end ? iso(periodEnd) : null),
    trialEnd: iso(sub.trial_end),
    endedAt: iso(sub.ended_at),
    recurringAmount: amount,
    currency: typeof sub.currency === 'string' ? sub.currency : (items[0]?.price?.currency ?? null),
    interval: items[0]?.price?.recurring?.interval ?? null,
  }
}

/** Retrieve + summarize; null on any failure (a callback is never held back by it). */
export async function fetchSubscriptionSummary(secretKey: string, subscriptionId: string | null): Promise<SubscriptionSummary | null> {
  if (!secretKey || !subscriptionId) return null
  try {
    const sub = await new Stripe(secretKey).subscriptions.retrieve(subscriptionId)
    return summarizeSubscription(sub)
  } catch (e) {
    console.error('[broker] subscription summary failed (non-blocking):', e instanceof Error ? e.message : e)
    return null
  }
}
