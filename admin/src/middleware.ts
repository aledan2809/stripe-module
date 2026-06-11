import { NextRequest, NextResponse } from 'next/server'

/**
 * G-STRIPE-001 guard: admin panel handles Stripe secret keys and has no user system.
 * Policy: requests must come from localhost. For remote/tunneled access, set
 * STRIPE_ADMIN_TOKEN in the environment and send it as the `x-admin-token` header.
 */
export function middleware(request: NextRequest) {
  const adminToken = process.env.STRIPE_ADMIN_TOKEN

  if (adminToken && request.headers.get('x-admin-token') === adminToken) {
    return NextResponse.next()
  }

  const host = (request.headers.get('host') || '').split(':')[0]
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1'

  if (isLocalhost) {
    return NextResponse.next()
  }

  return NextResponse.json(
    { error: 'Forbidden: stripe-module admin is localhost-only (set STRIPE_ADMIN_TOKEN + x-admin-token header for remote access)' },
    { status: 403 }
  )
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
