import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * Checkout Broker storage + crypto + callback dispatch.
 *
 * The broker holds Stripe keys (in credentials.json) so consumer apps never do.
 * Flow:
 *   consumer → POST /api/checkout (X-Project-Key)  → broker creates Stripe session, stores a record
 *   Stripe   → POST /api/stripe/webhook/[company]   → broker verifies, finds record, dispatches callback
 *   broker   → POST <callbackUrl> (X-Broker-Signature) → consumer reacts
 */

// Mirror data.ts resolution so both read the same data/ dir.
function resolveDataDir(): string {
  if (process.env.STRIPE_ADMIN_DATA_DIR) return process.env.STRIPE_ADMIN_DATA_DIR
  const candidates = [
    path.resolve(process.cwd(), '../data'),
    path.resolve(process.cwd(), 'data'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'companies.json'))) return dir
  }
  return candidates[0]
}

const DATA_DIR = resolveDataDir()
const SESSIONS_FILE = 'checkout-sessions.json'

// ─── Types ──────────────────────────────────────────────────────────

export interface CheckoutSessionRecord {
  sessionId: string
  /** Stable ref injected into session + payment_intent metadata to map PI failures back to a session */
  brokerRef: string
  projectSlug: string
  companySlug: string
  env: 'test' | 'live'
  callbackUrl: string
  callbackSecret: string
  /** Opaque consumer metadata — echoed back unchanged */
  metadata: Record<string, unknown>
  currency: string
  status: 'created' | 'paid' | 'expired' | 'failed'
  paymentIntentId?: string
  createdAt: string
  /** Stripe event ids already dispatched (idempotency) */
  processedEventIds: string[]
  dispatched: Array<{ event: string; at: string; ok: boolean; statusCode?: number }>
}

export type BrokerCallbackEvent =
  | 'payment.succeeded'
  | 'payment.expired'
  | 'payment.failed'

export interface BrokerCallbackPayload {
  event: BrokerCallbackEvent
  sessionId: string
  projectSlug: string
  metadata: Record<string, unknown>
  paymentStatus: string
  /** Stripe minor units (cents) — same scale Stripe returns */
  amountTotal: number | null
  currency: string
  stripePaymentIntentId: string | null
}

// ─── Store (JSON file) ──────────────────────────────────────────────

interface SessionStore {
  sessions: Record<string, CheckoutSessionRecord>
}

function readStore(): SessionStore {
  const filePath = path.join(DATA_DIR, SESSIONS_FILE)
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionStore
  } catch {
    return { sessions: {} }
  }
}

function writeStore(store: SessionStore): void {
  const filePath = path.join(DATA_DIR, SESSIONS_FILE)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8')
}

export function saveCheckoutSession(record: CheckoutSessionRecord): void {
  const store = readStore()
  store.sessions[record.sessionId] = record
  writeStore(store)
}

export function getCheckoutSession(sessionId: string): CheckoutSessionRecord | undefined {
  return readStore().sessions[sessionId]
}

export function findSessionByBrokerRef(brokerRef: string): CheckoutSessionRecord | undefined {
  if (!brokerRef) return undefined
  return Object.values(readStore().sessions).find(s => s.brokerRef === brokerRef)
}

/** Apply a patch to a stored record (re-reads to avoid clobbering concurrent webhook writes). */
export function updateCheckoutSession(
  sessionId: string,
  patch: Partial<CheckoutSessionRecord>
): CheckoutSessionRecord | undefined {
  const store = readStore()
  const existing = store.sessions[sessionId]
  if (!existing) return undefined
  const merged = { ...existing, ...patch }
  store.sessions[sessionId] = merged
  writeStore(store)
  return merged
}

// ─── Crypto ─────────────────────────────────────────────────────────

/** Generate a per-project API key + callback secret (shown once in the admin UI). */
export function generateBrokerKeys(): { apiKey: string; callbackSecret: string } {
  return {
    apiKey: 'pk_proj_' + crypto.randomBytes(24).toString('hex'),
    callbackSecret: 'cbs_' + crypto.randomBytes(32).toString('hex'),
  }
}

export function newBrokerRef(): string {
  return 'bref_' + crypto.randomBytes(16).toString('hex')
}

/** Stripe-compatible major→minor conversion (matches the library's toStripeAmount). */
export function toStripeAmount(amount: number): number {
  return Math.round(amount * 100)
}

export function signCallback(rawBody: string, callbackSecret: string): string {
  return crypto.createHmac('sha256', callbackSecret).update(rawBody, 'utf8').digest('hex')
}

// ─── Callback dispatch (broker → consumer app) ──────────────────────

const CALLBACK_ATTEMPTS = 3
const CALLBACK_BACKOFF_MS = [0, 500, 1500]

/**
 * POST the signed payload to the consumer's callbackUrl.
 * Retries on network error / non-2xx (bounded, in-request).
 * Returns the final outcome — the caller decides whether to 5xx so Stripe retries the webhook.
 */
export async function dispatchCallback(
  record: CheckoutSessionRecord,
  payload: BrokerCallbackPayload
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const rawBody = JSON.stringify(payload)
  const signature = signCallback(rawBody, record.callbackSecret)

  let last: { ok: boolean; statusCode?: number; error?: string } = { ok: false }
  for (let attempt = 0; attempt < CALLBACK_ATTEMPTS; attempt++) {
    if (CALLBACK_BACKOFF_MS[attempt]) {
      await new Promise(r => setTimeout(r, CALLBACK_BACKOFF_MS[attempt]))
    }
    try {
      const res = await fetch(record.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Broker-Signature': signature,
        },
        body: rawBody,
      })
      last = { ok: res.ok, statusCode: res.status }
      if (res.ok) return last
    } catch (e) {
      last = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return last
}
