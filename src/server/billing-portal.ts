import Stripe from 'stripe'
import { getStripe } from '../client'

// --- Types ---

export interface CreatePortalSessionInput {
  /** Stripe Customer ID */
  customerId: string
  /** URL to redirect after the customer leaves the portal */
  returnUrl: string
}

export interface CreatePortalConfigInput {
  /** Allow customers to update payment methods */
  allowPaymentMethodUpdate?: boolean
  /** Allow customers to update subscriptions */
  allowSubscriptionUpdate?: boolean
  /** Allow customers to cancel subscriptions */
  allowSubscriptionCancel?: boolean
  /** Products that can be switched between (for plan upgrades/downgrades) */
  subscriptionUpdateProducts?: Array<{
    productId: string
    priceIds: string[]
  }>
  /** Business name and branding */
  businessProfile?: {
    headline?: string
    privacyPolicyUrl?: string
    termsOfServiceUrl?: string
  }
}

// --- Functions ---

/**
 * Create a Stripe Billing Portal session.
 * Customers can manage subscriptions, update payment methods, view invoices.
 */
export async function createPortalSession(
  input: CreatePortalSessionInput
): Promise<{ url: string }> {
  const stripe = await getStripe()

  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
  })

  return { url: session.url }
}

/**
 * Create or update a Billing Portal configuration.
 * Controls what customers can do in the portal.
 */
export async function createPortalConfiguration(
  input: CreatePortalConfigInput
): Promise<Stripe.BillingPortal.Configuration> {
  const stripe = await getStripe()

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {}

  if (input.allowPaymentMethodUpdate !== false) {
    features.payment_method_update = { enabled: true }
  }

  if (input.allowSubscriptionCancel !== false) {
    features.subscription_cancel = {
      enabled: true,
      mode: 'at_period_end',
    }
  }

  if (input.allowSubscriptionUpdate !== false && input.subscriptionUpdateProducts?.length) {
    features.subscription_update = {
      enabled: true,
      default_allowed_updates: ['price'],
      products: input.subscriptionUpdateProducts.map((p) => ({
        product: p.productId,
        prices: p.priceIds,
      })),
    }
  }

  const params: Stripe.BillingPortal.ConfigurationCreateParams = {
    features,
    business_profile: input.businessProfile
      ? {
          headline: input.businessProfile.headline,
          privacy_policy_url: input.businessProfile.privacyPolicyUrl,
          terms_of_service_url: input.businessProfile.termsOfServiceUrl,
        }
      : undefined,
  }

  return stripe.billingPortal.configurations.create(params)
}
