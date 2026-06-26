# Gap Analysis — Strategie (docs) vs. Cod — Stripe Checkout Broker
**Data:** 2026-06-20 · **Scope:** READ-ONLY (analiză, zero modificări) · **Proiect:** `@projects/stripe-module` + sub-app `admin/` (Checkout Broker, LIVE `stripe.knowbest.ro:3025`)

---

## 🗣️ Pe înțelesul tău + implicații (non-tehnic)

Ai două lucruri în acest folder, care arată la fel dar fac treburi diferite:

1. **Biblioteca** (`src/`) — un set de „cărămizi" de cod pe care alte aplicații (BlocHub, Tutor, knowbest, utilajhub) le importă ca să vorbească cu Stripe. E ca un set de unelte împrumutate.
2. **Brokerul** (`admin/`) — o aplicație care **rulează singură pe server** și **ține cheile Stripe ale tuturor firmelor** într-un singur loc. Aplicațiile consumatoare NU mai țin chei — cer brokerului „fă-mi un checkout" și brokerul îl face cu cheia firmei potrivite. Este **coloana vertebrală a banilor** din tot ecosistemul.

**Ce am găsit, pe scurt:**
- **Codul a luat-o înaintea documentației.** Brokerul are deja funcții reale care NU sunt în niciun document: **rambursări** (`/api/refund`), **facturare cu TVA** (invoicing), **sincronizare cu hub-ul Legal**, **auto-completare date firmă din Stripe**, **atribuire pe ecosistem întreg dintr-un clic**. Documentul de contract (`CHECKOUT-BROKER.md`) descrie doar checkout + webhook + callback. Regula aici e clară: **NU tăiem funcțiile — ridicăm documentația la nivelul codului.** Funcțiile sunt bune și deja folosite live (pilotul AVE).
- **Lucrurile promise sunt, în mare, livrate.** Cele 3 părți ale contractului (checkout → webhook → callback HMAC) sunt implementate exact ca în spec. Gap-urile de audit anterioare (G-STRIPE-001…010) sunt toate închise.
- **Riscul real nu e o funcție lipsă, ci câteva fundații.** Cheile Stripe stau în **text simplu** într-un fișier (`data/credentials.json`) — gitignorat (bine), dar necriptat pe disc. Store-ul de date e un fișier JSON fără „lacăt" (lock), deci două plăți strict-simultane se pot călca pe coadă (lost-update). Aceste lucruri sunt cunoscute și parțial documentate, dar trebuie ridicate la nivel de „money-path" pe măsură ce treci pe **chei LIVE** și plăți reale.

**Implicație practică:** Brokerul e funcțional și verificat (11/11 E2E + pilot AVE real test-mode). Înainte de a trece pe bani reali (`sk_live_`), trei lucruri merită o sesiune dedicată: (1) criptarea cheilor la repaus sau mutarea într-un secrets-vault, (2) un lock pe fișierul de sesiuni (sau migrare la o mică DB), (3) ridicarea documentației la nivelul codului ca să nu te trezești peste 6 luni că „nu mai știi ce face brokerul cu adevărat".

---

## (a) Promis-dar-lipsă (docs spun X, codul n-are X)

| # | Promisiune în docs | Stare în cod | Sev |
|---|---|---|---|
| a1 | `CHECKOUT-BROKER.md` L62 + `CONSUMER-RECIPE.md` L48 cer consumatorului verificare callback **timing-safe** (`timingSafeEqual`). Brokerul-side documentează „HMAC". | ✅ Brokerul **semnează** corect (`signCallback`, `admin/src/lib/broker.ts:139`). Dar brokerul **NU verifică timestamp/replay** pe callback (e doar semnătură, fără fereastră de timp). Documentația nu promite replay-protection pe callback, deci nu e propriu-zis „lipsă", dar e un gap de robustețe (vezi 04b). | P2 |
| a2 | `USAGE.md` (lib) descrie **Stripe Connect / marketplace** (`createMarketplacePayment`, payout-uri). | ✅ Există în `src/server/connect.ts` (lib), DAR brokerul (`admin/`) **nu expune** niciun endpoint Connect. Connect e neactivat pe contul test (S8 BLOCKED în `TODO_PERSISTENT.md`). Promisiune la nivel de lib, nu de broker — corect documentat ca blocat. | P3 |
| a3 | `CHECKOUT-BROKER.md` menționează doar `payment` mode. | ✅ Brokerul hardcodează `mode: 'payment'` (`checkout/route.ts:118`). Lib-ul suportă `subscription`, dar **brokerul nu** → abonamentele recurente prin broker NU sunt posibile azi. Nedocumentat ca limitare explicită. | P2 |

**Verdict (a):** Aproape nimic „promis-dar-lipsă" real. Singura limitare funcțională ne-marcată: brokerul e doar **one-time payment** (nu subscription), deși ecosistemul (Tutor/knowbest/utilajhub) folosește abonamente. Ar trebui documentat explicit că abonamentele rămân pe lib-ul direct, nu pe broker.

---

## (b) Construit-dar-nedocumentat — DRIFT (cod înaintea docs)

> **REGULĂ:** cod înaintea docs = **documentație stale**, NU funcție de tăiat. Acțiunea e „ridicăm documentația la nivelul codului".

| # | Funcție livrată (cod) | Unde | Documentat? |
|---|---|---|---|
| b1 | **Rambursări** (`POST /api/refund`) — money-back per sessionId, izolat pe project-key, idempotent pe `charge_already_refunded`. | `admin/src/app/api/refund/route.ts` | ❌ Absent din `CHECKOUT-BROKER.md`. Doar în `USAGE.md` ca funcție de lib, nu ca endpoint de broker. **DRIFT.** |
| b2 | **Facturare cu TVA opt-in** (`body.invoicing`) — creează Stripe Customer + tax id + TaxRate reutilizabil + `invoice_creation`, logica UAE VAT 5%/0% export. | `admin/src/lib/invoicing.ts` + `checkout/route.ts:98-145` | ❌ Absent complet din contract. Comentarii inline bune, dar zero în Knowledge. **DRIFT major** (afectează ce primește buyerul). |
| b3 | **`customerEmail` passthrough** pe checkout (prefill, validare regex email). | `checkout/route.ts:43,137` | ❌ Nedocumentat în contract. **DRIFT.** |
| b4 | **Legal sync + reconciliere** (`/api/legal/sync` GET/POST, preview/apply, diff Legal↔Stripe, flags drift, biller-fără-chei). | `admin/src/lib/legal.ts` + `api/legal/sync/route.ts` + pagina `/legal` | ⚠️ Menționat în DEPLOY_REGISTRY (Legal-sync 2026-06-12) dar **nu în Knowledge/** broker. **DRIFT.** |
| b5 | **Auto-setup firmă din cheie Stripe** (`/api/auto-setup`) — trage nume/CUI/IBAN/adresă/balance din contul Stripe. | `api/auto-setup/route.ts` | ❌ Nedocumentat. **DRIFT.** |
| b6 | **Atribuire pe ecosistem** (`/api/ecosystems/assign`) — mapează tot ecosistemul la o firmă dintr-un clic, generează chei per-proiect. | `api/ecosystems/assign/route.ts` | ❌ Nedocumentat. **DRIFT.** |
| b7 | **Dublă-firmă per proiect** (`subscriptionCompany` vs `serviceCompany` — abonament SaaS vs plăți servicii, ex. BlocHub: Class RDA încasează abonamentul, asociația încasează de la chiriași). | `data.ts:60-93` (`ProjectMapping`) | ❌ Concept-cheie de business, comentat doar în cod. **DRIFT major** — modelul de date e mai bogat decât contractul. |
| b8 | **Test-connection** (`/api/test-connection`) — validează o cheie Stripe live (account.retrieve). | `api/test-connection/route.ts` | ❌ Nedocumentat. |
| b9 | **`brokerEnabled=false` → 503** (kill-switch per proiect). | `checkout/route.ts:32` | ⚠️ Menționat în contract („503 broker dezactivat") dar nu și cum se setează (din UI Projects). Parțial documentat. |

**Verdict (b):** **DRIFT semnificativ.** Brokerul a crescut de la „checkout + webhook + callback" la o platformă completă de billing (rambursări, facturare TVA, Legal-sync, auto-setup, dublă-firmă). `Knowledge/CHECKOUT-BROKER.md` descrie ~30% din suprafața reală. **Acțiune: ridică documentația — adaugă secțiuni pentru §refund, §invoicing, §legal-sync, §model-dublă-firmă, §admin-endpoints.** Nu tăia nimic.

---

## (c) Reconciliere TODO

`TODO_PERSISTENT.md` declară „Toate gap-urile închise 2026-06-11" și `AUDIT_GAPS.md` = 0 open. Verificat în cod:

| Item TODO | Stare reală în cod | OK? |
|---|---|---|
| G-STRIPE-001 (auth admin API) | ✅ `middleware.ts` — localhost-only + `STRIPE_ADMIN_TOKEN` + `STRIPE_ADMIN_PROXY_AUTH=1` (nginx basic-auth pe prod). | ✅ |
| G-STRIPE-002 (chei hardcodate în test-webhook) | ✅ `test-aiwebauditor-webhook.mjs` citește din env (verificat: `process.env.STRIPE_SECRET_KEY`). | ✅ |
| G-STRIPE-005 (`discoverProjects` `/var/www`) | ✅ `data.ts:283` — `PROJECTS_ROOT` env + darwin→`~/Projects`. | ✅ |
| G-STRIPE-006 (`DATA_DIR` cwd) | ✅ `resolveDataDir()` în `data.ts` + `broker.ts` (mirror). | ✅ |
| G-STRIPE-010 (syncPlans duplicate) | ✅ Lib `src/server/sync.ts` (`products.list`). **Notă reziduală onestă:** race STRICT-concurent (read-then-create fără lock) RĂMÂNE — recunoscut în AUDIT_GAPS. | ⚠️ rezidual |
| **Commit pending** (`ai-router`→peerDeps + `teinformez`) | ⚠️ TODO L37: „rămas necomis". `package.json` are deja `ai-router` în `peerDependencies` ✅, dar `data/companies.json` NU conține `teinformez` (are blochub/techbiz-uae/class-rda). Diff parțial neaplicat / companiile sunt runtime-edited. | ⚠️ |
| C1 webhook duplicate (by design) | ✅ Documentat în `USAGE.md` §7. Brokerul `admin/` are propria idempotență pe `processedEventIds` (`webhook/[companySlug]/route.ts:118`). | ✅ |
| C2 syncPlans race | ✅ → G-STRIPE-010 rezidual. | ⚠️ |
| C3 useCompany bleed | ✅ doc + warn. | ✅ |

**Verdict (c):** TODO e onest. Un singur item operațional încă deschis (commit pending al peerDeps/teinformez). Două race-condition reziduale recunoscute explicit (lost-update file-store) — nu sunt „ascunse", dar nu sunt închise.

---

## (d) Top gap-uri P0/P1/P2 (cu căi reale)

### P0 — niciunul blocant azi (broker e test-mode + nginx basic-auth)
Nu există gap care să oprească operarea curentă. Riscurile P0 apar **la trecerea pe `sk_live_`** (vezi 04b).

### P1
| ID | Gap | Cale / dovadă | Recomandare |
|---|---|---|---|
| **GAP-DOC-01** | **Documentație stale ~70%** — refund, invoicing, Legal-sync, dublă-firmă, auto-setup, ecosystem-assign nedocumentate. | `Knowledge/CHECKOUT-BROKER.md` (acoperă doar 3 endpoint-uri din ~10). | Ridică docs la nivelul codului (NU tăia funcții). |
| **GAP-SEC-01** | **Chei Stripe `sk_` în text simplu** pe disc. | `data/credentials.json` (gitignorat ✅, dar necriptat). | Criptare la repaus (envelope/KMS) sau secrets-vault — vezi 04b S1. |
| **GAP-RACE-01** | **File-store fără lock** → lost-update pe sesiuni concurente (callbackSecret/processedEventIds se pot pierde). | `broker.ts:85-118` (`writeStore` non-atomic, fără lock). | Scriere atomică (tmp+rename) + lock, sau SQLite. Vezi 04b S5. |

### P2
| ID | Gap | Cale / dovadă | Recomandare |
|---|---|---|---|
| **GAP-FN-01** | Brokerul e **doar one-time payment** (nu subscription), deși ecosistemul vinde abonamente. | `checkout/route.ts:118` `mode:'payment'` hardcodat. | Documentează limitarea + plan pentru subscription-mode dacă consumatorii o cer. |
| **GAP-SEC-02** | Callback broker→consumer **fără timestamp/replay-protection** (doar HMAC). | `broker.ts:dispatchCallback` — semnătură pe body, fără `t=`. | Adaugă timestamp în payload + fereastră (consumatorul respinge >5min). |
| **GAP-DEP-01** | `npm audit`: Next.js **HIGH** (middleware/proxy-bypass family) în admin + qs/postcss moderate. | `admin/` Next 15.5.14. | Bump Next la ultima 15.x; vezi 04b S8. |

---

## Inventar complet (referință)

**Lib (`src/`):** `index.ts` (barrel), `client.ts`, `config.ts`, `types.ts`, `utils.ts`, `server/` (checkout/intent/subscription/connect/sync/webhook), `companies/` (`use-company.ts`, `getStripeForCompany`), `components/` (PaymentForm), `nextjs/` (route helpers).

**Broker (`admin/src/`):**
- **Pagini UI:** `/` (Dashboard), `/companies` (Firme), `/projects` (Project-Mappings), `/credentials` (Credențiale), `/legal` (Legal-sync).
- **API publice (broker):** `POST /api/checkout`, `POST /api/stripe/webhook/[companySlug]`, `POST /api/refund`.
- **API admin (gated):** `/api/companies`, `/api/credentials`, `/api/projects`, `/api/ecosystems/assign`, `/api/legal/sync`, `/api/test-connection`, `/api/auto-setup`.
- **Lib broker:** `data.ts` (file-store + tipuri), `broker.ts` (sesiuni + crypto + dispatch), `invoicing.ts` (TVA), `legal.ts` (Legal-sync), `middleware.ts` (gate auth).

**File-store (`data/`):**
| Fișier | Conținut | Git |
|---|---|---|
| `credentials.json` | chei Stripe `sk_/pk_/whsec_` per firmă (TEXT SIMPLU) | **gitignorat** ✅ |
| `companies.json` | profile firme | gitignorat ✅ |
| `project-mappings.json` | proiect→firmă + `apiKey` (pk_proj_) + `callbackSecret` (cbs_) | gitignorat ✅ |
| `checkout-sessions.json` | sesiuni runtime + `callbackSecret` per sesiune | gitignorat ✅ |
| `ecosystems.json` | grupare curată proiecte (static) | **TRACKED** ✅ (corect — fără secrete) |
