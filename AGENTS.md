# AGENTS.md

Pedoman kerja untuk AI coding agents (Claude Code, Codex, Cursor, Copilot, dll)
yang bekerja di repository **photobooth-receipt**.

> Bahasa utama repo: **Indonesia** (UI & komentar). Kode dalam Bahasa Inggris (identifier).
> Saat menulis UI text, gunakan Bahasa Indonesia santai.

---

## Ringkasan Aplikasi

Photobooth SaaS multi-tenant: web PWA untuk foto booth (camera → strip → print thermal → share QR),
dengan **admin dashboard** terpisah dan **license code system** (HMAC) untuk on-boarding vendor.

```
User browser
   ├─ {slug}.achipix.web.id   → photobooth app (tenant/vendor)
   └─ admin.achipix.web.id    → admin dashboard SPA (super_admin)
```

**Stack:**
- Frontend booth: React 18 + TypeScript + Vite + PWA (plain HTML/CSS, TIDAK pakai MUI)
- Admin SPA: React 18 + TypeScript + Vite + **MUI v5** + Recharts (bundle terpisah di `admin/`)
- Backend: Node.js (Express) — file ESM `.mjs` (package.json `"type": "module"`)
- Database: PostgreSQL (via `pg` Pool di `db.mjs`)
- Deploy: Docker Compose (multi-stage Dockerfile), Cloudflare Tunnel wildcard

---

## Struktur Repo (PENTING)

```
photobooth/
├─ serve.mjs           # Entry point server: Express + static serving + tenant routing
├─ admin-api.mjs       # Admin REST API (di-mount di /api/admin/* di serve.mjs)
├─ db.mjs              # Semua query Postgres + schema init + migrations + seed
├─ Dockerfile          # Multi-stage: build booth + admin, runtime node-slim
├─ docker-compose.yml  # Service photobooth (+ postgres external)
├─ public/             # Static assets booth (logo, icons)
├─ src/                # Booth frontend (React/Vite/PWA)
│  ├─ App.tsx          # Root: LicenseGate + PinGate + routing
│  ├─ components/      # LicenseGate.tsx (license activation), dll
│  ├─ lib/             # licenseUtil.js (HMAC generate/verify), tenant.ts
│  ├─ modules/         # camera/, templates/, escpos/, print/, qr/, share/
│  ├─ store/           # Zustand store (session, branding)
│  └─ types/           # TypeScript types
├─ admin/              # Admin SPA (MUI) — SEPARATE package.json
│  ├─ src/
│  │  ├─ App.tsx       # Router v6 (hash mode) + RoleRoute guards
│  │  ├─ pages/        # Login, Dashboard, Tenants, Users, PricingTiers,
│  │  │                #   LicenseCodes, Billing, Attract...
│  │  └─ api/client.ts # REST client wrapper (auth + CSRF)
│  └─ package.json     # deps admin sendiri
├─ server/             # (legacy) Node bridge lama — TIDAK dipakai untuk deploy utama
└─ docs/               # MULTI_TENANT.md
```

> **⚠️ JANGAN edit `server/`** — itu bridge lama. Backend aktif adalah `serve.mjs` + `admin-api.mjs` + `db.mjs`.

---

## Module System (KRITIS)

- `package.json` root punya `"type": "module"` → **semua `.js`/`.mjs` adalah ESM**.
- Backend pakai `import`/`export`, bukan `require`.
- Gunakan **`.mjs`** untuk file backend baru (Express, DB, dll).
- Frontend (`.ts`/`.tsx`) normal — Vite handle bundling.

---

## Database & Schema

Schema diinisialisasi otomatis di `db.mjs` (`initDb()` + `migrate()` dipanggil dari `serve.mjs`).

Tabel utama:

| Tabel | Fungsi |
|-------|--------|
| `tenants` | Tenant (slug PK, name, owner_user_id, pricing_tier_id, pin / access_pin) |
| `admin_user` | User (email, password_hash `scrypt:`, role, tenant_id) |
| `admin_sessions` | Session cookie httpOnly |
| `admin_audit_log` | Audit trail |
| `pricing_tiers` | Basic/Premium/Profesional (max_tenants) |
| `presets`, `frames`, `designs`, `attract_assets`, `app_config`, `photos`, `transactions` | Data per-tenant (semua punya kolom `tenant_id` FK → `tenants(slug) ON DELETE CASCADE`) |
| `license_codes` | Kode lisensi issued (code_hash, vendor_id, tier_slug, active, redeemed_at, secret_version) |
| `license_secrets` | Versi secret (version, secret, is_current, rotated_by) |

**Aturan penting:**
- Semua query data tenant **WAJIB difilter by `tenant_id`** — jangan bocor antar tenant!
- Hapus data tenant = cascade otomatis (FK).
- Tenant `booth` adalah default tenant root. `admin` tenant untuk super admin.

---

## Multi-Tenant Routing (serve.mjs)

1. `admin.achipix.web.id` (+ `/admin` di root) → serve admin SPA
2. Subdomain known (`booth`, `hallo`, `testing`) → serve booth SPA dengan tenant tersebut
3. Subdomain lain → resolve dari DB `tenants` → filter data by slug
4. Unknown → fallback `DEFAULT_TENANT` (`booth`)

`resolveTenant(host)` di `db.mjs` adalah pusat logika ini.

---

## License System (HMAC) — Jangan Rusak

Kode lisensi format: `{vendorId}-{expiryEpochMs}-{hmacSha256Hex}`

**Backend flow:**
1. `POST /api/admin/license/generate` (super_admin) → buat kode via `generateLicenseCode()` + simpan hash di `license_codes`
2. `POST /api/admin/license/redeem` (**NO auth**, rate-limit 5/min/IP) → verifikasi HMAC + expiry + status → auto-create tenant `vendor-{vendorId}` + user `{slug}@achipix.local` (role `tenant_admin`) → mark redeemed
3. Verify/resolve secret: lookup `secret_version` di `license_codes` → `getSecretByVersion()` → fallback ke `process.env.LICENSE_SECRET_KEY`

**Versioned secrets (JANGAN di-ubah):**
- Setiap kode simpan `secret_version` saat generate.
- Rotasi secret (`POST /license/secret/rotate`, butuh password super_admin) → versi baru ditambah, versi lama tetap valid.
- Secret disimpan **plaintext** di DB `license_secrets` (dibutuhkan untuk HMAC verify ulang).

**Frontend (LicenseGate.tsx):**
- Mounted **sebelum PinGate** di `App.tsx` — kalau `VITE_LICENSE_ENFORCE=1`, app block di LicenseGate sampai license valid.
- Online check: `POST /api/admin/license/redeem` (pakai `/redeem` BUKAN `/verify` — voucher mode)
- Offline verify: Web Crypto HMAC-SHA256, pakai `VITE_LICENSE_SECRET` (build-time)

---

## Security & Auth (JANGAN dilewati)

- **Session**: cookie `admin_session` httpOnly + SameSite=Strict + Secure (di belakang HTTPS/Cloudflare).
- **CSRF**: double-submit token — header `X-XSRF-TOKEN` harus match cookie `XSRF-TOKEN`. Semua mutasi POST/PUT/DELETE admin WAJIB header ini.
- **Role**: super_admin vs tenant_admin vs user — guard di frontend (RoleRoute) DAN backend (`requireRole`).
- **Rate limit**: login 5 gagal/15 mnt/email; redeem 5/mnt/IP.
- **Password**: hash `scrypt:` via `hashPassword()`.
- Jangan pernah log/menampilkan `license_secrets.secret`.

---

## Build & Deploy

### Build lokal

```bash
# Booth
VITE_LICENSE_SECRET=<hex64> npm run build    # → dist/

# Admin
cd admin && npm run build                     # → ../dist/admin/
```

### Deploy production (STANDAR WAJIB)

```bash
export VITE_LICENSE_SECRET=$(openssl rand -hex 32)
export LICENSE_SECRET_KEY="$VITE_LICENSE_SECRET"
docker compose up -d --build --force-recreate
```

> **WAJIB `--build --force-recreate`** — tanpa `--build`, perubahan source tidak masuk image!
> Kalau bundle tidak berubah walau source berubah → tambah `--no-cache` (bukan ganti flag).

### Verifikasi setelah deploy

```bash
docker ps                      # container Up
curl -s https://booth.achipix.web.id/api/config   # tenant OK
curl -s https://admin.achipix.web.id/api/admin/csrf  # admin OK
```

---

## Env Vars

| Var | Diperlukan | Fungsi |
|-----|-----------|--------|
| `VITE_LICENSE_SECRET` | build-time | Secret HMAC untuk license (di-inject bundle frontend) |
| `LICENSE_SECRET_KEY` | runtime | Secret server-side signing/verify — HARUS sama dgn VITE_LICENSE_SECRET |
| `PORT` | no | Port container (default 8080) |
| `PG_HOST`/`PG_PORT`/`PG_DATABASE`/`PG_USER`/`PG_PASSWORD` | runtime | Koneksi Postgres |
| `VITE_LICENSE_ENFORCE` | no | `1` = enforce license gate di booth app (vendor build) |
| `PRINT_ENABLED`/`PRINTER_PATH` | no | Printer thermal (serial) |

> `.env` TIDAK di-commit. Jangan pernah hardcode secret di kode.

---

## Kredensial Dev (jangan commit ke public!)

- Admin: `admin@achipix.com` / `admin123` (super_admin)
- Tenant test: `tenantuser1@achipix.com` / `testing123` (tenant_admin, tenant `testing`)
- Auto-provision vendor: `{slug}@achipix.local` / `vendor123`

---

## Konvensi Kode

1. **UI text**: Bahasa Indonesia santai. Kode identifier: English.
2. **Backend baru**: ESM `.mjs`, `import` style (package.json type=module).
3. **Frontend booth**: plain CSS, NO MUI (booth dipakai tablet kiosk — bundle kecil).
4. **Admin SPA**: MUI v5, komponen per halaman di `admin/src/pages/`.
5. **State**: Zustand (`src/store/`) untuk session/branding booth.
6. **React Router**: hash mode (`#/`) — penting di belakang Cloudflare Tunnel.
7. Jangan tambah dependency berat tanpa kebutuhan jelas; bundle admin sudah ~88KB + vendor chunks.

---

## Pitfalls (Jangan Terulang)

- `createUser` WAJIB param `password` string — `undefined` akan throw di `hashPassword`.
- Route tanpa auth (mis. `/license/redeem`) — pakai `req.user?.id ?? null` untuk `logAudit`, bukan `req.user.id` (crash!).
- Jangan duplikat import dari `db.mjs` di `admin-api.mjs` (dulu pernah syntax error).
- `Dockerfile` runtime stage pakai COPY eksplisit (`serve.mjs db.mjs admin-api.mjs ./` + `src/lib/licenseUtil.js`) — file shared baru HARUS ditambah COPY.
- Build admin lambat (~30-90s) — jangan panik, tunggu.
- Deploy background bisa orphan — cek `process list` sebelum redeploy.

---

## Testing / Verifikasi

- Script verifikasi ada di `/tmp/routing-verify.sh` (8 route checks) & `/tmp/full-verify.sh` (tenants + audit).
- End-to-end license: generate → redeem → check tenant+user dibuat → cleanup.
- Utk test backend di container: `docker exec photobooth node --input-type=module -e "..."` (import dari `/app/*.mjs`).
- Selalu cleanup test data (`DELETE FROM tenants WHERE slug LIKE 'vendor-%'` + license_codes terkait).

---

## Git Workflow

- Commit kecil + pesan jelas (conventional: `feat:`, `fix:`, `docs:`, `chore:`).
- Pusatkan workflow: `main` branch, push langsung (self-host).
- JANGAN commit: `dist/`, `node_modules/`, `server/uploads/`, `.env`, secret.