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

## ✅ Stripe Broker — security hardening (4 items + bonus) — DONE 2026-06-26
Sursă: `Stripe/Reports/INTROSPECTION-2026-06-20/04b-security-audit.md` (S1-S8). Toate aplicate într-o sesiune dedicată (deploy LIVE pe stripe.knowbest.ro).

- [x] 🔴 **S2 — `npm audit fix`** — next 15.5.14→**15.5.19** (HIGH middleware/proxy-bypass + postcss/qs); build verde. Reziduul de advisory (cere 16.3.0 inexistent) e acoperit de nginx basic-auth ca strat primar + S4. (2026-06-26)
- [x] 🟡 **S1 — Chei Stripe criptate at-rest** — `crypto-at-rest.ts` AES-256-GCM envelope (env `STRIPE_DATA_KEY`), citire dual plaintext/criptat (backward-compat), `chmod 600`, migrare `admin/scripts/encrypt-credentials.mjs`. Activat pe prod cu cheia salvată în `Master/credentials/stripe-broker.env`. (2026-06-26)
- [x] 🟡 **S3 — Listă API nu mai expune cheile** — `/api/companies` întoarce doar `credentialsStatus` (prezență), nu cheile complete. Cheile full doar la `/api/credentials?slug=` (editor single-slug, behind basic-auth). _Rămas (decizie): mascare + reveal-endpoint pe editorul single-slug — UX redesign, deferat._ (2026-06-26)
- [x] 🟡 **S4 — Port 3025** — verificat: **NU** e accesibil extern (UFW default-deny; test din afară = refuzat). Întărit: next legat pe **127.0.0.1** (defense-in-depth, nu mai depinde doar de UFW). (2026-06-26)
- [x] 🟢 **S5 — File-store lock + atomic write** — `atomic.ts` (tmp+rename, 0600) + `locks.ts` (mutex per-sessionId); webhook re-read sub lock → elimină lost-update pe `processedEventIds`. (2026-06-26)
- [x] 🟢 **S6 — Callback anti-replay** — `v`+`t`(unix) în payload + HMAC; consumatorii pot respinge `now-t>300s`. Aditiv/backward-compat. (2026-06-26)
- [x] **S7 (bonus)** — `timingSafeEqual` pe project-key + rate-limit 60/min pe /checkout,/refund + Idempotency-Key opțional (consumer-supplied). (2026-06-26)
- _Solid (confirmat, fără acțiune): webhook semnat pe raw body + idempotency, runtime `data/*.json` gitignored, Checkout hosted = PCI SAQ A, refund izolat per project-key._
- _Rămas deschis (decizii user): mascare editor single-slug (S3 rest), backup automat criptat `data/` + retenție (S9)._

---

## 🔍 Introspection Audit 2026-06-20
> Audit complet (gap strategie↔cod · ghid per-pagină · deep research · funcțional + cyber).
> Acțiuni de securitate (S1-S7) **rezolvate 2026-06-26** (vezi blocul de mai sus).
> Rapoarte: `Reports/INTROSPECTION-2026-06-20/` (00-SUMMARY.md, 01-gap-strategy-vs-code.md, 02-pages-guide-RO.md, 03-deep-research-optimization.md, 04b-security-audit.md)
> Checklist Alex centralizat: `Master/reports/Alex_TODO_2026-06-20.md` + tab „Introspection Audit" în UI Master.

---
