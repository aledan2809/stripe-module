import { NextRequest, NextResponse } from 'next/server'
import {
  getCompanies,
  upsertCompany,
  type CompanyProfile,
} from '@/lib/data'
import {
  fetchLegalEntities,
  fetchLegalAppBillers,
  legalEntityToCompany,
  computeReconciliation,
} from '@/lib/legal'

/**
 * POST /api/legal/sync
 *  ?preview=1 → returns the diff + reconciliation, writes nothing.
 *  (no preview) → applies: upserts Legal entities into companies.json as source:'legal'
 *                (NEVER overwrites Stripe-local fields: credentials, stripeEnvironment, keys).
 *
 * Project→biller mappings are NOT auto-applied here — they are surfaced for the operator to
 * confirm in the Projects page (generates broker keys per project on confirm).
 */
/** GET /api/legal/sync — read-only reconciliation (for the panel + dashboard counter). */
export async function GET() {
  try {
    const [entities, billers] = await Promise.all([fetchLegalEntities(), fetchLegalAppBillers()])
    return NextResponse.json({ reconciliation: computeReconciliation(entities, billers), billers })
  } catch (e: any) {
    return NextResponse.json({ error: `Legal unreachable: ${e?.message || e}`, reconciliation: null }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const preview = new URL(request.url).searchParams.get('preview') === '1'

  let entities, billers
  try {
    [entities, billers] = await Promise.all([fetchLegalEntities(), fetchLegalAppBillers()])
  } catch (e: any) {
    return NextResponse.json({ error: `Legal unreachable: ${e?.message || e}` }, { status: 502 })
  }

  const recon = computeReconciliation(entities, billers)

  // Build the list of company upserts (Legal → Stripe), preserving Stripe-local fields.
  const existing = new Map(getCompanies().map(c => [c.slug, c]))
  const changes: { slug: string; action: 'create' | 'update' | 'unchanged'; fields: string[] }[] = []

  const upserts: CompanyProfile[] = []
  for (const e of entities) {
    const d = legalEntityToCompany(e)
    const prev = existing.get(e.slug)
    const merged: CompanyProfile = {
      // Stripe-local fields preserved (or sensible defaults for new)
      slug: e.slug,
      stripeEnvironment: prev?.stripeEnvironment ?? 'test',
      registrationNumber: prev?.registrationNumber ?? '',
      phone: prev?.phone ?? '',
      bank: prev?.bank ?? '',
      iban: prev?.iban ?? '',
      isVatPayer: prev?.isVatPayer ?? false,
      vatRate: prev?.vatRate ?? 0,
      website: prev?.website ?? '',
      logoUrl: prev?.logoUrl ?? '',
      // Legal-driven fields
      name: d.name,
      cui: d.cui,
      address: d.address,
      email: d.email,
      country: d.country,
      currency: d.currency,
      source: 'legal',
      legalSyncedAt: new Date().toISOString(),
    }

    // diff which Legal-driven fields change
    const changed: string[] = []
    if (prev) {
      for (const k of ['name', 'cui', 'address', 'email', 'country', 'currency'] as const) {
        if ((prev[k] || '') !== (merged[k] || '')) changed.push(k)
      }
      changes.push({ slug: e.slug, action: changed.length ? 'update' : 'unchanged', fields: changed })
    } else {
      changes.push({ slug: e.slug, action: 'create', fields: ['name', 'cui', 'address', 'email', 'country', 'currency'] })
    }
    upserts.push(merged)
  }

  // Project→biller suggestions (not applied here)
  const billerSuggestions = billers.map(b => ({
    appSlug: b.appSlug,
    suggestedCompany: b.billerSlug,
    billerName: b.billerName,
  }))

  if (preview) {
    return NextResponse.json({
      preview: true,
      changes,
      billerSuggestions,
      reconciliation: recon,
    })
  }

  // Apply
  for (const c of upserts) upsertCompany(c)

  return NextResponse.json({
    applied: true,
    upserted: upserts.length,
    changes,
    billerSuggestions,
    reconciliation: computeReconciliation(entities, billers),
  })
}
