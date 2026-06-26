#!/usr/bin/env node
/**
 * One-time migration: encrypt the broker's at-rest Stripe secrets (S1).
 *
 * Usage:
 *   node admin/scripts/encrypt-credentials.mjs --gen-key
 *       → prints a fresh base64 32-byte STRIPE_DATA_KEY (store it in the env, NOT in git)
 *
 *   STRIPE_DATA_KEY=<base64> node admin/scripts/encrypt-credentials.mjs [--data <dir>] [--dry-run]
 *       → encrypts secretKey + webhookSecret in <data>/credentials.json in place
 *         (publishableKey stays plaintext; already-encrypted values are skipped).
 *
 * Format mirrors admin/src/lib/crypto-at-rest.ts exactly (AES-256-GCM, prefix "enc:v1:").
 * The read path is backward-compatible: plaintext values still work until migrated,
 * and encrypted values require the same STRIPE_DATA_KEY at runtime.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const PREFIX = 'enc:v1:'
const args = process.argv.slice(2)

if (args.includes('--gen-key')) {
  console.log(crypto.randomBytes(32).toString('base64'))
  process.exit(0)
}

const dryRun = args.includes('--dry-run')
const dataIdx = args.indexOf('--data')
const dataDir = dataIdx >= 0 ? args[dataIdx + 1] : path.resolve(process.cwd(), 'data')
const file = path.join(dataDir, 'credentials.json')

const raw = process.env.STRIPE_DATA_KEY
if (!raw) {
  console.error('STRIPE_DATA_KEY env var required (run with --gen-key to create one).')
  process.exit(1)
}
const key = Buffer.from(raw, 'base64')
if (key.length !== 32) {
  console.error(`STRIPE_DATA_KEY must decode to 32 bytes (got ${key.length}).`)
  process.exit(1)
}

function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX)
}
function encrypt(plaintext) {
  if (!plaintext || isEncrypted(plaintext)) return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

if (!fs.existsSync(file)) {
  console.error(`No credentials file at ${file}`)
  process.exit(1)
}
const json = JSON.parse(fs.readFileSync(file, 'utf-8'))
const companies = json.companies || {}
let changed = 0
for (const [slug, c] of Object.entries(companies)) {
  for (const env of ['test', 'live']) {
    const k = c?.[env]
    if (!k) continue
    for (const field of ['secretKey', 'webhookSecret']) {
      if (k[field] && !isEncrypted(k[field])) {
        k[field] = encrypt(k[field])
        changed++
        console.log(`  encrypted ${slug}.${env}.${field}`)
      }
    }
  }
}

if (changed === 0) {
  console.log('Nothing to encrypt (already migrated or empty).')
  process.exit(0)
}

if (dryRun) {
  console.log(`[dry-run] would encrypt ${changed} secret field(s) in ${file}`)
  process.exit(0)
}

// Backup the plaintext file, then write encrypted atomically with 0600.
const stamp = new Date().toISOString().slice(0, 10)
fs.copyFileSync(file, `${file}.bak-plaintext-${stamp}`)
const tmp = `${file}.tmp-${process.pid}`
fs.writeFileSync(tmp, JSON.stringify(json, null, 2), { encoding: 'utf-8', mode: 0o600 })
fs.renameSync(tmp, file)
fs.chmodSync(file, 0o600)
console.log(`Encrypted ${changed} secret field(s). Backup: ${file}.bak-plaintext-${stamp}`)
console.log('IMPORTANT: delete the plaintext backup once you confirm the broker works with the key.')
