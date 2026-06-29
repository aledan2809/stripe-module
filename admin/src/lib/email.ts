import fs from 'fs'
import path from 'path'
import nodemailer from 'nodemailer'
import { encryptSecret, decryptSecret } from './crypto-at-rest'
import { atomicWriteFileSync } from './atomic'
import { getProjectMappings, type InvoiceEmailConfig } from './data'

/**
 * Invoice email (per-project, with control BCC).
 *
 * On a paid checkout / subscription renewal the broker emails the customer the
 * Stripe invoice (hosted link + PDF) and BCCs a control address, using a
 * per-project template + verified FROM. Transport is Resend SMTP (techbiz.ae is
 * a verified Resend domain). Stripe's own "email invoices" toggle must stay OFF
 * so the customer gets exactly one email (this one — the only one that can BCC).
 *
 * Everything here is additive + fail-soft: a send failure NEVER changes the
 * webhook's HTTP status (the caller wraps this in try/catch and the callback
 * dispatch is computed before email is touched).
 */

// Mirror data.ts / broker.ts so all three read the same data/ dir.
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
const EMAIL_CONFIG_FILE = 'email-config.json'
const INVOICE_EMAILS_FILE = 'invoice-emails.json'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export function isValidEmail(e: string): boolean {
  return typeof e === 'string' && EMAIL_RE.test(e) && e.length <= 254
}

// ─── Broker-level SMTP config (single shared transport, Resend) ─────────

export interface EmailSmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  /** Encrypted at rest (AES-256-GCM, same envelope as Stripe secrets). */
  passEnc: string
  fromDefault: string
}

export interface EmailConfig {
  smtp: EmailSmtpConfig
  verified: boolean
  verifiedAt: string | null
}

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  smtp: { host: 'smtp.resend.com', port: 587, secure: false, user: 'resend', passEnc: '', fromDefault: 'invoice@techbiz.ae' },
  verified: false,
  verifiedAt: null,
}

export function getEmailConfig(): EmailConfig {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, EMAIL_CONFIG_FILE), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<EmailConfig>
    return {
      ...DEFAULT_EMAIL_CONFIG,
      ...parsed,
      smtp: { ...DEFAULT_EMAIL_CONFIG.smtp, ...(parsed.smtp || {}) },
    }
  } catch {
    return { ...DEFAULT_EMAIL_CONFIG, smtp: { ...DEFAULT_EMAIL_CONFIG.smtp } }
  }
}

export function saveEmailConfig(cfg: EmailConfig): void {
  const filePath = path.join(DATA_DIR, EMAIL_CONFIG_FILE)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  atomicWriteFileSync(filePath, JSON.stringify(cfg, null, 2))
}

/** True once the SMTP transport has been verified end-to-end. */
export function emailConfigured(): boolean {
  const cfg = getEmailConfig()
  return cfg.verified && !!cfg.smtp.host && !!decryptSecret(cfg.smtp.passEnc || '')
}

function buildTransporter(cfg: EmailConfig) {
  const pass = decryptSecret(cfg.smtp.passEnc || '')
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user || pass ? { user: cfg.smtp.user, pass } : undefined,
  })
}

// ─── Templates ──────────────────────────────────────────────────────────

export const DEFAULT_SUBJECT_TEMPLATE = 'Factura {{invoiceNumber}} — {{projectName}}'
export const DEFAULT_BODY_TEMPLATE = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
  <p>Bună ziua,</p>
  <p>Îți mulțumim pentru plată.</p>
  <p>Factura <strong>{{invoiceNumber}}</strong> în valoare de <strong>{{amount}} {{currency}}</strong> a fost emisă pe {{date}}.</p>
  <p>
    <a href="{{hostedInvoiceUrl}}" style="color:#635bff">Vezi factura</a>
    &nbsp;·&nbsp;
    <a href="{{invoicePdfUrl}}" style="color:#635bff">Descarcă PDF</a>
  </p>
  <p style="color:#8a8a8a;font-size:13px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">{{projectName}}</p>
</div>`

/** Replace {{key}} placeholders; unknown keys render empty. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ''))
}

// ─── Verify (broker SMTP + per-project send-test) ─────────────────────────

/**
 * Verify the SMTP transport: connection/auth + a real test send to `to`.
 * `from` defaults to the configured fromDefault (broker-level verify); the
 * per-project test passes the project's own FROM (must be on a Resend-verified domain).
 */
export async function verifyAndSend(opts: { to: string; subject: string; html: string; from?: string }): Promise<{ ok: boolean; error?: string }> {
  const cfg = getEmailConfig()
  const from = opts.from || cfg.smtp.fromDefault
  if (!cfg.smtp.host) return { ok: false, error: 'SMTP host not configured' }
  if (!decryptSecret(cfg.smtp.passEnc || '')) return { ok: false, error: 'SMTP password not set' }
  if (!isValidEmail(opts.to)) return { ok: false, error: `invalid recipient: ${opts.to}` }
  if (!isValidEmail(from)) return { ok: false, error: `invalid from: ${from}` }
  try {
    const transporter = buildTransporter(cfg)
    await transporter.verify()
    await transporter.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Invoice email log (idempotency + audit) ──────────────────────────────

export type InvoiceEmailStatus = 'PENDING' | 'SENT' | 'FAILED' | 'BLOCKED_UNVERIFIED'

export interface InvoiceEmailLogEntry {
  invoiceId: string
  projectSlug: string
  invoiceNumber: string
  to: string
  bcc: string
  status: InvoiceEmailStatus
  error?: string
  at: string
}

interface InvoiceEmailLog {
  entries: Record<string, InvoiceEmailLogEntry>
}

function readLog(): InvoiceEmailLog {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, INVOICE_EMAILS_FILE), 'utf-8')) as InvoiceEmailLog
  } catch {
    return { entries: {} }
  }
}

function writeLog(log: InvoiceEmailLog): void {
  const filePath = path.join(DATA_DIR, INVOICE_EMAILS_FILE)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  atomicWriteFileSync(filePath, JSON.stringify(log, null, 2))
}

export function getInvoiceEmailLog(): InvoiceEmailLogEntry[] {
  return Object.values(readLog().entries).sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Atomically claim an invoiceId for sending. Returns false if it was already
 * SENT or PENDING (skip — idempotent). FAILED/BLOCKED entries can be re-claimed
 * (a manual webhook resend should be able to retry a transient failure).
 */
function claimInvoiceEmail(invoiceId: string): boolean {
  const log = readLog()
  const existing = log.entries[invoiceId]
  if (existing && (existing.status === 'SENT' || existing.status === 'PENDING')) return false
  log.entries[invoiceId] = {
    invoiceId, projectSlug: '', invoiceNumber: '', to: '', bcc: '',
    status: 'PENDING', at: new Date().toISOString(),
  }
  writeLog(log)
  return true
}

function recordInvoiceEmail(entry: InvoiceEmailLogEntry): void {
  const log = readLog()
  log.entries[entry.invoiceId] = entry
  writeLog(log)
}

// ─── High-level: send the invoice email for a paid invoice ────────────────

/** Minimal shape of a Stripe Invoice the email needs (decoupled from the SDK). */
export interface InvoiceLike {
  id: string
  number?: string | null
  hosted_invoice_url?: string | null
  invoice_pdf?: string | null
  customer_email?: string | null
  amount_paid?: number | null
  currency?: string | null
}

/**
 * Send the per-project invoice email for a paid Stripe invoice. Fail-soft:
 * never throws — the caller (webhook) must not have its HTTP status affected.
 *  - no invoice / disabled        → skip (no log noise)
 *  - enabled but not verified     → BLOCKED_UNVERIFIED (fail-closed, no email)
 *  - already SENT/PENDING (idem.) → skip
 *  - sent / failed                → SENT / FAILED logged
 */
export async function maybeSendInvoiceEmail(projectSlug: string, invoice: InvoiceLike | null): Promise<void> {
  try {
    if (!invoice || !invoice.id) return // one-time payment without invoice_creation → nothing to send

    const mapping = getProjectMappings().find(m => m.projectSlug === projectSlug)
    const ie: InvoiceEmailConfig | undefined = mapping?.invoiceEmail
    if (!ie?.enabled) return // feature off for this project

    const bcc = ie.bcc || 'invoice@techbiz.ae'
    const to = invoice.customer_email || ''
    const invoiceNumber = invoice.number || invoice.id

    if (!ie.verified) {
      recordInvoiceEmail({
        invoiceId: invoice.id, projectSlug, invoiceNumber, to, bcc,
        status: 'BLOCKED_UNVERIFIED', error: 'invoice email config not verified', at: new Date().toISOString(),
      })
      return
    }
    if (!emailConfigured()) {
      recordInvoiceEmail({
        invoiceId: invoice.id, projectSlug, invoiceNumber, to, bcc,
        status: 'FAILED', error: 'broker SMTP not verified', at: new Date().toISOString(),
      })
      return
    }
    if (!isValidEmail(to)) {
      recordInvoiceEmail({
        invoiceId: invoice.id, projectSlug, invoiceNumber, to, bcc,
        status: 'FAILED', error: `missing/invalid customer_email`, at: new Date().toISOString(),
      })
      return
    }

    // Idempotency: claim before sending so a duplicate webhook can't double-send.
    if (!claimInvoiceEmail(invoice.id)) return

    const cfg = getEmailConfig()
    const fromAddress = ie.fromAddress || cfg.smtp.fromDefault
    const fromName = ie.fromName || projectSlug
    const amount = typeof invoice.amount_paid === 'number' ? (invoice.amount_paid / 100).toFixed(2) : ''
    const currency = (invoice.currency || '').toUpperCase()
    const vars: Record<string, string> = {
      projectName: ie.fromName || projectSlug,
      invoiceNumber,
      amount,
      currency,
      customerEmail: to,
      hostedInvoiceUrl: invoice.hosted_invoice_url || '',
      invoicePdfUrl: invoice.invoice_pdf || '',
      date: new Date().toLocaleDateString('ro-RO'),
    }
    const subject = renderTemplate(ie.subjectTemplate || DEFAULT_SUBJECT_TEMPLATE, vars)
    const html = renderTemplate(ie.bodyTemplate || DEFAULT_BODY_TEMPLATE, vars)

    try {
      const transporter = buildTransporter(cfg)
      await transporter.sendMail({ from: `${fromName} <${fromAddress}>`, to, bcc, subject, html })
      recordInvoiceEmail({ invoiceId: invoice.id, projectSlug, invoiceNumber, to, bcc, status: 'SENT', at: new Date().toISOString() })
    } catch (e) {
      recordInvoiceEmail({
        invoiceId: invoice.id, projectSlug, invoiceNumber, to, bcc,
        status: 'FAILED', error: e instanceof Error ? e.message : String(e), at: new Date().toISOString(),
      })
    }
  } catch (e) {
    // Last-resort guard — email must never break the webhook.
    console.error('[broker] maybeSendInvoiceEmail unexpected error:', e instanceof Error ? e.message : e)
  }
}
