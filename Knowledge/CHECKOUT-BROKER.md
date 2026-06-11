# Stripe Checkout Broker — Contract (pentru app-uri consumatoare)

> Brokerul e **UNIVERSAL / multi-tenant** — funcționează pentru ORICE `projectSlug`, fiecare cu
> maparea lui proiect→firmă. Nu e nimic AVE-specific în cod (cheia e pe `projectSlug` + `apiKey`).
> Rulează în `admin/` (deploy planificat: **stripe.knowbest.ro**). Cheile Stripe stau DOAR aici;
> app-urile consumatoare dețin doar un **project-key** + un **callback-secret**, generate din panoul
> admin la maparea proiectului.
>
> **AVE (app.techbiz.ae) = primul pilot** care testează contractul. Restul (Tutor, knowbest, BlocHub,
> utilajhub, PRO, eCabinet, Offer...) se vor putea conecta la fel — dar **migrarea lor e fazată,
> sesiune dedicată per proiect**; NO-TOUCH CRITIC (BlocHub plăți, PRO, eCabinet) doar cu
> propose-confirm-apply. Brokerul în sine nu presupune niciun consumator anume.
>
> Construit 2026-06-11. E2E verificat: 11/11 (succeeded/failed/expired + idempotency + 401/400/503).

## Arhitectură
```
consumer app ──POST /api/checkout (X-Project-Key)──▶ broker ──▶ Stripe (cheia firmei)
Stripe ──POST /api/stripe/webhook/<companySlug> (signature)──▶ broker
broker ──POST <callbackUrl> (X-Broker-Signature = HMAC)──▶ consumer app
```

## 1) POST /api/checkout  (consumer → broker)
**Headers:** `X-Project-Key: <apiKey per-proiect>`
**Body:**
```jsonc
{
  "projectSlug": "ave",
  "lineItems": [{ "name": "...", "description": "...", "amount": 29, "quantity": 1 }], // amount = UNITĂȚI MAJORE (29 = $29; brokerul face ×100)
  "currency": "usd",
  "successUrl": "https://app.techbiz.ae/success?session_id={CHECKOUT_SESSION_ID}",
  "cancelUrl": "https://app.techbiz.ae/cancel",
  "callbackUrl": "https://app.techbiz.ae/api/stripe/callback",  // http(s) obligatoriu
  "metadata": { "auditId": "...", "orderId": "...", "productType": "..." }  // opac, întors neschimbat
}
```
**Răspuns:** `200 { url, sessionId }` — redirecționezi userul la `url`.
**Erori:** `401` project-key invalid / projectSlug nepotrivit · `404` proiect fără firmă broker sau fără credențiale · `503` broker dezactivat · `400` body invalid · `502` eroare Stripe.

## 2) POST /api/stripe/webhook/[companySlug]  (Stripe → broker)
Webhook-ul FIECĂREI firme din Stripe pointează aici cu **companySlug**-ul ei (ex. `/api/stripe/webhook/techbiz`).
Brokerul verifică semnătura pe **raw body** cu webhook-secret-ul firmei (încearcă test apoi live).
Evenimente: `checkout.session.completed` (doar `payment_status='paid'`), `checkout.session.expired`, `payment_intent.payment_failed`.
Idempotent (Stripe livrează de 2×). Pe eșec de callback → **500** ca Stripe să reîncerce (durable retry).

## 3) POST <callbackUrl>  (broker → consumer)  ⚠️ orice app consumator implementează ASTA (AVE prima)
**Headers:** `X-Broker-Signature: hex(hmacSHA256(rawBody, callbackSecret))`
**Body:**
```jsonc
{
  "event": "payment.succeeded" | "payment.expired" | "payment.failed",
  "sessionId": "cs_test_...",
  "projectSlug": "ave",
  "metadata": { ...echoed... },
  "paymentStatus": "paid",
  "amountTotal": 2900,            // ⚠️ UNITĂȚI MINORE (cents) — Stripe raw; NU major units
  "currency": "usd",
  "stripePaymentIntentId": "pi_..." | null
}
```
**Consumatorul TREBUIE (la fel pentru oricine, AVE inclus):**
1. Recalculează `hex(hmacSHA256(rawBody, STRIPE_BROKER_CALLBACK_SECRET))` și compară cu `X-Broker-Signature` (timing-safe). Respinge dacă nu se potrivește.
2. **Dedupe pe `sessionId`** — la duplicate strict-concurente brokerul poate trimite callback-ul de 2× (lost-update pe file-store). Procesează o singură dată per sessionId.
3. Răspunde **2xx** rapid; orice non-2xx declanșează retry (broker + Stripe).

## Env pe app-ul consumator (orice proiect)
```
STRIPE_BROKER_URL=https://stripe.knowbest.ro
STRIPE_BROKER_PROJECT_KEY=pk_proj_...      # X-Project-Key
STRIPE_BROKER_CALLBACK_SECRET=cbs_...      # verifică X-Broker-Signature
```

## Note de contract (schimbări vs prompt-ul inițial — confirmate)
- **amountTotal = unități MINORE** (cents) pe callback (input e major units). Asimetria e intenționată: e valoarea raw de la Stripe.
- Brokerul folosește **stripe SDK direct** (nu lib-ul `@projects/stripe-module`) — aceleași apeluri Stripe, același ×100; contractul extern e identic.
- `callbackUrl` trebuie http(s) (guard anti file:///data:).
- Restul contractului (cele 3 părți, headers, status-uri) = EXACT ca în spec.
