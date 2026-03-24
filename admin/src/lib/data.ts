import fs from 'fs'
import path from 'path'

const DATA_DIR = path.resolve(process.cwd(), '../data')

// --- Types ---

export interface CompanyProfile {
  slug: string
  name: string
  cui: string
  registrationNumber: string
  address: string
  email: string
  phone: string
  bank: string
  iban: string
  isVatPayer: boolean
  vatRate: number
  currency: string
  country: string
  stripeEnvironment: 'test' | 'live'
  website: string
  logoUrl: string
}

export interface StripeKeys {
  secretKey: string
  publishableKey: string
  webhookSecret: string
}

export interface CompanyCredentials {
  test: StripeKeys
  live: StripeKeys
}

/**
 * Each project has 2 separate Stripe configurations:
 *
 * 1. subscriptionCompany — firma care ÎNCASEAZĂ ABONAMENTUL pentru folosirea aplicației
 *    Ex: Class RDA Impex SRL primește bani de la administratorul care folosește BlocHub
 *
 * 2. serviceCompany — firma prin care SE PROCESEAZĂ PLĂȚILE SERVICIILOR
 *    Ex: Asociația de proprietari primește banii de la chiriași/proprietari prin BlocHub
 *    Poate fi aceeași firmă sau diferită. Poate lipsi dacă proiectul nu are plăți servicii.
 */
export interface ProjectMapping {
  projectSlug: string
  projectPath: string
  /** Firma care încasează abonamentul SaaS */
  subscriptionCompany: string
  subscriptionEnv: 'test' | 'live'
  /** Firma care procesează plățile de servicii (opțional) */
  serviceCompany: string
  serviceEnv: 'test' | 'live'
  // Legacy compat
  companySlug?: string
  environment?: 'test' | 'live'
}

// --- File helpers ---

function readJson<T>(filename: string, fallback: T): T {
  const filePath = path.join(DATA_DIR, filename)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJson(filename: string, data: unknown): void {
  const filePath = path.join(DATA_DIR, filename)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// --- Companies ---

export function getCompanies(): CompanyProfile[] {
  return readJson<CompanyProfile[]>('companies.json', [])
}

export function getCompany(slug: string): CompanyProfile | undefined {
  return getCompanies().find(c => c.slug === slug)
}

export function saveCompanies(companies: CompanyProfile[]): void {
  writeJson('companies.json', companies)
}

export function upsertCompany(company: CompanyProfile): void {
  const companies = getCompanies()
  const idx = companies.findIndex(c => c.slug === company.slug)
  if (idx >= 0) {
    companies[idx] = company
  } else {
    companies.push(company)
  }
  saveCompanies(companies)
}

export function deleteCompany(slug: string): void {
  const companies = getCompanies().filter(c => c.slug !== slug)
  saveCompanies(companies)
  // Clear this company from project mappings (both subscription and service)
  const mappings = getProjectMappings().map(m => ({
    ...m,
    subscriptionCompany: m.subscriptionCompany === slug ? '' : m.subscriptionCompany,
    serviceCompany: m.serviceCompany === slug ? '' : m.serviceCompany,
  })).filter(m => m.subscriptionCompany || m.serviceCompany)
  saveProjectMappings(mappings)
  // Remove credentials
  const creds = getAllCredentials()
  delete creds[slug]
  saveAllCredentials(creds)
}

// --- Credentials ---

function getAllCredentials(): Record<string, CompanyCredentials> {
  const data = readJson<{ companies: Record<string, CompanyCredentials> }>('credentials.json', { companies: {} })
  return data.companies || {}
}

function saveAllCredentials(creds: Record<string, CompanyCredentials>): void {
  writeJson('credentials.json', { companies: creds })
}

export function getCredentials(companySlug: string): CompanyCredentials {
  const all = getAllCredentials()
  return all[companySlug] || {
    test: { secretKey: '', publishableKey: '', webhookSecret: '' },
    live: { secretKey: '', publishableKey: '', webhookSecret: '' },
  }
}

export function saveCredentials(companySlug: string, credentials: CompanyCredentials): void {
  const all = getAllCredentials()
  all[companySlug] = credentials
  saveAllCredentials(all)
}

// --- Project Mappings ---

export function getProjectMappings(): ProjectMapping[] {
  const data = readJson<{ mappings: ProjectMapping[] }>('project-mappings.json', { mappings: [] })
  return data.mappings || []
}

export function saveProjectMappings(mappings: ProjectMapping[]): void {
  writeJson('project-mappings.json', { mappings })
}

export function upsertProjectMapping(mapping: ProjectMapping): void {
  const mappings = getProjectMappings()
  // Remove any existing mapping for this project (exclusive assignment)
  const filtered = mappings.filter(m => m.projectSlug !== mapping.projectSlug)
  filtered.push(mapping)
  saveProjectMappings(filtered)
}

export function removeProjectMapping(projectSlug: string): void {
  const mappings = getProjectMappings().filter(m => m.projectSlug !== projectSlug)
  saveProjectMappings(mappings)
}

export function getProjectsForCompany(companySlug: string): ProjectMapping[] {
  return getProjectMappings().filter(m =>
    m.subscriptionCompany === companySlug || m.serviceCompany === companySlug
  )
}

export function getAssignedProjects(): string[] {
  return getProjectMappings()
    .filter(m => m.subscriptionCompany || m.serviceCompany)
    .map(m => m.projectSlug)
}

// --- Discover available projects from C:/Projects ---

export function discoverProjects(): { slug: string; path: string }[] {
  const projectsRoot = 'C:/Projects'
  try {
    const dirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
    return dirs
      .filter(d => d.isDirectory())
      .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules')
      .filter(d => d.name !== 'Stripe') // Exclude self
      .map(d => ({
        slug: d.name.toLowerCase().replace(/\s+/g, '-'),
        path: path.join(projectsRoot, d.name),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug))
  } catch {
    return []
  }
}
