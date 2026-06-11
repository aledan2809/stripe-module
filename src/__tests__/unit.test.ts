import { describe, it, expect, beforeEach } from 'vitest'
import { toStripeAmount, fromStripeAmount } from '../utils'
import { validateMarketplaceAmounts } from '../server/connect'
import { resolveCredentials, setCompanyCredentials } from '../companies/credentials'

describe('amount conversion (money math — no drift)', () => {
  it('toStripeAmount: major → minor units, rounded', () => {
    expect(toStripeAmount(10.5)).toBe(1050)
    expect(toStripeAmount(19.99)).toBe(1999)
    expect(toStripeAmount(10.005)).toBe(1001)      // rounds half up
    expect(toStripeAmount(0.1 + 0.2)).toBe(30)     // float artifact absorbed
    expect(toStripeAmount(0)).toBe(0)
    expect(toStripeAmount(99999999.99)).toBe(9999999999)
  })

  it('fromStripeAmount: minor → major units', () => {
    expect(fromStripeAmount(1050)).toBe(10.5)
    expect(fromStripeAmount(0)).toBe(0)
  })

  it('round-trips for typical prices', () => {
    for (const v of [1, 9.99, 29, 49.99, 499.99]) {
      expect(fromStripeAmount(toStripeAmount(v))).toBeCloseTo(v, 2)
    }
  })
})

describe('validateMarketplaceAmounts (G-STRIPE-008)', () => {
  it('accepts valid amounts', () => {
    expect(() => validateMarketplaceAmounts(100, 10)).not.toThrow()
    expect(() => validateMarketplaceAmounts(100, 0)).not.toThrow()
    expect(() => validateMarketplaceAmounts(100, 100)).not.toThrow() // fee == amount allowed
  })
  it('rejects amount <= 0', () => {
    expect(() => validateMarketplaceAmounts(0, 0)).toThrow(/must be > 0/)
    expect(() => validateMarketplaceAmounts(-5, 0)).toThrow(/must be > 0/)
  })
  it('rejects negative fee', () => {
    expect(() => validateMarketplaceAmounts(100, -1)).toThrow(/cannot be negative/)
  })
  it('rejects fee > amount', () => {
    expect(() => validateMarketplaceAmounts(100, 150)).toThrow(/cannot exceed amount/)
  })
})

describe('resolveCredentials priority (env > programmatic > throw)', () => {
  const SLUG = 'unittestco'
  const ENV = 'STRIPE_UNITTESTCO'
  beforeEach(() => {
    delete process.env[`${ENV}_SECRET_KEY`]
    delete process.env[`${ENV}_PUBLISHABLE_KEY`]
    delete process.env[`${ENV}_WEBHOOK_SECRET`]
  })

  it('env vars win over programmatic', () => {
    setCompanyCredentials(SLUG, { secretKey: 'sk_prog', publishableKey: 'pk_prog', webhookSecret: '' })
    process.env[`${ENV}_SECRET_KEY`] = 'sk_env'
    process.env[`${ENV}_PUBLISHABLE_KEY`] = 'pk_env'
    expect(resolveCredentials(SLUG).secretKey).toBe('sk_env')
  })

  it('falls back to programmatic when env absent', () => {
    setCompanyCredentials(SLUG, { secretKey: 'sk_prog', publishableKey: 'pk_prog', webhookSecret: '' })
    expect(resolveCredentials(SLUG).secretKey).toBe('sk_prog')
  })

  it('throws a clear error when nothing is configured', () => {
    expect(() => resolveCredentials('no-such-company-xyz')).toThrow(/credentials not found/)
  })
})
