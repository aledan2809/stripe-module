import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession } from '../server/checkout'
import type { CreateCheckoutSessionInput } from '../server/checkout'

export interface CheckoutRouteOptions {
  /**
   * Resolve checkout session params from the request body.
   * Return null to reject.
   */
  resolveCheckout: (body: any, request: NextRequest) => Promise<CreateCheckoutSessionInput | null>
  /**
   * Optional auth check.
   */
  authorize?: (request: NextRequest) => Promise<boolean>
  /**
   * Called after session is created (e.g., save to DB).
   */
  onSessionCreated?: (result: { sessionId: string; url: string }, body: any) => Promise<void>
}

/**
 * Create a Next.js POST route for Stripe Checkout Sessions.
 *
 * Usage:
 * ```ts
 * export const POST = checkoutRoute({
 *   resolveCheckout: async (body) => ({
 *     mode: 'subscription',
 *     priceItems: [{ priceId: body.priceId }],
 *     successUrl: `${process.env.NEXT_PUBLIC_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
 *     cancelUrl: `${process.env.NEXT_PUBLIC_URL}/pricing`,
 *     customerEmail: body.email,
 *   }),
 * })
 * ```
 */
export function checkoutRoute(options: CheckoutRouteOptions) {
  return async function POST(request: NextRequest) {
    try {
      if (options.authorize) {
        const authorized = await options.authorize(request)
        if (!authorized) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      }

      const body = await request.json()
      const checkoutInput = await options.resolveCheckout(body, request)

      if (!checkoutInput) {
        return NextResponse.json({ error: 'Invalid checkout request' }, { status: 400 })
      }

      const result = await createCheckoutSession(checkoutInput)

      if (options.onSessionCreated) {
        await options.onSessionCreated(result, body)
      }

      return NextResponse.json(result)
    } catch (error: any) {
      console.error('Checkout session error:', error)
      return NextResponse.json(
        { error: error.message || 'Checkout failed' },
        { status: 500 }
      )
    }
  }
}
