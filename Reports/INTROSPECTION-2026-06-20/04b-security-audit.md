# Audit Securitate (Cyber) — Stripe Broker

> **Data:** 2026-06-20 · **Scope:** READ-ONLY (audit + propuneri, ZERO modificări) · **Țintă:** `admin/` Checkout Broker (LIVE `stripe.knowbest.ro:3025`)
> **MONEY-PATH** — brokerul ține cheile Stripe ale tuturor firmelor și mișcă bani reali. Auditul extern AIWebAuditor a fost SĂRIT intenționat (panoul e în spatele nginx basic-auth, nu e accesibil neautenticat).

---

## 🗣️ Pe înțelesul tău + implicații (non-tehnic)

Brokerul ăsta e seiful comun de chei Stripe al ecosistemului tău. Toate aplicațiile (BlocHub, Tutor, knowbest, utilajhub, AVE...) NU mai țin chei Stripe — cer brokerului „fă-mi un checkout" și el o face cu cheia firmei potrivite. Asta e foarte bine ca design (un singur loc de protejat în loc de zece), DAR exact de-asta seiful trebuie să fie foarte solid.

**Ce am verificat, pe scurt:**
- ✅ **Lucrurile de bază sunt corecte.** Webhook-urile de la Stripe sunt verificate cu semnătură pe body-ul brut (nu pot fi falsificate). Plățile duplicate nu se procesează de două ori. Cheile NU sunt urcate în git (sunt gitignorate). Panoul admin e blocat în spatele unei parole (nginx basic-auth). Brokerul nu trimite callback-uri decât către adrese http(s) (nu poate fi păcălit cu `file://`).
- ⚠️ **Riscul real e în trei fundații, nu în funcții.** (1) Cheile Stripe stau în **text simplu** într-un fișier pe server — gitignorate, dar oricine ajunge pe disc le citește direct. (2) Magazinul de date e un fișier JSON fără „lacăt", deci două operații strict-simultane se pot călca pe coadă. (3) Panoul îți arată cheile secrete complete în browser (acceptabil pentru că ești singurul cu parola, dar nu e ideal).
- 🟡 **O dependență (Next.js) are o vulnerabilitate HIGH** care atinge chiar mecanismul de parolă al panoului — se rezolvă cu o singură comandă de update.

**Implicație practică:** azi, în mod test + în spatele parolei nginx, **nu ești în pericol imediat**. Dar înainte de a pune chei LIVE (`sk_live_`) și a încasa bani reali, cele trei fundații (criptare chei, lacăt pe fișier, update Next.js) merită o sesiune dedicată. Nu e nimic de tăiat — doar de întărit.

---

## Constatări (severitate · dovadă · PROPUNERE)

### 🔴 S1 — Chei Stripe în text simplu pe disc (HIGH / money-path)
- **Dovadă:** `data/credentials.json` conține `sk_test_…`, `pk_test_…`, `whsec_…` în clar (verificat: cheia `class-rda.test.secretKey` e un `sk_test_` lizibil). Scrise/citite de `admin/src/lib/data.ts` (`getAllCredentials`/`saveAllCredentials`) fără nicio criptare. Fișierul e **gitignorat** (`.gitignore` → `data/credentials.json`) ✅, dar **necriptat la repaus**.
- **Risc:** orice acces la disc (backup necriptat, exfiltrare server, greșeală de permisiuni, snapshot VPS) = expunere directă a cheilor care mișcă bani. La trecerea pe `sk_live_` devine CRITIC.
- **PROPUNERE:** criptare la repaus AES-256-GCM cu cheie master din env/systemd-creds (envelope encryption), decriptare just-in-time la checkout/refund/webhook. Pas următor ideal: vault dedicat (Vault/Infisical/KMS). Permisiuni `chmod 600` pe `data/` + verifică retenția backup-urilor (vezi S7 + S9).

### 🔴 S2 — Dependență Next.js cu vulnerabilitate HIGH ce atinge auth-ul panoului (HIGH)
- **Dovadă:** `npm audit` în `admin/` → `next` HIGH, familia de advisory-uri include **„Middleware / Proxy bypass in App Router applications"** (GHSA-26hh-7cqf-hhc6, GHSA-492v-c6pp-mqqv, GHSA-267c-6grr-h53f). Versiune instalată în range-ul vulnerabil (`^15.0.0`). Auth-ul admin al brokerului ESTE implementat în `admin/src/middleware.ts` → un bypass de middleware poate ocoli gate-ul de autentificare.
- **Risc:** dacă bypass-ul se aplică, suprafața admin (chei Stripe, refund-uri) ar putea deveni atinsă chiar prin App Router, chiar dacă nginx basic-auth rămâne primul strat. Plus `postcss` + `qs` moderate.
- **PROPUNERE:** `cd admin && npm audit fix` (bump Next la ultima 15.x), apoi `npm run build` + smoke pe `stripe.knowbest.ro`. NU lăsa auth-ul money-path să depindă de o versiune Next vulnerabilă. nginx basic-auth rămâne al doilea strat — păstrează-l.

### 🟠 S3 — Cheile secrete sunt returnate în browser de API-urile admin (MEDIUM)
- **Dovadă:** `GET /api/companies` (`admin/src/app/api/companies/route.ts:6-11`) face `enriched` cu `getCredentials(c.slug)` → întoarce `sk_/whsec_` complet pentru fiecare firmă. `GET /api/credentials?slug=` (`credentials/route.ts:8`) la fel. Pagina maschează vizual (`maskKey`, input `type=password`) DAR valoarea plaintext circulă în răspunsul HTTP și e în memoria browserului.
- **Risc:** încalcă least-privilege; orice XSS pe panou, extensie de browser compromisă, sau log de proxy ar capta cheile complete. Atenuat de basic-auth, dar nu e zero.
- **PROPUNERE:** API-urile întorc valori mascate + `hasSecret: true`; plaintextul doar la un endpoint „reveal" explicit, audit-logat, niciodată în listarea de firme. Salvarea poate accepta „neschimbat" (nu retrimite cheia ca să o re-salvezi).

### 🟠 S4 — `STRIPE_ADMIN_PROXY_AUTH=1` dezactivează complet gate-ul aplicației (MEDIUM)
- **Dovadă:** `middleware.ts` — când `STRIPE_ADMIN_PROXY_AUTH === '1'` (setat pe prod, din DEPLOY_REGISTRY) → `NextResponse.next()` necondiționat pentru tot ce nu e public. Întreaga securitate a suprafeței admin depinde 100% de nginx basic-auth.
- **Risc:** single point of failure — dacă nginx e reconfigurat greșit, vhost-ul e bypassuit (vezi incidentul `procu.4pro.io` 502 din escaparea `$`), sau cineva lovește direct `127.0.0.1:3025`, NU mai există niciun strat aplicativ. Brokerul „se încrede orbește" în proxy.
- **PROPUNERE:** defense-in-depth — păstrează basic-auth, dar lasă și un al doilea factor în app (ex. `x-admin-token` verificat MEREU, chiar și cu proxy-auth on), SAU leagă portul 3025 strict pe `127.0.0.1` (UFW + `next start -H 127.0.0.1`) ca să nu fie atins direct. Confirmă că 3025 nu e expus extern.

### 🟠 S5 — File-store fără lock → lost-update pe money-path (MEDIUM)
- **Dovadă:** `broker.ts:85-89` `writeStore` = `fs.writeFileSync` non-atomic, fără lock. `updateCheckoutSession` face read-modify-write (re-citește, dar fără lock între read și write). La două webhook-uri strict-concurente pentru aceeași firmă, scrierile se pot suprascrie → `processedEventIds`/`callbackSecret`/`dispatched` se pot pierde. Recunoscut onest în `AUDIT_GAPS` (G-STRIPE-010 rezidual) + documentat la consumator ca „dedupe pe sessionId".
- **Risc:** în cel mai rău caz, un eveniment marcat „neprocesat" din cauza unei scrieri pierdute → callback dublu către consumator (atenuat de dedupe-ul cerut consumatorului) sau un fișier half-written la crash → store corupt.
- **PROPUNERE:** scriere atomică (`tmp` + `rename`) + lock de fișier, SAU migrare la SQLite (un writer, tranzacții — rezolvă și idempotency-în-tranzacție). Vezi `03-deep-research` #4 + #7.

### 🟡 S6 — Callback broker→consumer fără timestamp/replay-protection (LOW-MEDIUM)
- **Dovadă:** `broker.ts:signCallback` = HMAC-SHA256 pe body, fără `t=<unix>` în payload sau string-to-sign. `BrokerCallbackPayload` (`broker.ts:58-68`) nu are câmp de timp/nonce. Documentul cere consumatorului verificare timing-safe + dedupe pe sessionId, dar NU o fereastră de timp.
- **Risc:** un callback semnat interceptat poate fi re-trimis oricând mai târziu (replay). Atenuat de faptul că payload-ul e idempotent pe sessionId la consumator, dar standardul 2026 e HMAC + timestamp (≤5 min) + nonce.
- **PROPUNERE:** adaugă `t` (unix) în payload + în calculul HMAC; consumatorul respinge `now - t > 300s`. Adaugă `version` la contract pentru evoluție.

### 🟡 S7 — Validare inbound: brokerul semnează, dar nu verifică inbound HMAC pe niciun endpoint propriu non-Stripe (LOW)
- **Dovadă:** singura verificare de semnătură e pe webhook-ul Stripe (`webhook/[companySlug]/route.ts:58` `constructEvent` pe raw body) ✅. `/api/checkout` + `/api/refund` se autentifică DOAR cu `x-project-key` în clar (header), fără semnătură/timestamp. `findMappingByApiKey` compară cheia cu `===` (nu timing-safe).
- **Risc:** un project-key scurs (din log, din clientul consumator) permite crearea de checkout-uri / refund-uri pe acel proiect. Comparația non-timing-safe e teoretică (key lung random), dar e o slăbiciune de igienă.
- **PROPUNERE:** comparație timing-safe pe `apiKey` (`crypto.timingSafeEqual`), rate-limiting per-key pe `/api/checkout` + `/api/refund` (vezi `03` #13), și `Idempotency-Key` pe apelurile Stripe de creare ca un retry să nu dubleze sesiunea/refundul (`03` #15). Tratează project-key ca secret (rotire la nevoie).

### 🟢 S8 — Lucruri CORECTE (confirmate, fără acțiune)
- ✅ **Verificare semnătură Stripe pe raw body** (`request.text()` → `constructEvent`) — corect, nu parsează JSON înainte.
- ✅ **Idempotency pe `processedEventIds`** + 500-pe-eșec-callback ca Stripe să reîncerce (durable retry) — pattern corect.
- ✅ **Toate `data/*.json` runtime gitignorate** (`credentials.json`, `companies.json`, `project-mappings.json`, `checkout-sessions.json`); doar `ecosystems.json` (curare statică, fără secrete) e tracked. Verificat: `git ls-files data/` → doar `ecosystems.json`.
- ✅ **`callbackUrl` restricționat la http(s)** (`checkout/route.ts:59-64`) — blochează `file://`/`data:`.
- ✅ **Guard pe VAT rate** ([0,1]) + email regex + `projectSlug` match cu key-ul — validări de input prezente.
- ✅ **`mode:'payment'` hosted Checkout** → menține eligibilitatea PCI **SAQ A** (Stripe ține datele cardului; brokerul nu vede niciodată PAN).
- ✅ **Refund izolat pe proiect** (`refund/route.ts:41` — un project-key refundează doar sesiunile lui) + idempotent pe `charge_already_refunded`.

---

## Acțiuni care necesită USER

1. **Decizie key-management înainte de `sk_live_`** (S1): criptare la repaus (rapid) vs. vault dedicat (robust). Necesită alegerea unei strategii + (dacă vault) provisioning. Sesiune dedicată — money-path.
2. **`npm audit fix` pe `admin/` + redeploy** (S2): bump Next 15.x, rebuild, smoke pe `stripe.knowbest.ro`. Confirmă-mi când vrei să-l facem (atinge prod LIVE — propose-confirm-apply).
3. **Confirmă că portul 3025 NU e expus extern** (S4): verifică UFW pe VPS2 (`ufw status` → 3025 blocat din afară, doar nginx îl atinge pe `127.0.0.1`). Dacă nu, leagă-l strict pe localhost.
4. **Decizie pe expunerea cheilor în browser** (S3): accept-as-is (sub basic-auth) vs. mascare + reveal-endpoint. E o schimbare de UI/API a panoului — confirmă dacă o vrei.
5. **Activare backup automat `data/` + retenție** (S9/S1): mappings/credentials sunt gitignorate → NU se recuperează din git. Confirmă unde vrei backup-urile (criptate) + retenția.

> Toate constatările de mai sus sunt strict propuneri. Nicio modificare nu a fost aplicată. Modificările pe `admin/` LIVE money-path trebuie făcute prin propose-confirm-apply.
