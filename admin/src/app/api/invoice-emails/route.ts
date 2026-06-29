import { NextResponse } from 'next/server'
import { getInvoiceEmailLog } from '@/lib/email'

/**
 * GET /api/invoice-emails — the invoice-email send log (audit + idempotency view).
 * Gated by middleware (localhost / nginx basic-auth on prod).
 */
export async function GET() {
  return NextResponse.json({ entries: getInvoiceEmailLog() })
}
