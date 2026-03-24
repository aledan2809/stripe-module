import { NextRequest, NextResponse } from 'next/server'
import {
  createConnectedAccount,
  createAccountLink,
  createLoginLink,
  getConnectedAccount,
  createMarketplacePayment,
  createMarketplaceCheckout,
} from '../server/connect'
import type {
  CreateConnectedAccountInput,
  CreateMarketplacePaymentInput,
  CreateMarketplaceCheckoutInput,
} from '../server/connect'

export interface ConnectRouteOptions {
  authorize?: (request: NextRequest) => Promise<boolean>
}

/**
 * Next.js route handlers for Stripe Connect (marketplace).
 *
 * Usage in app/api/stripe/connect/route.ts:
 * ```ts
 * import { connectRoute } from '@projects/stripe-module'
 * const handlers = connectRoute({ authorize: ... })
 * export const POST = handlers.POST
 * export const GET = handlers.GET
 * ```
 */
export function connectRoute(options: ConnectRouteOptions = {}) {
  return {
    /**
     * POST actions:
     * - { action: 'create-account', ... } → create connected account
     * - { action: 'onboarding-link', accountId, returnUrl, refreshUrl } → get onboarding URL
     * - { action: 'login-link', accountId } → get Express Dashboard URL
     * - { action: 'create-payment', ... } → marketplace payment with fee split
     * - { action: 'create-checkout', ... } → marketplace checkout with fee split
     */
    async POST(request: NextRequest) {
      try {
        if (options.authorize) {
          const authorized = await options.authorize(request)
          if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
        }

        const body = await request.json()
        const { action } = body

        switch (action) {
          case 'create-account': {
            const account = await createConnectedAccount(body as CreateConnectedAccountInput)
            return NextResponse.json({
              accountId: account.id,
              email: account.email,
            })
          }

          case 'onboarding-link': {
            const { accountId, returnUrl, refreshUrl } = body
            if (!accountId || !returnUrl || !refreshUrl) {
              return NextResponse.json({ error: 'accountId, returnUrl, refreshUrl required' }, { status: 400 })
            }
            const link = await createAccountLink({ accountId, returnUrl, refreshUrl })
            return NextResponse.json(link)
          }

          case 'login-link': {
            const { accountId } = body
            if (!accountId) {
              return NextResponse.json({ error: 'accountId required' }, { status: 400 })
            }
            const link = await createLoginLink(accountId)
            return NextResponse.json(link)
          }

          case 'create-payment': {
            const result = await createMarketplacePayment(body as CreateMarketplacePaymentInput)
            return NextResponse.json(result)
          }

          case 'create-checkout': {
            const result = await createMarketplaceCheckout(body as CreateMarketplaceCheckoutInput)
            return NextResponse.json(result)
          }

          default:
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
        }
      } catch (error: any) {
        console.error('Connect error:', error)
        return NextResponse.json(
          { error: error.message || 'Connect operation failed' },
          { status: 500 }
        )
      }
    },

    /**
     * GET: retrieve connected account info
     * ?accountId=acct_xxx
     */
    async GET(request: NextRequest) {
      try {
        if (options.authorize) {
          const authorized = await options.authorize(request)
          if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
        }

        const { searchParams } = new URL(request.url)
        const accountId = searchParams.get('accountId')

        if (!accountId) {
          return NextResponse.json({ error: 'accountId required' }, { status: 400 })
        }

        const info = await getConnectedAccount(accountId)
        return NextResponse.json(info)
      } catch (error: any) {
        console.error('Connect GET error:', error)
        return NextResponse.json(
          { error: error.message || 'Failed to get account' },
          { status: 500 }
        )
      }
    },
  }
}
