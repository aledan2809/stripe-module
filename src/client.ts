import Stripe from 'stripe'
import { getConfig } from './config'
import type { StripeKeyProvider } from './types'

let stripeInstance: Stripe | null = null
let currentKeyHash: string | null = null
let keyProvider: StripeKeyProvider | null = null

/**
 * Register a custom key provider (e.g., read from DB, vault, etc.).
 * If not set, falls back to STRIPE_SECRET_KEY env var.
 */
export function setKeyProvider(provider: StripeKeyProvider): void {
  keyProvider = provider
  // Invalidate cached instance so next call uses the new provider
  stripeInstance = null
  currentKeyHash = null
}

async function resolveSecretKey(): Promise<string> {
  // 1. Custom key provider
  if (keyProvider) {
    const key = await keyProvider()
    if (key) return key
  }

  // 2. Environment variable fallback
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY
  }

  throw new Error(
    'Stripe secret key not configured. Use setKeyProvider() or set STRIPE_SECRET_KEY env var.'
  )
}

/**
 * Get a Stripe instance (async, preferred).
 * Re-creates instance if the key changes.
 */
export async function getStripe(): Promise<Stripe> {
  const key = await resolveSecretKey()
  const keyHash = simpleHash(key)

  if (stripeInstance && currentKeyHash === keyHash) {
    return stripeInstance
  }

  const config = getConfig()
  stripeInstance = new Stripe(key, {
    apiVersion: config.apiVersion as any,
    typescript: true,
  })
  currentKeyHash = keyHash
  return stripeInstance
}

/**
 * Synchronous Stripe getter — uses env var only.
 * Use getStripe() (async) when possible.
 */
export function getStripeSync(): Stripe {
  if (stripeInstance) return stripeInstance

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      'Stripe not initialized. Call getStripe() first or set STRIPE_SECRET_KEY env var.'
    )
  }

  const config = getConfig()
  stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: config.apiVersion as any,
    typescript: true,
  })
  currentKeyHash = simpleHash(process.env.STRIPE_SECRET_KEY)
  return stripeInstance
}

/**
 * Lazy-initialized Stripe proxy (sync access, env-only fallback).
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const instance = getStripeSync()
    const value = (instance as any)[prop]
    if (typeof value === 'function') {
      return value.bind(instance)
    }
    return value
  },
})

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash.toString(36)
}
