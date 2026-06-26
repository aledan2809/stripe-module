import crypto from 'crypto'

/**
 * Envelope encryption for Stripe secrets at rest (S1).
 *
 * `data/credentials.json` holds `sk_…` / `whsec_…` — money-path secrets. They are
 * gitignored but were stored in plaintext on disk. When `STRIPE_DATA_KEY` (a
 * base64 32-byte key) is present we encrypt secret fields with AES-256-GCM before
 * writing and decrypt on read. Publishable keys (`pk_…`) are NOT secret and stay
 * plaintext.
 *
 * Backward compatible by design:
 *  - No key set            → encrypt() returns plaintext, decrypt() passes through.
 *    The broker keeps working exactly as before (plaintext at rest).
 *  - Key set, value plaintext (pre-migration) → decrypt() passes it through.
 *  - Key set, value encrypted → decrypt() returns the secret.
 *  - Value encrypted, key MISSING → decrypt() throws (fail loud, never silently
 *    hand a wrong/empty key to Stripe).
 *
 * Migration of an existing plaintext store: `admin/scripts/encrypt-credentials.mjs`.
 */

const PREFIX = 'enc:v1:'

function loadKey(): Buffer | null {
  const raw = process.env.STRIPE_DATA_KEY
  if (!raw) return null
  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new Error('STRIPE_DATA_KEY is not valid base64')
  }
  if (key.length !== 32) {
    throw new Error(`STRIPE_DATA_KEY must decode to 32 bytes (got ${key.length})`)
  }
  return key
}

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/** Encrypt a secret for storage. Empty strings and already-encrypted values pass through. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext
  if (isEncrypted(plaintext)) return plaintext
  const key = loadKey()
  if (!key) return plaintext // no key configured → store plaintext (legacy behavior)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

/** Decrypt a stored secret. Plaintext (legacy) values pass through unchanged. */
export function decryptSecret(value: string): string {
  if (!value || !isEncrypted(value)) return value
  const key = loadKey()
  if (!key) {
    throw new Error('Encountered an encrypted secret but STRIPE_DATA_KEY is not set')
  }
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8')
}

/** True when at-rest encryption is active (key configured). */
export function encryptionEnabled(): boolean {
  return loadKey() !== null
}
