import { NextRequest, NextResponse } from 'next/server'
import { getCredentials, saveCredentials } from '@/lib/data'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  return NextResponse.json(getCredentials(slug))
}

export async function POST(request: NextRequest) {
  const { slug, credentials } = await request.json()
  if (!slug || !credentials) {
    return NextResponse.json({ error: 'slug and credentials required' }, { status: 400 })
  }
  saveCredentials(slug, credentials)
  return NextResponse.json({ ok: true })
}
