# Stripe Checkout Broker — Direct Changes Ledger — 2026-06

> NO-TOUCH CRITIC (deține chei `sk_live` — Class RDA + Fabulosos). Orice modificare = propose-confirm-apply + backup + verificare consumatori. Vezi CLASSIFICATION §2d + §3.1.

---

## 2026-06-26 — add broker project `travelagency` (advance/deposit pt TravelAgency P4)

**Context**: TravelAgency P4 (Order/Contract) colectează avansul prin brokerul existent. Userul a confirmat „fa tu asta" pe recomandarea: **proiect dedicat `travelagency` → firma Class RDA, env TEST** (test-first; flip pe live când agenția e reală).

**Schimbare (strict aditivă)**:
- Backup: `data/project-mappings.json` → `data/project-mappings.json.bak-pre-travelagency-2026-06-26`.
- Adăugat 1 mapare via **API-ul oficial** `POST localhost:3025/api/projects` (NU editare manuală JSON) → `upsertProjectMapping` + `generateBrokerKeys`:
  - `{ projectSlug: "travelagency", brokerCompany: "class-rda", brokerEnv: "test", brokerEnabled: true }`
  - generat: `apiKey=pk_proj_aef1…90b7`, `callbackSecret=cbs_0b4c…81b2` (în `credentials/travelagency.env` + `/var/www/travelagency/.env` VPS).
- Total mapări 15 → **16**. Niciun proiect existent atins (verificat: `ave` + `rpa-hub` + restul intacte).

**Verificare consumatori (post-change)**: `stripe.knowbest.ro/api/checkout` 405 (POST-only, sănătos) · `ave.techbiz.ae` 301 · `contakt.knowbest.ro/api/health` 200. Niciun consumator afectat.

**Verificare E2E nou (TA, prod, test mode)**: advance → URL real `checkout.stripe.com` (chei class-rda test) · factură avans creată (kind=advance) · callback semnat cu HMAC valid → `200` → deposit **paid** + factură **paid** · replay → `alreadyProcessed` (idempotent) · bad-sig → `401`. Fixture demo curățat (0 comenzi reziduale).

**Rămas (acțiune user/ops)**: flip `travelagency` env test→live când agenția încasează real (UI broker: regenerează/comută env pe live; setează `brokerEnv:live`). Pentru BYO per-tenant (contul Stripe al agenției, nu Class RDA) = onboarding distinct ulterior.
