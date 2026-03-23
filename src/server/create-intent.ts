import { getStripe } from '../client'
import { getConfig } from '../config'
import { toStripeAmount } from '../utils'
import type { CreatePaymentIntentInput, CreatePaymentIntentResult } from '../types'

/**
 * Create a Stripe PaymentIntent.
 * This is a generic server-side function — no framework dependency.
 */
export async function createPaymentIntent(
  input: CreatePaymentIntentInput
): Promise<CreatePaymentIntentResult> {
  const stripe = await getStripe()
  const config = getConfig()

  const paymentIntent = await stripe.paymentIntents.create({
    amount: toStripeAmount(input.amount),
    currency: input.currency || config.currency,
    metadata: input.metadata || {},
    description: input.description,
    customer: input.customerId,
  })

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
    amount: input.amount,
  }
}
