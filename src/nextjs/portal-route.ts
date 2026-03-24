import { NextRequest, NextResponse } from 'next/server'
import { createPortalSession } from '../server/billing-portal'

export interface PortalRouteOptions {
  /**
   * Resolve the Stripe customer ID from the request.
   * Return null to reject.
   */
  resolveCustomerId: (request: NextRequest) => Promise<string | null>
  /**
   * Return URL after the customer leaves the portal.
   */
  returnUrl: string | ((request: NextRequest) => Promise<string>)
}

/**
 * Create a Next.js POST route for Stripe Billing Portal.
 *
 * Usage:
 * ```ts
 * export const POST = portalRoute({
 *   resolveCustomerId: async (req) => {
 *     const session = await getServerSession(authOptions)
 *     const user = await db.user.findUnique({ where: { id: session.user.id } })
 *     return user?.stripeCustomerId || null
 *   },
 *   returnUrl: `${process.env.NEXT_PUBLIC_URL}/dashboard`,
 * })
 * ```
 */
export function portalRoute(options: PortalRouteOptions) {
  return async function POST(request: NextRequest) {
    try {
      const customerId = await options.resolveCustomerId(request)

      if (!customerId) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }

      const returnUrl = typeof options.returnUrl === 'function'
        ? await options.returnUrl(request)
        : options.returnUrl

      const result = await createPortalSession({ customerId, returnUrl })

      return NextResponse.json(result)
    } catch (error: any) {
      console.error('Portal session error:', error)
      return NextResponse.json(
        { error: error.message || 'Portal creation failed' },
        { status: 500 }
      )
    }
  }
}
