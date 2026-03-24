import Stripe from 'stripe'
import { getStripe } from '../client'

// --- Types ---

export interface CreateCustomerInput {
  email: string
  name?: string
  phone?: string
  metadata?: Record<string, string>
  /** App-level user ID to store in Stripe metadata */
  appUserId?: string
}

export interface UpdateCustomerInput {
  customerId: string
  email?: string
  name?: string
  phone?: string
  metadata?: Record<string, string>
}

// --- Functions ---

/**
 * Create a Stripe customer. Stores appUserId in metadata for linking back.
 */
export async function createCustomer(input: CreateCustomerInput): Promise<Stripe.Customer> {
  const stripe = await getStripe()

  const metadata: Record<string, string> = { ...input.metadata }
  if (input.appUserId) {
    metadata.appUserId = input.appUserId
  }

  return stripe.customers.create({
    email: input.email,
    name: input.name,
    phone: input.phone,
    metadata,
  })
}

/**
 * Get a Stripe customer by ID.
 */
export async function getCustomer(customerId: string): Promise<Stripe.Customer | null> {
  const stripe = await getStripe()
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (customer.deleted) return null
    return customer as Stripe.Customer
  } catch {
    return null
  }
}

/**
 * Find customer by email. Returns the first match or null.
 */
export async function findCustomerByEmail(email: string): Promise<Stripe.Customer | null> {
  const stripe = await getStripe()
  const result = await stripe.customers.list({ email, limit: 1 })
  return result.data[0] || null
}

/**
 * Find customer by app user ID (stored in metadata).
 */
export async function findCustomerByAppUserId(appUserId: string): Promise<Stripe.Customer | null> {
  const stripe = await getStripe()
  const result = await stripe.customers.search({
    query: `metadata["appUserId"]:"${appUserId}"`,
    limit: 1,
  })
  return result.data[0] || null
}

/**
 * Get or create a customer. Searches by email first, creates if not found.
 */
export async function getOrCreateCustomer(input: CreateCustomerInput): Promise<Stripe.Customer> {
  const existing = await findCustomerByEmail(input.email)
  if (existing) {
    // Update appUserId in metadata if provided and not set
    if (input.appUserId && !existing.metadata?.appUserId) {
      return updateCustomer({
        customerId: existing.id,
        metadata: { ...existing.metadata, appUserId: input.appUserId },
      })
    }
    return existing
  }
  return createCustomer(input)
}

/**
 * Update a Stripe customer.
 */
export async function updateCustomer(input: UpdateCustomerInput): Promise<Stripe.Customer> {
  const stripe = await getStripe()
  return stripe.customers.update(input.customerId, {
    email: input.email,
    name: input.name,
    phone: input.phone,
    metadata: input.metadata,
  })
}

/**
 * Delete a Stripe customer.
 */
export async function deleteCustomer(customerId: string): Promise<void> {
  const stripe = await getStripe()
  await stripe.customers.del(customerId)
}
