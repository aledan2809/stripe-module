# Stripe — Reusable Payment Integration Module

## Overview
Modular Stripe integration: payment intents, checkout, subscriptions, billing portal, refunds, Stripe Connect, webhooks.

## Stack
- TypeScript 5.7, React 19, Next.js 15, Stripe SDK 17.7
- Build: tsc → dist/
- ai-router dependency (configured, exports routeAI)

## Build
```bash
npm run build    # TypeScript compilation
```

## Features
- Payment intents + checkout sessions
- Customer + subscription management
- Billing portal + refunds
- Stripe Connect (marketplace payouts)
- Webhook handling with event routing
- PaymentForm React component
- Multi-company/multi-tenant support

## Consumers
- BlocHub, utilajhub-next, AIWebAuditor, knowbest, and any project needing Stripe

## DO NOT MODIFY
- Webhook signature validation
- Stripe API version configuration
- PaymentForm component public API


## Governance Reference
See: `Master/knowledge/MASTER_SYSTEM.md` §1-§5. This project follows Master governance; do not duplicate rules.
