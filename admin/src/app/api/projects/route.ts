import { NextRequest, NextResponse } from 'next/server'
import {
  discoverProjects,
  getProjectMappings,
  upsertProjectMapping,
  removeProjectMapping,
  getAssignedProjects,
} from '@/lib/data'
import { generateBrokerKeys } from '@/lib/broker'

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

  // A mapping is valid if it assigns at least one of: subscription / service / broker company.
  if (!mapping.projectSlug ||
      (!mapping.subscriptionCompany && !mapping.serviceCompany && !mapping.brokerCompany && !mapping.companySlug)) {
    return NextResponse.json({ error: 'projectSlug + at least one company required' }, { status: 400 })
  }

  // Broker keys are generated once and preserved across edits unless explicitly regenerated.
  let generated: { apiKey: string; callbackSecret: string } | null = null
  if (mapping.brokerCompany) {
    const existing = getProjectMappings().find(m => m.projectSlug === mapping.projectSlug)
    if (mapping.regenerateBrokerKeys || !existing?.apiKey || !existing?.callbackSecret) {
      generated = generateBrokerKeys()
      mapping.apiKey = generated.apiKey
      mapping.callbackSecret = generated.callbackSecret
    } else {
      mapping.apiKey = existing.apiKey
      mapping.callbackSecret = existing.callbackSecret
    }
    if (mapping.brokerEnabled === undefined) mapping.brokerEnabled = true
  }
  delete mapping.regenerateBrokerKeys

  upsertProjectMapping(mapping)
  return NextResponse.json({ ok: true, brokerKeys: generated })
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
