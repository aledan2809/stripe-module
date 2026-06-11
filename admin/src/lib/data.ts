import fs from 'fs'
import path from 'path'
import os from 'os'

/**
 * Resolve the module's data/ dir robustly (G-STRIPE-006):
 * env override > cwd-relative candidates (admin cwd or repo-root cwd).
 * Falls back to ../data (the historical default) if nothing exists yet.
 */
function resolveDataDir(): string {
  if (process.env.STRIPE_ADMIN_DATA_DIR) return process.env.STRIPE_ADMIN_DATA_DIR
  const candidates = [
    path.resolve(process.cwd(), '../data'), // started from admin/ (next dev default)
    path.resolve(process.cwd(), 'data'),    // started from the Stripe repo root
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'companies.json'))) return dir
  }
  return candidates[0]
}

const DATA_DIR = resolveDataDir()

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
  // ─── Checkout Broker API (consumer apps create checkouts without holding Stripe keys) ───
  /** Per-project API key the consumer app sends as X-Project-Key */
  apiKey?: string
  /** HMAC secret used to sign broker→app callbacks */
  callbackSecret?: string
  /** Firma a cărei cheie Stripe o folosește brokerul pentru checkout-urile acestui proiect */
  brokerCompany?: string
  /** Mediul cheii folosite de broker pentru acest proiect */
  brokerEnv?: 'test' | 'live'
  /** Brokerul răspunde 503 dacă e dezactivat */
  brokerEnabled?: boolean
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
    m.subscriptionCompany === companySlug ||
    m.serviceCompany === companySlug ||
    m.brokerCompany === companySlug
  )
}

/** Resolve a project mapping by its broker API key (X-Project-Key). */
export function findMappingByApiKey(apiKey: string): ProjectMapping | undefined {
  if (!apiKey) return undefined
  return getProjectMappings().find(m => m.apiKey === apiKey)
}

export function getAssignedProjects(): string[] {
  return getProjectMappings()
    .filter(m => m.subscriptionCompany || m.serviceCompany)
    .map(m => m.projectSlug)
}

// --- Discover available projects ---

const EXCLUDED = new Set([
  'stripe', 'stripe-admin', 'node_modules', 'html', 'deploy.sh',
  'backups', 'monitoring',
])

export function discoverProjects(): { slug: string; path: string }[] {
  // Detect environment: Windows → C:/Projects, macOS → ~/Projects, Linux/VPS → /var/www (G-STRIPE-005)
  const projectsRoot =
    process.env.PROJECTS_ROOT ||
    (process.platform === 'win32'
      ? 'C:/Projects'
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Projects')
        : '/var/www')

  try {
    const dirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
    return dirs
      .filter(d => d.isDirectory())
      .filter(d => !d.name.startsWith('.'))
      .filter(d => !EXCLUDED.has(d.name.toLowerCase()))
      .map(d => ({
        slug: d.name.toLowerCase().replace(/\s+/g, '-'),
        path: path.join(projectsRoot, d.name),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug))
  } catch {
    return []
  }
}
