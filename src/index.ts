// --- Core ---
export { getStripe, getStripeSync, stripe, setKeyProvider } from './client'
export { configureStripeModule, getConfig, DEFAULT_CONFIG } from './config'
export { toStripeAmount, fromStripeAmount } from './utils'

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

// --- Server ---
export { createPaymentIntent } from './server/create-intent'
export { verifyWebhookSignature, processWebhookEvent, handleWebhook } from './server/webhook'
export type { VerifyWebhookInput } from './server/webhook'

// --- Next.js Route Helpers ---
export { createIntentRoute } from './nextjs/create-intent-route'
export type { CreateIntentRouteOptions } from './nextjs/create-intent-route'
export { webhookRoute } from './nextjs/webhook-route'
export type { WebhookRouteOptions } from './nextjs/webhook-route'

// --- React Components ---
export { PaymentForm } from './components/PaymentForm'
