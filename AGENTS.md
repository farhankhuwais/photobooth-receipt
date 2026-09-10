# AGENTS.md

Pedoman kerja untuk AI coding agents (Claude Code, Codex, Cursor, Copilot, dll)
yang bekerja di repository **photobooth-receipt**.

> Bahasa utama repo: **Indonesia** (UI & komentar). Kode dalam Bahasa Inggris (identifier).
> Saat menulis UI text, gunakan Bahasa Indonesia santai.

---

## Ringkasan Aplikasi

Photobooth SaaS multi-tenant: web PWA untuk foto booth (camera → strip → print thermal → share),
dengan **admin dashboard SPA** terpisah dan **license code system** (HMAC) untuk on-boarding vendor.

```
User browser
   ├─ {slug}.achipix.web.id   → photobooth app (tenant/vendor) + booth API + /portal/api/*
   └─ admin.achipix.web.id    → admin dashboard SPA (super_admin / tenant_admin)
```

**Stack:**
- Frontend booth: React 18 + TypeScript + Vite + PWA (Tailwind/plain CSS, **TIDAK pakai MUI**) — dipakai di tablet kiosk
- Admin SPA: React 18 + TypeScript + Vite + **MUI v5** + Recharts (bundle terpisah di `admin/`, hash router)
- Backend: Node.js (Express 5) — file ESM `.mjs` (package.json `"type": "module"`)
- Database: PostgreSQL (via `pg` Pool di `db.mjs`) — **eksternal, bukan service compose**
- Deploy: Docker Compose (multi-stage Dockerfile), Cloudflare Tunnel wildcard `*.achipix.web.id`

---

## Struktur Repo (PENTING)

```
photobooth/
├─ serve.mjs           # Entry point: Express + tenant routing + booth API + /portal + mount admin API
├─ admin-api.mjs       # Admin REST API (di-mount di /api/admin/*, HANYA subdomain admin)
├─ db.mjs              # Pool Postgres + schema init/migrate + seed + semua query tenant-scoped
├─ Dockerfile          # Multi-stage: build booth + admin, runtime node:22-slim
├─ docker-compose.yml  # Service photobooth saja (Postgres external via network photobooth-net)
├─ public/             # icon.svg + guides/ (panduan cetak)
├─ src/                # Booth frontend (React/Vite/PWA)
│  ├─ App.tsx          # ⚠️ INI MONOLIT (~1300 baris): LicenseGate → PinGate → attract → booth → hasil
│  ├─ components/      # LicenseGate.tsx (aktivasi license offline-first) + CSS
│  ├─ lib/             # licenseUtil.js (HMAC generate/verify), tenant.ts (slug + header PIN)
│  ├─ store/           # useSession.ts (Zustand: session, branding, mode, payment)
│  ├─ types/           # TypeScript types
│  └─ modules/         # camera/, templates/, escpos/, print/, qr/, share/, offline/, pin/, branding/
├─ admin/              # Admin SPA (MUI) — SEPARATE package.json
│  ├─ src/
│  │  ├─ App.tsx       # HashRouter: /login, dashboard, tenants, users, photos, designs,
│  │  │                #   presets, audit, billing, tiers, license, settings, manage (RoleRoute-guarded)
│  │  ├─ pages/        # satu file per halaman (Login, Dashboard, Tenants, Users, Photos, Designs,
│  │  │                #   Presets, PricingTiers, AuditLog, Billing, LicenseCodes, Settings, Manage)
│  │  └─ api/client.ts # REST client wrapper (auth + CSRF)
│  └─ package.json     # deps admin sendiri (MUI v5, recharts, axios, react-router-dom v6)
└─ server/             # (legacy) Node bridge lama — TIDAK dipakai untuk deploy utama
```

> **⚠️ JANGAN edit `server/`** — bridge lama. Backend aktif adalah `serve.mjs` + `admin-api.mjs` + `db.mjs`.

---

## Module System (KRITIS)

- `package.json` root punya `"type": "module"` → **semua `.js`/`.mjs` adalah ESM**.
- Backend pakai `import`/`export`, bukan `require`.
- Gunakan **`.mjs`** untuk file backend baru (Express, DB, dll).
- Frontend (`.ts`/`.tsx`) normal — Vite handle bundling.

---

## Multi-Tenant Routing (db.mjs `resolveTenant`)

Logika pemusat di `db.mjs` (`resolveTenant(host)`). Bukan daftar hardcoded — **DB-driven**:

1. `localhost` / IP langsung / root `achipix.web.id` → `'admin'` (serve admin SPA)
2. `admin.achipix.web.id` → `'admin'`
3. `{slug}.achipix.web.id` → lookup `tenants` (slug + `active=true`) → slug tersebut
4. Subdomain tak dikenal / nonaktif → fallback `DEFAULT_TENANT` (= `PB_DEFAULT_TENANT`, default `'default'`; compose men-set `booth`)
5. Error query DB → `null` → HTTP 404 (middleware block)

Tenant default ikut di-seed di `initDb()` saat start (`PB_DEFAULT_TENANT`).

> Rule: jangan hardcode daftar tenant di serve.mjs. Semua lewat `resolveTenant` + query ber-filter `tenant_id`.

---

## API — Booth (`/api/*` di serve.mjs)

Semua `/api/*` di bawah middleware PIN tenant (`serve.mjs`): kalau `tenants.access_pin` terisi,
klien wajib kirim header `x-tenant-pin` kecuali endpoint public di bawah.

**Public tanpa PIN:** `/api/tenant/pin-status`, `/api/tenant/verify-pin`, `/api/config`,
`/api/presets*`, `/api/designs*` (metadata + blob frame, dipakai `<img>`).

| Method | Path | Fungsi |
|--------|------|--------|
| `GET/POST` | `/api/config` | Config aktif: `{mode, price, preset_name, branding}`; GET kirim `ETag` (MD5 JSON) untuk deteksi perubahan config |
| `GET/POST/PUT/DELETE` | `/api/presets[/:name]` | Preset bernama (mode `regular`/`event`, price, branding) — POST cek tier |
| `GET/POST` `DELETE` | `/api/frames[/:id]` | Gallery frame custom PNG (kolom `template`: `strip3`/`single`/`grid2x2`/NULL=universal) — POST cek tier |
| `GET/POST/PUT/DELETE` | `/api/designs[/:id]` + `GET /api/designs/:id/frame` | Mockup desain (frame PNG + `slots` JSON + `canvas_w/h`) — POST cek tier |
| `POST` | `/api/upload` | Simpan strip PNG ke Postgres → `{url: /u/:id}` |
| `GET` | `/u/:id` | Serve strip tersimpan (cache immutable) |
| `GET/POST` | `/api/ai/status` · `/api/ai/settings` | Status / settings AI sketch (API key TIDAK pernah dikirim ke klien — cuma dimask) |
| `POST` | `/api/ai/sketch` | Foto → sketsa Gemini (timeout 60s; frontend wajib punya fallback lokal) |
| `POST` | `/api/print` | Cetak ESC/POS ke printer serial server (hanya aktif kalau `PRINT_ENABLED=1` + `PRINTER_PATH`) |
| `GET/POST` | `/api/tenant/pin-status` · `/api/tenant/verify-pin` | Cek & verifikasi PIN tenant |

> Tier enforcement: `checkTierLimit` → HTTP **403** saat batas `presets`/`frames`/`designs` terlampaui.

---

## API — Admin (`/api/admin/*` di admin-api.mjs)

Dikenakan middleware: session cookie `admin_session` (httpOnly, SameSite=Strict, Secure di prod) +
CSRF double-submit (`X-XSRF-TOKEN` header == cookie `XSRF-TOKEN`) untuk semua mutasi + `requireRole`.

| Method | Path | Fungsi |
|--------|------|--------|
| `GET` | `/csrf` | Token CSRF (tanpa auth; readable cookie) |
| `POST` | `/login` | Login + remember-me; rate limit 5 gagal/15 mnt/email |
| `POST` `GET` | `/logout` · `/me` | Logout / sesi saat ini |
| `GET` | `/my-tier` · `/overview` | Tier+usage user login / statistik global |
| CRUD | `/tenants` · `/my-tenants` `PATCH/DELETE /tenants/:slug` | Manajemen tenant (tenant_admin dibatasi tier `max_tenants`) |
| CRUD | `/users` (+ `/users/:id/code`, `/users/:id/tier`) | User + kode akses + pricing tier |
| CRUD | `/tiers` | Pricing tiers (max_tenants/photos/frames/designs/presets) |
| `POST` | `/license/generate` | Generate kode HMAC (super_admin + CSRF) |
| `GET` `POST` | `/license/list` · `/license/:id/revoke` | List / revoke kode |
| `POST` | `/license/redeem` | **Tanpa auth**, rate-limit 5/mnt/IP — aktivasi + auto-provision |
| `POST` | `/license/verify` | Verifikasi kode (session) |
| `GET` `POST` | `/license/secrets` · `/license/secret/rotate` | List versi / rotasi secret |
| `GET` | `/audit` (+ `DELETE /audit/:id`, `POST /audit/cleanup`) | Audit trail |
| `GET DEL` | `/photos` · `/photos/:id` | Foto per tenant |
| CRUD | `/designs` (`GET/GET:id/POST/PUT/DELETE`) | Mockup desain (upload frame + slots) |
| `GET` | `/tenant-info/:slug` · `/tenant-stats/:slug` | Detail + statistik tenant |
| `GET` `PUT` | `/config` | Config per-tenant |
| `GET` | `/billing` | Revenue per tenant (30 hari) + grand total |
| CRUD | `/presets` | Preset per-tenant |

> **Endpoints `attract/*` dihapus (HTTP 410).** Attract/background/ikon kini **inline di `branding`**
> preset/config (`attractMedia` gambar/video, `attractIcon`, `attractTagline`, `attractCtaText`).
> Jangan re-add endpoint attract terpisah — satu source of truth = `branding`.

---

## Portal API (`/portal/api/*` di serve.mjs) — legacy, tapi BOOTH PAKAI

- Sesi cookie terpisah: `pb_admin_session` (Path=/portal, HttpOnly, SameSite=Strict, Max-Age 30 hari).
- `/portal/api/login|logout` — sesi legacy (email+password).
- **`POST /portal/api/log` TANPA auth (by design)** — booth kiosk mencatat transaksi lunas
  (`{method: qris|cash, amount, template, note, preset, mode}`) → tabel `transactions`.
- Sisanya (`/tenants`, `/photos`, `/transactions`, `/stats`, `/export` CSV, `/change-password`) — `requireAccess`
  (cek cookie `admin_session` ATAU `pb_admin_session`), direkomendasikan via admin SPA baru.

---

## Database & Schema

Schema auto-init di `db.mjs` (`initDb()` yang memanggil `migrate()`), dijalankan saat `serve.mjs` start.

| Tabel | Fungsi / catatan |
|-------|------------------|
| `tenants` | Slug PK (+ kolom `id` UUID), name, active, `access_pin`, `owner_user_id` |
| `admin_user` | User (email, password_hash `scrypt:`, role, tenant_id, name, active, `code` akses, `pricing_tier_id`, max_tenants) |
| `admin_sessions` | Session cookie httpOnly (TTL 8 jam, 30 hari kalau remember-me) |
| `admin_audit_log` | Audit trail (action, target, metadata, ip, ua, user_id, tenant_slug) |
| `admin_login_attempts` | Rate-limit login |
| `pricing_tiers` | Basic/Premium/Profesional (max_tenants, max_photos, max_frames, max_designs, max_presets) |
| `photos` | Strip hasil (id=timestamp.png, data BYTEA, tenant_id) |
| `presets` | Preset per tenant (name PK, mode, price, branding JSONB) |
| `transactions` | Riwayat transaksi lunas (method, amount, mode, preset, template, note) |
| `app_config` | Config aktif per tenant — **PK composite `(tenant_id, id)`** (mode, price, preset_name, branding JSONB) |
| `ai_settings` | API key Gemini, model, prompt, enabled — per tenant |
| `frames` | Frame custom PNG — **PK composite `(tenant_id, id)`**, kolom `template` |
| `designs` | Mockup desain — **PK composite `(tenant_id, id)`** (frame_data, canvas_w/h, slots JSONB) |
| `license_codes` | Kode issued — **hanya `code_hash` (SHA256)**, vendor_id, tier_slug, expires_at, redeemed_*, revoked_*, `secret_version` |
| `license_secrets` | Versi secret plaintext (version, secret, is_current, rotated_by/from) |

**Aturan penting:**
- Semua query data tenant **WAJIB difilter by `tenant_id`** — jangan bocor antar tenant!
- Hapus tenant = cascade otomatis (FK `ON DELETE CASCADE`).
- Tenant default adalah `PB_DEFAULT_TENANT`. `admin` adalah tenant khusus untuk admin SPA.
- Kode lisensi asli TIDAK disimpan — simpan `code_hash` dari SHA256(kode).

---

## License System (HMAC) — Jangan Rusak

Kode lisensi format: `{vendorId}-{expiryEpochMs}-{hmacSha256Hex}` (64 hex).

**Backend flow:**
1. `POST /api/admin/license/generate` (super_admin + CSRF) → `generateLicenseCode(vendorId, expiryDays, secret)`.
   Secret dipakai = versi `is_current` di DB (fallback `LICENSE_SECRET_KEY`) → simpan hash + `secret_version`.
2. `POST /api/admin/license/redeem` (**NO auth**, rate-limit in-memory 5/mnt/IP) →
   lookup kode by hash (dapat `secret_version`) → `verifyLicenseCode` → cek active/expired →
   auto-provision: **create tenant `{vendorId-slug}` + user `{slug}@achipix.local`** (role `tenant_admin`,
   password **random 12-char** — bukan default statis) → `markLicenseRedeemed`.
3. `POST /api/admin/license/verify` (session) → verifikasi authoritatif (HMAC + revoke check).
4. Revoke: `POST /api/admin/license/:id/revoke` → `active=false`.

**Versioned secrets (JANGAN di-ubah):**
- Setiap kode simpan `secret_version` saat generate.
- Rotasi (`POST /license/secret/rotate`, butuh konfirmasi password super_admin) → versi baru,
  versi lama **tetap valid** (lookup by version dari `license_secrets`).
- Secret disimpan **plaintext** di DB (dibutuhkan untuk verify ulang HMAC) — **jangan pernah log/menampilkan**.

**Frontend (src/components/LicenseGate.tsx + App.tsx):**
- LicenseGate aktif **hanya** kalau build dengan `VITE_LICENSE_ENFORCE=1` (langsung return `<LicenseGate/>`
  menggantikan seluruh app, sebelum PinGate). Default self-host = tidak di-enforce.
- Online check: `POST /api/admin/license/redeem` {code, deviceFingerprint} (voucher mode).
- Offline: verifikasi HMAC lokal (Web Crypto) pakai `VITE_LICENSE_SECRET` (build-time) → lic disimpan
  di localStorage (`pb_license_v1`, bind ke device fingerprint `pb_device_fp`).
- Trade-off keamanan di-dokumentasikan di header LicenseGate.tsx (HMAC ada di bundle; revoke best-effort).

---

## Security & Auth (JANGAN dilewati)

- **Session admin**: cookie `admin_session` httpOnly + SameSite=Strict + Secure (prod), TTL 8 jam (30 hari remember-me).
- **CSRF**: double-submit — header `X-XSRF-TOKEN` harus match cookie `XSRF-TOKEN` (kecuali GET/HEAD/OPTIONS).
- **Role**: `super_admin` vs `tenant_admin` vs `tenant_user` — guard di frontend (RoleRoute) DAN backend (`requireRole`).
  tenant_admin hanya boleh operasi pada tenant miliknya (`tenant_id` scope di `requireSession`).
- **Rate limit**: login 5 gagal/15 mnt/email; redeem 5/mnt/IP (in-memory Map).
- **Password**: hash `scrypt:` via `hashPassword()`. `createUser` WAJIB `password` string.
- **PIN tenant**: booth API protected dengan header `x-tenant-pin` (bandingkan dengan `tenants.access_pin`).
- Jangan pernah log/menampilkan `license_secrets.secret`.

---

## Build & Deploy

### Build lokal

```bash
# Booth
VITE_LICENSE_SECRET=<hex64> npm run build        # → dist/

# Admin
cd admin && npm run build                         # → ../dist/admin/
```

### Deploy production (STANDAR WAJIB)

```bash
export VITE_LICENSE_SECRET=$(openssl rand -hex 32)
export LICENSE_SECRET_KEY="$VITE_LICENSE_SECRET"  # HARUS sama dgn VITE_LICENSE_SECRET
export PGPASSWORD='<pw-db>'                       # Wajib — compose ${PGPASSWORD:?} bakal fail kalau kosong
docker compose up -d --build --force-recreate
```

> **WAJIB `--build --force-recreate`** — tanpa `--build`, perubahan source tidak masuk image!
> Kalau bundle tidak berubah walau source berubah → tambah `--no-cache` (bukan ganti flag).
> Env lain yang di-set compose: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PB_DEFAULT_TENANT=booth`, `PGHOST=postgres-kontrakan`.
> Host port `8099` → container `8080`. Postgres **external** (`photobooth-net`, `external: true`).

### Verifikasi setelah deploy

```bash
docker ps                                          # container photobooth Up + healthy
curl -s http://localhost:8099/api/config           # tenant OK
curl -s https://admin.achipix.web.id/api/admin/csrf   # admin OK
```

---

## Env Vars (nama AKURAT — beda dari README lama!)

| Var | Diperlukan | Fungsi |
|-----|-----------|--------|
| `VITE_LICENSE_SECRET` | build-time | Secret HMAC untuk license (baked ke bundle frontend) |
| `LICENSE_SECRET_KEY` | runtime | Secret server-side signing/verify — HARUS sama dgn VITE_LICENSE_SECRET |
| `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE`/`PGPASSWORD` | runtime | Koneksi Postgres (`PGPASSWORD` fallback: file `/tmp/photobooth_pg_pw.txt` → `PB_DB_PW`) |
| `PB_DEFAULT_TENANT` | optional | Tenant default seed + fallback routing |
| `PB_DB_PW` | optional | Fallback password DB (kalau PGPASSWORD kosong) |
| `ADMIN_EMAIL`/`ADMIN_PASSWORD` | optional | Seed super_admin pertama (default `admin@photobooth.local` / `admin123`) |
| `PORT` | optional | Port container (default 8080; compose map ke host 8099) |
| `VITE_LICENSE_ENFORCE` | optional | `1` = enforce license gate di booth (vendor build) |
| `PRINT_ENABLED`/`PRINTER_PATH`/`PRINTER_BAUD` | optional | Printer thermal serial server-side |

> `.env` TIDAK di-commit. Jangan pernah hardcode secret di kode.

---

## Kredensial Dev (jangan commit ke public!)

- Admin: `admin@photobooth.local` / `admin123` (super_admin — dari `ADMIN_EMAIL`/`ADMIN_PASSWORD`, seed hanya kalau user kosong)
- Auto-provision vendor saat redeem: `{tenantSlug}@achipix.local` + password random (reset via admin)

---

## Konvensi Kode

1. **UI text**: Bahasa Indonesia santai. Kode identifier: English.
2. **Backend baru**: ESM `.mjs`, `import` style (package.json type=module).
3. **Frontend booth**: plain CSS + Tailwind, NO MUI (tablet kiosk — bundle kecil).
4. **Admin SPA**: MUI v5; satu komponen utama per halaman di `admin/src/pages/`.
5. **State booth**: Zustand via `src/store/useSession.ts` (session, branding, mode, payment).
6. **React Router admin**: hash mode (`#/`) — penting di belakang Cloudflare Tunnel.
7. **Template/frame/design**: template bawaannya di `TemplateEngine.ts` + `FrameId`; frame custom & design dari DB (`/api/frames`, `/api/designs`).
8. **Attract screen**: semua lewat `branding.*` (attractMedia/Icon/Tagline/CtaText) — endpoint attract terpisah sudah dihapus.
9. Jangan tambah dependency berat tanpa kebutuhan jelas (admin bundle sudah besar; booth harus tetap ringan).
10. `src/App.tsx` sudah besar — tambah state-ish UI di maximal di `modules/`, jangan menumpuk di App kecuali perlu.

---

## Pitfalls (Jangan Terulang)

- `createUser` WAJIB param `password` string — `undefined` akan throw di `hashPassword`.
- Route tanpa auth (mis. `/license/redeem`, `/portal/api/log`) — pakai `req.user?.id ?? null` untuk `logAudit`, bukan `req.user.id` (crash!).
- Jangan duplikat import dari `db.mjs` di `admin-api.mjs` (dulu pernah syntax error).
- `Dockerfile` runtime stage pakai COPY eksplisit (`serve.mjs db.mjs admin-api.mjs ./` + `src/lib/licenseUtil.js`) — file shared baru HARUS ditambah COPY.
- Env DB pakai nama `PGHOST`/`PGPASSWORD` (bukan `PG_HOST`) — dan `PB_DEFAULT_TENANT`, bukan `DEFAULT_TENANT`.
- Compose **hard-require** `VITE_LICENSE_SECRET`, `LICENSE_SECRET_KEY`, `PGPASSWORD` (guard `:?`) — jangan hapus guard ini.
- Build admin lambat (~30-90s) — jangan panik, tunggu.
- Deploy background bisa orphan — cek `process list` sebelum redeploy.
- Jangan re-add endpoint `attract/*` — sudah ditutup 410; pakai `branding.attractMedia`/`attractIcon`.
- QR **tidak dicetak di struk** — QR hanya via tombol "QR HASIL" di layar hasil (upload + bubble). Jangan balikin QR ke struk tanpa persetujuan.

---

## Testing / Verifikasi

- Script verifikasi ad-hoc: `/tmp/routing-verify.sh` (8 route checks) & `/tmp/full-verify.sh` (tenants + audit).
- End-to-end license: generate → redeem → check tenant+user dibuat → cleanup.
- Test backend di container: `docker exec photobooth node --input-type=module -e "..."` (import dari `/app/*.mjs`).
- Smoke test via curl:
  ```bash
  curl -s http://localhost:8099/api/config
  curl -s -X POST http://localhost:8099/api/tenant/verify-pin -H 'Content-Type: application/json' -d '{"pin":"1234"}'
  curl -s https://admin.achipix.web.id/api/admin/csrf
  ```
- Selalu cleanup test data (`DELETE FROM tenants WHERE slug LIKE 'vendor-%'` + `license_codes` terkait).

---

## Git Workflow

- Commit kecil + pesan jelas (conventional: `feat:`, `fix:`, `docs:`, `chore:`).
- Pusatkan workflow: `main` branch, push langsung (self-host).
- JANGAN commit: `dist/`, `node_modules/`, `server/uploads/`, `.env`, secret.