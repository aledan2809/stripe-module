# TODO Persistent — Stripe (@projects/stripe-module)

> Citit la fiecare sesiune pe acest proiect. Items rămân până sunt marcate `[x]` cu dată + commit.
> **Scaffolded 2026-06-11** în timpul True E2E [10] (secțiunea TRUE FULL E2E nu exista — creată per skill /true-e2e).

---

## 🎯 TRUE FULL E2E — multi-role business workflows

> Source of truth pentru scope-ul auditului [10] pe acest modul. Rolurile relevante:
> **Platform-Operator** (admin panel, gestionează firme+chei) · **Integrator** (app consumator: BlocHub/Tutor/knowbest/utilajhub/AIWebAuditor) · **Buyer** (plătitor, test cards) · **Seller** (cont Connect, marketplace).
> Toate scenariile rulează pe Stripe **TEST mode** (chei din `Master/credentials/stripe.env`).

### Workflow scenarios (S1-S12)
- [x] S1 — Checkout session `payment` (2026-06-11) — URL checkout.stripe.com valid
- [x] S2 — Checkout session `subscription` + trial (2026-06-11)
- [x] S3 — PaymentIntent + confirm `pm_card_visa` → `succeeded` (2026-06-11)
- [x] S4 — Webhook: valid acceptat + 2 negative respinse (2026-06-11)
- [x] S5 — Refund full + partial → `succeeded` (2026-06-11)
- [x] S6 — Customer → subscription → cancel → `canceled` (2026-06-11)
- [x] S7 — Plan sync lifecycle complet idempotent (2026-06-11) — a expus G-STRIPE-010
- [~] S8 — Connect marketplace — **BLOCKED** (Connect neactivat pe cont test; acțiune user dashboard.stripe.com/connect)
- [x] S9 — Credentials resolution: env > programmatic > eroare (2026-06-11)
- [x] S10 — Billing portal session (2026-06-11)
- [x] S11 — toStripeAmount edge cases 6/6 (2026-06-11)
- [x] S12 — Admin panel walk (acoperit de TG flows + headed G1-G4, 2026-06-11)

### Concurrency (C1-C3)
- [x] C1 — Webhook duplicate: NU deduplichează (by design) → documentat în `Knowledge/USAGE.md` (2026-06-11)
- [x] C2 — syncPlans paralel: race CONFIRMAT → G-STRIPE-010 (2026-06-11)
- [x] C3 — useCompany global-state bleed CONFIRMAT → G-STRIPE-004 (2026-06-11)

---

## Items operaționale

- [ ] **Commit diff-ul pending**: `ai-router` → peerDependencies (pattern L93) + companie `teinformez` în registry. Diff verificat OK în /review 2026-06-11. (rămas necomis — vezi mai jos)
- [x] **G-STRIPE-001**: auth pe admin panel API — DONE 2026-06-11 (`b40a19f`, middleware localhost-only)
- [x] **G-STRIPE-002**: `test-aiwebauditor-webhook.mjs` citește din env — DONE 2026-06-11 (`b40a19f`)
- [x] **G-STRIPE-010 (P1)**: idempotency syncPlans (search→list) — DONE 2026-06-11 (commit `6e90316`)
- [x] **G-STRIPE-009 (P2)**: vitest suite — DONE 2026-06-11 (10 teste pure-logic)
- [x] **G-STRIPE-003/004/007/008**: fix-uri pe lib — DONE 2026-06-11 (§6.1, health consumatori 200)

> **Toate gap-urile închise 2026-06-11.** AUDIT_GAPS.md = 0 open.

---

## Session log

| Date | Change |
|------|--------|
| 2026-06-11 | Scaffolded (True E2E [10] session). TRUE FULL E2E S1-S12 + C1-C3 definite. |
