import { NextRequest, NextResponse } from 'next/server'
import { getProjectMappings, upsertProjectMapping } from '@/lib/data'
import { verifyAndSend, isValidEmail, emailConfigured } from '@/lib/email'

/**
 * POST /api/invoice-email-test  { projectSlug }
 *
 * Runs the per-project verification: validate FROM/BCC, then a real test send
 * (FROM = project's fromAddress, TO = its BCC). On success flips
 * mapping.invoiceEmail.verified = true (fail-closed gate for live emails).
 *
 * Gated by middleware (localhost / nginx basic-auth on prod).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const projectSlug = typeof body?.projectSlug === 'string' ? body.projectSlug : ''

  const mapping = getProjectMappings().find(m => m.projectSlug === projectSlug)
  if (!mapping) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const ie = mapping.invoiceEmail
  if (!ie) {
    return NextResponse.json({ error: 'Invoice email not configured for this project' }, { status: 400 })
  }
  if (!emailConfigured()) {
    return NextResponse.json({ error: 'Broker SMTP not verified — verifică întâi transportul în pagina Email' }, { status: 400 })
  }
  if (!isValidEmail(ie.fromAddress)) {
    return NextResponse.json({ error: `fromAddress invalid: ${ie.fromAddress}` }, { status: 400 })
  }
  if (!isValidEmail(ie.bcc)) {
    return NextResponse.json({ error: `bcc invalid: ${ie.bcc}` }, { status: 400 })
  }

  const result = await verifyAndSend({
    from: ie.fromAddress,
    to: ie.bcc,
    subject: `[TEST] ${ie.fromName || projectSlug} invoice email`,
    html: `<p>Test invoice email pentru proiectul <strong>${projectSlug}</strong>.</p><p>Dacă vezi acest mesaj, adresa FROM (<code>${ie.fromAddress}</code>) și BCC funcționează. Poți activa trimiterea live.</p>`,
  })

  if (result.ok) {
    upsertProjectMapping({
      ...mapping,
      invoiceEmail: { ...ie, verified: true, verifiedAt: new Date().toISOString() },
    })
  }
  return NextResponse.json(result)
}
