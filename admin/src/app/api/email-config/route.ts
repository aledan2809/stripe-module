import { NextRequest, NextResponse } from 'next/server'
import { getEmailConfig, saveEmailConfig, verifyAndSend } from '@/lib/email'
import { encryptSecret } from '@/lib/crypto-at-rest'

/**
 * GET/POST /api/email-config — broker-level SMTP transport (Resend).
 *
 * GET  → masked config (never returns the password; only `hasPass`).
 * POST → save fields (password write-only; blank = keep existing). Any change
 *        resets `verified=false`.
 * POST { action: 'verify' } → transporter.verify() + real test send to fromDefault;
 *        on success flips `verified=true`.
 *
 * Gated by middleware (localhost / nginx basic-auth on prod).
 */

export async function GET() {
  const cfg = getEmailConfig()
  return NextResponse.json({
    smtp: {
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.secure,
      user: cfg.smtp.user,
      fromDefault: cfg.smtp.fromDefault,
      hasPass: !!cfg.smtp.passEnc,
    },
    verified: cfg.verified,
    verifiedAt: cfg.verifiedAt,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const cfg = getEmailConfig()

  if (body?.action === 'verify') {
    const result = await verifyAndSend({
      to: cfg.smtp.fromDefault,
      subject: '[TEST] Stripe Broker — verificare SMTP',
      html: '<p>Transportul SMTP al brokerului funcționează. Acesta e un email de test de verificare.</p>',
    })
    if (result.ok) {
      saveEmailConfig({ ...cfg, verified: true, verifiedAt: new Date().toISOString() })
    }
    return NextResponse.json(result)
  }

  // Save — copy nested smtp so we don't mutate the throwaway read.
  const next = { ...cfg, smtp: { ...cfg.smtp } }
  if (typeof body.host === 'string') next.smtp.host = body.host.trim()
  if (body.port != null) next.smtp.port = Number(body.port) || 587
  if (typeof body.secure === 'boolean') next.smtp.secure = body.secure
  if (typeof body.user === 'string') next.smtp.user = body.user.trim()
  if (typeof body.fromDefault === 'string') next.smtp.fromDefault = body.fromDefault.trim()
  // Password is write-only: only update when a non-empty value is provided.
  if (typeof body.pass === 'string' && body.pass) next.smtp.passEnc = encryptSecret(body.pass)
  // Any config change invalidates the prior verification (must re-verify).
  next.verified = false
  next.verifiedAt = null
  saveEmailConfig(next)
  return NextResponse.json({ ok: true })
}
