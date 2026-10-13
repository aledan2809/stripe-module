#!/bin/bash
# Livrarea brokerului de plăți (stripe.knowbest.ro) pe VPS2 — contractul de callback v3 (13.10.2026).
# Rulat de Alex, din orice folder de pe Mac, DUPĂ livrarea eTutor (eTutor nou știe evenimentele noi). Serverul găsește
# folderul brokerului din PM2 și ia scriptul din GitHub într-un fișier:
#
#   ssh root@72.62.155.74 'cd "$(pm2 jlist | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).find(p => p.name === \"stripe-broker\").pm2_env.pm_cwd")" && git fetch -q origin master && git show origin/master:scripts/ops/livreaza-broker.sh > /root/livreaza-broker.sh && bash /root/livreaza-broker.sh'
#
# Ce face, în ordine — se oprește la prima problemă; până la repornire, procesul care rulează nu e atins:
#   1. găsește folderul brokerului din PM2 (procesul stripe-broker), arată versiunea și ce intră;
#   2. copie a folderului data/ în /root/backups (firmele, cheile criptate, sesiunile de plată);
#   3. git pull + npm install + build, cu .next-ul vechi păstrat: dacă build-ul pică, îl pune la loc și NU repornește;
#   4. verifică build-ul (ruta nouă există), repornește (fără --update-env), verifică data/ neatins;
#   5. probe: /api/checkout și /api/subscription răspund 401 fără cheie, webhook-ul 400 fără semnătură;
#   6. nginx: /api/subscription trebuie să fie fără basic-auth (ca /api/checkout); dacă nu e, o adaugă copiind
#      blocul lui /api/checkout, cu `nginx -t` înainte și revenire automată dacă testul pică.
set -euo pipefail

APP=stripe-broker
STAMP=$(date +%Y-%m-%d-%H%M)
NEEDED=admin/src/app/api/subscription/route.ts
DOMAIN=stripe.knowbest.ro

echo "══ 1/6 unde e și ce intră ══"
CWD=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);process.stdout.write(p?p.pm2_env.pm_cwd:"")})' "$APP")
[ -n "$CWD" ] || { echo "  ✗ niciun proces PM2 „$APP”"; exit 1; }
ROOT=$(git -C "$CWD" rev-parse --show-toplevel)
ADMIN="$ROOT/admin"
PORT=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);const e=p.pm2_env;const a=[].concat(e.args||[]).join(" ");const m=a.match(/-p\s*(\d+)|--port[= ](\d+)/);process.stdout.write(String((e.env&&e.env.PORT)||e.PORT||(m&&(m[1]||m[2]))||3025))})' "$APP")
echo "  PM2 cwd: $CWD · repo: $ROOT · port: $PORT"
cd "$ROOT"
git fetch -q origin master
echo "  acum: $(git rev-parse --short HEAD) · pe GitHub: $(git rev-parse --short origin/master)"
git log --oneline -30 "HEAD..origin/master" | sed 's/^/    + /'
git cat-file -e "origin/master:$NEEDED" 2>/dev/null || { echo "  ✗ origin/master nu are $NEEDED — nimic atins."; exit 1; }
CHANGED=$(git status --porcelain --untracked-files=no | grep -vE '(^| |/)package-lock\.json$' || true)
if [ -n "$CHANGED" ]; then
  echo "  ✗ fișiere urmărite schimbate direct pe server — nimic atins (trimite-mi lista):"
  printf '%s\n' "$CHANGED" | sed 's/^/    /'
  exit 1
fi
TOUCH_DATA=$(git diff --name-only HEAD origin/master -- data/ || true)
[ -z "$TOUCH_DATA" ] || echo "  ⚠ livrarea schimbă în data/: $TOUCH_DATA (fișiere urmărite în git; restul din data/ nu e atins)"

echo "══ 2/6 copie data/ ══"
mkdir -p /root/backups
BACKUP=/root/backups/stripe-broker-data-$STAMP.tgz
tar czf "$BACKUP" -C "$ROOT" data
chmod 600 "$BACKUP"
SUM_BEFORE=$(cd "$ROOT/data" && find . -type f ! -name 'ecosystems.json' -exec sha256sum {} + | sort -k2 | sha256sum | cut -c1-16)
echo "  $BACKUP ($(du -h "$BACKUP" | cut -f1))"

echo "══ 3/6 cod + build ══"
for f in package-lock.json admin/package-lock.json; do git checkout -- "$f" 2>/dev/null || true; done
git pull -q --ff-only origin master
echo "  versiune nouă: $(git rev-parse --short HEAD)"
cd "$ADMIN"
npm install --no-audit --no-fund > /tmp/broker-install.log 2>&1 || { echo "  ✗ npm install a eșuat (procesul vechi rulează neatins) — /tmp/broker-install.log"; tail -5 /tmp/broker-install.log; exit 1; }
rm -rf .next.prev
[ -d .next ] && cp -a .next .next.prev
if ! npm run build > /tmp/broker-build.log 2>&1 || [ ! -f .next/BUILD_ID ]; then
  echo "  ✗ BUILD EȘUAT — pun la loc build-ul vechi, NU repornesc:"
  grep -iA4 "error" /tmp/broker-build.log | head -20
  rm -rf .next && [ -d .next.prev ] && mv .next.prev .next
  exit 1
fi

echo "══ 4/6 verificare build + repornire ══"
restore_old() { echo "  ✗ $1 — pun la loc build-ul vechi, NU repornesc"; rm -rf .next; [ -d .next.prev ] && mv .next.prev .next; exit 1; }
test -f .next/server/app/api/subscription/route.js || restore_old "ruta /api/subscription lipsește din build"
grep -rqs "subscription.updated" .next/server/app/api/stripe/webhook/ || restore_old "codul nou NU e în build"
echo "  cod nou în build: da"
pm2 restart "$APP" >/dev/null
echo "  repornit"
SUM_AFTER=$(cd "$ROOT/data" && find . -type f ! -name 'ecosystems.json' -exec sha256sum {} + | sort -k2 | sha256sum | cut -c1-16)
[ "$SUM_BEFORE" = "$SUM_AFTER" ] && echo "  data/ neatins: da" || echo "  ⚠ data/ s-a schimbat în timpul livrării (poate o plată a sosit între timp) — copia e în $BACKUP"

echo "══ 5/6 probe ══"
for _ in $(seq 1 20); do
  curl -s -o /dev/null -m 5 "http://127.0.0.1:$PORT/api/checkout" && break
  sleep 2
done
probe() { # metodă cale cod-așteptat
  local cod; cod=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X "$1" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT$2" || echo 000)
  echo "  $1 $2 → $cod (aștept $3)"; [ "$cod" = "$3" ]
}
OK=1
probe POST /api/checkout 401 || OK=0
probe POST /api/subscription 401 || OK=0
probe POST /api/stripe/webhook/probe-fara-semnatura 400 || OK=0
[ "$OK" = "1" ] || echo "  ⚠ o probă nu a dat ce trebuia — pm2 logs $APP --lines 50 --nostream"

echo "══ 6/6 nginx: /api/subscription fără basic-auth ══"
public_ok() { curl -s -m 10 -X POST -H 'Content-Type: application/json' -d '{}' "https://$DOMAIN/api/subscription" | grep -q "Invalid project key"; }
if public_ok; then
  echo "  https://$DOMAIN/api/subscription ajunge la broker (răspunde aplicația, nu parola nginx): OK"
else
  CONF=$(grep -ls "server_name[^;]*$DOMAIN" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | head -1 || true)
  CONF=$(readlink -f "$CONF" 2>/dev/null || true)
  echo "  nginx cere parola pe /api/subscription. Config: ${CONF:-(negăsit)}"
  [ -n "$CONF" ] || { echo "  ✗ nu găsesc configurația nginx pentru $DOMAIN — trimite-mi: grep -rl $DOMAIN /etc/nginx"; exit 1; }
  # Blocul simplu „location [=|^~] /api/checkout {…}” (acolada pe același rând), copiat cu calea schimbată,
  # inserat înaintea lui. Altă formă (regex, acolada pe rândul următor) → doar afișez, nu ghicesc.
  NEW=$(awk '
    !inb && $0 ~ /^[ \t]*location[ \t]+((=|\^~)[ \t]+)?\/api\/checkout\/?[ \t]*\{/ { inb=1; depth=0; blk="" }
    inb { blk = blk $0 "\n"; n=gsub(/\{/,"{"); m=gsub(/\}/,"}"); depth += n - m; if (depth==0 && n+m>0) { inb=0; found=1; sub(/\/api\/checkout/, "/api/subscription", blk); printf "%s", blk; exit } }
  ' "$CONF")
  if [ -z "$NEW" ]; then
    echo "  ✗ nu găsesc un bloc simplu „location /api/checkout { … }” de copiat. Blocurile /api din config:"
    grep -n "location.*api\|auth_basic" "$CONF" | sed 's/^/    /'
    echo "  Trimite-mi rândurile de mai sus: îți dau modificarea exactă."
    exit 1
  fi
  cp -a "$CONF" "/root/backups/nginx-$(basename "$CONF")-$STAMP"
  LINE=$(grep -nE '^\s*location\s+((=|\^~)\s+)?/api/checkout/?\s*\{' "$CONF" | head -1 | cut -d: -f1)
  { head -n $((LINE - 1)) "$CONF"; printf '%s\n' "$NEW"; tail -n +"$LINE" "$CONF"; } > "/tmp/nginx-$STAMP.conf"
  cp "/tmp/nginx-$STAMP.conf" "$CONF"
  if nginx -t 2>/tmp/nginx-test.log; then
    systemctl reload nginx
    sleep 1
    public_ok && echo "  adăugat blocul /api/subscription, nginx reîncărcat: OK" \
      || echo "  ⚠ blocul e adăugat, dar tot nu ajunge la broker — trimite-mi: grep -n 'location\\|auth_basic' $CONF"
  else
    cp "/root/backups/nginx-$(basename "$CONF")-$STAMP" "$CONF"
    echo "  ✗ nginx -t a picat — am pus config-ul la loc, nimic schimbat:"; tail -3 /tmp/nginx-test.log
    exit 1
  fi
fi

rm -rf "$ADMIN/.next.prev"
echo
echo "GATA. Revenire, dacă e nevoie: cd $ROOT && git checkout <versiunea veche> && cd admin && npm install && npm run build && pm2 restart $APP"
echo "data/: tar xzf $BACKUP -C $ROOT"
