# Stripe Checkout Broker — modificări directe, septembrie 2026

> NO-TOUCH CRITIC (deține chei `sk_live` — Class RDA + Fabulosos). Orice modificare = propose-confirm-apply + backup + verificare consumatori. Vezi CLASSIFICATION §2d + §3.1.

---

## 2026-09-03 — metode de plată per proiect (listă albă `card` implicită, `auto` = Stripe decide)

**Context**: userul a văzut **Satispay** pe pagina de checkout a abonamentului Notify (49 EUR/lună, firma Fabulosos, chei LIVE) și a întrebat de ce apare. Cauza: brokerul nu trimitea `payment_method_types`, deci Stripe alegea dinamic din ce e bifat în Dashboard-ul firmei. Userul a cerut explicit ca excluderea să se facă **din broker**, cu valoarea aplicată pe toate proiectele („Acolo le putem seta pe toate ca la 2, by default").

**Ce s-a măsurat ÎNAINTE de orice modificare** (read-only, cheile n-au părăsit VPS-ul):

| Cont | Metode bifate | Plăți reușite (live+test) | Metode chiar folosite |
|---|---|---|---|
| class-rda | 8 | 5 | card |
| techbiz-uae | 3 | 7 | card, link |
| fabulosos | **10** (incl. satispay, mb_way) | 4 | card |

- Sesiunea exactă din captura userului: `payment_method_types: ["card","link","satispay"]`, `mode: subscription`, `cs_live_…`, neplătită.
- Portofele pe toate cele 3 firme: `apple_pay=on`, `link=on`, **`google_pay=off`**.
- **Contradicție în documentația Stripe**: pagina de integrare Checkout a Satispay scrie `Subscription mode: No` + `Setup mode: No`, iar tabelul de compatibilitate `Subscriptions: Unsupported`; pagina de prezentare a metodei scrie invers, `Recurring payments: Yes`. Satispay a ajuns totuși pe o sesiune de ABONAMENT. Necunoscută pe traseul banilor → nu se lasă deschisă.
- Nicio aplicație consumatoare (Notify, Contakt, Tutor, knowbest, utilajhub, TravelAgency, AVE, 4uPDF, BlocHub, PRO, eCabinet, Offer) nu pomenește `klarna|bancontact|satispay|mb_way|blik|pix` în cod.

**Schimbare (aditivă, commits `10a9852` + `696d7a2`)**:
- `ProjectMapping.paymentMethods?: 'card' | 'auto'`; absent → `'card'`. `resolvePaymentMethods` e fail-safe: orice valoare stricată din fișierul de date (`null`, `''`, `0`, `[]`, `{}`, `'AUTO'`, `' auto'`) cade pe lista albă; doar `'auto'` exact deschide metodele dinamice.
- `api/checkout`: `payment_method_types: ['card']` pe `'card'`, parametru omis pe `'auto'`. **Un singur call site** de sesiuni în broker (fără PaymentIntents/PaymentLinks) → setarea nu se poate ocoli.
- `api/projects`: validează valoarea și o **păstrează** când un client vechi o omite (altfel un proiect pus pe `'auto'` ar fi resetat tăcut pe lista albă).
- UI `/projects`: selector în blocul broker (deci imposibil de setat fără firmă broker) + insignă în listă.
- `Knowledge/CHECKOUT-BROKER.md`: secțiune nouă „Metodele de plată afișate".
- Seed: `paymentMethods: 'card'` scris **explicit pe toate 19 mapările**, prin API-ul oficial (`POST /api/projects` → `upsertProjectMapping`), NU editare manuală de JSON. Verificat după: 19 → 19 mapări, **0 chei broker schimbate**, 0 verificări invoice-email pierdute, 0 mapări fără setare.

**Backup-uri**: `/root/backups/{project-mappings,companies,credentials}.bak-2026-09-03-pre-paymentmethods.json`.

**Rollback**: `git revert 10a9852 696d7a2` + rebuild + `pm2 restart stripe-broker` (comportamentul dinamic revine imediat, câmpul rămas în date e inert). Sau, per proiect fără deploy: setarea pe „Stripe decide" din UI.

**Verificare pe PRODUCȚIE (după deploy + seed)**:
- `procuchaingo2` (fabulosos TEST, `card`) → `["card"]`
- `procuchaingo2` comutat pe `auto` → `["card","klarna","link","satispay"]` → **readus pe `card`** (dovedește că ramura dinamică funcționează și că satispay chiar ar apărea)
- **`notify` (fabulosos LIVE, `card`) → `["card"]`** — cazul userului, satispay dispărut
- Stripe acceptă `['card']` împreună cu tot bagajul brokerului (abonament + `trial_period_days` + cupon + `tax_rates` + `customer_email` + `subscription_data`): probat pe cheie de test, `["card"]` vs `["card","klarna","link"]` fără parametru.
- **Link RĂMÂNE** cu `['card']` — verificat pe pagina reală de Checkout: se încarcă cadrul de login Link și se randează butonul Apple Pay (`applePay=always`, `link=auto`, `googlePay=never`). Sesiunea listează doar `["card"]` fiindcă Link e tratat CA plată cu cardul; absența lui `'link'` din `payment_method_types` NU înseamnă că Link a dispărut. (Review-ul adversarial dedusese contrariul din enum-ul SDK — infirmat empiric.)
- Health consumatori: broker `/api/checkout` 405 (POST-only, sănătos) · notify 200 · contakt 200 · cabinet 200 · pro 200 · legal 200 · etutor 307 · ta 200 · procuchain 200 · app.techbiz 200 · 4updf 200.

**Review adversarial**: 1 constatare validă preluată (comentariul din `api/checkout` mai promitea Google Pay — corectat în `696d7a2`), 1 infirmată empiric (Link, vezi mai sus), restul confirmări. Am prins singur, înainte de review, o inexactitate proprie: textele promiteau Google Pay, care e OFF pe toate firmele.

**Rămas cunoscut, NEreparat (pre-existent, nu agravat de schimbarea asta)**: `upsertProjectMapping` face read-modify-write fără lacăt — două salvări simultane pe același proiect se calcă reciproc și a doua rescrie tot rândul. Scrierea în fișier e atomică (`atomicWriteFileSync`), deci nu există fișier corupt, doar pierdere de ultimă-scriere. Reparația cere lacăt pe magazinul de date al traseului banilor → sesiune dedicată.

**Acțiune user rămasă (opțională, nelegată de asta)**: metodele exotice rămân bifate în Dashboard-ul Fabulosos. Nu mai ajung la clienți prin broker, dar dacă vrei curățenie și la sursă, le stingi din Settings → Payment methods (mod Live).
