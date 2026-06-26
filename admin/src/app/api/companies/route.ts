import { NextRequest, NextResponse } from 'next/server'
import { getCompanies, upsertCompany, deleteCompany, getCredentials, getProjectsForCompany } from '@/lib/data'

export async function GET() {
  const companies = getCompanies()
  // S3: the company LIST must not ship every firm's Stripe secrets in one response.
  // Return presence-only flags; the full keys load on demand via /api/credentials?slug=
  // when a single company's editor is opened.
  const enriched = companies.map(c => {
    const creds = getCredentials(c.slug)
    return {
      ...c,
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
