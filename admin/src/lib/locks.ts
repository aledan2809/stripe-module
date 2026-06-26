/**
 * In-process keyed async mutex (S5).
 *
 * The broker runs as a single `next start` process (not clustered), so a
 * process-level mutex is enough to serialize read-modify-write sequences that
 * span an `await` — e.g. the webhook handler reads a session record, awaits the
 * callback dispatch, then writes back `processedEventIds`. Two concurrent
 * webhooks for the SAME session would otherwise clobber each other's writes.
 *
 * Locks are keyed (typically by sessionId) so different sessions still run in
 * parallel; only same-key sections are serialized.
 *
 * NOTE: this does NOT protect against a second OS process (e.g. a clustered
 * deploy). If the broker is ever clustered, switch the store to SQLite / a real
 * file lock. Documented in AUDIT_GAPS (S5 residual).
 */
const chains = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  // Chain fn after whatever is currently queued for this key; swallow the
  // predecessor's rejection so one failure doesn't poison the queue.
  const run = prev.catch(() => undefined).then(fn)
  // Keep the chain pointer current; clean up when this is the tail to avoid
  // unbounded Map growth.
  chains.set(key, run)
  run.catch(() => undefined).finally(() => {
    if (chains.get(key) === run) chains.delete(key)
  })
  return run
}
