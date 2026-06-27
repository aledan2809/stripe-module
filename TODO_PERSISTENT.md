# TODO Persistent — Stripe (@projects/stripe-module)

> Citit la fiecare sesiune pe acest proiect. Items rămân până sunt marcate `[x]` cu dată + commit.
> **Scaffolded 2026-06-11** în timpul True E2E [10] (secțiunea TRUE FULL E2E nu exista — creată per skill /true-e2e).

---

## [ ] 📧 BUILD — Invoice email per-proiect (cu BCC de control) — propus user 2026-06-26

> **NO-TOUCH CRITIC** (broker deține `sk_live_`) → propose-confirm-apply, backup `data/`, smoke pe prod. `data/*.json` gitignored (mai puțin `ecosystems.json`) — nu commitui, nu șterge la `git pull`.
>
> **🔴 PREREQ user (blochează verificarea, nu codul):** (a) credențiale SMTP cont **techbiz.ae** (host/port/user/parolă); (b) confirmă că **invoice@techbiz.ae e cutie reală** (pt BCC). Fără ele, Verify/Send-test/acceptance §7 nu se pot rula.

**OBIECTIV**: când un client plătește printr-un proiect (one-time ȘI abonament-renewal), brokerul trimite clientului emailul cu factura (link/PDF din Stripe) + BCC pe adresă de control (default `invoice@techbiz.ae`), cu șablon editabil per-proiect + FROM specific per-proiect verificat în prealabil. Toate trimiterile logate (UI + inbox BCC). Brokerul trimite singur (NU `stripe.invoices.sendInvoice` — facturile din Checkout `invoice_creation` sunt deja paid; sendInvoice e doar pt draft/open; + e singura cale de BCC). După live: OFF în Stripe Dashboard toggle „Email finalized invoices to customers" (un singur emitent).

**Context tehnic (citește înainte)**: webhook `admin/src/app/api/stripe/webhook/[companySlug]/route.ts` (cuplezi emailul ADITIV, fără să atingi callback-ul HMAC); date `admin/src/lib/data.ts` (`ProjectMapping`, `getCredentials`, readJson/writeJson pe `data/*.json`); secrete `admin/src/lib/crypto-at-rest.ts` (`encryptSecret/decryptSecret` — parola SMTP criptată); UI `admin/src/app/{projects,companies,credentials}/page.tsx`. Brokerul n-are azi email (zero nodemailer) → îl adaugi.

**Pași**:
1. **Transport SMTP** (techbiz.ae, partajat): `nodemailer`+`@types/nodemailer`; config în `data/email-config.json` (gitignored) `{smtp:{host,port:587,secure:false,user,passEnc:"enc:v1:...",fromDefault:"invoice@techbiz.ae"},verified,verifiedAt}` — `passEnc` criptat; `getEmailConfig/saveEmailConfig/getTransporter` (parola doar în memorie, niciodată logată).
2. **Config per-proiect** în `ProjectMapping.invoiceEmail?` = `{enabled,fromName,fromAddress,bcc(default invoice@techbiz.ae),subjectTemplate,bodyTemplate(HTML),verified,verifiedAt}`. Placeholders `{{projectName/invoiceNumber/amount/currency/customerEmail/hostedInvoiceUrl/invoicePdfUrl/date}}`. Default editabil (FĂRĂ cuvântul „AI"): Subject „Factura {{invoiceNumber}} — {{projectName}}"; Body salut + „Îți mulțumim pentru plată." + nr + sumă/valută + linkuri Vezi factura/Descarcă PDF + footer. Backward-compat: lipsă `invoiceEmail` = off.
3. **Verificare prealabilă (obligatorie)**: niciun email live dacă `verified!==true`. Pași: validează format from/bcc → `transporter.verify()` → test-send real (FROM=fromAddress, TO=bcc, „[TEST] ...") → doar dacă toate trec `verified=true`. Schimbarea fromAddress/SMTP resetează `verified=false`.
4. **Cuplare webhook** (aditiv, non-blocking, idempotent): după callback-ul existent, pe `checkout.session.completed`+`payment.succeeded` (one-time → `invoices.retrieve(session.invoice)` sau `expand:['invoice']`) și `invoice.paid` (renewal → `event.data.object`): rezolvă projectSlug (din `session.metadata.projectSlug`/client_reference_id — vezi `api/checkout/route.ts`) → mapping → `!enabled` skip, `!verified` → BLOCKED_UNVERIFIED (fail-closed) → din invoice ia number/hosted_invoice_url/invoice_pdf/customer_email → idempotență pe `data/invoice-emails.json` (claim atomic PENDING pe invoice.id) → trimite from „{{fromName}} <{{fromAddress}}>" to=customer_email bcc=invoiceEmail.bcc → loghează SENT/FAILED. **Tot blocul în try/catch: eroarea de email NU schimbă HTTP-ul webhook-ului** (callback + 200/500 ca azi).
5. **UI admin**: secțiune „Email" (SMTP broker: host/port/secure/user/parolă write-only mascată criptată + „Verify"); în `projects/page.tsx` Edit modal secțiune „Invoice email" per-proiect (toggle, fromName, fromAddress, bcc prefill, editor subject/body + listă placeholders, „Send test" → §3, badge verified); pagină „Invoice emails" (log din `data/invoice-emails.json`: dată/proiect/invoiceNumber/to/bcc/status/eroare).
6. **Gitignore + deploy**: `.gitignore` += `data/email-config.json` + `data/invoice-emails.json`. SMTP prin `data/email-config.json` (criptat), nu `.env` (`STRIPE_DATA_KEY` deja în `.env.local`). Deploy (DEPLOY_REGISTRY row 14f): backup `data/*.json` în /tmp ÎNAINTE de `git pull` → `cd admin && npm install && npm run build && pm2 restart stripe-broker` (NU `--update-env`) → restore data/ dacă pull le-a atins. Smoke: /api/checkout 401 fără key, webhook 400 fără semnătură, admin 401→200 basic-auth, AVE app.techbiz.ae 200.
7. **Acceptance**: (1) SMTP „Verify" trece; (2) proiect `ave` test → enable + „Send test" → verified ✓; (3) checkout test → client primește email + BCC primește copia + rând SENT; (4) replay webhook → 1 singur SENT; (5) enabled dar `verified=false` → BLOCKED_UNVERIFIED zero email; (6) eroare SMTP → webhook normal (callback neafectat) + rând FAILED; (7) Stripe Dashboard auto-email OFF pe contul testat.
8. **Out of scope**: nu schimba callback-ul HMAC; nu `stripe.invoices.sendInvoice`; fără „AI" în textul client.

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
