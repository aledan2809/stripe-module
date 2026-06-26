# 00 — SUMMARY (pe limbaj simplu) — Stripe Broker

> **Data:** 2026-06-20 · **Proiect:** `@projects/stripe-module` + sub-app `admin/` (Checkout Broker, LIVE `stripe.knowbest.ro:3025`) · **Scope:** introspecție READ-ONLY, doar propuneri, zero modificări, zero funcții tăiate.
> Acest fișier rezumă cele 4 deliverabile: `01-gap-strategy-vs-code`, `02-pages-guide-RO`, `03-deep-research-optimization`, `04b-security-audit`.

---

## Ce e, în două fraze

Brokerul Stripe e **coloana vertebrală a banilor** din tot ecosistemul tău. Toate aplicațiile (AVE, BlocHub, Tutor, knowbest, utilajhub, PRO, eCabinet, Offer...) NU mai țin chei Stripe — cer brokerului „fă-mi un checkout / un refund" și el le face cu cheia firmei potrivite, apoi le anunță înapoi printr-un callback semnat. Un singur seif de protejat în loc de zece.

## Verdictul în trei rânduri

1. **Funcționează și e verificat** — cele 3 părți ale contractului (checkout → webhook → callback HMAC) sunt implementate corect, E2E 11/11 + pilot AVE real în mod test. Lucrurile de bază de securitate sunt corecte (semnătură pe webhook, idempotency, chei gitignorate, panou în spatele parolei nginx).
2. **Codul a luat-o mult înaintea documentației** — brokerul a crescut de la „checkout" la o platformă întreagă de billing (rambursări, facturare TVA, sincronizare Legal, auto-setup firmă, atribuire pe ecosistem). Contractul documentat acoperă ~30% din ce face de fapt. Regula: **ridicăm documentația la nivelul codului, NU tăiem funcții** — toate sunt bune și deja folosite.
3. **Riscul real e în trei fundații, nu în funcții** — (a) cheile Stripe stau în **text simplu** pe disc, (b) magazinul de date e un fișier JSON fără lacăt (două operații simultane se pot călca), (c) o dependență Next.js are o vulnerabilitate HIGH care atinge chiar mecanismul de parolă al panoului. Niciunul nu te pune în pericol imediat (mod test + parolă nginx), dar toate trei trebuie întărite **înainte de chei LIVE** (`sk_live_`).

## Securitate — pe scurt

| # | Constatare | Sev | Stare |
|---|---|---|---|
| S1 | Chei Stripe în text simplu pe disc (gitignorate, dar necriptate) | 🔴 HIGH | de criptat înainte de LIVE |
| S2 | Next.js vulnerabilitate HIGH (familia middleware-bypass — atinge auth-ul panoului) | 🔴 HIGH | `npm audit fix` + redeploy |
| S3 | API-urile admin întorc cheile secrete complete în browser | 🟠 MEDIUM | mascare + reveal-endpoint |
| S4 | `STRIPE_ADMIN_PROXY_AUTH=1` dezactivează gate-ul aplicației (depinde 100% de nginx) | 🟠 MEDIUM | defense-in-depth + confirmă port closed |
| S5 | File-store fără lock → lost-update pe sesiuni concurente | 🟠 MEDIUM | atomic write/lock sau SQLite |
| S6 | Callback fără timestamp/replay-protection (doar HMAC) | 🟡 LOW-MED | adaugă `t=` + fereastră 5 min |
| S7 | project-key în clar, comparație non-timing-safe, fără rate-limit | 🟡 LOW | timing-safe + rate-limit + idempotency-key |
| S8 | Corecte: webhook raw-body, idempotency, data gitignorat, http(s)-guard, SAQ A, refund izolat | 🟢 OK | fără acțiune |

**Verdict securitate:** Solid pentru scara curentă (test + nginx basic-auth). **NU LIVE-ready până nu se rezolvă S1 + S2 + S4** (criptare chei + update Next + confirmare port localhost-only). Aceasta e zona money-path — orice modificare pe prod se face prin propose-confirm-apply.

## Optimizări & WOW (din `03`)

Top fundații de ridicat: criptare chei la repaus (envelope/vault), migrare la SQLite (rezolvă concurența + idempotency-în-tranzacție), `npm audit fix`, replay-protection pe callback, audit-log money-path. WOW realiste: smart-routing multi-provider (al doilea PSP RON-local ca fallback), dashboard reconciliere bani-vs-Legal, onboarding self-service (un click → keys + recipe), webhook-replay harness, mod „dry-run" pentru piloți fără bani reali.

## Ce trebuie de la tine (USER)

1. Decizie strategie key-management înainte de `sk_live_` (criptare rapidă vs. vault).
2. OK pentru `npm audit fix` pe `admin/` + redeploy (atinge prod LIVE).
3. Confirmă că portul 3025 nu e expus extern (UFW pe VPS2).
4. Decizie pe mascarea cheilor în browser.
5. Activare backup automat criptat al `data/` + retenție (mappings/credentials NU se recuperează din git).

> **Reamintire:** toate deliverabilele sunt analiză + propuneri. Zero modificări aplicate. Zero funcții tăiate (cod-înainte-de-docs = documentație de ridicat, nu funcție de șters).
