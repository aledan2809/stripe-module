# TODO Persistent — Stripe (@projects/stripe-module)

> Citit la fiecare sesiune pe acest proiect. Items rămân până sunt marcate `[x]` cu dată + commit.
> **Scaffolded 2026-06-11** în timpul True E2E [10] (secțiunea TRUE FULL E2E nu exista — creată per skill /true-e2e).

---

## [x] 📧 BUILD — Invoice email per-proiect (cu BCC de control) — DONE 2026-06-29 (commit `6073207`, LIVE stripe.knowbest.ro)

> **LIVE 2026-06-29** (commit `6073207`, deploy VPS2 backup-data→pull→npm install→build→restart, smoke 6/6 PASS). Transport **Resend** (cheie re_… din credentials, techbiz.ae verificat). Broker SMTP **verificat** (test trimis la invoice@techbiz.ae). **ave-platform** configurat + verificat (enabled, From/BCC invoice@techbiz.ae, TEST mode). Tab-uri noi LIVE: `/email` + `/invoice-emails` (behind basic-auth). Webhook cuplat ADITIV (fail-soft, callback HMAC neatins). `data/email-config.json`+`data/invoice-emails.json` gitignored.
> **✅ FINDING + DECIZIE 2026-06-29: BCC = `alexdanciulescu.ae@gmail.com` (final, „lăsăm așa").** `invoice@techbiz.ae` NU primește (Resend `receiving=disabled` + MX root prioritate 0 → VPS1 187.77.179.159 care n-are server de mail → mailul de intrare pică). **Trimiterea e OK** (FROM invoice@techbiz.ae, verificat: test la gmail = `delivered`, Resend id `4a96472c`). Decizie user: copia de control NU trebuie să fie @techbiz.ae → BCC = un Gmail dedicat (`alexdanciulescu.ae@gmail.com`), setat pe ave + verificat. FROM rămâne invoice@techbiz.ae. **Provizionarea invoice@techbiz.ae (forwarding ImprovMX/Cloudflare sau Workspace) = OPȚIONAL, nu se face** (nu schimbăm MX-ul domeniului de sending). Default cod BCC (`invoice@techbiz.ae`) = doar placeholder UI; setezi BCC corect per proiect.
> **RĂMAS (cere mâna user-ului — VERIFY P2-P7)**: (1) checkout TEST real pe AVE (unlock cu `invoicing:true` → invoice → email + BCC + rând SENT); pt one-time, AVE trebuie să trimită `invoicing:true` (altfel nu se creează invoice → fără email; subs auto-invoice). (2) replay webhook → 0 al 2-lea email. (3) Stripe Dashboard techbiz-uae → „Email finalized invoices to customers" = OFF (un singur emitent). (4) adopție per-proiect pe ceilalți (Tutor etc.) din UI: enable + From verificat + Send test.

> **NO-TOUCH CRITIC** (broker deține `sk_live_`) → propose-confirm-apply, backup `data/`, smoke pe prod. `data/*.json` gitignored (mai puțin `ecosystems.json`) — nu commitui, nu șterge la `git pull`.
>
> **✅ TRANSPORT = RESEND** (decis 2026-06-26): `techbiz.ae` e **verificat în Resend** (status verified, eu-west-1; cheie `re_...` deja în `Master/credentials/{tutor,marketing-automation,...}.env`). Folosim Resend ca transport — SMTP `smtp.resend.com:587` user `resend` pass=`re_...`, SAU API Resend. `invoice@techbiz.ae` ca FROM merge (domeniu verificat). **Nu mai trebuie SMTP techbiz.ae.**
> **🔴 SINGUR PREREQ rămas:** confirmă că **există o cutie reală care PRIMEȘTE BCC-ul** (`invoice@techbiz.ae` sau altă adresă citibilă) — Resend e send-only, recepția BCC cere mailbox real pe techbiz.ae.

**OBIECTIV**: când un client plătește printr-un proiect (one-time ȘI abonament-renewal), brokerul trimite clientului emailul cu factura (link/PDF din Stripe) + BCC pe adresă de control (default `invoice@techbiz.ae`), cu șablon editabil per-proiect + FROM specific per-proiect verificat în prealabil. Toate trimiterile logate (UI + inbox BCC). Brokerul trimite singur (NU `stripe.invoices.sendInvoice` — facturile din Checkout `invoice_creation` sunt deja paid; sendInvoice e doar pt draft/open; + e singura cale de BCC). După live: OFF în Stripe Dashboard toggle „Email finalized invoices to customers" (un singur emitent).

**Context tehnic (citește înainte)**: webhook `admin/src/app/api/stripe/webhook/[companySlug]/route.ts` (cuplezi emailul ADITIV, fără să atingi callback-ul HMAC); date `admin/src/lib/data.ts` (`ProjectMapping`, `getCredentials`, readJson/writeJson pe `data/*.json`); secrete `admin/src/lib/crypto-at-rest.ts` (`encryptSecret/decryptSecret` — parola SMTP criptată); UI `admin/src/app/{projects,companies,credentials}/page.tsx`. Brokerul n-are azi email (zero nodemailer) → îl adaugi.

**Pași**:
1. **Transport = Resend** (SMTP `smtp.resend.com:587`, user `resend`, pass = cheia `re_...`): `nodemailer`+`@types/nodemailer`; config în `data/email-config.json` (gitignored) `{smtp:{host:"smtp.resend.com",port:587,secure:false,user:"resend",passEnc:"enc:v1:...",fromDefault:"invoice@techbiz.ae"},verified,verifiedAt}` — `passEnc`=cheia Resend criptată; `getEmailConfig/saveEmailConfig/getTransporter` (cheia doar în memorie, niciodată logată). FROM trebuie pe domeniu verificat în Resend (techbiz.ae ✓; alte domenii = verifică-le în Resend întâi).
2. **Config per-proiect** în `ProjectMapping.invoiceEmail?` = `{enabled,fromName,fromAddress,bcc(default invoice@techbiz.ae),subjectTemplate,bodyTemplate(HTML),verified,verifiedAt}`. Placeholders `{{projectName/invoiceNumber/amount/currency/customerEmail/hostedInvoiceUrl/invoicePdfUrl/date}}`. Default editabil (FĂRĂ cuvântul „AI"): Subject „Factura {{invoiceNumber}} — {{projectName}}"; Body salut + „Îți mulțumim pentru plată." + nr + sumă/valută + linkuri Vezi factura/Descarcă PDF + footer. Backward-compat: lipsă `invoiceEmail` = off.
3. **Verificare prealabilă (obligatorie)**: niciun email live dacă `verified!==true`. Pași: validează format from/bcc → `transporter.verify()` → test-send real (FROM=fromAddress, TO=bcc, „[TEST] ...") → doar dacă toate trec `verified=true`. Schimbarea fromAddress/SMTP resetează `verified=false`.
4. **Cuplare webhook** (aditiv, non-blocking, idempotent): după callback-ul existent, pe `checkout.session.completed`+`payment.succeeded` (one-time → `invoices.retrieve(session.invoice)` sau `expand:['invoice']`) și `invoice.paid` (renewal → `event.data.object`): rezolvă projectSlug (din `session.metadata.projectSlug`/client_reference_id — vezi `api/checkout/route.ts`) → mapping → `!enabled` skip, `!verified` → BLOCKED_UNVERIFIED (fail-closed) → din invoice ia number/hosted_invoice_url/invoice_pdf/customer_email → idempotență pe `data/invoice-emails.json` (claim atomic PENDING pe invoice.id) → trimite from „{{fromName}} <{{fromAddress}}>" to=customer_email bcc=invoiceEmail.bcc → loghează SENT/FAILED. **Tot blocul în try/catch: eroarea de email NU schimbă HTTP-ul webhook-ului** (callback + 200/500 ca azi).
5. **UI admin**: secțiune „Email" (SMTP broker: host/port/secure/user/parolă write-only mascată criptată + „Verify"); în `projects/page.tsx` Edit modal secțiune „Invoice email" per-proiect (toggle, fromName, fromAddress, bcc prefill, editor subject/body + listă placeholders, „Send test" → §3, badge verified); pagină „Invoice emails" (log din `data/invoice-emails.json`: dată/proiect/invoiceNumber/to/bcc/status/eroare).
6. **Gitignore + deploy**: `.gitignore` += `data/email-config.json` + `data/invoice-emails.json`. SMTP prin `data/email-config.json` (criptat), nu `.env` (`STRIPE_DATA_KEY` deja în `.env.local`). Deploy (DEPLOY_REGISTRY row 14f): backup `data/*.json` în /tmp ÎNAINTE de `git pull` → `cd admin && npm install && npm run build && pm2 restart stripe-broker` (NU `--update-env`) → restore data/ dacă pull le-a atins. Smoke: /api/checkout 401 fără key, webhook 400 fără semnătură, admin 401→200 basic-auth, AVE app.techbiz.ae 200.
7. **Acceptance**: (1) SMTP „Verify" trece; (2) proiect `ave` test → enable + „Send test" → verified ✓; (3) checkout test → client primește email + BCC primește copia + rând SENT; (4) replay webhook → 1 singur SENT; (5) enabled dar `verified=false` → BLOCKED_UNVERIFIED zero email; (6) eroare SMTP → webhook normal (callback neafectat) + rând FAILED; (7) Stripe Dashboard auto-email OFF pe contul testat.
8. **Out of scope**: nu schimba callback-ul HMAC; nu `stripe.invoices.sendInvoice`; fără „AI" în textul client.

**🔬 VERIFY (de rulat DUPĂ implementare + deploy pe stripe.knowbest.ro — NU acum)**:
- **Precondiții**: pagina „Email" (Resend) salvată + Verify verde (test ajuns la inbox); proiect `ave` cu Invoice email enabled + From techbiz.ae + BCC + Send test ✓; `ave` pe TEST (brokerEnv=test); acces la inbox-ul BCC.
- **P1 Smoke prod (read-only)**: `POST /api/checkout` fără key → **401**; `POST /api/stripe/webhook/techbiz-uae` fără sig → **400**; `GET /projects` fără auth → **401**; `GET app.techbiz.ae/` → **200**.
- **P2 Plată TEST ave**: unlock cu billing pe app.techbiz.ae → Stripe Checkout TEST card `4242 4242 4242 4242` (dată viitoare, CVC orice), email la care ai acces. SAU `POST /api/checkout` cu X-Project-Key ave + invoicing:true + billing → finalizează cu 4242.
- **P3 Confirmă 4**: (a) clientul primește emailul (TO din checkout) cu nr factură + linkuri Vezi factura/PDF funcționale; (b) `invoice@techbiz.ae` primește copia BCC; (c) pagina „Facturi trimise" → rând SENT (ave/invoiceNumber/to/bcc); (d) callback AVE a mers (auditul deblocat — emailul e additiv, n-a blocat fluxul).
- **P4 Idempotență**: Resend webhook (`checkout.session.completed`) din Dashboard → NU pleacă al 2-lea email, rămâne 1 rând SENT.
- **P5 Fail-closed**: proiect enabled=true dar `verified=false` → plată → status BLOCKED_UNVERIFIED + zero email.
- **P6 (opțional) SMTP down non-blocking**: cheie Resend greșită temporar pe un proiect de test → webhook răspunde normal (callback neafectat) + rând FAILED → repui cheia.
- **P7 Un singur emitent**: în Stripe Dashboard (techbiz-uae) „Email finalized invoices to customers" = **OFF**.
- **Regula**: dacă vreun pas pică → NU declara done; loghează HTTP/eroarea exactă + remediază la sursă (fix cod broker = NO-TOUCH propose-confirm-apply + re-smoke).

---

## [ ] 🧾 BUILD — Browser facturi Stripe (istoric, per firmă) — cerut user 2026-06-29

> **NO-TOUCH CRITIC** (broker deține `sk_live_`) → propose-confirm-apply, backup `data/`, smoke pe prod. Additiv, read-only (NU emite/modifică facturi).
> **Origine**: user a observat că tab-ul „Facturi trimise" e doar log de emailuri trimise, nu un browser al facturilor emise. Acesta e feature-ul complementar.

**OBIECTIV**: un tab nou „Facturi" care listează facturile Stripe emise, per firmă (companySlug) + per mediu (test/live), aducându-le din Stripe API cu cheia firmei (din broker). Read-only: sumă, status (paid/open/void/uncollectible), client (email/nume), dată, link hosted + PDF, nr factură. Filtru per firmă + per status + paginare.

**Context tehnic (citește înainte)**:
- Cheile firmelor: `admin/src/lib/data.ts` `getCredentials(companySlug)` → `{test,live}.secretKey` (decriptat at-rest). Firme: `getCompanies()`. Mapări proiect→firmă: `getProjectMappings()`.
- Stripe SDK deja prezent (`stripe` în admin). `new Stripe(secretKey).invoices.list({ limit, starting_after, status? })` → paginare cursor.
- Middleware gate-uiește deja orice rută admin (localhost / nginx basic-auth). Pattern UI: vezi `admin/src/app/invoice-emails/page.tsx` (tabel) + `companies/page.tsx`.

**Pași**:
1. **API** `GET /api/invoices?company=<slug>&env=<test|live>&status?=<...>&starting_after?=<id>` → rezolvă cheia firmei (getCredentials), `stripe.invoices.list({limit:50, ...})`, mapează la `{id, number, status, customerEmail, customerName, amountDue, amountPaid, currency, created, hostedInvoiceUrl, invoicePdf}` + `has_more` + `next` cursor. Fail clar dacă firma n-are cheie pe env-ul cerut. NU expune secretKey.
2. **UI** tab nou `/invoices` (+ link în `layout.tsx`): selector firmă (din /api/companies) + toggle test/live + filtru status + tabel (dată/nr/client/sumă/status/link-uri Vezi+PDF) + buton „Mai multe" (paginare cursor). Buton refresh.
3. **(opțional)** badge per rând dacă există rând SENT în invoice-emails log (corelează „factura asta a fost și emailată?").
4. **Gitignore/deploy**: nimic nou de gitignored (read-only din Stripe). Deploy = recipe row 14f (backup data → pull → npm install → build → restart) + smoke.
5. **Acceptance**: (1) selectezi techbiz-uae + live → apar facturile reale (inclusiv AED 22 AVE); (2) link Vezi/PDF funcționează; (3) firmă fără cheie pe env → mesaj clar, nu crash; (4) paginare „Mai multe" aduce următoarea pagină; (5) smoke prod 401/400/401/200 neschimbat; (6) secretKey niciodată în răspuns.

**Out of scope**: nu emite/anula/plăti facturi (read-only); fără „AI" în UI.

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
