import { getCompanies, getProjectMappings, type CompanyProfile, type CompanyCredentials } from './data'
import { getCredentials } from './data'

/**
 * Legal → Stripe Broker sync.
 *
 * Legal (legal.knowbest.ro) is the SOURCE OF TRUTH for entity identity + project→biller
 * mappings. The broker mirrors that into its own JSON store and flags drift. The broker
 * NEVER writes back to Legal (legal data needs human review) — reconciliation is copy-assisted.
 */

const LEGAL_API_URL = process.env.LEGAL_API_URL || 'https://legal.knowbest.ro'
const LEGAL_API_KEY = process.env.LEGAL_API_KEY || ''

export interface LegalEntity {
  slug: string
  legalName: string
  jurisdiction: string
  cui: string | null
  address: unknown
  dpoEmail: string | null
  bankDetails: unknown
  stripeAccountId: string | null
  appliesToCurrencies: string[]
  isActive: boolean
}

export interface LegalAppBiller {
  appSlug: string
  billerSlug: string
  billerName: string
  controllerSlug: string
  controllerName: string
}

async function legalFetch<T>(path: string): Promise<T> {
  if (!LEGAL_API_KEY) throw new Error('LEGAL_API_KEY not configured in the broker env')
  const res = await fetch(`${LEGAL_API_URL}${path}`, {
    headers: { 'x-api-key': LEGAL_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Legal ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export async function fetchLegalEntities(): Promise<LegalEntity[]> {
  const data = await legalFetch<{ entities: LegalEntity[] }>('/api/v1/public/billing-entities')
  return data.entities || []
}

export async function fetchLegalAppBillers(): Promise<LegalAppBiller[]> {
  const data = await legalFetch<{ mappings: LegalAppBiller[] }>('/api/v1/public/app-billers')
  return data.mappings || []
}

// ─── Mapping Legal entity → Stripe company profile fields ───────────────────

function flattenAddress(addr: unknown): string {
  if (!addr || typeof addr !== 'object') return ''
  const a = addr as Record<string, string>
  return [a.street, a.city, a.postal, a.country].filter(Boolean).join(', ')
}

function jurisdictionToCountry(j: string): string {
  // "RO" | "US-CA" | "AE-DIFC" → ISO country
  return (j || '').split('-')[0].toUpperCase()
}

/** The Stripe-company shape that Legal drives (Stripe-local fields like keys are excluded). */
export interface LegalDerivedCompany {
  slug: string
  name: string
  cui: string
  address: string
  email: string
  country: string
  currency: string
}

export function legalEntityToCompany(e: LegalEntity): LegalDerivedCompany {
  return {
    slug: e.slug,
    name: e.legalName,
    cui: e.cui || '',
    address: flattenAddress(e.address),
    email: e.dpoEmail || '',
    country: jurisdictionToCountry(e.jurisdiction),
    currency: (e.appliesToCurrencies?.[0] || 'ron').toLowerCase(),
  }
}

// ─── Diff + inconsistency computation ───────────────────────────────────────

export interface FieldDiff {
  field: string
  legal: string
  stripe: string
  status: 'same' | 'differs' | 'legal-empty' | 'stripe-empty'
}

export interface CompanyReconcile {
  slug: string
  name: string
  inLegal: boolean
  inStripe: boolean
  source?: string
  fields: FieldDiff[]
  flags: string[] // human-readable inconsistency flags
}

const FIELD = (field: string, legal: string, stripe: string): FieldDiff => {
  const l = (legal || '').trim()
  const s = (stripe || '').trim()
  let status: FieldDiff['status']
  if (l && s) status = l === s ? 'same' : 'differs'
  else if (!l && s) status = 'legal-empty'
  else if (l && !s) status = 'stripe-empty'
  else status = 'same'
  return { field, legal: l, stripe: s, status }
}

/**
 * Build the full reconciliation view: per company, Legal vs Stripe field diff + flags.
 * Pure (no IO) — caller passes fetched Legal data.
 */
export function computeReconciliation(
  legalEntities: LegalEntity[],
  legalBillers: LegalAppBiller[],
): { companies: CompanyReconcile[]; summary: { withFlags: number; total: number } } {
  const stripeCompanies = getCompanies()
  const stripeBySlug = new Map(stripeCompanies.map(c => [c.slug, c]))
  const legalBySlug = new Map(legalEntities.map(e => [e.slug, e]))
  const mappings = getProjectMappings()

  const allSlugs = new Set<string>([...stripeBySlug.keys(), ...legalBySlug.keys()])
  const companies: CompanyReconcile[] = []

  for (const slug of allSlugs) {
    const sc = stripeBySlug.get(slug)
    const le = legalBySlug.get(slug)
    const derived = le ? legalEntityToCompany(le) : null
    const flags: string[] = []
    const fields: FieldDiff[] = []

    if (le && sc) {
      fields.push(FIELD('name', derived!.name, sc.name))
      fields.push(FIELD('cui', derived!.cui, sc.cui || ''))
      fields.push(FIELD('address', derived!.address, sc.address || ''))
      fields.push(FIELD('email', derived!.email, sc.email || ''))
      fields.push(FIELD('country', derived!.country, sc.country || ''))
      fields.push(FIELD('currency', derived!.currency, sc.currency || ''))
      for (const f of fields) {
        if (f.status === 'differs') flags.push(`drift: ${f.field} (Legal „${f.legal}" ≠ Stripe „${f.stripe}")`)
      }
      // stripeAccountId cross-check (Legal entity may carry the expected account)
      if (le.stripeAccountId) {
        // we can't read the account id from keys here without a Stripe call; surface for the panel
      }
    } else if (le && !sc) {
      flags.push('entitate în Legal, nesincronizată în Stripe')
    } else if (sc && !le) {
      flags.push('firmă în Stripe, absentă în Legal (orphan)')
      // surface Stripe values as candidates to promote to Legal
      fields.push(FIELD('name', '', sc.name))
      fields.push(FIELD('cui', '', sc.cui || ''))
      fields.push(FIELD('address', '', sc.address || ''))
      fields.push(FIELD('email', '', sc.email || ''))
      fields.push(FIELD('country', '', sc.country || ''))
      fields.push(FIELD('currency', '', sc.currency || ''))
    }

    companies.push({
      slug,
      name: le?.legalName || sc?.name || slug,
      inLegal: !!le,
      inStripe: !!sc,
      source: sc?.source,
      fields,
      flags,
    })
  }

  // Project→biller mapping inconsistencies (Legal biller vs Stripe brokerCompany)
  for (const m of legalBillers) {
    const stripeMapping = mappings.find(x => x.projectSlug === m.appSlug)
    if (stripeMapping?.brokerCompany && stripeMapping.brokerCompany !== m.billerSlug) {
      const target = companies.find(c => c.slug === m.billerSlug) || companies.find(c => c.slug === stripeMapping.brokerCompany)
      target?.flags.push(`proiect „${m.appSlug}": Stripe→${stripeMapping.brokerCompany}, Legal biller→${m.billerSlug}`)
    }
    // biller without Stripe keys → can't collect
    const creds: CompanyCredentials = getCredentials(m.billerSlug)
    const hasKey = !!(creds.test?.secretKey || creds.live?.secretKey)
    if (!hasKey) {
      const target = companies.find(c => c.slug === m.billerSlug)
      target?.flags.push(`biller pentru „${m.appSlug}" dar fără chei Stripe`)
    }
  }

  const withFlags = companies.filter(c => c.flags.length > 0).length
  return { companies, summary: { withFlags, total: companies.length } }
}
