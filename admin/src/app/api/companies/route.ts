import { NextRequest, NextResponse } from 'next/server'
import { getCompanies, upsertCompany, deleteCompany, getCredentials, getProjectsForCompany } from '@/lib/data'

export async function GET() {
  const companies = getCompanies()
  const enriched = companies.map(c => ({
    ...c,
    credentials: getCredentials(c.slug),
    projects: getProjectsForCompany(c.slug),
  }))
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
