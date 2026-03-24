import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function POST(request: NextRequest) {
  const { secretKey } = await request.json()

  if (!secretKey) {
    return NextResponse.json({ error: 'secretKey required' }, { status: 400 })
  }

  try {
    const stripe = new Stripe(secretKey, {
      apiVersion: '2025-12-15.clover' as any,
      typescript: true,
    })

    // Try to fetch account info — validates the key
    const account = await stripe.accounts.retrieve()

    const isTest = secretKey.startsWith('sk_test_')
    const isLive = secretKey.startsWith('sk_live_')

    return NextResponse.json({
      ok: true,
      mode: isTest ? 'test' : isLive ? 'live' : 'unknown',
      account: {
        id: account.id,
        businessName: account.business_profile?.name || account.settings?.dashboard?.display_name || 'N/A',
        country: account.country,
        currency: account.default_currency,
        email: account.email,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      },
    })
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error.message || 'Connection failed',
      code: error.code,
    })
  }
}
