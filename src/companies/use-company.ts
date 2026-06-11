import Stripe from 'stripe'
import { getCompanyProfile } from './registry'
import { resolveCredentials, getPublishableKey } from './credentials'
import { configureStripeModule, getConfig } from '../config'
import { setKeyProvider } from '../client'
import type { CompanyProfile, CompanyConfig } from './types'

// Track the active company
let activeCompanySlug: string | null = null

// Per-company Stripe instance cache
const stripeInstances: Map<string, Stripe> = new Map()

/**
 * Activate a company for the Stripe module.
 * Configures currency, country, and Stripe keys automatically.
 *
 * ⚠️ SINGLE-COMPANY-PER-PROCESS ONLY (G-STRIPE-004): this mutates module-global state
 * (config + key provider + active slug). In a process that serves MULTIPLE companies
 * concurrently (e.g. multi-tenant request handlers), currency/keys can bleed between
 * in-flight requests. For multi-company use `getStripeForCompany(slug)` instead — it
 * returns an isolated, cached Stripe instance per company with no global mutation.
 *
 * Usage in app startup (e.g., Next.js middleware or layout):
 * ```ts
 * import { useCompany } from '@projects/stripe-module'
 * useCompany('ave')
 * // Done! All Stripe calls now use AVE's credentials and config.
 * ```
 */
export function useCompany(slug: string): CompanyConfig {
  const profile = getCompanyProfile(slug)
  if (!profile) {
    throw new Error(
      `Company "${slug}" not registered. Add it in src/companies/registry.ts`
    )
  }

  if (activeCompanySlug && activeCompanySlug !== slug) {
    // Switching the global active company mid-process — safe only if companies aren't
    // served concurrently. Multi-tenant callers should use getStripeForCompany() instead.
    console.warn(
      `[stripe-module] useCompany('${slug}') switched the global active company from '${activeCompanySlug}'. ` +
      `If this process serves multiple companies concurrently, use getStripeForCompany('${slug}') to avoid currency/key bleed (G-STRIPE-004).`
    )
  }

  const credentials = resolveCredentials(slug)

  // Configure module-level settings
  configureStripeModule({
    currency: profile.currency,
    country: profile.country,
  })

  // Set key provider to use this company's secret key
  setKeyProvider(async () => credentials.secretKey)

  activeCompanySlug = slug

  return { profile, credentials }
}

/**
 * Get the currently active company slug.
 */
export function getActiveCompany(): string | null {
  return activeCompanySlug
}

/**
 * Get the active company's profile.
 */
export function getActiveCompanyProfile(): CompanyProfile | null {
  if (!activeCompanySlug) return null
  return getCompanyProfile(activeCompanySlug) || null
}

/**
 * Get the active company's publishable key (for frontend).
 */
export function getActivePublishableKey(): string {
  if (!activeCompanySlug) {
    throw new Error('No company activated. Call useCompany() first.')
  }
  return getPublishableKey(activeCompanySlug)
}

/**
 * Get a Stripe instance for a specific company (multi-company in same app).
 * Instances are cached per company.
 */
export function getStripeForCompany(slug: string): Stripe {
  const cached = stripeInstances.get(slug)
  if (cached) return cached

  const credentials = resolveCredentials(slug)
  const config = getConfig()

  const instance = new Stripe(credentials.secretKey, {
    apiVersion: config.apiVersion as any,
    typescript: true,
  })

  stripeInstances.set(slug, instance)
  return instance
}

/**
 * Invalidate cached Stripe instance for a company (e.g., after key rotation).
 */
export function invalidateCompanyInstance(slug: string): void {
  stripeInstances.delete(slug)
}
