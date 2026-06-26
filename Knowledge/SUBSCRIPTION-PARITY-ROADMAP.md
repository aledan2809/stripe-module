# Stripe Checkout Broker — Subscription Parity Roadmap (migrarea app-urilor mature)

> Scop: lista exactă a ce mai trebuie construit în broker ca să putem muta pe el
> aplicațiile de abonament EXISTENTE (Tutor, 4pro-eat, PRO, eCabinet, website-guru),
> nu doar checkout-uri simple noi. **Trial + cupoane = primul increment al sesiunii următoare.**
>
> Status la **2026-06-25**. Autor: sesiune Stripe-broker (vezi DEVELOPMENT_STATUS / ledger).

---

## Ce FACE broker-ul acum (gata + live pe stripe.knowbest.ro)
- **Plată unică** — `mode:"payment"` (default). Consumator dovedit: **AVE** (unlock $29, live).
- **Abonament de bază** — `mode:"subscription"` + `interval` (day/week/month/year) inline `price_data` (amount+interval). Callback-uri: `subscription.activated` / `renewed` / `payment_failed` / `canceled` (+ `stripeSubscriptionId`, `subscriptionStatus`). Cod: `admin/src/app/api/checkout/route.ts`, `admin/src/app/api/stripe/webhook/[companySlug]/route.ts`, `admin/src/lib/broker.ts`. Contract: `Knowledge/CHECKOUT-BROKER.md`.
- **Tooling**: `admin/scripts/sync-broker-keys.mjs` (trage cheile unui proiect din broker → scrie `STRIPE_BROKER_URL/PROJECT_KEY/CALLBACK_SECRET` în `.env`-ul app-ului; chei env-independent, o-singură-dată-per-app).

## Ce NU face încă (blochează migrarea app-urilor mature)
1. ~~**Trial** (perioadă de probă)~~ ✅ DONE 2026-06-26
2. ~~**Cupoane / discount-uri** (vouchere)~~ ✅ DONE 2026-06-26
3. ~~**Customer management + Billing Portal** (cancel/upgrade abonament de către user)~~ ✅ DONE 2026-06-26
4. **(opțional) Price-ID passthrough** (preț pre-creat pe contul firmei, în loc de inline) — încă low priority

> **STATUS 2026-06-26**: paritatea necesară migrării (1-3) e COMPLETĂ pe broker (LIVE).
> - Trial: checkout `trialDays` → `subscription_data.trial_period_days`.
> - Cupoane: checkout `coupon:{percentOff|amountOff,duration,durationInMonths,metadata}` → `coupons.create` pe contul firmei + `discounts`; idempotent pe consumer key.
> - Portal: `customerId` stocat la activare + `POST /api/portal {sessionId|subscriptionId,returnUrl}` → `billingPortal.sessions.create`.
> Contract: `Knowledge/CHECKOUT-BROKER.md`. Următor = migrarea app-urilor (Tutor șablon → knowbest → NO-TOUCH). Acțiune user per firmă: activează Customer Portal în Stripe Dashboard.

---

## De ce app-urile mature NU pot migra încă (constatat în sesiune)

### Tutor — `etutor.ro`, ACTIVE, LIVE · `src/app/api/admin/stripe/checkout/route.ts`
- **Price IDs pre-create**: `line_items: [{ price: plan.stripeId }]` (din tabela `subscriptionPlan.stripeId`, pe contul Stripe AL Tutor) — broker-ul folosește `price_data` inline. *(Tutor are amount+interval în plan → poate trimite inline; OK.)*
- **Customer per-user**: `user.stripeCustomerId` salvat în DB (pt portal/management) — broker-ul ține customer-ul pe contul firmei.
- **Vouchere → cupoane Stripe**: `getStripe().coupons.create({percent_off})` + `discounts:[{coupon}]` — **broker fără cupoane**.
- **Trial**: `subscription_data.trial_period_days` — **broker fără trial**.
- → Migrat ca-atare ar **pierde voucherele + trial-urile** și ar rupe managementul abonamentului.

### 4pro-eat — `eat.4pro.io`, **NO-TOUCH CRITIC**, LIVE
- Stripe propriu (`stripe@18`): `api/v1/checkout-session`, `api/v1/subscription`, `api/v1/webhooks/stripe`, `lib/billing/{coupons,loyalty}.ts`, `stripe.subscriptions.update`. Abonamente + cupoane + loyalty pricing.
- → Aceleași lipsuri de paritate + NO-TOUCH (propose-confirm-apply, ultimul).

### PRO, eCabinet — **NO-TOUCH CRITIC**, LIVE
- Stripe direct: PRO `api/billing/checkout` + `lib/stripe.ts`; eCabinet `server/src/services/stripe.service.ts` + migrații `platform_subscriptions`. Abonamente.

### website-guru — "Varianta 1 completă" (extinde broker cu subscriptions, apoi migrează subs + one-time WG). Aceleași dependențe de paritate.

---

## Roadmap de paritate (de construit în broker, ADITIV, în ordine)

### 1. Trial (mic) — **primul, sesiunea următoare**
- Checkout: accept `trialDays?: number` pe body (sau per-plan) → `subscription_data.trial_period_days = trialDays` (doar `mode:subscription`).
- Fără event nou necesar; `subscription.activated` acoperă (status poate fi `trialing`). Eventual mapează `customer.subscription.trial_will_end` → un callback `subscription.trial_ending` (opțional).
- Test: checkout cu trialDays → sesiune cu trial; verifică callback activated.

### 2. Cupoane / discount-uri (mediu) — **al doilea**
- Checkout: accept `coupon?: { percentOff?: number; amountOff?: number; currency?: string; duration?: 'once'|'forever'|'repeating'; durationInMonths?: number }`.
- Broker creează cuponul pe contul firmei (`stripe.coupons.create(...)`) + `discounts: [{ coupon }]` pe sesiune. Validează percentOff∈[0,100], amountOff>0, exact unul prezent.
- Echo metadata voucher în `stripeMetadata` (ca să mapezi înapoi `voucherId`). Idempotență cupon: opțional reuse pe `coupon.id` deterministic.
- Test: checkout cu coupon → sesiune cu discount aplicat.

### 3. Customer management + Billing Portal (mediu-mare) — **al treilea**
- Problema: customer-ul abonamentului trăiește pe contul FIRMEI (broker), nu pe app. App-ul nu poate oferi „Gestionează abonamentul" fără cheia firmei.
- Soluție: endpoint broker `POST /api/portal` (X-Project-Key) `{ sessionId | subscriptionId | customerRef, returnUrl }` → broker rezolvă customer-ul (din record-ul checkout / subscription) → `stripe.billingPortal.sessions.create({ customer, return_url })` → întoarce `{ url }`. App-ul redirecționează userul.
- Necesită: să stocăm `customerId` pe `CheckoutSessionRecord` la activare (din `session.customer`), + lookup customer per (proiect, user) — fie prin metadata (`metadata.userId`) fie un nou index.
- Test: după activare, `/api/portal` → URL de portal funcțional (cancel/upgrade).

### 4. (opțional) Price-ID passthrough
- Accept `priceId?: string` pe lineItem → broker folosește `line_items:[{ price: priceId }]` pe contul firmei. Doar dacă un consumator pre-creează prețuri pe contul firmei (rar; majoritatea vor inline). Low priority.

---

## Rețetă de migrare per app (DUPĂ ce există paritatea necesară)
1. **Biller**: decide firma (routing Legal / geo). Creează maparea în broker `/projects` → firmă → generează `project-key` + `callback-secret`.
2. **Env**: `node admin/scripts/sync-broker-keys.mjs --project <slug> --out <app>/.env` → cele 3 variabile (env-independent).
3. **Checkout**: înlocuiește `stripe.checkout.sessions.create(...)` din app cu `POST {STRIPE_BROKER_URL}/api/checkout` (header `X-Project-Key`), `mode:"subscription"`, `lineItems` inline (amount+interval), + `trialDays`/`coupon` (după ce există în broker).
4. **Callback handler**: adaugă în app `POST /api/stripe/callback` — verifică `X-Broker-Signature` = HMAC-SHA256(rawBody, callbackSecret) timing-safe, dedupe pe `sessionId`, reacționează la `subscription.activated/renewed/payment_failed/canceled` (actualizează starea abonamentului local).
5. **Webhook Stripe (în stripe.com, pe contul firmei)**: endpoint `/api/stripe/webhook/<companySlug>` cu evenimentele: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
6. **Test**: TEST mode (card 4242) → flip mapping `brokerEnv→live` → test din nou. **NO-TOUCH** (4pro-eat/PRO/eCabinet/BlocHub) = propose-confirm-apply, sesiune dedicată.

## Ordinea recomandată de migrare (după paritate)
1. **Tutor** sau **knowbest** (RO, ACTIVE, non-NO-TOUCH) — primul șablon real de abonament.
2. NO-TOUCH (propose-confirm): **4pro-eat → PRO → eCabinet → BlocHub**.
3. **website-guru** (Varianta 1 completă).

## Referințe cod
- Contract: `Knowledge/CHECKOUT-BROKER.md` (secțiune subscription).
- Checkout: `admin/src/app/api/checkout/route.ts` · Webhook: `admin/src/app/api/stripe/webhook/[companySlug]/route.ts` · Tipuri/store: `admin/src/lib/broker.ts`.
- Tool sync env: `admin/scripts/sync-broker-keys.mjs`.
- Bug-fix de referință (NU regresa): `deleteCompany` păstrează mapările broker-only (commit `9745aa8`) — filtrul vechi `m.subscriptionCompany || m.serviceCompany` ștergea toate mapările pe grup (care au doar `brokerCompany`).
