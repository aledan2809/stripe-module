import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

/**
 * Given a Stripe Secret Key, fetches all account info automatically.
 * Returns company profile data + detected environment.
 */
export async function POST(request: NextRequest) {
  const { secretKey } = await request.json()

  if (!secretKey) {
    return NextResponse.json({ error: 'secretKey required' }, { status: 400 })
  }

  const isTest = secretKey.startsWith('sk_test_')
  const isLive = secretKey.startsWith('sk_live_')

  if (!isTest && !isLive) {
    return NextResponse.json({
      ok: false,
      error: 'Cheia trebuie să înceapă cu sk_test_ sau sk_live_',
    })
  }

  try {
    const stripe = new Stripe(secretKey, {
      apiVersion: '2025-12-15.clover' as any,
      typescript: true,
    })

    const account = await stripe.accounts.retrieve()

    // Try to get balance to confirm charges work
    let balanceInfo = null
    try {
      const balance = await stripe.balance.retrieve()
      balanceInfo = {
        available: balance.available.map(b => ({
          amount: b.amount / 100,
          currency: b.currency,
        })),
      }
    } catch { /* balance not accessible for all account types */ }

    return NextResponse.json({
      ok: true,
      environment: isTest ? 'test' : 'live',
      account: {
        id: account.id,
        businessName: account.business_profile?.name || account.settings?.dashboard?.display_name || '',
        country: account.country || 'RO',
        currency: account.default_currency || 'ron',
        email: account.email || '',
        phone: account.business_profile?.support_phone || '',
        website: account.business_profile?.url || '',
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        businessType: account.business_type,
      },
      balance: balanceInfo,
    })
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error.message || 'Cheie invalidă sau conexiune eșuată',
      code: error.code,
    })
  }
}
