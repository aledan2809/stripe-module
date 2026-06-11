# Recipe: integrarea unui proiect NOU prin Checkout Broker

> Pas-cu-pas operațional pentru a conecta orice app din ecosistem la brokerul central
> (`stripe.knowbest.ro`). Contractul API complet e în [CHECKOUT-BROKER.md](CHECKOUT-BROKER.md) —
> citește-l întâi. **Implementarea de referință = AVE** (`ave/ave-platform`), primul consumator
> live (plată reală test-mode dovedită 2026-06-12).
>
> Reguli: consumatorii NO-TOUCH CRITIC (BlocHub plăți, PRO, eCabinet) se migrează DOAR în sesiune
> dedicată cu propose-confirm-apply. Verificat A1.8 (ave-platform TODO) 2026-06-12.

## Pasul 0 — Precondiții
- Brokerul rulează la `https://stripe.knowbest.ro` (VPS2 :3025, PM2 `stripe-broker`).
- Admin UI e în spatele nginx basic-auth — creds în `Master/credentials/stripe-broker.env`.
- Firma (compania Stripe) care va încasa există deja în broker cu credențiale `sk_` + `whsec_`
  (Credentials UI). Dacă nu: adaugi firma + cheile întâi (vezi CHECKOUT-BROKER.md §admin).

## Pasul 1 — Maparea proiect → firmă (în broker)
1. Admin UI → Project Mappings → adaugă `projectSlug` nou (ex: `tutor`) → alege firma.
2. UI generează **`pk_proj_…` (project-key)** + **`cbs_…` (callback-secret)** — copiază-le o singură dată.
3. Creează în Stripe (contul firmei) un webhook endpoint către
   `https://stripe.knowbest.ro/api/stripe/webhook/<companySlug>` cu events
   `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`,
   și pune `whsec_`-ul lui în Credentials UI (dacă firma nu-l are deja pentru endpointul ăsta).

## Pasul 2 — Env în app-ul consumator (3 variabile, ZERO chei Stripe)
```env
STRIPE_BROKER_URL=https://stripe.knowbest.ro
STRIPE_BROKER_PROJECT_KEY=pk_proj_...
STRIPE_BROKER_CALLBACK_SECRET=cbs_...
```
- Sync și în `Master/credentials/<project>.env`.
- ⚠️ **Next.js standalone NU citește root `.env`** — pe VPS pune-le în `.next/standalone/.env`
  (lecție AVE 2026-06-12).

## Pasul 3 — Cod consumator (oglindește AVE)
Două fișiere, copiate + adaptate din referință:

1. **Ruta de checkout** — `ave/ave-platform/app/api/audit/[auditId]/checkout/route.ts`:
   - server-priced (NICIODATĂ prețul din client), rate-limit per IP, validare email;
   - `POST {STRIPE_BROKER_URL}/api/checkout` cu header `X-Project-Key` și body per contract;
   - ⚠️ `lineItems[].amount` e în **UNITĂȚI MAJORE** (29 = $29) — brokerul face ×100;
   - `metadata` = id-urile tale interne (orderId etc.) — se întorc neschimbate în callback;
   - creezi rândul de order PENDING în DB-ul tău ÎNAINTE de apelul broker.

2. **Ruta de callback** — `ave/ave-platform/app/api/stripe/callback/route.ts`:
   - verifică `X-Broker-Signature` = HMAC-SHA256(rawBody, callback-secret) cu `timingSafeEqual`;
   - fulfillment idempotent: claim `PENDING→PAID` cu `updateMany` (brokerul poate livra dublu);
   - email de confirmare plată per order (vezi `sendPaymentConfirmationEmail` în AVE) — DUPĂ
     acțiunea user-facing (unlock/activare), ca SMTP-ul lent să nu întârzie userul;
   - `payment.expired` / `payment.failed` → reconciliază orderul;
   - răspunde mereu 2xx pe events necunoscute (brokerul face retry pe non-2xx);
   - ⚠️ ruta NU trebuie prinsă de middleware-ul de auth (e server-to-server; securitatea = HMAC).

## Pasul 4 — Gotchas de UI/infra (toate lovite de AVE)
- **CSP `form-action`**: dacă un form HTML face handoff cross-origin, adaugă originul în
  `form-action` (CSP-ul îl blochează SILENȚIOS — fără eroare vizibilă).
- **Success URL ≠ fulfillment**: deblocarea se face DOAR din callback, niciodată din `successUrl`
  (userul poate deschide success fără să fi plătit). Pe pagina de success fă poll pe starea
  resursei (pattern AVE `?paid=1`).
- **Feature-flag**: gate-uiește checkout-ul pe prezența env-urilor broker (`isStripeEnabled()`),
  cu fallback la fluxul gratuit — deploy inert până la go-live.

## Pasul 5 — Test (fără să aștepți o plată reală)
1. **Plată reală test-mode**: firma pe chei `sk_test_` → checkout → card `4242 4242 4242 4242`
   → verifică lanțul: webhook broker → callback HMAC → order PAID → fulfillment + emailuri.
2. **Negative**: callback cu semnătură greșită → 401; replay același callback → no-op (idempotent).
3. **Go-LIVE**: comuți firma pe `sk_live_` + webhook live în broker, remapezi → chei `pk_proj_`/`cbs_`
   noi → actualizezi cele 3 env-uri → smoke cu produs ieftin real.

## Changelog
- [2026-06-12] v1.0: recipe extras din integrarea AVE (A1.8) — pași broker + env + cod + gotchas + test.
