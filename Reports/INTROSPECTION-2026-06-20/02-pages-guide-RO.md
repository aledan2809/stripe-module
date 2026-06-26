# Ghid pe pagini — Stripe Broker (admin)

> **Data:** 2026-06-20 · **Scope:** READ-ONLY · App: `admin/` (Next.js, LIVE `stripe.knowbest.ro:3025`, pm2 id 48)
> **Acces:** întregul panou admin e protejat de **nginx basic-auth** (user=email; vezi `credentials/stripe-broker.env`). Endpoint-urile publice (`/api/checkout`, `/api/stripe/webhook/*`) NU sunt sub basic-auth — au propria autentificare (project-key / semnătură Stripe).
> Toate paginile sunt componente client (`'use client'`) care citesc/scriu prin API-urile admin (`/api/companies`, `/api/credentials`, `/api/projects`, `/api/legal/sync`).

---

## `/` — Dashboard (`page.tsx`)
- **Rol:** pagina de start — vedere de ansamblu. Afișează 4 contoare (firme înregistrate, proiecte asignate, proiecte în mod test, proiecte în mod live) + listă cu firmele și câte proiecte are fiecare + indicatori (puncte verzi/gri) pentru cheile test/live prezente.
- **Butoane / acțiuni:** „+ Adaugă firmă" (link → `/companies`); click pe un card de firmă → `/companies`.
- **Impact:** doar citire (`GET /api/companies` + `GET /api/projects`). Nu modifică nimic — e tabloul de bord.

## `/companies` — Firme (`companies/page.tsx`)
- **Rol:** CRUD pe firmele (entitățile juridice) care încasează prin broker — nume, CUI, adresă, IBAN, plătitor de TVA, cotă TVA, monedă, țară. Aici se introduc/editează și **cheile Stripe** ale firmei (test + live: secret/publishable/webhook).
- **Butoane / acțiuni:** „+ Adaugă firmă"; „Auto-completare din cheie Stripe" (`POST /api/auto-setup` — trage nume/CUI/IBAN/adresă/balanță din contul Stripe); „Testează conexiunea" (`POST /api/test-connection`); copy-to-clipboard pe câmpuri; salvare (`POST /api/companies` + `POST /api/credentials`); ștergere (`DELETE`). Cheia secretă e mascată în UI (`maskKey`, input `type=password`).
- **Impact:** **money-path direct** — scrie chei Stripe în `data/credentials.json` (text simplu pe disc). `GET /api/companies` întoarce cheile complete în browser (acceptabil doar sub basic-auth). Ștergerea unei firme curăță și mapările + credențialele ei.

## `/credentials` — Credențiale (`credentials/page.tsx`)
- **Rol:** editor dedicat de chei Stripe per firmă, pe medii test + live (secretKey `sk_`, publishableKey `pk_`, webhookSecret `whsec_`). Selectezi firma, vezi/editezi cheile.
- **Butoane / acțiuni:** selectează firmă (`GET /api/credentials?slug=`); „Testează" per mediu (`POST /api/test-connection`); copy pe fiecare cheie; salvare (`POST /api/credentials`). Secretul e mascat (`type=password` + `maskKey` 7 caractere + `••••` + ultimele 4).
- **Impact:** **cel mai sensibil ecran** — aici stau cheile care mișcă banii. Conține și whsec-urile cu care brokerul validează webhook-urile Stripe. O cheie greșită aici → checkout-uri 404 sau webhook-uri respinse.

## `/projects` — Proiecte / Mapări (`projects/page.tsx`)
- **Rol:** leagă fiecare proiect (descoperit pe disc / din ecosisteme) de firme: **subscriptionCompany** (cine încasează abonamentul SaaS), **serviceCompany** (cine procesează plățile de servicii), **brokerCompany** (a cărei cheie o folosește brokerul la checkout) + mediul. Aici se generează **cheile de broker per-proiect** (`apiKey` = `pk_proj_…`, `callbackSecret` = `cbs_…`) pe care le primește app-ul consumator.
- **Butoane / acțiuni:** salvare mapare (`POST /api/projects` — generează keys o singură dată, le păstrează la editări dacă nu ceri explicit `regenerateBrokerKeys`); ștergere mapare (`DELETE`); toggle `brokerEnabled` (kill-switch → checkout 503); copy pe chei. Cheile generate se afișează O SINGURĂ dată după salvare.
- **Impact:** money-path indirect — cine activează un proiect și pe ce firmă. `apiKey`/`callbackSecret` sunt secrete partajate cu consumatorul → trebuie copiate atent (apar în răspunsul API).

## `/legal` — Legal Sync (`legal/page.tsx`)
- **Rol:** reconciliază firmele + maparea proiect→biller cu hub-ul **Legal** (`legal.knowbest.ro`, sursa de adevăr pentru identitatea juridică). Afișează diferențe (drift) Legal↔Stripe pe câmpuri (nume/CUI/adresă/email/țară/monedă) + flag-uri (entitate în Legal lipsă în Stripe, firmă orphan în Stripe, biller fără chei Stripe).
- **Butoane / acțiuni:** „🔄 Sync din Legal (preview)" (`POST /api/legal/sync?preview=1` — arată ce s-ar crea/actualiza, scrie nimic); „✓ Aplică sync" (`POST /api/legal/sync` — face upsert firmelor din Legal, **niciodată nu suprascrie** cheile/mediul Stripe); „↻ Reîncarcă"; copy. Mapările proiect→biller NU se aplică aici — se confirmă separat în `/projects`.
- **Impact:** Stripe nu scrie niciodată înapoi în Legal (Legal cere review uman). Aplicarea schimbă doar câmpurile de identitate ale firmelor, nu cheile.
