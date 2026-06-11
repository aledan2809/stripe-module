/**
 * E2E test for the Checkout Broker API (admin app must be running on BASE).
 * Verifies: mapping keygen → /api/checkout → signed webhook → HMAC callback →
 * idempotency + error paths (401 bad key, 400 bad signature, 503 disabled).
 *
 * Run:  node scripts/broker-e2e.mjs            (admin on http://localhost:3114)
 */
import http from 'http'
import crypto from 'crypto'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const Stripe = require('stripe')

const BASE = process.env.BROKER_BASE || 'http://localhost:3114'
const COMPANY = 'class-rda'
const PROJECT = 'ave'

// Load class-rda test creds (the broker uses them server-side; we need the webhook secret to sign).
const creds = require('../../data/credentials.json').companies[COMPANY].test
const stripe = new Stripe(creds.secretKey)

const results = []
const rec = (id, ok, note) => { results.push({ id, ok, note }); console.log(`${ok ? '✅' : '❌'} ${id}: ${note}`) }

// ── local callback receiver (the consumer app) ──────────────────────
let received = []
const cbServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    received.push({ sig: req.headers['x-broker-signature'], body })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
})
const cbPort = 4599
await new Promise(r => cbServer.listen(cbPort, r))
const callbackUrl = `http://localhost:${cbPort}/cb`

const main = async () => {
  // 1. Create broker mapping for `ave` → class-rda (test). Returns generated keys.
  const mapRes = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: PROJECT, projectPath: '/var/www/ave',
      subscriptionCompany: '', subscriptionEnv: 'test',
      serviceCompany: '', serviceEnv: 'test',
      brokerCompany: COMPANY, brokerEnv: 'test',
      regenerateBrokerKeys: true,
    }),
  })
  const mapData = await mapRes.json()
  const apiKey = mapData?.brokerKeys?.apiKey
  const callbackSecret = mapData?.brokerKeys?.callbackSecret
  rec('mapping-keygen', !!(apiKey && callbackSecret), apiKey ? `apiKey=${apiKey.slice(0, 16)}… secret set` : JSON.stringify(mapData))

  // 2. 401 — bad project key
  const bad = await fetch(`${BASE}/api/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Key': 'pk_proj_wrong' },
    body: JSON.stringify({ projectSlug: PROJECT, lineItems: [{ name: 'x', amount: 1 }], currency: 'usd', successUrl: 'https://e.com/s', cancelUrl: 'https://e.com/c', callbackUrl }),
  })
  rec('checkout-401-bad-key', bad.status === 401, `status=${bad.status}`)

  // 3. POST /api/checkout (valid)
  const coRes = await fetch(`${BASE}/api/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Key': apiKey },
    body: JSON.stringify({
      projectSlug: PROJECT,
      lineItems: [{ name: 'AVE Audit Pro', description: 'Full site audit', amount: 29, quantity: 1 }],
      currency: 'usd',
      successUrl: 'https://app.techbiz.ae/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.techbiz.ae/cancel',
      callbackUrl,
      metadata: { auditId: 'aud_123', orderId: 'ord_789', productType: 'audit' },
    }),
  })
  const co = await coRes.json()
  const sessionId = co.sessionId
  rec('checkout-create', coRes.status === 200 && !!co.url && /checkout\.stripe\.com/.test(co.url) && !!sessionId, `status=${coRes.status} session=${sessionId}`)

  // 4. Build a signed checkout.session.completed event (paid) referencing sessionId.
  const eventId = 'evt_test_' + crypto.randomBytes(8).toString('hex')
  const eventPayload = JSON.stringify({
    id: eventId, object: 'event', type: 'checkout.session.completed',
    data: { object: {
      id: sessionId, object: 'checkout.session',
      payment_status: 'paid', status: 'complete',
      amount_total: 2900, currency: 'usd',
      payment_intent: 'pi_test_broker_001',
      metadata: { broker_ref: 'unused-direct-id-lookup' },
    }},
  })
  const sigHeader = stripe.webhooks.generateTestHeaderString({ payload: eventPayload, secret: creds.webhookSecret })

  received = []
  const whRes = await fetch(`${BASE}/api/stripe/webhook/${COMPANY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sigHeader },
    body: eventPayload,
  })
  rec('webhook-accept', whRes.status === 200, `status=${whRes.status}`)

  // 5. callback received + HMAC valid + fields echoed
  await new Promise(r => setTimeout(r, 300))
  const cb = received[0]
  let cbOk = false, cbNote = 'no callback'
  if (cb) {
    const expectSig = crypto.createHmac('sha256', callbackSecret).update(cb.body, 'utf8').digest('hex')
    const payload = JSON.parse(cb.body)
    const sigMatch = expectSig === cb.sig
    const fieldsOk = payload.event === 'payment.succeeded' && payload.sessionId === sessionId &&
      payload.metadata?.auditId === 'aud_123' && payload.metadata?.orderId === 'ord_789' &&
      payload.amountTotal === 2900 && payload.currency === 'usd' && payload.stripePaymentIntentId === 'pi_test_broker_001'
    cbOk = sigMatch && fieldsOk
    cbNote = `hmac=${sigMatch} event=${payload.event} metadata-echo=${payload.metadata?.auditId} amount=${payload.amountTotal}`
  }
  rec('callback-hmac+fields', cbOk, cbNote)

  // 6. Idempotency — same event again → no second callback
  received = []
  const dupRes = await fetch(`${BASE}/api/stripe/webhook/${COMPANY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sigHeader },
    body: eventPayload,
  })
  await new Promise(r => setTimeout(r, 200))
  const dupBody = await dupRes.json()
  rec('webhook-idempotent', dupRes.status === 200 && dupBody.idempotent === true && received.length === 0, `status=${dupRes.status} idempotent=${dupBody.idempotent} extra-callbacks=${received.length}`)

  // 7. 400 — bad signature
  const badSig = await fetch(`${BASE}/api/stripe/webhook/${COMPANY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=deadbeef' },
    body: eventPayload,
  })
  rec('webhook-400-bad-sig', badSig.status === 400, `status=${badSig.status}`)

  // 8. 503 — broker disabled
  await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectSlug: PROJECT, projectPath: '/var/www/ave', subscriptionCompany: '', serviceCompany: '', brokerCompany: COMPANY, brokerEnv: 'test', brokerEnabled: false }),
  })
  const disabled = await fetch(`${BASE}/api/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Key': apiKey },
    body: JSON.stringify({ projectSlug: PROJECT, lineItems: [{ name: 'x', amount: 1 }], currency: 'usd', successUrl: 'https://e.com/s', cancelUrl: 'https://e.com/c', callbackUrl }),
  })
  rec('checkout-503-disabled', disabled.status === 503, `status=${disabled.status}`)

  cbServer.close()
  const fails = results.filter(r => !r.ok)
  console.log(`\n══ ${results.length - fails.length}/${results.length} PASS ══`)
  process.exit(fails.length ? 1 : 0)
}

main().catch(e => { console.error('FATAL', e); cbServer.close(); process.exit(2) })
