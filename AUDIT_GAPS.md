# AUDIT_GAPS — Stripe (@projects/stripe-module)

> Ledger de gaps deschise. Creat 2026-06-11 (True E2E [10], Faza 0 /review baseline).
> Clasificare proiect: ACTIVE; consumatori NO-TOUCH: BlocHub payment flows → fix-uri pe modul = propose-confirm-apply per CLASSIFICATION §6.1.

## Open Gaps

| ID | Sev | Fișier | Descriere | Status |
|----|-----|--------|-----------|--------|
| G-STRIPE-003 | P2 | `src/server/sync.ts:355` | Prețurile re-create în `syncPrices` primesc metadata `project: plan.slug` (slug-ul PLANULUI în câmpul project) și omit `planSlug` — drift de metadata vs prețurile create inițial în `syncPlans` (care pun corect `project` + `planSlug`). Nu rupe discovery (search e pe products), dar corupe trasabilitatea. **Fix pe lib → propose-confirm-apply per §6.1 (BlocHub NO-TOUCH consumer).** | OPEN |
| G-STRIPE-004 | P2 | `src/companies/use-company.ts` | `useCompany()` mută state global de modul (config + keyProvider + activeCompanySlug) — într-un proces care servește 2+ companii concurrent, currency/cheia pot „sângera" între requesturi. Safe path existent: `getStripeForCompany()`. Fix de design: documentare explicită single-company-per-process + deprecation warning, sau AsyncLocalStorage. **Propose-confirm-apply per §6.1.** | OPEN |
| G-STRIPE-007 | P3 | `src/nextjs/sync-route.ts`, `connect-route.ts` | `authorize` e opțional pe rute destructive (sync dezactivează produse; connect șterge conturi). Footgun: consumatorul poate monta ruta fără auth. Fix: warn la runtime când lipsește authorize, sau required în tipuri pentru rutele destructive. **Propose-confirm-apply per §6.1.** | OPEN |
| G-STRIPE-008 | P3 | `src/server/connect.ts:209` | `createMarketplacePayment`/`createMarketplaceCheckout` nu validează `platformFee <= amount` și `amount > 0` — eroarea Stripe rezultată e criptică pentru integrator. Fix: validare explicită cu mesaj clar. **Propose-confirm-apply per §6.1.** | OPEN |
| G-STRIPE-009 | P2 | `package.json` | Zero framework de teste în modul (fără vitest/jest) — bibliotecă de PLĂȚI consumată de 4+ proiecte fără un singur test unitar. Confirmat de [7] CODE audit 2026-06-11. Fix: vitest + teste pe utils/credentials/webhook/sync (pure-logic, fără API calls). | OPEN |

## Eliminated Gaps

| ID | Sev | Descriere | Eliminat | Commit |
|----|-----|-----------|----------|--------|
| G-STRIPE-001 | P1 | Admin API fără autentificare — GET /api/credentials returna chei în clar oricui. Fix: `admin/src/middleware.ts` — localhost-only + opțional `STRIPE_ADMIN_TOKEN`/`x-admin-token` pentru acces remote. Verificat live: localhost 200, host extern 403 (inclusiv /api/credentials). TG re-run PASSED 0 P0/P1. | 2026-06-11 | (vezi commit fix [10]) |
| G-STRIPE-002 | P2 | sk_test + whsec hardcodate în `test-aiwebauditor-webhook.mjs`. Fix: rescris să citească STRIPE_SECRET_KEY/WEBHOOK_SECRET din env (canonical: Master/credentials/stripe.env), exit 1 dacă lipsesc. | 2026-06-11 | (vezi commit fix [10]) |
| G-STRIPE-005 | P2 | `discoverProjects()` hardcoda `/var/www` pe non-Windows → [] pe macOS. Fix: `PROJECTS_ROOT` env override + darwin → `~/Projects`. Verificat live: /api/projects returnează lista completă din ~/Projects. | 2026-06-11 | (vezi commit fix [10]) |
| G-STRIPE-006 | P3 | `DATA_DIR` dependent de cwd. Fix: `resolveDataDir()` — env `STRIPE_ADMIN_DATA_DIR` > candidați cwd validați prin existența `companies.json`. | 2026-06-11 | (vezi commit fix [10]) |
