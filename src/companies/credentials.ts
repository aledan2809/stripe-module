import * as fs from 'fs'
import * as path from 'path'
import type { CompanyCredentials } from './types'

/**
 * Credential resolution order for a company slug:
 * 1. Environment variables: STRIPE_{SLUG}_SECRET_KEY, STRIPE_{SLUG}_PUBLISHABLE_KEY, STRIPE_{SLUG}_WEBHOOK_SECRET
 * 2. .credentials.json file in the Stripe module root
 * 3. Programmatically registered credentials
 */

// In-memory credential store (for programmatic registration)
const credentialStore: Map<string, CompanyCredentials> = new Map()

// Cached credentials from file
let fileCredentials: Record<string, CompanyCredentials> | null = null

/**
 * Programmatically register credentials for a company.
 * Useful for loading from DB or vault at app startup.
 */
export function setCompanyCredentials(slug: string, credentials: CompanyCredentials): void {
  credentialStore.set(slug, credentials)
}

/**
 * Load credentials from .credentials.json file.
 */
function loadFileCredentials(): Record<string, CompanyCredentials> {
  if (fileCredentials !== null) return fileCredentials

  const filePath = path.resolve(__dirname, '../../.credentials.json')
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      fileCredentials = JSON.parse(raw)
      return fileCredentials!
    }
  } catch {
    // File not found or invalid JSON — silent fallback
  }

  fileCredentials = {}
  return fileCredentials
}

/**
 * Resolve credentials for a company.
 * Priority: env vars > programmatic > .credentials.json
 */
export function resolveCredentials(slug: string): CompanyCredentials {
  const envPrefix = `STRIPE_${slug.toUpperCase().replace(/-/g, '_')}`

  // 1. Environment variables
  const envSecret = process.env[`${envPrefix}_SECRET_KEY`]
  const envPublishable = process.env[`${envPrefix}_PUBLISHABLE_KEY`]
  const envWebhook = process.env[`${envPrefix}_WEBHOOK_SECRET`]

  if (envSecret && envPublishable) {
    return {
      secretKey: envSecret,
      publishableKey: envPublishable,
      webhookSecret: envWebhook || '',
    }
  }

  // 2. Programmatic store
  const stored = credentialStore.get(slug)
  if (stored) return stored

  // 3. .credentials.json file
  const fileCreds = loadFileCredentials()
  if (fileCreds[slug]) return fileCreds[slug]

  throw new Error(
    `Stripe credentials not found for company "${slug}". ` +
    `Set env vars ${envPrefix}_SECRET_KEY + ${envPrefix}_PUBLISHABLE_KEY, ` +
    `or add to .credentials.json, or call setCompanyCredentials().`
  )
}

/**
 * Get the publishable key for a company (safe for frontend).
 */
export function getPublishableKey(slug: string): string {
  return resolveCredentials(slug).publishableKey
}

/**
 * Get the webhook secret for a company.
 */
export function getWebhookSecret(slug: string): string {
  return resolveCredentials(slug).webhookSecret
}

/**
 * Invalidate cached file credentials (e.g., after updating .credentials.json).
 */
export function invalidateCredentialCache(): void {
  fileCredentials = null
}
