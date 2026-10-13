import { NextRequest, NextResponse } from 'next/server'
import { findMappingByApiKey, getCredentials } from '@/lib/data'
import { getCheckoutSession, findSessionBySubscriptionId } from '@/lib/broker'
import { rateLimit } from '@/lib/guard'
import { fetchSubscriptionSummary } from '@/lib/subscription-summary'

/**
 * POST /api/subscription — where a subscription stands, for consumer apps (contract v3).
 *
 * The callbacks carry the same summary on every subscription.* event; this lets a consumer read it on
 * demand — for subscriptions that started before v3 (no period stored yet) or to refresh a stale copy
 * (a cancellation scheduled in the Billing Portal, when the company's Stripe webhook doesn't send
 * customer.subscription.updated).
 *
 * Auth: X-Project-Key. Body: { sessionId | subscriptionId }
 * → 200 { subscription } | 401 bad key / not your subscription | 404 unknown / no creds / not created yet
 *   | 400 bad body | 429 rate limited | 502 Stripe unreadable
 */
export async function POST(request: NextRequest) {
  const projectKey = request.headers.get('x-project-key') || ''
  const mapping = findMappingByApiKey(projectKey)
  if (!mapping) {
    return NextResponse.json({ error: 'Invalid project key' }, { status: 401 })
  }
  if (!rateLimit('subscription', projectKey)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { sessionId, subscriptionId } = body || {}
  if (!sessionId && !subscriptionId) {
    return NextResponse.json({ error: 'sessionId or subscriptionId required' }, { status: 400 })
  }

  const record = subscriptionId
    ? findSessionBySubscriptionId(String(subscriptionId))
    : getCheckoutSession(String(sessionId))
  if (!record) {
    return NextResponse.json({ error: 'Unknown session/subscription' }, { status: 404 })
  }
  // A project key reads only its own subscriptions.
  if (record.projectSlug !== mapping.projectSlug) {
    return NextResponse.json({ error: 'subscription does not belong to this project' }, { status: 401 })
  }
  if (!record.subscriptionId) {
    return NextResponse.json({ error: 'No subscription on this session yet (not activated)' }, { status: 404 })
  }

  const secretKey = getCredentials(record.companySlug)?.[record.env]?.secretKey
  if (!secretKey) {
    return NextResponse.json({ error: `No ${record.env} credentials for "${record.companySlug}"` }, { status: 404 })
  }

  const subscription = await fetchSubscriptionSummary(secretKey, record.subscriptionId)
  if (!subscription) {
    return NextResponse.json({ error: 'Subscription could not be read from Stripe' }, { status: 502 })
  }
  return NextResponse.json({ subscriptionId: record.subscriptionId, subscription })
}
