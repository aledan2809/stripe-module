import { NextRequest, NextResponse } from 'next/server'
import { handleWebhook } from '../server/webhook'
import type { WebhookHandlerMap } from '../types'

export interface WebhookRouteOptions {
  /**
   * Map of Stripe event types to handler functions.
   */
  handlers: WebhookHandlerMap
  /**
   * Webhook secret. Defaults to process.env.STRIPE_WEBHOOK_SECRET.
   */
  webhookSecret?: string
}

/**
 * Create a Next.js POST route handler for Stripe webhooks.
 *
 * Usage in app/api/payments/webhook/route.ts:
 * ```ts
 * import { webhookRoute } from '@projects/stripe-module/nextjs'
 * export const POST = webhookRoute({
 *   handlers: {
 *     'payment_intent.succeeded': async (event) => { ... },
 *     'payment_intent.payment_failed': async (event) => { ... },
 *   }
 * })
 * ```
 */
export function webhookRoute(options: WebhookRouteOptions) {
  return async function POST(request: NextRequest) {
    const rawBody = await request.text()
    const signature = request.headers.get('stripe-signature')

    const webhookSecret = options.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET

    if (!signature || !webhookSecret) {
      return NextResponse.json(
        { error: 'Missing signature or webhook secret' },
        { status: 400 }
      )
    }

    try {
      const result = await handleWebhook(
        { rawBody, signature, webhookSecret },
        options.handlers
      )

      return NextResponse.json(result)
    } catch (error: any) {
      if (error.type === 'StripeSignatureVerificationError') {
        console.error('Webhook signature verification failed:', error.message)
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }

      console.error('Webhook processing error:', error)
      return NextResponse.json(
        { error: 'Webhook processing failed' },
        { status: 500 }
      )
    }
  }
}
