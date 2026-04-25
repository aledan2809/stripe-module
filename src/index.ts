// --- Core ---
export { getStripe, getStripeSync, stripe, setKeyProvider } from './client'
export { configureStripeModule, getConfig, DEFAULT_CONFIG } from './config'
export { toStripeAmount, fromStripeAmount } from './utils'

// --- Company Registry ---
export { useCompany, getActiveCompany, getActiveCompanyProfile, getActivePublishableKey, getStripeForCompany, invalidateCompanyInstance } from './companies/use-company'
export { registerCompany, getCompanyProfile, listCompanies, listCompanyProfiles, hasCompany } from './companies/registry'
export { setCompanyCredentials, resolveCredentials, getPublishableKey, getWebhookSecret, invalidateCredentialCache } from './companies/credentials'
export type { CompanyProfile, CompanyCredentials, CompanyConfig } from './companies/types'

// --- Types ---
export type {
  StripeModuleConfig,
  StripeKeyProvider,
  CreatePaymentIntentInput,
  CreatePaymentIntentResult,
  WebhookEventType,
  WebhookHandlerMap,
  PaymentFormProps,
  PaymentFormLabels,
} from './types'
export { DEFAULT_LABELS } from './types'

// --- Server: Payment Intents ---
export { createPaymentIntent } from './server/create-intent'
export { verifyWebhookSignature, processWebhookEvent, handleWebhook } from './server/webhook'
export type { VerifyWebhookInput } from './server/webhook'

// --- Server: Checkout Sessions ---
export { createCheckoutSession, getCheckoutSession } from './server/checkout'
export type { CheckoutLineItem, CheckoutPriceItem, CreateCheckoutSessionInput, CheckoutSessionResult } from './server/checkout'

// --- Server: Customers ---
export { createCustomer, getCustomer, findCustomerByEmail, findCustomerByAppUserId, getOrCreateCustomer, updateCustomer, deleteCustomer } from './server/customers'
export type { CreateCustomerInput, UpdateCustomerInput } from './server/customers'

// --- Server: Subscriptions ---
export { createSubscription, getSubscription, listSubscriptions, updateSubscription, cancelSubscription, cancelSubscriptionAtPeriodEnd, resumeSubscription, toSubscriptionInfo } from './server/subscriptions'
export type { CreateSubscriptionInput, UpdateSubscriptionInput, SubscriptionInfo } from './server/subscriptions'

// --- Server: Products & Prices ---
export { createProduct, updateProduct, getProduct, listProducts, createPrice, listPrices, getProductWithPrices, listProductsWithPrices, createProductWithPrice } from './server/products'
export type { CreateProductInput, CreatePriceInput, ProductWithPrices } from './server/products'

// --- Server: Billing Portal ---
export { createPortalSession, createPortalConfiguration } from './server/billing-portal'
export type { CreatePortalSessionInput, CreatePortalConfigInput } from './server/billing-portal'

// --- Server: Refunds ---
export { createRefund, getRefund, listRefunds } from './server/refunds'
export type { CreateRefundInput, RefundInfo } from './server/refunds'

// --- Server: Usage-based Billing ---
export { reportUsage, getUsageSummary, getSubscriptionItemId, reportUsageForSubscription } from './server/usage'
export type { ReportUsageInput, UsageSummary } from './server/usage'

// --- Server: Plan Sync ---
export { syncPlans, getPlanMapping } from './server/sync'
export type { PlanDefinition, PriceDefinition, SyncResult, PlanMapping } from './server/sync'

// --- Server: Stripe Connect (Marketplace) ---
export { createConnectedAccount, createAccountLink, createLoginLink, getConnectedAccount, listConnectedAccounts, deleteConnectedAccount, createMarketplacePayment, createMarketplaceCheckout, createTransfer, getConnectedAccountBalance } from './server/connect'
export type { CreateConnectedAccountInput, CreateAccountLinkInput, ConnectedAccountInfo, CreateMarketplacePaymentInput, MarketplacePaymentResult, CreateMarketplaceCheckoutInput } from './server/connect'

// --- Next.js Route Helpers ---
export { createIntentRoute } from './nextjs/create-intent-route'
export type { CreateIntentRouteOptions } from './nextjs/create-intent-route'
export { webhookRoute } from './nextjs/webhook-route'
export type { WebhookRouteOptions } from './nextjs/webhook-route'
export { checkoutRoute } from './nextjs/checkout-route'
export type { CheckoutRouteOptions } from './nextjs/checkout-route'
export { portalRoute } from './nextjs/portal-route'
export type { PortalRouteOptions } from './nextjs/portal-route'
export { syncRoute } from './nextjs/sync-route'
export type { SyncRouteOptions } from './nextjs/sync-route'
export { connectRoute } from './nextjs/connect-route'
export type { ConnectRouteOptions } from './nextjs/connect-route'

// --- React Components ---
export { PaymentForm } from './components/PaymentForm'

// --- AI Router ---
export { routeAI, aiRouter, router } from './lib/ai-router'
export type { AIRequest, AIResponse } from './lib/ai-router'
