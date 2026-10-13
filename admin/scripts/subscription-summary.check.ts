/**
 * Checks summarizeSubscription on both Stripe shapes (period on the subscription before 2025-03-31, on the
 * items since). Run: npx tsx scripts/subscription-summary.check.ts — exits 1 on a mismatch.
 */
import assert from 'node:assert/strict'
import { summarizeSubscription } from '../src/lib/subscription-summary'

const T = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)
const item = (unit: number, qty = 1, extra: Record<string, unknown> = {}) => ({ price: { unit_amount: unit, currency: 'ron', recurring: { interval: 'month' } }, quantity: qty, ...extra })

// Older API: period on the subscription; two lines (a second subject).
const older = summarizeSubscription({
  status: 'active', currency: 'ron', current_period_end: T('2026-11-13T10:00:00Z'), cancel_at_period_end: false, cancel_at: null, trial_end: null, ended_at: null,
  items: { data: [item(3486), item(2440)] },
} as any)
assert.deepEqual(older, {
  status: 'active', currentPeriodEnd: '2026-11-13T10:00:00.000Z', cancelAtPeriodEnd: false, cancelAt: null, trialEnd: null, endedAt: null,
  recurringAmount: 5926, currency: 'ron', interval: 'month',
})

// Newer API (basil/clover): period on the items; a stop scheduled with cancel_at.
const newer = summarizeSubscription({
  status: 'trialing', currency: 'ron', cancel_at_period_end: false, cancel_at: T('2026-10-20T08:00:00Z'), trial_end: T('2026-10-20T08:00:00Z'), ended_at: null,
  items: { data: [item(4980, 1, { current_period_end: T('2026-10-20T08:00:00Z') })] },
} as any)
assert.equal(newer.currentPeriodEnd, '2026-10-20T08:00:00.000Z')
assert.equal(newer.cancelAtPeriodEnd, true)
assert.equal(newer.cancelAt, '2026-10-20T08:00:00.000Z')
assert.equal(newer.trialEnd, '2026-10-20T08:00:00.000Z')
assert.equal(newer.recurringAmount, 4980)

// The flag without a date: the stop is at the period's end.
const flagged = summarizeSubscription({ status: 'active', current_period_end: T('2026-11-13T10:00:00Z'), cancel_at_period_end: true, items: { data: [item(4980)] } } as any)
assert.equal(flagged.cancelAt, '2026-11-13T10:00:00.000Z')

// A cancelled subscription: ended_at, and a past cancel_at is not "scheduled".
const ended = summarizeSubscription({ status: 'canceled', cancel_at: T('2026-10-13T10:00:00Z'), ended_at: T('2026-10-13T10:00:00Z'), items: { data: [] } } as any)
assert.equal(ended.cancelAtPeriodEnd, false)
assert.equal(ended.endedAt, '2026-10-13T10:00:00.000Z')
assert.equal(ended.recurringAmount, null)

console.log('subscription-summary: 4/4 OK')
