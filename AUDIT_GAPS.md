# AUDIT_GAPS — Stripe (@projects/stripe-module)

> Ledger de gaps deschise. Creat 2026-06-11 (True E2E [10], Faza 0 /review baseline).
> Clasificare proiect: ACTIVE; consumatori NO-TOUCH: BlocHub payment flows → fix-uri pe modul = propose-confirm-apply per CLASSIFICATION §6.1.

## Open Gaps

_Niciun gap deschis — toate închise 2026-06-11._

## Eliminated Gaps

| ID | Sev | Descriere | Eliminat | Commit |
|----|-----|-----------|----------|--------|
| G-STRIPE-001 | P1 | Admin API fără autentificare — GET /api/credentials returna chei în clar oricui. Fix: `admin/src/middleware.ts` — localhost-only + opțional `STRIPE_ADMIN_TOKEN`/`x-admin-token` pentru acces remote. Verificat live: localhost 200, host extern 403 (inclusiv /api/credentials). TG re-run PASSED 0 P0/P1. | 2026-06-11 | (vezi commit fix [10]) |
| G-STRIPE-002 | P2 | sk_test + whsec hardcodate în `test-aiwebauditor-webhook.mjs`. Fix: rescris să citească STRIPE_SECRET_KEY/WEBHOOK_SECRET din env (canonical: Master/credentials/stripe.env), exit 1 dacă lipsesc. | 2026-06-11 | (vezi commit fix [10]) |
| G-STRIPE-005 | P2 | `discoverProjects()` hardcoda `/var/www` pe non-Windows → [] pe macOS. Fix: `PROJECTS_ROOT` env override + darwin → `~/Projects`. Verificat live: /api/projects returnează lista completă din ~/Projects. | 2026-06-11 | (vezi commit fix [10]) |
| G-STRIPE-006 | P3 | `DATA_DIR` dependent de cwd. Fix: `resolveDataDir()` — env `STRIPE_ADMIN_DATA_DIR` > candidați cwd validați prin existența `companies.json`. | 2026-06-11 | (vezi commit fix [10]) |
| G-STRIPE-010 | P1 | `syncPlans` duplica produse (`products.search` eventually-consistent ~16-60s). Fix: `products.list` strongly-consistent + filtru client-side metadata + auto-pagination (`src/server/sync.ts:fetchProjectProducts`). Verificat: re-sync IMEDIAT idempotent (0 created, exact 1 produs, fără cele 90s de workaround). §6.1: 0 consumatori apelează syncPlans; dist nou se preia organic la next build; health PRO/eat/teinformez/utilajhub/cabinet toți 200. **Notă reziduală:** race-ul STRICT-concurent (C2, 2 sync paralele) rămâne posibil — e read-then-create fără lock, root-cause diferit de eventual-consistency; necesită idempotency-key/lock (gap separat dacă apare în prod). | 2026-06-11 | (commit lib) |
| G-STRIPE-003 | P2 | Prețurile re-create în `syncPrices` primeau metadata `project: plan.slug` (greșit) + omiteau `planSlug`. Fix: pasez `project` real în `syncPrices` + metadata `{ project, planSlug, managedBy }` (`src/server/sync.ts`). Verificat live: preț re-creat are `project=<run>` + `planSlug=p`. | 2026-06-11 | (commit lib P2/P3) |
| G-STRIPE-004 | P2 | `useCompany()` mută state global → bleed multi-company concurrent. Fix: JSDoc explicit „single-company-per-process; folosește `getStripeForCompany()` pt multi-tenant" + `console.warn` la switch de companie activă (`src/companies/use-company.ts`). Path-ul sigur `getStripeForCompany()` exista deja. | 2026-06-11 | (commit lib P2/P3) |
| G-STRIPE-007 | P3 | `authorize` opțional pe rute destructive. Fix: `console.warn` la montarea `syncRoute`/`connectRoute` fără `authorize` (`src/nextjs/{sync,connect}-route.ts`). | 2026-06-11 | (commit lib P2/P3) |
| G-STRIPE-008 | P3 | Marketplace nu valida `amount>0` / `platformFee<=amount`. Fix: `validateMarketplaceAmounts` (exportat) cu mesaje clare, apelat în `createMarketplacePayment`+`createMarketplaceCheckout` (`src/server/connect.ts`). Acoperit de teste unitare (4 cazuri). | 2026-06-11 | (commit lib P2/P3) |
| G-STRIPE-009 | P2 | Zero teste unitare. Fix: vitest + `src/__tests__/unit.test.ts` (10 teste: money math 3 + marketplace validation 4 + credential resolution 3). `npm test`; `tsconfig` exclude `__tests__` din build. | 2026-06-11 | (commit lib P2/P3) |
