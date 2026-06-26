import fs from 'fs'

/**
 * Atomic JSON-file write for the broker's money-path data store (S5).
 *
 * Plain `fs.writeFileSync` truncates-then-writes: a crash mid-write leaves a
 * half-written (corrupt) file. Writing to a sibling temp file and `rename`-ing
 * it over the target is atomic on the same filesystem — readers see either the
 * old file or the new one, never a partial.
 *
 * Files hold Stripe secrets (credentials.json) so we also enforce mode 0600.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, data, { encoding: 'utf-8', mode: 0o600 })
  try {
    fs.renameSync(tmp, filePath)
  } catch (e) {
    // Clean up the temp file on a failed rename so we don't leak .tmp-* litter.
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
    throw e
  }
  // Re-assert restrictive perms on the final file (rename preserves the tmp's mode,
  // but be explicit in case the target pre-existed with looser perms).
  try { fs.chmodSync(filePath, 0o600) } catch { /* best-effort on non-POSIX */ }
}
