# Stripe Module — Ghid de utilizare

## Instalare în alt proiect

```bash
npm install stripe @stripe/react-stripe-js @stripe/stripe-js zod
```

Apoi referențiază modulul local în `package.json`:
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

## API Routes (Next.js App Router)

### Create Payment Intent — `app/api/payments/create-intent/route.ts`
```ts
import { createIntentRoute } from '@projects/stripe-module'

export const POST = createIntentRoute({
  authorize: async (req) => {
    const session = await getServerSession(authOptions)
    return !!session?.user
  },
  resolvePayment: async (body) => {
    const order = await db.order.findUnique({ where: { id: body.orderId } })
    if (!order) return null
    return {
      amount: order.total,
      description: `Comandă #${order.number}`,
      metadata: { orderId: order.id },
    }
  },
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

### Webhook — `app/api/payments/webhook/route.ts`
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
  },
})
```

## React Component

```tsx
import { PaymentForm } from '@projects/stripe-module'

<PaymentForm
  publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
  createIntentUrl="/api/payments/create-intent"
  createIntentBody={{ orderId: order.id }}
  amount={order.total}
  currencyLabel="RON"
  returnUrl={`${window.location.origin}/payments/success`}
  onSuccess={() => router.push('/payments/success')}
  onCancel={() => router.back()}
  labels={{
    title: 'Plată comandă',
    payButton: 'Plătește acum',
  }}
/>
```

## Server-side direct (fără Next.js)

```ts
import { createPaymentIntent, handleWebhook } from '@projects/stripe-module'

// Create intent
const result = await createPaymentIntent({
  amount: 99.99,
  description: 'Test payment',
  metadata: { userId: '123' },
})

// Handle webhook
const result = await handleWebhook(
  { rawBody, signature, webhookSecret: 'whsec_...' },
  { 'payment_intent.succeeded': async (event) => { ... } }
)
```
