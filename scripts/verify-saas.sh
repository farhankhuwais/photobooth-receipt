#!/bin/bash
# ============================================================
# verify-saas.sh — Flow pengecekan SaaS photobooth
#   ./verify-saas.sh            → smoke test (read-only, aman)
#   ./verify-saas.sh --e2e      → full E2E (buat data test + cleanup otomatis)
#
# Env opsional:
#   ADMIN_EMAIL / ADMIN_PASS   → kredensial super_admin (wajib utk --e2e)
#   BOOTH_HOST                 → host tenant booth (default booth.achipix.web.id)
#   BASE                       → base URL server (default http://localhost:8099)
#
# Keluar: tiap cek [OK]/[FAIL]; exit 0 kalau semua OK, 1 kalau ada FAIL.
# ============================================================
set -u
BASE="${BASE:-http://localhost:8099}"
BOOTH_HOST="${BOOTH_HOST:-booth.achipix.web.id}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@photobooth.local}"
ADMIN_PASS="${ADMIN_PASS:-}"
TMP="${TMPDIR:-/tmp}/verify-saas.$$"
mkdir -p "$TMP"
JAR="$TMP/user.jar"; AJAR="$TMP/admin.jar"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "[OK]   $1"; }
fail() { FAIL=$((FAIL+1)); echo "[FAIL] $1"; }
chk()  { # chk <nama> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (harap: '$2', dapat: '$3')"; fi
}
cleanup() {
  rm -f "$JAR" "$AJAR"
  if [ -n "${TENANT_SLUG:-}" ]; then
    docker exec photobooth node --input-type=module -e "
const { pool } = await import('/app/db.mjs');
const slug = process.env.SLUG;
const u = (await pool.query('SELECT id FROM admin_user WHERE email = \$1', [process.env.EMAIL])).rows.map(r=>r.id);
if (u.length) {
  await pool.query('DELETE FROM license_codes WHERE for_user_id = ANY(\$1::int[]) OR redeemed_user_id = ANY(\$1::int[])', [u]);
  await pool.query('DELETE FROM user_sessions WHERE user_id = ANY(\$1::int[])', [u]);
  await pool.query('DELETE FROM admin_user WHERE id = ANY(\$1::int[])', [u]);
}
await pool.query('DELETE FROM tenants WHERE slug = \$1', [slug]);
await pool.end();
" SLUG="$TENANT_SLUG" EMAIL="$EMAIL" 2>/dev/null
    echo "[OK]   cleanup data test ($TENANT_SLUG)"
  fi
}
trap cleanup EXIT

python_json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

# Tunggu server siap (max ~90s) — hindari race saat container baru start/recreate.
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "$BASE/api/auth/csrf" 2>/dev/null; then break; fi
  sleep 3
done

echo "=== SMOKE TEST ($BASE, booth: $BOOTH_HOST) ==="

# 1. Container jalan + server merespons (health 'starting' diterima jika wait-loop sudah lolos)
ST=$(docker ps --filter name=photobooth --format '{{.Status}}' | grep -cE 'healthy|health: starting')
chk "1. Container photobooth jalan" "1" "$ST"

# 2. Config booth punya field tenant_status
CFG=$(curl -s -H "Host: $BOOTH_HOST" "$BASE/api/config")
TS=$(echo "$CFG" | python_json "d.get('tenant_status','MISSING')")
case "$TS" in trial|active|expired|suspended) ok "2. /api/config tenant_status = '$TS'";; *) fail "2. /api/config tenant_status invalid/missing: '$TS'";; esac

# 3. /api/auth/status netral tanpa sesi
ST2=$(curl -s "$BASE/api/auth/status" | python_json "(d.get('hasTenant'), d.get('user'))")
chk "3. /api/auth/status netral tanpa sesi" "(False, None)" "$ST2"

# 4. CSRF admin endpoint hidup
CS=$(curl -s "$BASE/api/admin/csrf" | python_json "bool(d.get('csrfToken'))")
chk "4. /api/admin/csrf hidup" "True" "$CS"

# 5. CSRF auth endpoint hidup
CS2=$(curl -s "$BASE/api/auth/csrf" | python_json "bool(d.get('csrfToken'))")
chk "5. /api/auth/csrf hidup" "True" "$CS2"

# 6. Kode 6 digit tak bisa di-redeem tanpa sesi
R=$(curl -s -X POST "$BASE/api/admin/license/redeem-for-user" -H 'Content-Type: application/json' -d '{"code":"123456"}')
E=$(echo "$R" | python_json "'sesi' in d.get('error','').lower()")
chk "6. redeem-for-user butuh sesi (auth OK)" "True" "$E"

if [ "${1:-}" != "--e2e" ]; then
  echo; echo "Hasil: $PASS OK, $FAIL FAIL"
  [ "$FAIL" = 0 ] && exit 0 || exit 1
fi

# ================= E2E MODE =================
echo; echo "=== E2E: register → trial → kode6 → redeem → aktif ==="

TS_=$(date +%s)
EMAIL="verify-saas-$TS_@achipix.local"

# 7. Register → tenant status 'pending' (menunggu approval admin)
REG=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"verify12345\",\"name\":\"Verify SaaS\"}")
TENANT_SLUG=$(echo "$REG" | python_json "d.get('user',{}).get('tenant_id','')")
chk "7. Register buat akun (slug=$TENANT_SLUG)" "yes" "$([ -n "$TENANT_SLUG" ] && echo yes || echo no)"

# 8. Status awal → 'pending' (trial belum jalan sebelum approval)
PST=$(curl -s -b "$JAR" "$BASE/api/auth/status" | python_json "d.get('tenant',{}).get('status','')")
chk "8a. Status awal = pending" "pending" "$PST"

# 8a2. Booth subdomain tenant pending TIDAK boleh menyajikan booth (device fresh)
CFG0=$(curl -s -H "Host: $TENANT_SLUG.achipix.web.id" -H "X-Device-Fp: fpblock-$TS_" "$BASE/api/config")
PBLOCKED=$(echo "$CFG0" | python_json "(d.get('tenant_status') or 'None') not in ('pending','rejected','trial','active','expired','suspended')")
chk "8a2. Booth tenant pending terblokir" "True" "$PBLOCKED"

# 8b. Admin login + approve → trial mulai
[ -n "$ADMIN_PASS" ] || { echo "[SKIP] E2E butuh ADMIN_EMAIL/ADMIN_PASS env"; echo; echo "Hasil: $PASS OK, $FAIL FAIL"; [ "$FAIL" = 0 ] && exit 0 || exit 1; }
curl -s -c "$AJAR" "$BASE/api/admin/csrf" > /dev/null
CSRF=$(grep XSRF-TOKEN "$AJAR" | tail -1 | awk '{print $NF}')
LG=$(curl -s -b "$AJAR" -c "$AJAR" -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -H "X-XSRF-TOKEN: $CSRF" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
ROLE=$(echo "$LG" | python_json "d.get('user',{}).get('role','')")
chk "8b. Admin login (super_admin)" "super_admin" "$ROLE"
ACSRF=$(grep XSRF-TOKEN "$AJAR" | tail -1 | awk '{print $NF}')
AP=$(curl -s -b "$AJAR" -X POST "$BASE/api/admin/registrations/$TENANT_SLUG/approve" \
  -H "X-XSRF-TOKEN: $ACSRF")
APOK=$(echo "$AP" | python_json "d.get('ok') == True or d.get('tenant',{}).get('status','')=='trial'")
chk "8c. Approve pendaftaran" "True" "$APOK"

# 9. Status setelah approve → trial + days_remaining 3
S=$(curl -s -b "$JAR" "$BASE/api/auth/status")
SST=$(echo "$S" | python_json "d.get('tenant',{}).get('status','')")
DR=$(echo "$S" | python_json "d.get('tenant',{}).get('days_remaining','-1')")
chk "9a. Status tenant = trial" "trial" "$SST"
chk "9b. days_remaining = 3" "3" "$DR"

# 10. Generate kode aktivasi 6 char
VUID=$(curl -s -b "$AJAR" "$BASE/api/admin/users" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items = d if isinstance(d,list) else (d.get('items') or d.get('users') or d.get('data') or [])
print(next(u['id'] for u in items if u.get('email')=='$EMAIL'))" 2>/dev/null)
ACSRF=$(grep XSRF-TOKEN "$AJAR" | tail -1 | awk '{print $NF}')
GEN=$(curl -s -b "$AJAR" -X POST "$BASE/api/admin/license/generate" -H 'Content-Type: application/json' \
  -H "X-XSRF-TOKEN: $ACSRF" -d "{\"userId\":$VUID,\"expiresDays\":7}")
CODE=$(echo "$GEN" | python_json "d.get('code','')")
chk "10. Generate kode 6 digit" "6" "${#CODE}"

# 11. Redeem → active 30 hari
curl -s -b "$JAR" -c "$JAR" "$BASE/api/auth/csrf" > /dev/null
UCSRF=$(grep XSRF-TOKEN "$JAR" | tail -1 | awk '{print $NF}')
RD=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/license/redeem-for-user" -H 'Content-Type: application/json' \
  -H "X-XSRF-TOKEN: $UCSRF" -d "{\"code\":\"$CODE\"}")
RST=$(echo "$RD" | python_json "d.get('tenant',{}).get('status','')")
chk "11. Redeem → tenant active" "active" "$RST"

# 12. Status akhir → days_remaining 30
DR2=$(curl -s -b "$JAR" "$BASE/api/auth/status" | python_json "d.get('tenant',{}).get('days_remaining','-1')")
chk "12. days_remaining = 30" "30" "$DR2"

# 13. Redeem ulang → ditolak
RD2=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/license/redeem-for-user" -H 'Content-Type: application/json' \
  -H "X-XSRF-TOKEN: $UCSRF" -d "{\"code\":\"$CODE\"}")
DUP=$(echo "$RD2" | python_json "d.get('ok') != True")
chk "13. Redeem ulang ditolak" "True" "$DUP"

# 14. Booth config tenant status terbaca
TS2=$(curl -s -H "Host: $TENANT_SLUG.achipix.web.id" "$BASE/api/config" | python_json "d.get('tenant_status','')")
chk "14. Booth config tenant_status tenant baru" "active" "$TS2"

# ===== PAIRING DEVICE BOOTH =====
DEVFP="verifyfp$TS_"

echo "=== PAIRING: generate kode → pair device → revoke ==="
# 15. Generate kode pairing (default 15 menit)
curl -s -b "$JAR" -c "$JAR" "$BASE/api/auth/csrf" > /dev/null
UCSRF=$(grep XSRF-TOKEN "$JAR" | tail -1 | awk '{print $NF}')
PC=$(curl -s -b "$JAR" -X POST "$BASE/api/tenant/access-code" \
  -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: $UCSRF" -d '{"expiryMinutes":15}')
PCODE=$(echo "$PC" | python_json "d.get('code','')")
chk "15. Generate kode pairing" "6" "${#PCODE}"

# 16. Pair device via endpoint booth (public) — kode single-use
PV=$(curl -s -H "Host: $TENANT_SLUG.achipix.web.id" -X POST "$BASE/api/access-code/validate" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$PCODE\",\"deviceFp\":\"$DEVFP\"}")
PVOK=$(echo "$PV" | python_json "d.get('valid') == True")
chk "16. Pairing device sukses" "True" "$PVOK"

# 17. Re-validate kode yang sudah dipakai → harus ditolak
PV2=$(curl -s -H "Host: $TENANT_SLUG.achipix.web.id" -X POST "$BASE/api/access-code/validate" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$PCODE\",\"deviceFp\":\"$DEVFP\"}")
USED=$(echo "$PV2" | python_json "d.get('valid') == False")
chk "17. Kode pairing single-use (ditolak ulang)" "True" "$USED"

# 18. Config booth → device_paired = true
DP=$(curl -s -H "Host: $TENANT_SLUG.achipix.web.id" -H "X-Device-Fp: $DEVFP" "$BASE/api/config" | python_json "str(d.get('device_paired'))")
chk "18. device_paired = True" "True" "$DP"

# 19. List devices berisi device baru
DID=$(curl -s -b "$JAR" "$BASE/api/tenant/devices" | python_json "d['items'][0]['id'] if d.get('items') else ''")
chk "19. Device muncul di list" "yes" "$([ -n "$DID" ] && echo yes || echo no)"

# 20. Revoke device → poll berikutnya device_paired = false
curl -s -b "$JAR" -X POST "$BASE/api/tenant/devices/$DID/revoke" \
  -H "X-XSRF-TOKEN: $UCSRF" > /dev/null
DP2=$(curl -s -H "Host: $TENANT_SLUG.achipix.web.id" -H "X-Device-Fp: $DEVFP" "$BASE/api/config" | python_json "str(d.get('device_paired'))")
chk "20. Setelah revoke device_paired = False" "False" "$DP2"

# ===== SELF-PAY (Midtrans — mode simulasi jika tanpa server key) =====
PR=$(curl -s -b "$JAR" "$BASE/api/admin/subscription/price")
PRICE_OK=$(echo "$PR" | python_json "d.get('price',0) > 0")
chk "21. Price endpoint" "True" "$PRICE_OK"

PAY=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/subscription/pay" -H "X-XSRF-TOKEN: $UCSRF")
MOCK=$(echo "$PAY" | python_json "d.get('mock') == True or d.get('token') != None")
chk "22. Self-pay (simulasi/Snap)" "True" "$MOCK"

echo; echo "Hasil: $PASS OK, $FAIL FAIL"
[ "$FAIL" = 0 ] && exit 0 || exit 1
