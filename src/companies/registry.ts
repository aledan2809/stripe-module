import type { CompanyProfile } from './types'

/**
 * Central company registry.
 * Add new companies here. Credentials are loaded separately (never committed).
 *
 * Usage: import { COMPANIES } from '@projects/stripe-module'
 */
const companies: Map<string, CompanyProfile> = new Map()

// ─── Registered Companies ───────────────────────────────────────────

registerCompany({
  slug: 'blochub',
  name: 'BlocHub SRL',
  cui: '',            // Fill in
  address: '',
  email: '',
  currency: 'ron',
  country: 'RO',
  isVatPayer: true,
  vatRate: 0.19,
  stripeEnvironment: 'test',
})

registerCompany({
  slug: 'ave',
  name: 'AVE',
  cui: '',
  address: '',
  email: '',
  currency: 'ron',
  country: 'RO',
  isVatPayer: true,
  vatRate: 0.19,
  stripeEnvironment: 'test',
})

// ─── Registry Functions ─────────────────────────────────────────────

/**
 * Register a company in the registry.
 */
export function registerCompany(profile: CompanyProfile): void {
  companies.set(profile.slug, profile)
}

/**
 * Get a company profile by slug.
 */
export function getCompanyProfile(slug: string): CompanyProfile | undefined {
  return companies.get(slug)
}

/**
 * List all registered company slugs.
 */
export function listCompanies(): string[] {
  return Array.from(companies.keys())
}

/**
 * List all registered company profiles.
 */
export function listCompanyProfiles(): CompanyProfile[] {
  return Array.from(companies.values())
}

/**
 * Check if a company is registered.
 */
export function hasCompany(slug: string): boolean {
  return companies.has(slug)
}
