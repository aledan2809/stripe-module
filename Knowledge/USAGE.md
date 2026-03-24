# Stripe Module — Ghid complet de utilizare

## Instalare în alt proiect

```bash
npm install stripe @stripe/react-stripe-js @stripe/stripe-js zod
```

Referențiază modulul local în `package.json`:
```json
{
  "dependencies": {
    "@projects/stripe-module": "file:../Stripe"
  }
}
```

## Setup

### 1. Variabile de mediu (.env)
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 2. Configurare (opțional)
```ts
import { configureStripeModule } from '@projects/stripe-module'

configureStripeModule({
  currency: 'eur',     // default: 'ron'
  country: 'DE',       // default: 'RO'
})
```

### 3. Key Provider custom (opțional — pt. chei din DB)
```ts
import { setKeyProvider } from '@projects/stripe-module'

setKeyProvider(async () => {
  const settings = await db.settings.findFirst()
  return settings?.stripeSecretKey || ''
})
```

---

## 1. Checkout Sessions (Stripe-hosted page)

### Next.js Route — `app/api/checkout/route.ts`
```ts
import { checkoutRoute } from '@projects/stripe-module'

export const POST = checkoutRoute({
  authorize: async (req) => {
    const session = await getServerSession(authOptions)
    return !!session?.user
  },
  resolveCheckout: async (body) => ({
    mode: 'subscription',                    // or 'payment' for one-time
    priceItems: [{ priceId: body.priceId }], // existing Stripe Price ID
    successUrl: `${process.env.NEXT_PUBLIC_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${process.env.NEXT_PUBLIC_URL}/pricing`,
    customerEmail: body.email,
    allowPromotionCodes: true,
    trialDays: 14,
  }),
  onSessionCreated: async (result, body) => {
    // Save to DB if needed
  },
})
```

### Inline pricing (fără Price ID pre-creat):
```ts
resolveCheckout: async (body) => ({
  mode: 'payment',
  lineItems: [{
    name: 'AI Web Audit',
    description: 'Full website audit report',
    amount: 49.99,        // RON, NOT cents
    quantity: 1,
  }],
  successUrl: '...',
  cancelUrl: '...',
})
```

### Frontend redirect:
```ts
const res = await fetch('/api/checkout', {
  method: 'POST',
  body: JSON.stringify({ priceId: 'price_xxx' }),
})
const { url } = await res.json()
window.location.href = url  // redirect to Stripe Checkout
```

---

## 2. Payment Intents (Embedded form)

### Next.js Route — `app/api/payments/create-intent/route.ts`
```ts
import { createIntentRoute } from '@projects/stripe-module'

export const POST = createIntentRoute({
  authorize: async (req) => {
    const session = await getServerSession(authOptions)
    return !!session?.user
  },
  resolvePayment: async (body) => ({
    amount: body.amount,
    description: `Order #${body.orderId}`,
    metadata: { orderId: body.orderId },
  }),
  onIntentCreated: async (result, body) => {
    await db.payment.create({
      data: {
        amount: result.amount,
        status: 'PENDING',
        stripePaymentId: result.paymentIntentId,
        orderId: body.orderId,
      },
    })
  },
})
```

### React Component:
```tsx
import { PaymentForm } from '@projects/stripe-module'

<PaymentForm
  publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
  createIntentUrl="/api/payments/create-intent"
  createIntentBody={{ orderId: order.id, amount: order.total }}
  amount={order.total}
  currencyLabel="RON"
  returnUrl={`${window.location.origin}/payments/success`}
  onSuccess={() => router.push('/payments/success')}
  onCancel={() => router.back()}
  labels={{ title: 'Plată comandă', payButton: 'Plătește acum' }}
/>
```

---

## 3. Customers

```ts
import { getOrCreateCustomer, findCustomerByAppUserId } from '@projects/stripe-module'

// Get or create — searches by email first
const customer = await getOrCreateCustomer({
  email: user.email,
  name: user.name,
  appUserId: user.id,   // stored in Stripe metadata
})

// Find by app user ID
const customer = await findCustomerByAppUserId(userId)
```

---

## 4. Subscriptions

```ts
import {
  createSubscription,
  cancelSubscriptionAtPeriodEnd,
  resumeSubscription,
  updateSubscription,
  listSubscriptions,
  toSubscriptionInfo,
} from '@projects/stripe-module'

// Create subscription
const sub = await createSubscription({
  customerId: customer.id,
  priceId: 'price_xxx',
  trialDays: 14,
  metadata: { plan: 'pro', product: 'web-auditor' },
})

// Client secret for payment confirmation (if needed)
const clientSecret = (sub.latest_invoice as any)?.payment_intent?.client_secret

// List customer's subscriptions
const subs = await listSubscriptions(customer.id, 'active')
const infos = subs.map(toSubscriptionInfo)

// Change plan
await updateSubscription({
  subscriptionId: sub.id,
  priceId: 'price_new_plan',
})

// Cancel at period end
await cancelSubscriptionAtPeriodEnd(sub.id)

// Resume cancelled
await resumeSubscription(sub.id)
```

---

## 5. Products & Prices

```ts
import { createProductWithPrice, listProductsWithPrices } from '@projects/stripe-module'

// Create product + price in one call
const { product, prices } = await createProductWithPrice(
  { name: 'AI Web Auditor Pro', description: 'Monthly audit subscription' },
  { amount: 99.99, recurring: { interval: 'month' } }
)

// List all products with prices (for pricing page)
const catalog = await listProductsWithPrices()

// Create metered price (usage-based)
const { product, prices } = await createProductWithPrice(
  { name: 'AI Test Runs', description: 'Per-test pricing' },
  { amount: 2.50, recurring: { interval: 'month' }, usageType: 'metered' }
)
```

---

## 6. Billing Portal (self-service)

### Next.js Route — `app/api/billing/portal/route.ts`
```ts
import { portalRoute } from '@projects/stripe-module'

export const POST = portalRoute({
  resolveCustomerId: async (req) => {
    const session = await getServerSession(authOptions)
    const user = await db.user.findUnique({ where: { id: session.user.id } })
    return user?.stripeCustomerId || null
  },
  returnUrl: `${process.env.NEXT_PUBLIC_URL}/dashboard`,
})
```

### Frontend:
```ts
const res = await fetch('/api/billing/portal', { method: 'POST' })
const { url } = await res.json()
window.location.href = url  // redirect to Stripe self-service portal
```

---

## 7. Webhooks

### Next.js Route — `app/api/stripe/webhook/route.ts`
```ts
import { webhookRoute } from '@projects/stripe-module'
import Stripe from 'stripe'

export const POST = webhookRoute({
  handlers: {
    'payment_intent.succeeded': async (event) => {
      const pi = event.data.object as Stripe.PaymentIntent
      await db.payment.updateMany({
        where: { stripePaymentId: pi.id },
        data: { status: 'CONFIRMED' },
      })
    },
    'payment_intent.payment_failed': async (event) => {
      const pi = event.data.object as Stripe.PaymentIntent
      await db.payment.updateMany({
        where: { stripePaymentId: pi.id },
        data: { status: 'FAILED' },
      })
    },
    'customer.subscription.created': async (event) => {
      const sub = event.data.object as Stripe.Subscription
      // Handle new subscription
    },
    'customer.subscription.updated': async (event) => {
      const sub = event.data.object as Stripe.Subscription
      // Handle plan change, cancellation, etc.
    },
    'customer.subscription.deleted': async (event) => {
      const sub = event.data.object as Stripe.Subscription
      // Handle subscription ended
    },
    'checkout.session.completed': async (event) => {
      const session = event.data.object as Stripe.Checkout.Session
      // Handle checkout completed
    },
  },
})
```

---

## 8. Refunds

```ts
import { createRefund, listRefunds } from '@projects/stripe-module'

// Full refund
await createRefund({ paymentIntentId: 'pi_xxx' })

// Partial refund
await createRefund({
  paymentIntentId: 'pi_xxx',
  amount: 25.00,   // RON, not cents
  reason: 'requested_by_customer',
})

// List refunds for a payment
const refunds = await listRefunds('pi_xxx')
```

---

## 9. Usage-based Billing

Perfect for components that charge per-use (audit runs, test executions, etc.).

```ts
import { reportUsageForSubscription, getUsageSummary } from '@projects/stripe-module'

// After each audit/test run, report usage
await reportUsageForSubscription(subscriptionId, 1)  // +1 unit

// Or report multiple at once
await reportUsageForSubscription(subscriptionId, 5, 'set')  // set to 5

// Get usage summary for current period
const summary = await getUsageSummary(subscriptionItemId)
```

---

## 10. Direct server-side (fără Next.js)

```ts
import { createPaymentIntent, handleWebhook, getStripe } from '@projects/stripe-module'

// Direct Stripe instance access
const stripe = await getStripe()
const charges = await stripe.charges.list({ limit: 10 })

// Create intent
const result = await createPaymentIntent({
  amount: 99.99,
  description: 'Test payment',
  metadata: { userId: '123' },
})

// Handle webhook (Express/Fastify)
const result = await handleWebhook(
  { rawBody, signature, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET! },
  { 'payment_intent.succeeded': async (event) => { /* ... */ } }
)
```

---

## Stripe Dashboard Setup

### Test Mode:
1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy Publishable key → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
3. Copy Secret key → `STRIPE_SECRET_KEY`
4. Go to Developers → Webhooks → Add endpoint
5. URL: `https://your-domain.com/api/stripe/webhook`
6. Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `customer.subscription.*`, `checkout.session.completed`
7. Copy Signing secret → `STRIPE_WEBHOOK_SECRET`

### Stripe CLI (local testing):
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```
