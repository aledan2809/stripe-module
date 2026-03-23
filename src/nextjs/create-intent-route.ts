import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createPaymentIntent } from '../server/create-intent'
import type { CreatePaymentIntentInput } from '../types'

export interface CreateIntentRouteOptions {
  /**
   * Validate the request and return a CreatePaymentIntentInput.
   * Throw or return null to reject the request.
   */
  resolvePayment: (body: any, request: NextRequest) => Promise<CreatePaymentIntentInput | null>
  /**
   * Optional: called after PaymentIntent is created (e.g., to save to DB).
   */
  onIntentCreated?: (result: { paymentIntentId: string; clientSecret: string; amount: number }, body: any) => Promise<void>
  /**
   * Optional: custom auth check. Return false to reject with 401.
   */
  authorize?: (request: NextRequest) => Promise<boolean>
}

/**
 * Create a Next.js POST route handler for creating Stripe PaymentIntents.
 *
 * Usage in app/api/payments/create-intent/route.ts:
 * ```ts
 * import { createIntentRoute } from '@projects/stripe-module/nextjs'
 * export const POST = createIntentRoute({ ... })
 * ```
 */
export function createIntentRoute(options: CreateIntentRouteOptions) {
  return async function POST(request: NextRequest) {
    try {
      // Auth check
      if (options.authorize) {
        const authorized = await options.authorize(request)
        if (!authorized) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      }

      const body = await request.json()

      // Resolve payment details from the request body
      const paymentInput = await options.resolvePayment(body, request)
      if (!paymentInput) {
        return NextResponse.json({ error: 'Invalid payment request' }, { status: 400 })
      }

      // Create Stripe PaymentIntent
      const result = await createPaymentIntent(paymentInput)

      // Post-creation callback (e.g., save to DB)
      if (options.onIntentCreated) {
        await options.onIntentCreated(result, body)
      }

      return NextResponse.json({
        clientSecret: result.clientSecret,
        paymentIntentId: result.paymentIntentId,
        amount: result.amount,
      })
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }
      console.error('Stripe create intent error:', error)
      return NextResponse.json(
        { error: error.message || 'Payment creation failed' },
        { status: 500 }
      )
    }
  }
}
