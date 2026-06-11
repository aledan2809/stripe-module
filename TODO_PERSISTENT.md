# TODO Persistent — Stripe (@projects/stripe-module)

> Citit la fiecare sesiune pe acest proiect. Items rămân până sunt marcate `[x]` cu dată + commit.
> **Scaffolded 2026-06-11** în timpul True E2E [10] (secțiunea TRUE FULL E2E nu exista — creată per skill /true-e2e).

---

## 🎯 TRUE FULL E2E — multi-role business workflows

> Source of truth pentru scope-ul auditului [10] pe acest modul. Rolurile relevante:
> **Platform-Operator** (admin panel, gestionează firme+chei) · **Integrator** (app consumator: BlocHub/Tutor/knowbest/utilajhub/AIWebAuditor) · **Buyer** (plătitor, test cards) · **Seller** (cont Connect, marketplace).
> Toate scenariile rulează pe Stripe **TEST mode** (chei din `Master/credentials/stripe.env`).

### Workflow scenarios (S1-S12)
- [ ] S1 — Checkout session `payment` mode (inline line items) → URL valid `checkout.stripe.com`
- [ ] S2 — Checkout session `subscription` mode + trialDays → session creată cu trial
- [ ] S3 — PaymentIntent create + confirm cu `pm_card_visa` → status `succeeded` (rol: Buyer)
- [ ] S4 — Webhook: semnătură validă acceptată + semnătură invalidă RESPINSĂ (negative test) + secret greșit respins
- [ ] S5 — Refund full + partial pe PaymentIntent reușit → status `succeeded` pe refund
- [ ] S6 — Customer create → subscription create (price din S7) → cancel → status `canceled`
- [ ] S7 — Plan sync: syncPlans creează produs+preț → re-sync idempotent (0 created/updated) → schimbare amount → preț NOU creat + vechi dezactivat → plan scos → produs dezactivat
- [ ] S8 — Connect (rol: Seller): createConnectedAccount express → account link URL → marketplace payment cu platformFee → cleanup (delete account)
- [ ] S9 — Credentials resolution: env vars > programmatic > .credentials.json (prioritate corectă + eroare clară când lipsesc)
- [ ] S10 — Billing portal session (necesită portal config pe contul test; dacă lipsește → BLOCKED documentat)
- [ ] S11 — toStripeAmount edge cases: 10.005, 0.1+0.2, valori mari — rounding corect, fără drift de bani
- [ ] S12 — Admin panel (rol: Platform-Operator): walk /, /companies, /projects, /credentials + test-connection cu cheia test

### Concurrency (C1-C3)
- [ ] C1 — Webhook duplicate delivery (același event de 2×): modulul NU deduplichează (by design — consumer responsibility) → verificat + documentat în USAGE
- [ ] C2 — syncPlans paralel (2× simultan, același proiect): search-then-create nu e atomic → risc duplicat produs — verificat/analizat + documentat
- [ ] C3 — Multi-company key-switch race (useCompany global state) → analizat, gap G-STRIPE-004

---

## Items operaționale

- [ ] **Commit diff-ul pending**: `ai-router` → peerDependencies (pattern L93) + companie `teinformez` în registry. Diff verificat OK în /review 2026-06-11.
- [ ] **G-STRIPE-001**: auth pe admin panel API (vezi AUDIT_GAPS.md)
- [ ] **G-STRIPE-002**: șterge/relocă `test-aiwebauditor-webhook.mjs` (chei hardcodate; canonical e `Master/credentials/stripe.env`)

---

## Session log

| Date | Change |
|------|--------|
| 2026-06-11 | Scaffolded (True E2E [10] session). TRUE FULL E2E S1-S12 + C1-C3 definite. |
