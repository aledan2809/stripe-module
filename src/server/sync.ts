import Stripe from 'stripe'
import { getStripe } from '../client'
import { getConfig } from '../config'
import { toStripeAmount } from '../utils'

// --- Types ---

export interface PlanDefinition {
  /** Unique slug within the project (e.g., 'basic', 'pro', 'enterprise') */
  slug: string
  /** Display name */
  name: string
  /** Description */
  description?: string
  /** Features list (stored in Stripe metadata for reference) */
  features?: string[]
  /** Pricing tiers */
  prices: PriceDefinition[]
  /** Is this plan active? Set false to deactivate in Stripe */
  active?: boolean
  /** Sort order for display */
  sortOrder?: number
  /** Image URLs */
  images?: string[]
}

export interface PriceDefinition {
  /** Amount in real currency (e.g., 49.99), NOT cents */
  amount: number
  /** Billing interval */
  interval: 'month' | 'year' | 'week' | 'day'
  /** Interval count (e.g., 3 for quarterly) */
  intervalCount?: number
  /** Currency override (uses config default) */
  currency?: string
  /** For usage-based/metered billing */
  usageType?: 'licensed' | 'metered'
  /** Is this price active? */
  active?: boolean
}

export interface SyncResult {
  project: string
  created: { products: number; prices: number }
  updated: { products: number; prices: number }
  deactivated: { products: number; prices: number }
  /** Mapping: planSlug → { productId, prices: [{ interval, priceId }] } */
  mapping: Record<string, PlanMapping>
}

export interface PlanMapping {
  productId: string
  prices: Array<{
    interval: string
    intervalCount: number
    priceId: string
    amount: number
    currency: string
    active: boolean
  }>
}

// --- Sync Function ---

/**
 * Synchronize plans for a project to Stripe.
 *
 * - Creates products/prices that don't exist
 * - Updates products that changed (name, description, active)
 * - Creates new prices if amount/interval changed (Stripe prices are immutable)
 * - Deactivates prices/products that are no longer in the plan list
 * - All products tagged with metadata: { project, planSlug, managedBy: 'stripe-module' }
 *
 * Usage:
 * ```ts
 * const result = await syncPlans('blochub', [
 *   { slug: 'basic', name: 'Basic', prices: [{ amount: 29.99, interval: 'month' }] },
 *   { slug: 'pro', name: 'Professional', prices: [
 *     { amount: 49.99, interval: 'month' },
 *     { amount: 499.99, interval: 'year' },
 *   ]},
 * ])
 * // result.mapping.basic.prices[0].priceId → 'price_xxx'
 * ```
 */
export async function syncPlans(
  project: string,
  plans: PlanDefinition[]
): Promise<SyncResult> {
  const stripe = await getStripe()
  const config = getConfig()

  const result: SyncResult = {
    project,
    created: { products: 0, prices: 0 },
    updated: { products: 0, prices: 0 },
    deactivated: { products: 0, prices: 0 },
    mapping: {},
  }

  // 1. Fetch all existing products for this project
  const existingProducts = await fetchProjectProducts(stripe, project)

  // Track which slugs we've processed (to detect removed plans)
  const processedSlugs = new Set<string>()

  // 2. For each plan definition, sync to Stripe
  for (const plan of plans) {
    processedSlugs.add(plan.slug)
    const isActive = plan.active !== false

    const existing = existingProducts.get(plan.slug)

    if (existing) {
      // Product exists — update if needed
      const needsUpdate =
        existing.product.name !== plan.name ||
        existing.product.description !== (plan.description || null) ||
        existing.product.active !== isActive

      if (needsUpdate) {
        await stripe.products.update(existing.product.id, {
          name: plan.name,
          description: plan.description || undefined,
          active: isActive,
          metadata: {
            ...existing.product.metadata,
            features: plan.features?.join('|||') || '',
            sortOrder: String(plan.sortOrder ?? 0),
          },
        })
        result.updated.products++
      }

      // Sync prices
      const priceMapping = await syncPrices(
        stripe, existing.product.id, plan, existing.prices, config.currency, result
      )

      result.mapping[plan.slug] = {
        productId: existing.product.id,
        prices: priceMapping,
      }
    } else {
      // Product doesn't exist — create it
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        active: isActive,
        images: plan.images,
        metadata: {
          project,
          planSlug: plan.slug,
          managedBy: 'stripe-module',
          features: plan.features?.join('|||') || '',
          sortOrder: String(plan.sortOrder ?? 0),
        },
      })
      result.created.products++

      // Create prices
      const priceMapping: PlanMapping['prices'] = []
      for (const priceDef of plan.prices) {
        const priceActive = priceDef.active !== false && isActive
        const currency = priceDef.currency || config.currency

        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: toStripeAmount(priceDef.amount),
          currency,
          active: priceActive,
          recurring: {
            interval: priceDef.interval,
            interval_count: priceDef.intervalCount || 1,
            usage_type: priceDef.usageType || 'licensed',
          },
          metadata: {
            project,
            planSlug: plan.slug,
            managedBy: 'stripe-module',
          },
        })
        result.created.prices++

        priceMapping.push({
          interval: priceDef.interval,
          intervalCount: priceDef.intervalCount || 1,
          priceId: price.id,
          amount: priceDef.amount,
          currency,
          active: priceActive,
        })
      }

      result.mapping[plan.slug] = {
        productId: product.id,
        prices: priceMapping,
      }
    }
  }

  // 3. Deactivate products that are no longer in the plan list
  for (const [slug, existing] of existingProducts) {
    if (!processedSlugs.has(slug) && existing.product.active) {
      await stripe.products.update(existing.product.id, { active: false })
      result.deactivated.products++

      // Deactivate all prices too
      for (const price of existing.prices) {
        if (price.active) {
          await stripe.prices.update(price.id, { active: false })
          result.deactivated.prices++
        }
      }
    }
  }

  return result
}

/**
 * Get the current plan mapping for a project (without syncing).
 * Useful for reading Stripe Price IDs at runtime.
 */
export async function getPlanMapping(project: string): Promise<Record<string, PlanMapping>> {
  const stripe = await getStripe()
  const products = await fetchProjectProducts(stripe, project)
  const mapping: Record<string, PlanMapping> = {}

  for (const [slug, data] of products) {
    if (!data.product.active) continue
    mapping[slug] = {
      productId: data.product.id,
      prices: data.prices
        .filter(p => p.active)
        .map(p => ({
          interval: p.recurring?.interval || 'month',
          intervalCount: p.recurring?.interval_count || 1,
          priceId: p.id,
          amount: (p.unit_amount || 0) / 100,
          currency: p.currency,
          active: p.active,
        })),
    }
  }

  return mapping
}

// --- Internal helpers ---

interface ExistingProduct {
  product: Stripe.Product
  prices: Stripe.Price[]
}

async function fetchProjectProducts(
  stripe: Stripe,
  project: string
): Promise<Map<string, ExistingProduct>> {
  const map = new Map<string, ExistingProduct>()

  // Search for products managed by this module for this project
  const products = await stripe.products.search({
    query: `metadata["project"]:"${project}" AND metadata["managedBy"]:"stripe-module"`,
    limit: 100,
  })

  for (const product of products.data) {
    const slug = product.metadata?.planSlug
    if (!slug) continue

    // Fetch prices for this product
    const prices = await stripe.prices.list({
      product: product.id,
      limit: 100,
    })

    map.set(slug, { product, prices: prices.data })
  }

  return map
}

async function syncPrices(
  stripe: Stripe,
  productId: string,
  plan: PlanDefinition,
  existingPrices: Stripe.Price[],
  defaultCurrency: string,
  result: SyncResult
): Promise<PlanMapping['prices']> {
  const priceMapping: PlanMapping['prices'] = []

  // Build a key for each price definition: "month-1-ron-4999"
  const priceKey = (interval: string, count: number, currency: string, amount: number) =>
    `${interval}-${count}-${currency}-${amount}`

  const existingByKey = new Map<string, Stripe.Price>()
  for (const p of existingPrices) {
    const key = priceKey(
      p.recurring?.interval || 'month',
      p.recurring?.interval_count || 1,
      p.currency,
      p.unit_amount || 0
    )
    existingByKey.set(key, p)
  }

  const processedPriceIds = new Set<string>()

  for (const priceDef of plan.prices) {
    const currency = priceDef.currency || defaultCurrency
    const amountCents = toStripeAmount(priceDef.amount)
    const key = priceKey(
      priceDef.interval,
      priceDef.intervalCount || 1,
      currency,
      amountCents
    )
    const priceActive = priceDef.active !== false && plan.active !== false

    const existing = existingByKey.get(key)

    if (existing) {
      processedPriceIds.add(existing.id)

      // Price amount matches — just update active status if needed
      if (existing.active !== priceActive) {
        await stripe.prices.update(existing.id, { active: priceActive })
        result.updated.prices++
      }

      priceMapping.push({
        interval: priceDef.interval,
        intervalCount: priceDef.intervalCount || 1,
        priceId: existing.id,
        amount: priceDef.amount,
        currency,
        active: priceActive,
      })
    } else {
      // Price doesn't exist (or amount changed) — create new
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: amountCents,
        currency,
        active: priceActive,
        recurring: {
          interval: priceDef.interval,
          interval_count: priceDef.intervalCount || 1,
          usage_type: priceDef.usageType || 'licensed',
        },
        metadata: {
          project: plan.slug,
          managedBy: 'stripe-module',
        },
      })
      result.created.prices++
      processedPriceIds.add(price.id)

      priceMapping.push({
        interval: priceDef.interval,
        intervalCount: priceDef.intervalCount || 1,
        priceId: price.id,
        amount: priceDef.amount,
        currency,
        active: priceActive,
      })
    }
  }

  // Deactivate prices that are no longer in the plan
  for (const existingPrice of existingPrices) {
    if (!processedPriceIds.has(existingPrice.id) && existingPrice.active) {
      await stripe.prices.update(existingPrice.id, { active: false })
      result.deactivated.prices++
    }
  }

  return priceMapping
}
