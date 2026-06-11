/**
 * Smoke-test: send a signed checkout.session.completed event to a consumer webhook.
 * Keys come from env — canonical store: Master/credentials/stripe.env (G-STRIPE-002: no hardcoded keys).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... WEBHOOK_SECRET=whsec_... \
 *   WEBHOOK_URL=https://techbiz.ae/api/payments/webhook node test-aiwebauditor-webhook.mjs
 */
import Stripe from 'stripe'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.AIWEBAUDITOR_STRIPE_WEBHOOK_SECRET
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://techbiz.ae/api/payments/webhook'

if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
  console.error('Missing env: STRIPE_SECRET_KEY + WEBHOOK_SECRET (see Master/credentials/stripe.env)')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY)

// Construct a minimal checkout.session.completed payload
const payload = JSON.stringify({
  id: 'evt_test_webhook_verify_' + Date.now(),
  object: 'event',
  api_version: '2024-06-20',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_' + Date.now(),
      object: 'checkout.session',
      amount_total: 2900,
      currency: 'usd',
      customer_email: 'test@example.com',
      metadata: { plan: 'starter' },
      payment_status: 'paid',
      status: 'complete',
    }
  }
})

// Generate a valid Stripe signature header
const header = stripe.webhooks.generateTestHeaderString({
  payload,
  secret: WEBHOOK_SECRET,
})

console.log('Sending test checkout.session.completed to:', WEBHOOK_URL)
console.log('Payload size:', payload.length, 'bytes')
console.log('Signature header:', header.substring(0, 60) + '...')

const res = await fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Stripe-Signature': header,
  },
  body: payload,
})

console.log('\nResponse status:', res.status)
const body = await res.text()
console.log('Response body:', body.substring(0, 300))

if (res.status === 200) {
  console.log('\n✅ Webhook signature verified and endpoint returned 200')
} else if (res.status === 400) {
  console.log('\n❌ 400 — likely signature validation failure or payload error')
} else {
  console.log('\n⚠️  Unexpected status — check server logs')
}
