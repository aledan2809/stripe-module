import { NextRequest, NextResponse } from 'next/server'
import {
  getEcosystems,
  getProjectMappings,
  upsertProjectMapping,
  getCredentials,
  discoverProjects,
} from '@/lib/data'
import { generateBrokerKeys } from '@/lib/broker'

/**
 * POST /api/ecosystems/assign — assign every project in an ecosystem to one Stripe company.
 *
 * Body: { ecosystem: "<group name>", brokerCompany: "<slug>", brokerEnv: "test"|"live",
 *         regenerate?: boolean }
 * → for each project in the ecosystem, upsert a broker mapping → brokerCompany; generate
 *   per-project apiKey + callbackSecret (preserved if already mapped, unless regenerate).
 * Returns the per-project keys so the operator can hand them to each consumer app.
 */
export async function POST(request: NextRequest) {
  const { ecosystem, brokerCompany, brokerEnv = 'test', regenerate = false } = await request.json()

  if (!ecosystem || !brokerCompany) {
    return NextResponse.json({ error: 'ecosystem and brokerCompany required' }, { status: 400 })
  }

  const eco = getEcosystems().find(e => e.name === ecosystem)
  if (!eco) {
    return NextResponse.json({ error: `Unknown ecosystem "${ecosystem}"` }, { status: 404 })
  }

  // The company must have a Stripe secret key for the chosen env, otherwise checkouts 404 later.
  const creds = getCredentials(brokerCompany)
  const hasKey = !!creds?.[brokerEnv as 'test' | 'live']?.secretKey
  if (!hasKey) {
    return NextResponse.json(
      { error: `Company "${brokerCompany}" has no ${brokerEnv} Stripe secret key — add it in Credențiale first.` },
      { status: 400 }
    )
  }

  const bySlug = new Map(discoverProjects().map(p => [p.slug, p]))
  const existingMappings = getProjectMappings()
  const assigned: { projectSlug: string; apiKey: string; callbackSecret: string }[] = []

  for (const slug of eco.projects) {
    const existing = existingMappings.find(m => m.projectSlug === slug)
    let apiKey = existing?.apiKey
    let callbackSecret = existing?.callbackSecret
    if (regenerate || !apiKey || !callbackSecret) {
      const k = generateBrokerKeys()
      apiKey = k.apiKey
      callbackSecret = k.callbackSecret
    }
    upsertProjectMapping({
      projectSlug: slug,
      projectPath: bySlug.get(slug)?.path || existing?.projectPath || '',
      subscriptionCompany: existing?.subscriptionCompany || '',
      subscriptionEnv: existing?.subscriptionEnv || 'test',
      serviceCompany: existing?.serviceCompany || '',
      serviceEnv: existing?.serviceEnv || 'test',
      brokerCompany,
      brokerEnv,
      brokerEnabled: true,
      apiKey,
      callbackSecret,
    })
    assigned.push({ projectSlug: slug, apiKey: apiKey!, callbackSecret: callbackSecret! })
  }

  return NextResponse.json({ ok: true, ecosystem, brokerCompany, brokerEnv, count: assigned.length, assigned })
}
