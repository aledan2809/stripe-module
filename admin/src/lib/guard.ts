import crypto from 'crypto'

/**
 * Money-path request hygiene for the public broker endpoints (S7).
 *  - timing-safe project-key comparison
 *  - in-memory per-key rate limiting on /api/checkout + /api/refund
 *
 * Single-process, best-effort: the window resets on restart and is not shared
 * across a clustered deploy. It exists to blunt abuse of a leaked project key,
 * not as a hard quota.
 */

/** Constant-time string equality (avoids leaking key length/prefix via timing). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a || '', 'utf8')
  const bb = Buffer.from(b || '', 'utf8')
  // Hash to a fixed length so unequal lengths don't early-return (and don't throw).
  const ah = crypto.createHash('sha256').update(ab).digest()
  const bh = crypto.createHash('sha256').update(bb).digest()
  return crypto.timingSafeEqual(ah, bh) && ab.length === bb.length
}

interface Window {
  count: number
  resetAt: number
}
const buckets = new Map<string, Window>()

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60

/**
 * Returns true when the request is allowed; false when the per-key window is
 * exhausted. Keyed by `<scope>:<projectKey>` so checkout + refund have
 * independent budgets.
 */
export function rateLimit(scope: string, projectKey: string): boolean {
  const key = `${scope}:${projectKey}`
  const now = Date.now()
  const w = buckets.get(key)
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (w.count >= MAX_PER_WINDOW) return false
  w.count++
  return true
}
