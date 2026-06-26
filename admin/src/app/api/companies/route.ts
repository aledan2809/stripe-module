import { NextRequest, NextResponse } from 'next/server'
import { getCompanies, upsertCompany, deleteCompany, getCredentials, getProjectsForCompany } from '@/lib/data'

export async function GET() {
  const companies = getCompanies()
  // S3: the company LIST must not ship every firm's Stripe secrets in one response.
  // Return presence-only flags; the full keys load on demand via /api/credentials?slug=
  // when a single company's editor is opened.
  const enriched = companies.map(c => {
    const creds = getCredentials(c.slug)
    // Defensively drop any `credentials` accidentally embedded in companies.json
    // (legacy: the UI used to POST the whole company object incl. keys) so the
    // list never re-emits Stripe secrets via spread.
    const { credentials: _embedded, ...rest } = c as typeof c & { credentials?: unknown }
    void _embedded
    return {
      ...rest,
      credentialsStatus: {
        test: { hasSecret: !!creds.test?.secretKey, hasWebhook: !!creds.test?.webhookSecret },
        live: { hasSecret: !!creds.live?.secretKey, hasWebhook: !!creds.live?.webhookSecret },
      },
      projects: getProjectsForCompany(c.slug),
    }
  })
  return NextResponse.json(enriched)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  if (!body.slug || !body.name) {
    return NextResponse.json({ error: 'slug and name are required' }, { status: 400 })
  }

  // Sanitize slug
  body.slug = body.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')

  // Never persist Stripe secrets inside companies.json — they belong only in the
  // (encrypted) credentials store. The UI saves credentials via /api/credentials.
  delete body.credentials

  upsertCompany(body)
  return NextResponse.json({ ok: true, company: body })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')

  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 })
  }

  deleteCompany(slug)
  return NextResponse.json({ ok: true })
}
