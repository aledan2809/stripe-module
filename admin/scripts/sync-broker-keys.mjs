#!/usr/bin/env node
/**
 * sync-broker-keys.mjs — fetch a project's Stripe Checkout Broker credentials and
 * write them into a consumer app's .env, so you never copy-paste them by hand.
 *
 * The broker keys (project-key + callback-secret) are ENV-INDEPENDENT: set once per
 * app, ever. Going test→live is a broker-side toggle and does NOT change these — so
 * this is one-time-per-app, not ongoing maintenance.
 *
 * Usage:
 *   node sync-broker-keys.mjs --project <slug> [--out <.env path>] [--broker-url URL] [--creds path]
 *
 *   --project     consumer project slug as registered in the broker (e.g. "ave", "4pro-eat")
 *   --out         .env file to upsert the 3 vars into. Omit to print them to stdout.
 *   --broker-url  broker base URL (default https://stripe.knowbest.ro)
 *   --creds       env file holding STRIPE_BROKER_ADMIN_USER / STRIPE_BROKER_ADMIN_PASS
 *                 (basic-auth). Default: <HOME>/Projects/Master/credentials/stripe-broker.env
 *
 * Writes/updates exactly: STRIPE_BROKER_URL, STRIPE_BROKER_PROJECT_KEY, STRIPE_BROKER_CALLBACK_SECRET
 * Existing lines are replaced in place; everything else in the .env is left untouched.
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const project = arg('project');
const outFile = arg('out');
const brokerUrl = arg('broker-url', 'https://stripe.knowbest.ro').replace(/\/+$/, '');
const credsFile = arg(
  'creds',
  path.resolve(process.env.HOME || '', 'Projects/Master/credentials/stripe-broker.env'),
);

if (!project) {
  console.error('Usage: node sync-broker-keys.mjs --project <slug> [--out <.env path>] [--broker-url URL] [--creds path]');
  process.exit(2);
}

function readEnvVar(file, key) {
  try {
    const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(key + '='));
    if (!line) return '';
    return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

const user = readEnvVar(credsFile, 'STRIPE_BROKER_ADMIN_USER');
const pass = readEnvVar(credsFile, 'STRIPE_BROKER_ADMIN_PASS');
if (!user || !pass) {
  console.error(`Could not read STRIPE_BROKER_ADMIN_USER / STRIPE_BROKER_ADMIN_PASS from ${credsFile}`);
  console.error('Pass a different file with --creds <path>.');
  process.exit(2);
}

const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
let data;
try {
  const res = await fetch(`${brokerUrl}/api/projects`, { headers: { Authorization: auth } });
  if (!res.ok) {
    console.error(`Broker ${brokerUrl}/api/projects → HTTP ${res.status}`);
    process.exit(1);
  }
  data = await res.json();
} catch (e) {
  console.error(`Could not reach broker at ${brokerUrl}: ${e?.message || e}`);
  process.exit(1);
}

const mapping = (data.mappings || []).find((m) => m.projectSlug === project);
if (!mapping) {
  console.error(`No mapping for project "${project}" in the broker. Assign it first in the /projects page.`);
  process.exit(1);
}
if (!mapping.apiKey || !mapping.callbackSecret) {
  console.error(`Project "${project}" has no broker keys yet. Assign it to a company in /projects first.`);
  process.exit(1);
}

const vars = {
  STRIPE_BROKER_URL: brokerUrl,
  STRIPE_BROKER_PROJECT_KEY: mapping.apiKey,
  STRIPE_BROKER_CALLBACK_SECRET: mapping.callbackSecret,
};

if (!outFile) {
  for (const [k, v] of Object.entries(vars)) console.log(`${k}=${v}`);
  process.exit(0);
}

let lines = [];
try {
  lines = fs.readFileSync(outFile, 'utf8').split('\n');
} catch {
  lines = [];
}
for (const [k, v] of Object.entries(vars)) {
  const idx = lines.findIndex((l) => l.startsWith(k + '='));
  const newLine = `${k}=${v}`;
  if (idx >= 0) lines[idx] = newLine;
  else lines.push(newLine);
}
const out = lines.join('\n').replace(/\n+$/, '') + '\n';
fs.writeFileSync(outFile, out);
console.log(`✓ Wrote 3 broker vars for "${project}" into ${outFile} (project-key + callback-secret are env-independent — set once).`);
