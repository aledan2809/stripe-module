/**
 * True E2E [10] — workflow scenarios S1-S11 pentru @projects/stripe-module.
 * Rulează pe Stripe TEST mode. Cheile se parsează din Master/credentials/stripe.env
 * (parser propriu — NU `source`, parolele/cheile pot conține metacaractere shell).
 *
 * Usage:  node scripts/true-e2e-scenarios.mjs
 * Roluri: Integrator (apeluri de modul) · Buyer (pm_card_visa) · Seller (cont Connect) · Platform (sync/refund).
 */
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ─── Load TEST keys (safe parse, no shell) ───────────────────────────
const credPath = process.env.STRIPE_CREDENTIALS_FILE
  || path.join(process.env.HOME || '', 'Projects/Master/credentials/stripe.env')
for (const line of fs.readFileSync(credPath, 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('ABORT: cheia nu e sk_test_ — scenariile rulează DOAR pe test mode.')
  process.exit(2)
}

// ─── Module under test (dist/, CJS — submodules ca să evităm react/ai-router din index) ───
const root = path.resolve(__dirname, '..')
const { createCheckoutSession } = require(path.join(root, 'dist/server/checkout.js'))
const { createPaymentIntent } = require(path.join(root, 'dist/server/create-intent.js'))
const { verifyWebhookSignature } = require(path.join(root, 'dist/server/webhook.js'))
const { createRefund, getRefund } = require(path.join(root, 'dist/server/refunds.js'))
const { createCustomer, deleteCustomer } = require(path.join(root, 'dist/server/customers.js'))
const { createSubscription, cancelSubscription } = require(path.join(root, 'dist/server/subscriptions.js'))
const { syncPlans, getPlanMapping } = require(path.join(root, 'dist/server/sync.js'))
const { createConnectedAccount, createAccountLink, createMarketplacePayment, deleteConnectedAccount } = require(path.join(root, 'dist/server/connect.js'))
const { createPortalSession } = require(path.join(root, 'dist/server/billing-portal.js'))
const { createProductWithPrice } = require(path.join(root, 'dist/server/products.js'))
const { toStripeAmount } = require(path.join(root, 'dist/utils.js'))
const { getStripe } = require(path.join(root, 'dist/client.js'))
const { resolveCredentials, setCompanyCredentials } = require(path.join(root, 'dist/companies/credentials.js'))

const RUN = `true-e2e-${Date.now()}`
const results = []
const cleanup = []

async function scenario(id, role, fn) {
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ id, role, status: 'PASS', ms: Date.now() - t0, note: note || '' })
    console.log(`✅ ${id} PASS (${Date.now() - t0}ms) ${note || ''}`)
  } catch (e) {
    const blocked = e.__blocked
    results.push({ id, role, status: blocked ? 'BLOCKED' : 'FAIL', ms: Date.now() - t0, note: String(e.message).slice(0, 220) })
    console.log(`${blocked ? '⛔' : '❌'} ${id} ${blocked ? 'BLOCKED' : 'FAIL'}: ${String(e.message).slice(0, 220)}`)
  }
}
const blocked = (msg) => { const e = new Error(msg); e.__blocked = true; return e }

// ─── Scenarios ───────────────────────────────────────────────────────
const main = async () => {
  let piS3, customer, subPriceId, connectedId

  await scenario('S1-checkout-payment', 'Integrator', async () => {
    const r = await createCheckoutSession({
      mode: 'payment',
      lineItems: [{ name: `Audit item ${RUN}`, amount: 49.99, quantity: 1 }],
      successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://example.com/cancel',
      metadata: { run: RUN },
    })
    if (!r.url?.startsWith('https://checkout.stripe.com')) throw new Error('URL invalid: ' + r.url)
    return r.sessionId
  })

  await scenario('S2-checkout-subscription-trial', 'Integrator', async () => {
    const r = await createCheckoutSession({
      mode: 'subscription',
      lineItems: [{ name: `Audit plan ${RUN}`, amount: 29.99 }],
      trialDays: 7,
      successUrl: 'https://example.com/s', cancelUrl: 'https://example.com/c',
      metadata: { run: RUN },
    })
    if (!r.url?.startsWith('https://checkout.stripe.com')) throw new Error('URL invalid')
    return r.sessionId
  })

  await scenario('S3-payment-intent-confirm', 'Buyer', async () => {
    const r = await createPaymentIntent({ amount: 100.0, description: `Audit PI ${RUN}`, metadata: { run: RUN } })
    const stripe = await getStripe()
    const confirmed = await stripe.paymentIntents.confirm(r.paymentIntentId, {
      payment_method: 'pm_card_visa',
      return_url: 'https://example.com/return',
    })
    if (confirmed.status !== 'succeeded') throw new Error('status=' + confirmed.status)
    piS3 = r.paymentIntentId
    return `${r.paymentIntentId} succeeded, amount=${confirmed.amount}`
  })

  await scenario('S4-webhook-signature', 'Integrator', async () => {
    const stripe = await getStripe()
    const payload = JSON.stringify({ id: `evt_${RUN}`, object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_x' } } })
    const secret = 'whsec_test_secret_for_audit'
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    const ev = verifyWebhookSignature({ rawBody: payload, signature: header, webhookSecret: secret })
    if (ev.type !== 'payment_intent.succeeded') throw new Error('event type greșit')
    // negative: semnătură coruptă
    let rejected = false
    try { verifyWebhookSignature({ rawBody: payload, signature: header.replace(/v1=\w{6}/, 'v1=000000'), webhookSecret: secret }) } catch { rejected = true }
    if (!rejected) throw new Error('semnătura coruptă NU a fost respinsă')
    // negative: secret greșit
    rejected = false
    try { verifyWebhookSignature({ rawBody: payload, signature: header, webhookSecret: 'whsec_wrong' }) } catch { rejected = true }
    if (!rejected) throw new Error('secretul greșit NU a fost respins')
    return 'valid acceptat + 2 negative respinse'
  })

  await scenario('S5-refund-full-and-partial', 'Platform', async () => {
    if (!piS3) throw new Error('S3 nu a produs PaymentIntent')
    const partial = await createRefund({ paymentIntentId: piS3, amount: 30.0, reason: 'requested_by_customer' })
    if (partial.status !== 'succeeded') throw new Error('partial status=' + partial.status)
    const rest = await createRefund({ paymentIntentId: piS3 })
    if (rest.status !== 'succeeded') throw new Error('full status=' + rest.status)
    const check = await getRefund(partial.id)
    if (check.amount !== toStripeAmount(30.0)) throw new Error('partial amount mismatch: ' + check.amount)
    return `partial 30.00 + rest 70.00 pe ${piS3}`
  })

  await scenario('S7-plan-sync-lifecycle', 'Platform', async () => {
    const project = RUN
    const plan = (amount) => [{ slug: 'audit-basic', name: 'Audit Basic', description: 'plan de audit', prices: [{ amount, interval: 'month' }] }]
    const r1 = await syncPlans(project, plan(19.99))
    if (r1.created.products !== 1 || r1.created.prices !== 1) throw new Error('create: ' + JSON.stringify(r1.created))
    // G-STRIPE-010: products.search e eventually-consistent (~16-60s) — așteptăm convergența
    // ÎNAINTE de re-sync (altfel fiecare re-sync creează un produs duplicat — verificat empiric 2026-06-11).
    let visible = false
    for (let i = 0; i < 18 && !visible; i++) {
      await new Promise(s => setTimeout(s, 5000))
      visible = Object.keys(await getPlanMapping(project)).length > 0
    }
    if (!visible) throw new Error('search nu a convers în 90s — nu pot testa idempotența')
    const r2 = await syncPlans(project, plan(19.99))
    if (r2.created.products !== 0 || r2.created.prices !== 0) throw new Error('re-sync NU e idempotent: ' + JSON.stringify(r2))
    const r3 = await syncPlans(project, plan(24.99))
    if (r3.created.prices !== 1 || r3.deactivated.prices !== 1) throw new Error('price change: ' + JSON.stringify({ c: r3.created, d: r3.deactivated }))
    subPriceId = r3.mapping['audit-basic'].prices.find(p => p.active)?.priceId
    const r4 = await syncPlans(project, [])
    if (r4.deactivated.products !== 1) throw new Error('remove plan: ' + JSON.stringify(r4.deactivated))
    cleanup.push(async () => { /* produsele rămân dezactivate în test mode — ok */ })
    return `create→idempotent→price-change(nou+dezactivat)→remove(dezactivat); priceId=${subPriceId}`
  })

  await scenario('S6-customer-subscription-cancel', 'Buyer', async () => {
    customer = await createCustomer({ email: `audit+${RUN}@example.com`, name: 'Audit Buyer', metadata: { run: RUN } })
    cleanup.push(async () => deleteCustomer(customer.id).catch(() => {}))
    // preț propriu (decuplat de S7 — vezi G-STRIPE-010)
    const { product, prices } = await createProductWithPrice(
      { name: `Audit sub plan ${RUN}`, metadata: { run: RUN } },
      { amount: 9.99, recurring: { interval: 'month' } }
    )
    const price = prices[0]
    const stripe = await getStripe()
    cleanup.push(async () => stripe.products.update(product.id, { active: false }).catch(() => {}))
    const sub = await createSubscription({ customerId: customer.id, priceId: price.id, trialDays: 7 })
    if (sub.status !== 'trialing') throw new Error('status=' + sub.status)
    const canceled = await cancelSubscription(sub.id)
    if (canceled.status !== 'canceled') throw new Error('cancel status=' + canceled.status)
    return `customer=${customer.id}, sub trialing→canceled (price propriu ${price.id})`
  })

  await scenario('S8-connect-marketplace', 'Seller', async () => {
    let acct
    try {
      acct = await createConnectedAccount({ email: `seller+${RUN}@example.com`, businessType: 'individual', metadata: { run: RUN } })
    } catch (e) {
      if (/signed up for Connect/i.test(e.message)) throw blocked('Connect NU e activat pe contul test (acțiune user: dashboard.stripe.com/connect) — nu e bug de modul')
      throw e
    }
    connectedId = acct.id
    cleanup.push(async () => deleteConnectedAccount(connectedId).catch(() => {}))
    if (!acct.id.startsWith('acct_')) throw new Error('account id invalid')
    const link = await createAccountLink({ accountId: acct.id, returnUrl: 'https://example.com/r', refreshUrl: 'https://example.com/f' })
    if (!link.url?.includes('connect.stripe.com')) throw new Error('account link invalid: ' + link.url)
    try {
      const pay = await createMarketplacePayment({ amount: 100.0, destinationAccountId: acct.id, platformFee: 10.0, description: `Audit marketplace ${RUN}` })
      return `acct=${acct.id}, link OK, marketplace PI=${pay.paymentIntentId}`
    } catch (e) {
      if (/capabilit|transfers|onboard/i.test(e.message)) return `acct=${acct.id}, link OK; marketplace PI gated de KYC Stripe (expected pre-onboarding): ${e.message.slice(0, 80)}`
      throw e
    }
  })

  await scenario('S9-credentials-resolution', 'Integrator', async () => {
    process.env.STRIPE_AUDITCO_SECRET_KEY = 'sk_test_env_priority'
    process.env.STRIPE_AUDITCO_PUBLISHABLE_KEY = 'pk_test_env_priority'
    setCompanyCredentials('auditco', { secretKey: 'sk_test_prog', publishableKey: 'pk_test_prog', webhookSecret: '' })
    const fromEnv = resolveCredentials('auditco')
    if (fromEnv.secretKey !== 'sk_test_env_priority') throw new Error('env NU are prioritate')
    delete process.env.STRIPE_AUDITCO_SECRET_KEY
    delete process.env.STRIPE_AUDITCO_PUBLISHABLE_KEY
    const fromProg = resolveCredentials('auditco')
    if (fromProg.secretKey !== 'sk_test_prog') throw new Error('programmatic NU e folosit după env')
    let threw = false
    try { resolveCredentials('no-such-company') } catch (e) { threw = /not found/.test(e.message) }
    if (!threw) throw new Error('lipsa credențialelor NU aruncă eroare clară')
    return 'env > programmatic > eroare clară'
  })

  await scenario('S10-billing-portal', 'Buyer', async () => {
    if (!customer) throw new Error('S6 nu a produs customer')
    try {
      const s = await createPortalSession({ customerId: customer.id, returnUrl: 'https://example.com/account' })
      if (!s.url) throw new Error('fără URL')
      return s.url.slice(0, 60)
    } catch (e) {
      if (/default configuration|no configuration/i.test(e.message)) throw blocked('portal default config lipsește în test mode (acțiune Dashboard, nu bug de modul): ' + e.message.slice(0, 120))
      throw e
    }
  })

  await scenario('S11-amount-rounding', 'Integrator', async () => {
    const cases = [[10.5, 1050], [10.005, 1001], [0.1 + 0.2, 30], [19.99, 1999], [0, 0], [99999999.99, 9999999999]]
    for (const [inp, exp] of cases) {
      const got = toStripeAmount(inp)
      if (got !== exp) throw new Error(`toStripeAmount(${inp}) = ${got}, expected ${exp}`)
    }
    return cases.length + ' cazuri OK'
  })

  // ─── Cleanup ───────────────────────────────────────────────────────
  for (const fn of cleanup.reverse()) await fn()

  console.log('\n══ SUMAR ══')
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 }
  for (const r of results) counts[r.status]++
  console.log(JSON.stringify({ counts, results }, null, 1))
  fs.writeFileSync(path.join(root, 'Reports', `true-e2e-scenarios-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ run: RUN, counts, results }, null, 2))
  process.exit(counts.FAIL > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(3) })
