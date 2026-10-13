# Stripe Checkout Broker — modificări directe, octombrie 2026

> NO-TOUCH CRITIC (deține chei `sk_live`). Orice modificare = propose-confirm-apply + backup + verificare consumatori.

---

## 2026-10-13 — contract callback v3: perioada abonamentului (cod, NELIVRAT)

**Cerere**: Alex, pentru Tutor — „fă și evidența lunii după plată, cu brokerul": după plată, părintele să vadă până când e
plătit, câte zile mai are, când și cât e următoarea plată, iar dacă a oprit abonamentul din portal, până când mai are acces.

**Cauza**: callback-urile nu cărau nicio dată de perioadă; `customer.subscription.updated` nu era tratat (o oprire din
portal nu ajungea la consumator decât la sfârșitul perioadei, ca `subscription.canceled`); `subscription.activated`
raporta mereu `active`, și pentru o probă cu card.

**Ce s-a schimbat** (aditiv — consumatorii vechi ignoră câmpurile și evenimentul nou; consumatori cu callback: Tutor; AVE n-are receptor):
- `admin/src/lib/subscription-summary.ts` (nou): rezumatul unui abonament — perioada (din abonament sau din linii, ambele versiuni de API), oprirea programată, proba, prețul pe perioadă. Fail-soft.
- Webhook: `subscription` pe orice callback `subscription.*`, `nextPaymentAttempt` pe `subscription.payment_failed`, evenimentul nou `customer.subscription.updated` → `subscription.updated` (nu schimbă starea record-ului); `subscription.activated` → `trialing` când e cazul. `CALLBACK_VERSION` 2 → 3. Semnătura webhook-ului, idempotența și versiunea API Stripe: neatinse.
- `POST /api/subscription` (nou, X-Project-Key, doar abonamentele proiectului propriu) + public în `middleware.ts`.

**Verificat (local, build de producție, date de test în afara repo-ului)**:
- `npx tsx admin/scripts/subscription-summary.check.ts` — 4/4 (forma veche + forma nouă a API-ului, oprire cu dată și fără, abonament anulat).
- Broker + Tutor QA: evenimente Stripe semnate cu secretul webhook-ului (`stripe.webhooks.generateTestHeaderString`) →
  `subscription.updated` ×3 (perioadă; oprit; repornit), `subscription.payment_failed` (cu `nextPaymentAttempt`; citirea
  Stripe eșuează în mediul de test → callback trimis fără rezumat = fail-soft), `subscription.renewed`, `subscription.canceled`
  — toate 200 la Tutor, care a ținut și afișat perioada corect; semnătură greșită 400; eveniment dublu `idempotent: true`;
  `/api/subscription` cheie greșită 401, abonament necunoscut 404. 12/12.

**Rămas**: livrarea pe VPS2 (backup `data/` înainte), excepția nginx pentru `/api/subscription`, evenimentul
`customer.subscription.updated` bifat pe webhook-ul firmei în Stripe Dashboard (vezi TODO).

**Pregătit pentru livrare (13.10, sesiunea Tutor)**: `scripts/ops/livreaza-broker.sh` — rulat de Alex de pe Mac după livrarea
Tutor. Se oprește la prima problemă; build-ul vechi rămâne pus deoparte până la verificarea celui nou; copia `data/` merge în
`/root/backups/stripe-broker-data-<data>.tgz`; excepția nginx se adaugă doar pentru forma simplă a blocului `/api/checkout`, cu
`nginx -t` și revenire. Probat local: probele (401/401/400) pe build-ul de producție, extragerea blocului nginx pe un config-model.

**LIVRAT 13.10 (~15:18)** de Alex, cu `scripts/ops/livreaza-broker.sh`: `696d7a2` → `b6e9c1c`; copie `data/`
`/root/backups/stripe-broker-data-2026-10-13-1218.tgz` (28K); build verificat; `data/` neatins; probe 401/401/400. nginx:
blocul `location /api/subscription` adăugat în `/etc/nginx/sites-available/stripe-knowbest` (copia blocului `/api/checkout`),
`nginx -t` OK, reload, verificat public (răspunde aplicația, nu parola); config-ul vechi în
`/root/backups/nginx-stripe-knowbest-2026-10-13-1218`. Rămas: `customer.subscription.updated` pe webhook-ul Class RDA (Alex).
