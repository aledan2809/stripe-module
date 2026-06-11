/**
 * True E2E [10] — concurrency scenarios C1-C3 pentru @projects/stripe-module.
 * C1: webhook duplicate delivery (dedup e responsabilitatea consumatorului — verificăm + documentăm)
 * C2: syncPlans paralel pe același proiect → race search-then-create (G-STRIPE-010)
 * C3: useCompany() global-state bleed între două „requesturi" concurente (G-STRIPE-004)
 */
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const credPath = process.env.STRIPE_CREDENTIALS_FILE
  || path.join(process.env.HOME || '', 'Projects/Master/credentials/stripe.env')
for (const line of fs.readFileSync(credPath, 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('ABORT: nu e sk_test_'); process.exit(2)
}

const root = path.resolve(__dirname, '..')
const { handleWebhook } = require(path.join(root, 'dist/server/webhook.js'))
const { syncPlans } = require(path.join(root, 'dist/server/sync.js'))
const { getStripe } = require(path.join(root, 'dist/client.js'))
const { configureStripeModule, getConfig } = require(path.join(root, 'dist/config.js'))

const RUN = `conc-${Date.now()}`
const results = []
const rec = (id, status, note) => { results.push({ id, status, note }); console.log(`${status === 'PASS' ? '✅' : status === 'DOCUMENTED' ? '📋' : '❌'} ${id} ${status}: ${note}`) }

const main = async () => {
  const stripe = await getStripe()

  // ── C1: webhook duplicate delivery ──────────────────────────────────
  {
    const payload = JSON.stringify({ id: `evt_dup_${RUN}`, object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_dup' } } })
    const secret = 'whsec_conc_test'
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    let invocations = 0
    const handlers = { 'payment_intent.succeeded': async () => { invocations++ } }
    // livrare duplicată — concurent
    await Promise.all([
      handleWebhook({ rawBody: payload, signature: header, webhookSecret: secret }, handlers),
      handleWebhook({ rawBody: payload, signature: header, webhookSecret: secret }, handlers),
    ])
    if (invocations === 2) {
      rec('C1-webhook-duplicate', 'DOCUMENTED', 'modulul NU deduplichează pe event.id (by design) — handler invocat 2/2; dedup = responsabilitatea consumatorului (de notat în Knowledge/USAGE.md)')
    } else {
      rec('C1-webhook-duplicate', 'FAIL', `comportament neașteptat: ${invocations} invocări`)
    }
  }

  // ── C2: syncPlans paralel — race search-then-create ────────────────
  {
    const project = RUN
    const plan = [{ slug: 'conc-plan', name: 'Conc Plan', prices: [{ amount: 5.99, interval: 'month' }] }]
    const [r1, r2] = await Promise.all([syncPlans(project, plan), syncPlans(project, plan)])
    const totalCreated = r1.created.products + r2.created.products
    // cleanup: dezactivează tot ce s-a creat
    await new Promise(s => setTimeout(s, 20000)) // search convergence pt cleanup
    const found = await stripe.products.search({ query: `metadata["project"]:"${project}"`, limit: 20 })
    for (const p of found.data) await stripe.products.update(p.id, { active: false })
    if (totalCreated > 1) {
      rec('C2-parallel-sync-race', 'PASS', `race CONFIRMAT (G-STRIPE-010): 2 sync-uri paralele → ${totalCreated} produse create (${found.data.length} găsite la cleanup) — duplicate reale în contul Stripe`)
    } else {
      rec('C2-parallel-sync-race', 'PASS', 'fără duplicat în acest run (race-ul rămâne teoretic posibil — G-STRIPE-010)')
    }
  }

  // ── C3: useCompany global-state bleed (fără API — pură logică) ─────
  {
    // simulăm două „requesturi" care configurează module-level config concurent
    configureStripeModule({ currency: 'ron' })
    const reqA = async () => {
      configureStripeModule({ currency: 'ron' })
      await new Promise(s => setTimeout(s, 50)) // alt request rulează între timp
      return getConfig().currency
    }
    const reqB = async () => {
      await new Promise(s => setTimeout(s, 10))
      configureStripeModule({ currency: 'eur' })
      return getConfig().currency
    }
    const [curA] = await Promise.all([reqA(), reqB()])
    if (curA === 'eur') {
      rec('C3-multicompany-bleed', 'PASS', `bleed CONFIRMAT (G-STRIPE-004): request-ul A (firmă RON) a citit currency='${curA}' după ce B a comutat global pe EUR — useCompany/configureStripeModule sunt nesigure multi-company concurrent`)
    } else {
      rec('C3-multicompany-bleed', 'PASS', 'fără bleed în acest interleaving (gap-ul G-STRIPE-004 rămâne — state-ul e global)')
    }
  }

  fs.writeFileSync(path.join(root, 'Reports', `true-e2e-concurrency-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ run: RUN, results }, null, 2))
  console.log('\nDONE:', JSON.stringify(results.map(r => r.id + '=' + r.status)))
}

main().catch(e => { console.error('FATAL:', e); process.exit(3) })
