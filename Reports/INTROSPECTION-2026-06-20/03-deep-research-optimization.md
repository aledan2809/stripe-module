# Deep Research — Optimizare & WOW Effect

> **Data:** 2026-06-20 · **Scope:** READ-ONLY (cercetare + propuneri, zero modificări) · **Subiect:** Stripe Checkout Broker (`stripe.knowbest.ro:3025`) — backbone-ul de plăți al ecosistemului
> **Metodă:** benchmark vs. pattern-uri de payment-orchestration / multi-tenant Stripe / merchant-of-record + best practices 2026 (idempotency webhook, minimizare scope PCI, key management, izolare multi-tenant). Surse citate la final.

---

## 0. Ce e brokerul, raportat la industrie

Brokerul tău este, în termeni de industrie, un **payment orchestration layer light + key vault centralizat**: prezintă un singur API (`/api/checkout`) către toate app-urile, normalizează providerul de dedesubt (azi doar Stripe), ține cheile tuturor firmelor într-un loc și rutează fiecare tranzacție către contul Stripe potrivit pe baza `projectSlug`. Stripe rămâne procesatorul; **firma rămâne merchant-of-record** (răspunde de TVA, chargeback, fraudă) — exact poziția pe care Stripe o descrie pentru gateway-uri vs. MoR ([Stripe — orchestration vs gateway](https://stripe.com/resources/more/payment-orchestration-vs-payment-gateway), [Dodo — Is Stripe a MoR?](https://dodopayments.com/blogs/stripe-vs-merchant-of-records)).

Verdict de poziționare: ai construit un **orchestrator mono-provider, multi-tenant, cu store fișier** — corect pentru scara curentă (ecosistem propriu, câteva firme), dar cu trei fundații care trebuie ridicate la nivel „money-path" înainte de `sk_live_`: **key-management**, **concurența store-ului**, și **PCI scope discipline**.

---

## 1. Top optimizări (prioritizate)

### Securitate & key-management (cel mai important pe money-path)

1. **Criptare la repaus a cheilor Stripe (envelope encryption).** `data/credentials.json` ține `sk_` în text simplu pe disc. Standardul 2026 pentru SaaS multi-tenant e **AES-256 la repaus + chei unice per tenant** + envelope encryption ca să nu treci fiecare operație prin vault ([Awssome](https://www.awssome.io/blog/multi-tenant-saas-security-encryption-faqs), [Azure Key Vault best practices](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/service/key-vault)). Minim viabil: cheie master într-o variabilă de mediu (sau systemd-creds) + AES-256-GCM peste valorile `secretKey/webhookSecret`, decriptare just-in-time la checkout. Ideal: vault dedicat (Infisical/Vault/KMS).
2. **Nu mai întoarce cheile secrete în browser.** `GET /api/companies` (`getCredentials` enriched) și `GET /api/credentials` returnează `sk_` complet în răspuns. Chiar și sub basic-auth, principiul e **least-privilege** ([WorkOS — cryptographic key isolation](https://workos.com/blog/cryptographic-key-isolation-multi-tenant-saas)). Întoarce mascat (`sk_test_••••1234`) + un flag `hasSecret:true`; valoarea plaintext doar la „reveal" explicit, audit-logat.
3. **Audit log + monitorizare centralizată.** Niciun log de „cine a citit/scris ce cheie / cine a făcut refund". Best practice multi-tenant: logging centralizat + audit periodic ([Awssome](https://www.awssome.io/blog/multi-tenant-saas-security-encryption-faqs)). Adaugă un append-only ledger pentru operațiile money-path (checkout creat, refund emis, cheie editată).

### Robustețe webhook & callback

4. **Idempotency în aceeași tranzacție cu efectul.** Brokerul marchează `processedEventIds` DUPĂ dispatch reușit — corect ca intenție, dar store-ul fișier nu e tranzacțional. Best practice: înregistrarea idempotency + munca de business în **aceeași tranzacție**, altfel un crash între ele lasă „fulfilled-but-not-recorded" ([Stigg](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks)). Cu SQLite (vezi #7) asta devine un `INSERT … ON CONFLICT` + update în aceeași tranzacție.
5. **Replay-protection pe callback-ul broker→consumer.** Azi semnezi corect HMAC, dar fără timestamp/nonce. Standardul 2026: **HMAC + timestamp (fereastră ≤5 min) + nonce/idempotency** ([webhooks.fyi](https://webhooks.fyi/security/replay-prevention), [Hooklistener](https://www.hooklistener.com/learn/webhook-security-guide), [FreelyIT](https://www.freelyit.nl/en/blog/api-security-best-practices-2026-03-21)). Adaugă `t=<unix>` în payload + în string-to-sign; consumatorul respinge dacă `now - t > 300s`. Tu deja documentezi „dedupe pe sessionId" la consumator — completează cu fereastra de timp.
6. **Răspuns webhook rapid + coadă.** Brokerul face `dispatchCallback` (până la 3 încercări + backoff) **inline** în handlerul de webhook — dacă consumatorul e lent, te apropii de fereastra de 10s a Stripe ([Stigg](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks), [HookRay](https://hookray.com/blog/stripe-webhook-best-practices-2026)). Pattern: verifică semnătura → enqueue (BullMQ/SQS) → 200 imediat → worker face dispatch + retry durabil. La volumul curent merge inline, dar e prima limită de scalare.

### Store & concurență

7. **Migrare la SQLite (sau atomic write + lock).** `data/checkout-sessions.json` + `credentials.json` se scriu cu `fs.writeFileSync` non-atomic, fără lock → **lost-update** la scrieri concurente + risc de fișier half-written la crash. Best practice: scriere atomică (`tmp` + `rename`) cu fallback recuperabil, SAU SQLite (un singur writer, reads concurente, tranzacții) ([DEV — crash-safe JSON](https://dev.to/constanta/crash-safe-json-at-scale-atomic-writes-recovery-without-a-db-3aic), [pl-rants — road to SQLite](https://pl-rants.net/posts/when-not-json/), [oneuptime — SQLite in Node](https://oneuptime.com/blog/post/2026-02-02-sqlite-nodejs/view)). SQLite rezolvă în plus #4 (tranzacționalitate idempotency).

### Dependențe & PCI

8. **`npm audit fix` pe Next.js (HIGH).** Familia de advisory-uri include **Middleware/Proxy bypass în App Router** — exact mecanismul pe care brokerul îl folosește pentru auth gate (`middleware.ts`). Bump la ultima 15.x (`npm audit fix`). Detaliu în `04b-security-audit.md` S8.
9. **Păstrează SAQ A — checkout minimal, fără script-uri.** Folosești Stripe Checkout hosted → califici pentru **SAQ A** (30 întrebări vs 330 la SAQ D) pentru că Stripe gestionează datele cardului ([Stripe PCI guide](https://stripe.com/guides/pci-compliance), [cside](https://cside.com/blog/can-you-use-stripe-for-pci-dss)). ⚠️ 2026: orice tag de marketing/analytics pe pagina de checkout poate escalada la **SAQ A-EP** ([episki](https://www.episki.com/now/pci-for-ecommerce), [pcicompliancecost](https://pcicompliancecost.com/saq-a-cost)). Tu redirectezi spre `session.url` (pagina Stripe) — bun; **documentează explicit** că app-urile consumatoare NU pun analytics pe pagina lor de success/cancel care interceptează fluxul.
10. **Validare per-firmă a webhook-secret pe medii.** Webhook-ul încearcă test apoi live cu `sk_placeholder` când lipsește secretKey — funcțional, dar logghează când o firmă are whsec fără secretKey (config incompletă) ca să prinzi din timp greșelile de setup.

### Operațional & DX

11. **Health/observability endpoint pentru money-path.** Un `/api/health` care raportează: câte sesiuni `created` vechi de >24h fără rezultat (checkout-uri abandonate), rata de callback-uri eșuate, firme cu config incompletă. Orchestratoarele mature monitorizează exact aceste KPI ([GR4VY](https://gr4vy.com/posts/payment-orchestration-2026/)).
12. **Versionarea contractului de callback.** Adaugă `version: "1"` în payload-ul de callback — îți permite să schimbi schema fără a sparge consumatorii deja conectați.
13. **Rate-limiting pe `/api/checkout`.** Endpoint public autentificat doar cu project-key; un key compromis poate genera sesiuni la infinit. Limită per-key (ex. N/min).
14. **Backup automat al `data/` înainte de fiecare deploy.** Deploy-ul deja face `cp data/*.json /tmp` manual (din DEPLOY_REGISTRY) — codifică-l ca pas în script + retenție (mappings/credentials sunt gitignorate, deci NU se recuperează din git).
15. **Idempotency-key pe apelurile Stripe de creare.** `checkout.sessions.create` / `refunds.create` ar trebui să primească un `Idempotency-Key` (ex. `brokerRef`) ca un retry de rețea să nu creeze două sesiuni/două refund-uri.

---

## 2. Idei „WOW" (5)

1. **Smart-routing multi-provider (ca un orchestrator real).** Azi e mono-Stripe. Pattern-ul 2026 e rutare către cel mai bun provider pe baza datelor în timp real + failover ([OCNJ Daily](https://ocnjdaily.com/uncategorized/payment-orchestration-in-2026-how-smart-routing-and-multi-provider-architecture-drive-higher-approval-rates/), [GR4VY](https://gr4vy.com/posts/payment-orchestration-2026/)). WOW realist pentru ecosistemul tău: un al doilea provider RON-local (ex. Netopia/PayU) ca fallback când Stripe e indisponibil/scump pe o monedă — brokerul tău e deja locul perfect, pentru că app-urile nu țin chei.

2. **Dashboard de reconciliere bani-vs-Legal live.** Ai deja Legal-sync care semnalează drift de identitate. WOW: extinde-l la un „money-reconciliation" — pentru fiecare firmă, soldul Stripe (`balance.retrieve`, deja apelat în auto-setup) lângă maparea Legal + alertă „biller fără chei" / „firmă încasează dar fără entitate Legal". O singură pagină care răspunde la „cine încasează, cât, pe ce entitate juridică".

3. **Self-service onboarding consumator (un click → keys + recipe).** Azi operatorul generează manual `apiKey`/`callbackSecret`. WOW: un buton „Conectează app X" care generează cheile, le afișează o dată, și produce automat snippet-ul de `.env` + exemplul de callback handler (din `CONSUMER-RECIPE.md`) gata de copiat — onboarding de la 30 min la 2 min.

4. **Webhook-replay & test-harness încorporat.** Un panou „Resend last event" care reia exact bytes-ul unui eveniment Stripe în handler (echivalent `stripe events resend`) ([Stigg](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks)) + un buton „Trimite callback de test semnat" către un consumator → verifici lanțul fără să faci o plată reală. Util la fiecare app nou conectat.

5. **Mod „dry-run" pe checkout pentru pilot.** Un flag care, în loc să creeze sesiune Stripe reală, întoarce un răspuns simulat complet + declanșează un callback semnat de test. Lasă orice app să-și testeze integrarea (inclusiv verificarea HMAC) **fără chei live și fără bani**, exact înainte de a-l muta pe `sk_live_`.

---

## Surse

- [Stripe — Payment Orchestration vs Payment Gateway](https://stripe.com/resources/more/payment-orchestration-vs-payment-gateway)
- [Dodo Payments — Is Stripe a Merchant of Record?](https://dodopayments.com/blogs/stripe-vs-merchant-of-records)
- [GR4VY — What is Payment Orchestration? 2026 Guide](https://gr4vy.com/posts/payment-orchestration-2026/)
- [OCNJ Daily — Payment Orchestration in 2026: Smart Routing & Multi-Provider](https://ocnjdaily.com/uncategorized/payment-orchestration-in-2026-how-smart-routing-and-multi-provider-architecture-drive-higher-approval-rates/)
- [Stigg — Best practices integrating Stripe webhooks](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks)
- [HookRay — Stripe Webhook Best Practices 2026](https://hookray.com/blog/stripe-webhook-best-practices-2026)
- [Hooklistener — Stripe Webhook Security Guide 2026](https://www.hooklistener.com/learn/stripe-webhook-security-guide)
- [webhooks.fyi — Replay prevention](https://webhooks.fyi/security/replay-prevention)
- [FreelyIT — API Security Best Practices (HMAC + replay)](https://www.freelyit.nl/en/blog/api-security-best-practices-2026-03-21)
- [Microsoft Learn — Key Vault in a Multitenant Solution](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/service/key-vault)
- [Awssome — Multi-Tenant SaaS Security: Encryption FAQs](https://www.awssome.io/blog/multi-tenant-saas-security-encryption-faqs)
- [WorkOS — Cryptographic key isolation in multi-tenant SaaS](https://workos.com/blog/cryptographic-key-isolation-multi-tenant-saas)
- [Infisical — Secrets Management: The Complete Guide](https://infisical.com/blog/secrets-management-complete-guide)
- [Stripe — What is PCI DSS compliance?](https://stripe.com/guides/pci-compliance)
- [cside — Can you use Stripe for PCI DSS?](https://cside.com/blog/can-you-use-stripe-for-pci-dss)
- [episki — PCI DSS Compliance for E-commerce (2026)](https://www.episki.com/now/pci-for-ecommerce)
- [DEV — Crash-safe JSON: atomic writes & recovery](https://dev.to/constanta/crash-safe-json-at-scale-atomic-writes-recovery-without-a-db-3aic)
- [pl-rants — The Road To SQLite Enlightenment](https://pl-rants.net/posts/when-not-json/)
- [oneuptime — How to Use SQLite in Node.js](https://oneuptime.com/blog/post/2026-02-02-sqlite-nodejs/view)
