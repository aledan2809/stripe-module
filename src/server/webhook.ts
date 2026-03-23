import Stripe from 'stripe'
import { getStripeSync } from '../client'
import type { WebhookHandlerMap } from '../types'

export interface VerifyWebhookInput {
  /** Raw request body (must be the raw string/buffer, NOT parsed JSON) */
  rawBody: string | Buffer
  /** Stripe-Signature header value */
  signature: string
  /** Webhook secret (from env or config) */
  webhookSecret: string
}

/**
 * Verify a Stripe webhook signature and return the parsed event.
 */
export function verifyWebhookSignature(input: VerifyWebhookInput): Stripe.Event {
  const stripe = getStripeSync()
  return stripe.webhooks.constructEvent(
    input.rawBody,
    input.signature,
    input.webhookSecret
  )
}

/**
 * Process a verified webhook event using a handler map.
 * Returns true if a handler was found and executed.
 */
export async function processWebhookEvent(
  event: Stripe.Event,
  handlers: WebhookHandlerMap
): Promise<boolean> {
  const handler = handlers[event.type]
  if (handler) {
    await handler(event)
    return true
  }
  return false
}

/**
 * Full webhook processing: verify signature + dispatch to handlers.
 * Returns { received: true } on success or throws on verification failure.
 */
export async function handleWebhook(
  input: VerifyWebhookInput,
  handlers: WebhookHandlerMap
): Promise<{ received: true; eventType: string; handled: boolean }> {
  const event = verifyWebhookSignature(input)
  const handled = await processWebhookEvent(event, handlers)
  return { received: true, eventType: event.type, handled }
}
