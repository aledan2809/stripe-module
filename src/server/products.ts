import Stripe from 'stripe'
import { getStripe } from '../client'
import { toStripeAmount } from '../utils'
import { getConfig } from '../config'

// --- Types ---

export interface CreateProductInput {
  name: string
  description?: string
  images?: string[]
  metadata?: Record<string, string>
  /** If true, marks as active (default: true) */
  active?: boolean
}

export interface CreatePriceInput {
  productId: string
  /** Amount in real currency (e.g., 49.99), NOT cents */
  amount: number
  /** Currency override (uses config default) */
  currency?: string
  /** Recurring interval for subscriptions */
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year'
    intervalCount?: number
  }
  /** For metered/usage-based billing */
  usageType?: 'licensed' | 'metered'
  /** Metadata */
  metadata?: Record<string, string>
}

export interface ProductWithPrices {
  product: Stripe.Product
  prices: Stripe.Price[]
}

// --- Functions ---

/**
 * Create a Stripe product.
 */
export async function createProduct(input: CreateProductInput): Promise<Stripe.Product> {
  const stripe = await getStripe()
  return stripe.products.create({
    name: input.name,
    description: input.description,
    images: input.images,
    metadata: input.metadata,
    active: input.active !== false,
  })
}

/**
 * Update a Stripe product.
 */
export async function updateProduct(
  productId: string,
  input: Partial<CreateProductInput>
): Promise<Stripe.Product> {
  const stripe = await getStripe()
  return stripe.products.update(productId, {
    name: input.name,
    description: input.description,
    images: input.images,
    metadata: input.metadata,
    active: input.active,
  })
}

/**
 * Get a product by ID.
 */
export async function getProduct(productId: string): Promise<Stripe.Product> {
  const stripe = await getStripe()
  return stripe.products.retrieve(productId)
}

/**
 * List all active products.
 */
export async function listProducts(active = true): Promise<Stripe.Product[]> {
  const stripe = await getStripe()
  const result = await stripe.products.list({ active, limit: 100 })
  return result.data
}

/**
 * Create a price for a product.
 */
export async function createPrice(input: CreatePriceInput): Promise<Stripe.Price> {
  const stripe = await getStripe()
  const config = getConfig()

  const params: Stripe.PriceCreateParams = {
    product: input.productId,
    unit_amount: toStripeAmount(input.amount),
    currency: input.currency || config.currency,
    metadata: input.metadata,
  }

  if (input.recurring) {
    params.recurring = {
      interval: input.recurring.interval,
      interval_count: input.recurring.intervalCount,
      usage_type: input.usageType || 'licensed',
    }
  }

  return stripe.prices.create(params)
}

/**
 * List prices for a product.
 */
export async function listPrices(productId: string, active = true): Promise<Stripe.Price[]> {
  const stripe = await getStripe()
  const result = await stripe.prices.list({ product: productId, active, limit: 100 })
  return result.data
}

/**
 * Get a product with all its active prices.
 */
export async function getProductWithPrices(productId: string): Promise<ProductWithPrices> {
  const [product, prices] = await Promise.all([
    getProduct(productId),
    listPrices(productId),
  ])
  return { product, prices }
}

/**
 * List all products with their prices.
 */
export async function listProductsWithPrices(active = true): Promise<ProductWithPrices[]> {
  const products = await listProducts(active)
  const results = await Promise.all(
    products.map(async (product) => ({
      product,
      prices: await listPrices(product.id, active),
    }))
  )
  return results
}

/**
 * Create a product with a price in one call.
 */
export async function createProductWithPrice(
  product: CreateProductInput,
  price: Omit<CreatePriceInput, 'productId'>
): Promise<ProductWithPrices> {
  const createdProduct = await createProduct(product)
  const createdPrice = await createPrice({
    ...price,
    productId: createdProduct.id,
  })
  return { product: createdProduct, prices: [createdPrice] }
}
