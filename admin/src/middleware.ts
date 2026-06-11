import { NextRequest, NextResponse } from 'next/server'

/**
 * Public Checkout Broker endpoints — reachable from anywhere, they carry their own auth:
 *   /api/checkout              → authenticated by X-Project-Key
 *   /api/stripe/webhook/<slug> → authenticated by the per-company Stripe webhook signature
 * Everything else is the admin surface (handles Stripe secret keys) and stays gated.
 */
function isPublicBrokerPath(pathname: string): boolean {
  return pathname === '/api/checkout' || pathname.startsWith('/api/stripe/webhook/')
}

/**
 * G-STRIPE-001 guard: admin panel handles Stripe secret keys and has no user system.
 * Policy: requests must come from localhost. For remote/tunneled access, set
 * STRIPE_ADMIN_TOKEN in the environment and send it as the `x-admin-token` header.
 */
export function middleware(request: NextRequest) {
  if (isPublicBrokerPath(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  // Deployed behind a trusted reverse proxy that authenticates the admin surface
  // (e.g. nginx basic-auth on stripe.knowbest.ro). The broker endpoints above stay public.
  if (process.env.STRIPE_ADMIN_PROXY_AUTH === '1') {
    return NextResponse.next()
  }

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
