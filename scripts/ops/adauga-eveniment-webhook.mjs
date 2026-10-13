#!/usr/bin/env node
/**
 * Adaugă pe webhook-ul Stripe al firmei care încasează pentru un proiect (implicit tutor → firma din project-mappings.json,
 * de ex. class-rda) evenimentele pe care brokerul le tratează și care lipsesc, FĂRĂ Stripe Dashboard (13.10.2026: în
 * Workbench, meniul de editare nu apărea). Rulează pe VPS2, din folderul admin/ al brokerului, cu cheia pe care brokerul
 * o are deja.
 *
 * De ce toate (13.10.2026): webhook-ul Class RDA primea doar checkout.session.completed + customer.subscription.updated.
 * Fără invoice.paid / invoice.payment_failed / customer.subscription.deleted, consumatorul nu află de reînnoiri, de plata
 * eșuată (pauza) sau de anulare (accesul nu se închide niciodată). Lista = ce tratează
 * admin/src/app/api/stripe/webhook/[companySlug]/route.ts; un eveniment al unui abonament care nu e al brokerului
 * primește 200 „no matching session”.
 *
 * Ce face, pe mediul brokerului pentru proiect (live/test):
 *   - găsește endpoint-urile Stripe cu adresa …/api/stripe/webhook/<firma>;
 *   - ce lipsește din listă ADAUGĂ la lista existentă (nu scoate nimic, nu schimbă versiunea API a endpoint-ului);
 *   - afișează lista înainte și după. Cheile nu se afișează niciodată.
 *
 * Rulare (din orice folder de pe Mac):
 *   ssh root@72.62.155.74 'cd /var/www/stripe-broker/admin && git fetch -q origin master && git show origin/master:scripts/ops/adauga-eveniment-webhook.mjs > /root/adauga-eveniment-webhook.mjs && node /root/adauga-eveniment-webhook.mjs'
 *
 * Opțiuni: DRY_RUN=1 (doar arată), PROJECT=<slug> (implicit tutor), EVENTS=<e1,e2,…> (implicit toate cele de mai jos).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const PROJECT = process.env.PROJECT || 'tutor'
// Every event the broker's webhook handles (route.ts), in its order.
const HANDLED = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.deleted',
  'customer.subscription.updated',
]
const EVENTS = (process.env.EVENTS || process.env.EVENT || HANDLED.join(','))
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)
const DRY_RUN = process.env.DRY_RUN === '1'
// The broker's own Stripe SDK, from the admin/ folder we run in (the script itself lives elsewhere).
const require = createRequire(path.join(process.cwd(), 'package.json'))
const Stripe = require('stripe')

function fail(msg) {
  console.error(`  ✗ ${msg}`)
  process.exit(1)
}

// Same data/ resolution as the broker (admin/src/lib/data.ts).
function dataDir() {
  if (process.env.STRIPE_ADMIN_DATA_DIR) return process.env.STRIPE_ADMIN_DATA_DIR
  for (const d of [path.resolve(process.cwd(), '../data'), path.resolve(process.cwd(), 'data')]) {
    if (fs.existsSync(path.join(d, 'companies.json'))) return d
  }
  fail(`nu găsesc data/ (rulez din ${process.cwd()}; trebuie din folderul admin/ al brokerului)`)
}

// STRIPE_DATA_KEY: from the environment, else from the env files Next loads for the broker, else from PM2.
function dataKey() {
  if (process.env.STRIPE_DATA_KEY) return process.env.STRIPE_DATA_KEY
  for (const f of ['.env.local', '.env.production.local', '.env.production', '.env', '../.env.local', '../.env']) {
    const p = path.resolve(process.cwd(), f)
    if (!fs.existsSync(p)) continue
    const m = fs.readFileSync(p, 'utf8').match(/^\s*STRIPE_DATA_KEY\s*=\s*"?([^"\r\n]+)"?/m)
    if (m) return m[1].trim()
  }
  // Last: the environment PM2 starts the broker with.
  try {
    const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    const e = list.find((p) => p.name === 'stripe-broker')?.pm2_env || {}
    return e.STRIPE_DATA_KEY || e.env?.STRIPE_DATA_KEY || null
  } catch {
    return null
  }
}

// Same envelope as admin/src/lib/crypto-at-rest.ts (enc:v1: + base64(iv 12 | tag 16 | ciphertext)).
function decrypt(value, rawKey) {
  if (!value || !value.startsWith('enc:v1:')) return value
  if (!rawKey) fail('cheia e criptată, dar STRIPE_DATA_KEY nu e nici în mediu, nici în .env.local')
  const key = Buffer.from(rawKey, 'base64')
  if (key.length !== 32) fail('STRIPE_DATA_KEY nu are 32 de octeți')
  const buf = Buffer.from(value.slice('enc:v1:'.length), 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return d.update(buf.subarray(28), undefined, 'utf8') + d.final('utf8')
}

const dir = dataDir()
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const mapping = (read('project-mappings.json').mappings || []).find((m) => m.projectSlug === PROJECT)
if (!mapping?.brokerCompany) fail(`proiectul „${PROJECT}” n-are o firmă în brokerul de plăți (project-mappings.json)`)
const company = mapping.brokerCompany
const env = mapping.brokerEnv === 'live' ? 'live' : 'test'
const secretKey = decrypt(read('credentials.json').companies?.[company]?.[env]?.secretKey || '', dataKey())
if (!secretKey) fail(`firma „${company}” n-are cheie ${env} în broker`)

console.log(`══ proiect ${PROJECT} → firma ${company}, mediul ${env}${DRY_RUN ? ' (DRY_RUN: doar arăt)' : ''} ══`)
const opts = process.env.STRIPE_API_BASE // tests only: a local fake of the Stripe API
  ? (() => { const u = new URL(process.env.STRIPE_API_BASE); return { host: u.hostname, port: u.port, protocol: u.protocol.replace(':', '') } })()
  : {}
const stripe = new Stripe(secretKey, opts)

try {
  const acct = await stripe.accounts.retrieve()
  console.log(`  contul Stripe: ${acct.id} (${acct.settings?.dashboard?.display_name || acct.business_profile?.name || 'fără nume'})`)
} catch {
  console.log('  contul Stripe: (cheia nu are voie să-l citească — nu contează)')
}

const suffix = `/api/stripe/webhook/${company}`
const endpoints = []
for await (const e of stripe.webhookEndpoints.list({ limit: 100 })) endpoints.push(e)
const ours = endpoints.filter((e) => {
  try { return new URL(e.url).pathname.replace(/\/$/, '') === suffix } catch { return false }
})
if (ours.length === 0) {
  console.log(`  ✗ niciun webhook cu adresa …${suffix} în acest cont. Toate webhook-urile contului:`)
  for (const e of endpoints) console.log(`    ${e.url} (${e.status})`)
  process.exit(1)
}

let changed = 0
for (const e of ours) {
  const before = e.enabled_events || []
  console.log(`\n  webhook ${e.id}: ${e.url} (${e.status}, API ${e.api_version || 'implicit'})`)
  console.log(`    evenimente înainte (${before.length}): ${before.join(', ')}`)
  const missing = before.includes('*') ? [] : EVENTS.filter((x) => !before.includes(x))
  if (missing.length === 0) {
    console.log(`    ✓ toate evenimentele sunt deja primite — nimic de schimbat`)
    continue
  }
  if (DRY_RUN) {
    console.log(`    (DRY_RUN) aș adăuga (${missing.length}): ${missing.join(', ')}`)
    continue
  }
  // Only enabled_events: the endpoint keeps its URL, secret, status and API version.
  const after = await stripe.webhookEndpoints.update(e.id, { enabled_events: [...before, ...missing] })
  const lost = before.filter((x) => !after.enabled_events.includes(x))
  console.log(`    evenimente după (${after.enabled_events.length}): ${after.enabled_events.join(', ')}`)
  const absent = missing.filter((x) => !after.enabled_events.includes(x))
  if (absent.length || lost.length) fail(`ceva nu e cum trebuie (lipsă: ${[...lost, ...absent].join(', ')})`)
  console.log(`    ✓ adăugat (${missing.length}): ${missing.join(', ')}`)
  changed++
}
console.log(`\nGATA. ${DRY_RUN ? 'DRY_RUN: nimic schimbat.' : changed ? `${changed} webhook actualizat.` : 'Nimic de schimbat.'}`)
