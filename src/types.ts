import Stripe from 'stripe'

// --- Configuration ---

export interface StripeModuleConfig {
  /** Currency code (default: 'ron') */
  currency: string
  /** Country code (default: 'RO') */
  country: string
  /** Accepted payment methods (default: ['card']) */
  paymentMethods: string[]
  /** Stripe API version */
  apiVersion?: string
}

// --- Key Provider ---

/**
 * Function that resolves the Stripe secret key.
 * Can read from DB, env, vault, etc.
 */
export type StripeKeyProvider = () => Promise<string>

// --- Payment Intent ---

export interface CreatePaymentIntentInput {
  /** Amount in real currency (e.g., 10.50 RON), NOT in cents */
  amount: number
  /** Currency override (uses config default if not set) */
  currency?: string
  /** Metadata to attach to the PaymentIntent */
  metadata?: Record<string, string>
  /** Human-readable description */
  description?: string
  /** Customer ID in Stripe (optional) */
  customerId?: string
}

export interface CreatePaymentIntentResult {
  clientSecret: string
  paymentIntentId: string
  amount: number
}

// --- Webhook ---

export type WebhookEventType =
  | 'payment_intent.succeeded'
  | 'payment_intent.payment_failed'
  | 'payment_intent.canceled'
  | 'charge.refunded'
  | string

export interface WebhookHandlerMap {
  [eventType: string]: (event: Stripe.Event) => Promise<void>
}

// --- Payment Form Component ---

export interface PaymentFormProps {
  /** API endpoint to create payment intent */
  createIntentUrl: string
  /** Body payload sent to the createIntentUrl */
  createIntentBody: Record<string, unknown>
  /** Amount to display (in real currency, not cents) */
  amount: number
  /** Currency label (default: 'RON') */
  currencyLabel?: string
  /** Stripe publishable key */
  publishableKey: string
  /** URL to redirect after successful payment */
  returnUrl?: string
  /** Callback on successful payment */
  onSuccess?: () => void
  /** Callback on cancel */
  onCancel?: () => void
  /** Custom labels */
  labels?: Partial<PaymentFormLabels>
}

export interface PaymentFormLabels {
  title: string
  subtitle: string
  payButton: string
  processing: string
  success: string
  successDescription: string
  error: string
  securityNote: string
  amountLabel: string
  backButton: string
}

export const DEFAULT_LABELS: PaymentFormLabels = {
  title: 'Plată online',
  subtitle: 'Introdu datele cardului pentru a efectua plata',
  payButton: 'Plătește',
  processing: 'Se pregătește plata...',
  success: 'Plată procesată cu succes!',
  successDescription: 'Vei primi o confirmare pe email în câteva momente.',
  error: 'A apărut o eroare la procesarea plății.',
  securityNote: 'Plățile sunt procesate securizat prin Stripe. Datele cardului nu sunt stocate pe serverele noastre.',
  amountLabel: 'Suma de plată:',
  backButton: 'Înapoi',
}
