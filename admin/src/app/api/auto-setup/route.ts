import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

/**
 * Given a Stripe Secret Key, fetches ALL account info automatically:
 * - Business name, email, phone, website
 * - Country, currency
 * - Tax ID (CUI), registration number
 * - Bank account / IBAN
 * - Address
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

    // Fetch account with full details
    const account = await stripe.accounts.retrieve()

    // Extract company/individual details
    const company = (account as any).company
    const individual = (account as any).individual

    // Extract address
    const address = company?.address || individual?.address
    const addressStr = address
      ? [address.line1, address.line2, address.city, address.state, address.postal_code].filter(Boolean).join(', ')
      : ''

    // Extract Tax ID (CUI) — stored in company.tax_id or company.tax_id_registrar
    const taxId = company?.tax_id || ''
    const vatId = company?.vat_id || ''
    const cui = taxId || vatId

    // Extract registration number
    const registrationNumber = company?.registration_number || ''

    // Try to get external accounts (bank accounts / IBAN)
    let bankInfo = { iban: '', bank: '', bankLast4: '' }
    try {
      const externalAccounts = await stripe.accounts.listExternalAccounts(account.id, {
        object: 'bank_account',
        limit: 1,
      })
      if (externalAccounts.data.length > 0) {
        const bankAccount = externalAccounts.data[0] as Stripe.BankAccount
        bankInfo = {
          iban: bankAccount.last4 ? `••••${bankAccount.last4}` : '',
          bank: bankAccount.bank_name || '',
          bankLast4: bankAccount.last4 || '',
        }
      }
    } catch {
      // External accounts not accessible for this account type — that's fine
    }

    // Try to get balance
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
        businessName: company?.name || account.business_profile?.name || account.settings?.dashboard?.display_name || '',
        country: account.country || 'RO',
        currency: account.default_currency || 'ron',
        email: account.email || '',
        phone: account.business_profile?.support_phone || company?.phone || '',
        website: account.business_profile?.url || '',
        address: addressStr,
        cui: cui,
        registrationNumber: registrationNumber,
        vatId: vatId,
        bank: bankInfo.bank,
        iban: bankInfo.iban,
        bankLast4: bankInfo.bankLast4,
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
