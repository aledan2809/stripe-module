import { NextRequest, NextResponse } from 'next/server'
import {
  discoverProjects,
  getProjectMappings,
  upsertProjectMapping,
  removeProjectMapping,
  getAssignedProjects,
} from '@/lib/data'

export async function GET() {
  const allProjects = discoverProjects()
  const mappings = getProjectMappings()
  const assigned = getAssignedProjects()

  return NextResponse.json({
    available: allProjects,
    mappings,
    assigned,
  })
}

export async function POST(request: NextRequest) {
  const mapping = await request.json()

  if (!mapping.projectSlug || !mapping.companySlug) {
    return NextResponse.json({ error: 'projectSlug and companySlug required' }, { status: 400 })
  }

  upsertProjectMapping(mapping)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectSlug = searchParams.get('projectSlug')

  if (!projectSlug) {
    return NextResponse.json({ error: 'projectSlug required' }, { status: 400 })
  }

  removeProjectMapping(projectSlug)
  return NextResponse.json({ ok: true })
}
