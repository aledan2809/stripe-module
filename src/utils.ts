/**
 * Convert a real-currency amount to Stripe's smallest unit (cents/bani).
 * E.g., 10.50 RON → 1050
 */
export function toStripeAmount(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Convert from Stripe's smallest unit back to real-currency amount.
 * E.g., 1050 → 10.50 RON
 */
export function fromStripeAmount(amount: number): number {
  return amount / 100
}
