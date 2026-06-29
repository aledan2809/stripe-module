import { NextRequest, NextResponse } from 'next/server'
import {
  discoverProjects,
  getProjectMappings,
  upsertProjectMapping,
  removeProjectMapping,
  getAssignedProjects,
  getGroupedProjects,
} from '@/lib/data'
import { generateBrokerKeys } from '@/lib/broker'

export async function GET() {
  const allProjects = discoverProjects()
  const mappings = getProjectMappings()
  const assigned = getAssignedProjects()
  const groups = getGroupedProjects()

  return NextResponse.json({
    available: allProjects,
    groups,
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

  // Invoice email: changing the FROM address invalidates the prior verification
  // (a live email must never go out on an unverified FROM). Enforced server-side
  // so a UI that forgets to reset can't bypass the fail-closed gate.
  if (mapping.invoiceEmail) {
    const existing = getProjectMappings().find(m => m.projectSlug === mapping.projectSlug)
    const prevFrom = existing?.invoiceEmail?.fromAddress
    if (prevFrom !== undefined && prevFrom !== mapping.invoiceEmail.fromAddress) {
      mapping.invoiceEmail.verified = false
      mapping.invoiceEmail.verifiedAt = null
    }
  }

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
