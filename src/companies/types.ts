/**
 * Company profile — business details (safe to commit).
 */
export interface CompanyProfile {
  /** Unique slug identifier (e.g., 'blochub', 'ave') */
  slug: string
  /** Legal company name */
  name: string
  /** CUI / Tax ID */
  cui?: string
  /** J-number / Registration number */
  registrationNumber?: string
  /** Company address */
  address?: string
  /** Company email */
  email?: string
  /** Company phone */
  phone?: string
  /** Bank name */
  bank?: string
  /** IBAN */
  iban?: string
  /** Is VAT payer */
  isVatPayer?: boolean
  /** VAT rate (e.g., 0.19 for 19%) */
  vatRate?: number
  /** Default currency for this company (e.g., 'ron', 'eur') */
  currency: string
  /** Country code (e.g., 'RO', 'DE') */
  country: string
  /** Stripe environment: 'test' or 'live' */
  stripeEnvironment: 'test' | 'live'
  /** Website URL */
  website?: string
  /** Logo URL */
  logoUrl?: string
}

/**
 * Company credentials — Stripe keys (NEVER commit these).
 * Loaded from .credentials.json or env vars.
 */
export interface CompanyCredentials {
  secretKey: string
  publishableKey: string
  webhookSecret: string
}

/**
 * Full company config — profile + credentials resolved at runtime.
 */
export interface CompanyConfig {
  profile: CompanyProfile
  credentials: CompanyCredentials
}
