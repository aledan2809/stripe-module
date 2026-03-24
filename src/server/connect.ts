import Stripe from 'stripe'
import { getStripe } from '../client'
import { getConfig } from '../config'
import { toStripeAmount } from '../utils'

// --- Types ---

export interface CreateConnectedAccountInput {
  /** Email of the seller/vendor */
  email: string
  /** Country code (default: config country) */
  country?: string
  /** Business type */
  businessType?: 'individual' | 'company'
  /** Metadata (e.g., app user ID, vendor ID) */
  metadata?: Record<string, string>
  /** Capabilities to request */
  capabilities?: {
    cardPayments?: boolean
    transfers?: boolean
    bankTransfers?: boolean
  }
}

export interface CreateAccountLinkInput {
  /** Connected account ID (acct_xxx) */
  accountId: string
  /** URL to redirect after onboarding is complete */
  returnUrl: string
  /** URL to redirect if user exits onboarding early */
  refreshUrl: string
  /** 'account_onboarding' for initial setup, 'account_update' for updates */
  type?: 'account_onboarding' | 'account_update'
}

export interface ConnectedAccountInfo {
  id: string
  email: string
  businessName: string | null
  country: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  onboardingComplete: boolean
  metadata: Record<string, string>
}

export interface CreateMarketplacePaymentInput {
  /** Amount in real currency (e.g., 100.00 RON), NOT cents */
  amount: number
  /** Currency override */
  currency?: string
  /** Connected account ID that receives the payment */
  destinationAccountId: string
  /** Platform fee in real currency (e.g., 10.00 RON for 10% on 100 RON) */
  platformFee: number
  /** Description */
  description?: string
  /** Metadata */
  metadata?: Record<string, string>
  /** Customer ID (optional) */
  customerId?: string
}

export interface MarketplacePaymentResult {
  clientSecret: string
  paymentIntentId: string
  amount: number
  platformFee: number
  sellerReceives: number
}

export interface CreateMarketplaceCheckoutInput {
  /** Line items */
  lineItems: Array<{
    name: string
    amount: number
    quantity?: number
    description?: string
    images?: string[]
  }>
  /** Connected account that receives payment */
  destinationAccountId: string
  /** Platform fee in real currency */
  platformFee: number
  /** Success/cancel URLs */
  successUrl: string
  cancelUrl: string
  /** Customer email */
  customerEmail?: string
  /** Metadata */
  metadata?: Record<string, string>
  /** Currency override */
  currency?: string
}

// --- Connected Accounts (Onboarding sellers/vendors) ---

/**
 * Create a connected account for a seller/vendor.
 * This is the first step in onboarding a marketplace seller.
 */
export async function createConnectedAccount(
  input: CreateConnectedAccountInput
): Promise<Stripe.Account> {
  const stripe = await getStripe()
  const config = getConfig()

  const params: Stripe.AccountCreateParams = {
    type: 'express',
    country: input.country || config.country,
    email: input.email,
    business_type: input.businessType || 'individual',
    metadata: input.metadata,
    capabilities: {
      card_payments: { requested: input.capabilities?.cardPayments !== false },
      transfers: { requested: input.capabilities?.transfers !== false },
    },
  }

  return stripe.accounts.create(params)
}

/**
 * Create an account link for seller onboarding.
 * Redirect the seller to this URL to complete KYC/identity verification.
 */
export async function createAccountLink(
  input: CreateAccountLinkInput
): Promise<{ url: string }> {
  const stripe = await getStripe()

  const link = await stripe.accountLinks.create({
    account: input.accountId,
    return_url: input.returnUrl,
    refresh_url: input.refreshUrl,
    type: input.type || 'account_onboarding',
  })

  return { url: link.url }
}

/**
 * Create a login link for a connected account (Express Dashboard).
 * Sellers can view their payments, payouts, etc.
 */
export async function createLoginLink(accountId: string): Promise<{ url: string }> {
  const stripe = await getStripe()
  const link = await stripe.accounts.createLoginLink(accountId)
  return { url: link.url }
}

/**
 * Get connected account details.
 */
export async function getConnectedAccount(accountId: string): Promise<ConnectedAccountInfo> {
  const stripe = await getStripe()
  const account = await stripe.accounts.retrieve(accountId)

  return {
    id: account.id,
    email: account.email || '',
    businessName: account.business_profile?.name || null,
    country: account.country || '',
    chargesEnabled: account.charges_enabled || false,
    payoutsEnabled: account.payouts_enabled || false,
    detailsSubmitted: account.details_submitted || false,
    onboardingComplete: (account.charges_enabled && account.details_submitted) || false,
    metadata: (account.metadata || {}) as Record<string, string>,
  }
}

/**
 * List all connected accounts.
 */
export async function listConnectedAccounts(
  limit = 100
): Promise<ConnectedAccountInfo[]> {
  const stripe = await getStripe()
  const result = await stripe.accounts.list({ limit })

  return result.data.map(account => ({
    id: account.id,
    email: account.email || '',
    businessName: account.business_profile?.name || null,
    country: account.country || '',
    chargesEnabled: account.charges_enabled || false,
    payoutsEnabled: account.payouts_enabled || false,
    detailsSubmitted: account.details_submitted || false,
    onboardingComplete: (account.charges_enabled && account.details_submitted) || false,
    metadata: (account.metadata || {}) as Record<string, string>,
  }))
}

/**
 * Delete/remove a connected account.
 */
export async function deleteConnectedAccount(accountId: string): Promise<void> {
  const stripe = await getStripe()
  await stripe.accounts.del(accountId)
}

// --- Marketplace Payments (with platform fee) ---

/**
 * Create a PaymentIntent with destination charge (marketplace model).
 * Money goes to the connected account, platform takes a fee.
 */
export async function createMarketplacePayment(
  input: CreateMarketplacePaymentInput
): Promise<MarketplacePaymentResult> {
  const stripe = await getStripe()
  const config = getConfig()
  const currency = input.currency || config.currency

  const paymentIntent = await stripe.paymentIntents.create({
    amount: toStripeAmount(input.amount),
    currency,
    description: input.description,
    metadata: input.metadata,
    customer: input.customerId,
    application_fee_amount: toStripeAmount(input.platformFee),
    transfer_data: {
      destination: input.destinationAccountId,
    },
  })

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
    amount: input.amount,
    platformFee: input.platformFee,
    sellerReceives: input.amount - input.platformFee,
  }
}

/**
 * Create a Checkout Session with destination charge (marketplace model).
 * Redirects buyer to Stripe-hosted page, money split between platform and seller.
 */
export async function createMarketplaceCheckout(
  input: CreateMarketplaceCheckoutInput
): Promise<{ sessionId: string; url: string }> {
  const stripe = await getStripe()
  const config = getConfig()
  const currency = input.currency || config.currency

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = input.lineItems.map(item => ({
    price_data: {
      currency,
      product_data: {
        name: item.name,
        description: item.description,
        images: item.images,
      },
      unit_amount: toStripeAmount(item.amount),
    },
    quantity: item.quantity || 1,
  }))

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    payment_intent_data: {
      application_fee_amount: toStripeAmount(input.platformFee),
      transfer_data: {
        destination: input.destinationAccountId,
      },
      metadata: input.metadata,
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail,
    metadata: input.metadata,
  })

  return {
    sessionId: session.id,
    url: session.url!,
  }
}

// --- Transfers & Payouts ---

/**
 * Create a manual transfer to a connected account.
 * Useful for delayed payouts or custom split logic.
 */
export async function createTransfer(
  destinationAccountId: string,
  amount: number,
  currency?: string,
  metadata?: Record<string, string>
): Promise<Stripe.Transfer> {
  const stripe = await getStripe()
  const config = getConfig()

  return stripe.transfers.create({
    amount: toStripeAmount(amount),
    currency: currency || config.currency,
    destination: destinationAccountId,
    metadata,
  })
}

/**
 * Get balance for a connected account.
 */
export async function getConnectedAccountBalance(
  accountId: string
): Promise<{ available: number; pending: number; currency: string }[]> {
  const stripe = await getStripe()
  const balance = await stripe.balance.retrieve({
    stripeAccount: accountId,
  })

  return balance.available.map((b, i) => ({
    available: b.amount / 100,
    pending: (balance.pending[i]?.amount || 0) / 100,
    currency: b.currency,
  }))
}
