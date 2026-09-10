# Photobooth Receipt

Aplikasi **photobooth web (PWA) multi-tenant** — ambil foto via kamera, susun strip foto
bergaya (template bawaan + bingkai custom + mockup desain), cetak ke **printer thermal**
(Web Bluetooth / WebUSB / Web Serial / bridge / download) dan bagikan hasil via QR.

> **Untuk AI coding agents**: baca [`AGENTS.md`](AGENTS.md) — stack, konvensi, arsitektur
> internal, dan pitfalls yang harus dihindari.

---

## Fitur

- [x] Kamera + countdown + multi-shot (1/2/3/4) + retake per-slot + filter (Komik / Vintage / Sepia / Mono / Sketsa / Sketsa AI Gemini).
- [x] Template: single / dual / strip-3 vertikal / grid-2x2 + bingkai bawaan (love, party, vintage, neon, floral).
- [x] Frame custom PNG per-template & **mockup desain** (bingkai + slot bebas posisi/rotasi) via editor admin.
- [x] Branding: logo, nama event, tanggal, watermark, header/footer text, warna primary, ukuran kertas, darkness cetak.
- [x] Attract screen custom: gambar/video background, ikon, CTA text, tagline (inline di branding preset).
- [x] Encoder ESC/POS tanpa lib eksternal (1-bit dithering Floyd–Steinberg + knob darkness).
- [x] Cetak: Web Bluetooth → WebUSB → Web Serial → bridge → fallback download PNG / `.bin` ESC/POS.
- [x] QR hasil (tombol **QR HASIL**) — hasil di-upload ke server, QR dibuka sebagai bubble draggable; **QR tidak dicetak di struk**.
- [x] Mode **offline-first**: foto masuk outbox device, auto-sync saat online; print tetap jalan.
- [x] Gerbang pembayaran per cetak: **QRIS (simulasi)** / **Cash (konfirmasi operator)**; mode **event** = gratis.
- [x] Transaksi & foto tercatat di Postgres + dashboard statistik + export CSV.
- [x] Multi-tenant dengan subdomain routing + akses **PIN** per tenant.
- [x] Admin dashboard SPA (MUI) untuk tenant, user, pricing tier, lisensi, preset, desain, billing, audit log.
- [x] License code system (HMAC-SHA256, versioned secrets, auto-provision tenant+user, offline-valid).
- [x] PWA installable + build-hash badge untuk verifikasi bundle.
- [ ] Tes cetak nyata ke printer target (XS-80BT) — printer server via `/api/print`.
- [ ] QRIS gateway sungguhan (masih simulasi).

---

## Arsitektur

```
User browser
   │
   ├─ achipix.web.id            → redirect ke /admin (super_admin)
   ├─ admin.achipix.web.id      → Admin dashboard SPA (dist/admin, MUI)
   ├─ {slug}.achipix.web.id     → Photobooth app (tenant/vendor)
   └─ {slug}.achipix.web.id/api → Booth API + /portal/api/* (legacy log transaksi)
```

- **Single container** — semua subdomain dilayani satu proses `serve.mjs` (Express).
- **Single codebase** — booth app (React/Vite) + admin SPA (React/MUI, bundle terpisah di `admin/`) + API server.
- **Postgres eksternal** — bukan service compose; koneksi via env `PGHOST` dkk (default host `postgres-kontrakan`).
- **Multi-tenant** — filter `tenant_id` di semua query; routing subdomain → DB lookup dengan fallback `PB_DEFAULT_TENANT`.
- **License system** — kode `{vendorId}-{expiryEpochMs}-{hmacSha256Hex}`, secret ber-versi (rotasi tidak membatalkan kode lama), auto-provision tenant + user saat redeem.

Target printer thermal: 58mm / 80mm ESC/POS (mis. IWARE XS-80BT, PP583, VSC Q58M).

---

## Prasyarat

- **Docker** + **Docker Compose** (deploy utama).
- **Postgres** yang bisa diakses container (network `photobooth-net` external, lihat `docker-compose.yml`).
- Browser **Chrome / Edge** (butuh `getUserMedia`; cetak langsung butuh Web Serial/WebUSB/Web Bluetooth).
- Kamera (webcam/tablet) untuk mode capture.
- Printer thermal ESC/POS (opsional; tanpa printer app tetap jalan → download).
- Cloudflare Tunnel wildcard `*.achipix.web.id` menuju host port `8099`.

---

## Cara Menjalankan

### Deploy production (Docker Compose)

Env **wajib** (compose langsung gagal kalau kosong — `:?` guard):

```bash
# 1. Generate license secret (64-char hex)
export VITE_LICENSE_SECRET=$(openssl rand -hex 32)
export LICENSE_SECRET_KEY="$VITE_LICENSE_SECRET"   # harus sama dengan VITE_LICENSE_SECRET

# 2. Password Postgres untuk user 'photobooth'
export PGPASSWORD='<password-db-photobooth>'

# 3. Build + start
docker compose up -d --build --force-recreate
```

> **WAJIB `--build --force-recreate`** — tanpa `--build`, perubahan source tidak masuk image.
> Kalau bundle tidak berubah walau source berubah → tambah `--no-cache`.

**Verifikasi:**

```bash
docker ps                                   # container photobooth Up + healthy
curl -s http://localhost:8099/api/config    # {"mode":..., "price":..., ...}
curl -s https://admin.achipix.web.id/api/admin/csrf   # {csrfToken: ...}
```

### Env vars

| Var | Wajib | Fungsi |
|-----|:---:|--------|
| `VITE_LICENSE_SECRET` | ✅ | Secret HMAC license, **build-time** (di-inject bundle frontend) |
| `LICENSE_SECRET_KEY` | ✅ | Secret server-side signing/verify — harus sama dgn `VITE_LICENSE_SECRET` |
| `PGPASSWORD` | ✅ | Password user Postgres `photobooth` (di `db.mjs` dibaca sebagai `PGPASSWORD`) |
| `PGHOST` | | Host Postgres (compose: `postgres-kontrakan`) |
| `PGPORT` | | Port Postgres (default `5432`) |
| `PGUSER` | | User DB (default `photobooth`) |
| `PGDATABASE` | | Nama DB (default `photobooth`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | | Seed user super_admin pertama (default `admin@photobooth.local` / `admin123`) |
| `PB_DEFAULT_TENANT` | | Tenant default saat seeding & fallback routing (compose: `booth`) |
| `VITE_LICENSE_ENFORCE` | | `1` = enforce license gate di booth (khusus build vendor) |
| `PORT` | | Port container (compose: `8080`) |
| `PRINT_ENABLED` / `PRINTER_PATH` / `PRINTER_BAUD` | | Printer serial server-side via `/api/print` |

> `.env` tidak di-commit. Jangan pernah hardcode secret di kode.

### Development lokal

```bash
# Booth app (vite dev server, port 5173)
npm install
VITE_LICENSE_SECRET="<64-char-hex>" npm run dev

# Admin SPA (bundle terpisah, port 5174+)
cd admin && npm install && npm run dev

# Backend (butuh Postgres + env)
PGPASSWORD=... PGHOST=... LICENSE_SECRET_KEY=... node serve.mjs
```

---

## Struktur Folder

```
photobooth/
├─ serve.mjs              # Entry point: Express + tenant routing + booth API + /portal + admin API mount
├─ admin-api.mjs          # Admin REST API (mount di /api/admin/*, hanya subdomain admin)
├─ db.mjs                 # Pool Postgres + schema init/migrate + seed + semua query tenant-scoped
├─ Dockerfile             # Multi-stage: build booth + admin → runtime node:22-slim
├─ docker-compose.yml     # Service photobooth (Postgres = external)
├─ public/                # icon.svg + guides/ (panduan cetak 1foto/2x2/3vertikal)
│
├─ src/                   # Booth frontend (React 18 + Vite + PWA, plain CSS/Tailwind, TANPA MUI)
│  ├─ App.tsx             # Inti app: LicenseGate → PinGate → attract → booth → hasil (satu file besar)
│  ├─ components/         # LicenseGate (aktivasi lisensi offline-first)
│  ├─ store/useSession.ts # Zustand: session, branding, mode, frame/design selection, payment
│  ├─ lib/                # licenseUtil.js (HMAC generate/verify), tenant.ts (slug + header PIN)
│  └─ modules/
│     ├─ camera/          # useCamera, comicFilter (filter foto), aiSketch (Gemini)
│     ├─ templates/       # TemplateEngine (compose strip → canvas)
│     ├─ frames/designs   # dari DB via /api/frames & /api/designs
│     ├─ escpos/          # encoder (dithering), serial/usb/bluetooth/bridge printer
│     ├─ print/           # printService (printSmart: BT→USB→Serial→bridge→download)
│     ├─ qr/              # generate QR dari URL hasil
│     ├─ share/           # upload hasil ke server
│     ├─ offline/         # outbox (antrian foto offline + auto-sync)
│     ├─ pin/             # PinGate (PIN 4 digit per tenant)
│     └─ branding/        # DesignEditor (preview struktur struk)
│
├─ admin/                 # Admin dashboard SPA (MUI v5 + Recharts, hash router) — package.json terpisah
│  └─ src/
│     ├─ App.tsx          # Routes: /login, dashboard, tenants, users, photos, designs,
│     │                   #          presets, audit, billing, tiers, license, settings, manage
│     ├─ pages/           # Login, Dashboard, Tenants, Users, Photos, Designs, Presets,
│     │                   # PricingTiers, AuditLog, Billing, LicenseCodes, Settings, Manage
│     └─ api/client.ts    # REST client (auth session + CSRF header)
│
└─ docs/MULTI_TENANT.md   # Catatan multi-tenant & license (sebagian sudah usang — TODO)
```

> **⚠️ JANGAN edit `server/`** — bridge Node lama, tidak dipakai deploy utama.

---

## API Reference (ringkas)

### Booth API — `/api/*` (tenant subdomain, `x-tenant-pin` bila tenant ber-PIN)

Public tanpa PIN: `/api/tenant/pin-status`, `/api/tenant/verify-pin`, `/api/config`, `/api/presets*`, `/api/designs*`.

| Method | Path | Fungsi |
|--------|------|--------|
| `GET/POST` | `/api/config` | Config aktif (mode/price/preset/branding; `ETag` untuk deteksi perubahan) |
| `GET/POST/PUT/DELETE` | `/api/presets[/:name]` | Preset bernama (mode `regular`/`event`, price, branding) — tier check |
| `GET/POST` | `/api/frames` · `DELETE /api/frames/:id` | Gallery bingkai custom PNG (per-template) — tier check |
| `GET/POST/PUT/DELETE` | `/api/designs[/:id]` · `GET /api/designs/:id/frame` | Mockup desain (bingkai + slots JSON + canvas) — tier check |
| `POST` | `/api/upload` · `GET /u/:id` | Simpan strip hasil → URL digital (dipakai QR) |
| `GET` | `/api/ai/status` | Status AI sketch (tanpa bocorkan API key) |
| `GET/POST` | `/api/ai/settings` | Settings AI sketch per tenant (key dimask) |
| `POST` | `/api/ai/sketch` | Generate sketsa via Gemini (fallback lokal di frontend) |
| `POST` | `/api/print` | Cetak ESC/POS ke printer serial server (`PRINT_ENABLED=1`) |
| `GET/POST` | `/api/tenant/pin-status` · `/api/tenant/verify-pin` | Cek & verifikasi PIN tenant |

### Admin API — `/api/admin/*` (hanya subdomain `admin.*`, session + CSRF)

| Method | Path | Fungsi |
|--------|------|--------|
| `GET` | `/csrf` | Token double-submit CSRF |
| `POST` | `/login` · `/logout` · `GET /me` | Auth (rate limit 5 gagal/15 mnt/email) |
| `GET` | `/overview` · `/my-tier` | Ringkasan global / tier+usage user |
| CRUD | `/tenants` · `/my-tenants` · `/tenant-info/:slug` · `/tenant-stats/:slug` | Manajemen tenant |
| CRUD | `/users` · `/users/:id/code` · `/users/:id/tier` | Manajemen user + kode akses + tier |
| CRUD | `/tiers` | Pricing tiers (max_tenants/photos/frames/designs/presets) |
| `POST` | `/license/generate` · `/license/redeem` · `/license/verify` | Generate / aktivasi (tanpa auth, rate-limit) / verifikasi kode |
| `GET/POST` | `/license/list` · `/license/:id/revoke` · `/license/secrets` · `/license/secret/rotate` | Kelola kode & rotasi secret |
| `GET` | `/audit` (+ `DELETE`, `/audit/cleanup`) | Audit log |
| CRUD | `/photos` · `/designs` · `/presets` · `/config` · `GET /billing` | Data operasional + billing |

> Endpoint `attract/*` lama sudah dihapus (HTTP 410) — attract kini inline di `branding.attractMedia` / `attractIcon` pada preset/config.

### Portal API — `/portal/api/*` (legacy)

| Method | Path | Fungsi |
|--------|------|--------|
| `POST` | `/portal/api/log` | **Tanpa auth** (by design) — booth mencatat transaksi lunas (qris/cash) |
| `POST` | `/portal/api/login` · `/logout` | Sesi cookie `pb_admin_session` (Path=/portal) — legacy |
| CRUD | `/portal/api/tenants` · `/photos` · `/transactions` · `/stats` · `/export` · `/change-password` | Residual API tenant admin lama |

---

## License Code System

**Alur vendor (offline-first):**

```
1. Admin generate kode → POST /api/admin/license/generate {vendorId, expiryDays}
2. Vendor buka booth app (build dgn VITE_LICENSE_ENFORCE=1) → LicenseGate
3. Frontend: parse + HMAC verify lokal (Web Crypto, pakai VITE_LICENSE_SECRET build-time)
4. Online: POST /api/admin/license/redeem {code, deviceFingerprint}
   → server verifikasi HMAC + expiry + status → auto-provision tenant + user → mark redeemed
5. Offline: validasi lokal dipercaya (kode bind ke device fingerprint, tersimpan di localStorage)
6. LicenseGate → PinGate (jika tenant ber-PIN) → attract screen → booth
```

**Format kode:**

```
{vendorId}-{expiryEpochMs}-{hmacSha256Hex}
contoh: vendor-xyz-1790700000000-a1b2c3d4e5f6...
```

**Versioned secret:**

- Tiap kode menyimpan `secret_version` saat di-generate (lookup by version saat verify/redeem).
- `POST /api/admin/license/secret/rotate` (butuh re-auth password) → versi baru; **kode lama tetap valid**.
- Secret disimpan plaintext di tabel `license_secrets` (butuh untuk verify ulang HMAC) — **jangan pernah log/tampilkan**.
- Kode asli **tidak disimpan** di DB — hanya `code_hash` (SHA256) untuk audit/revocation.
- `license_codes` + `license_secrets` → auto-rendem menciptakan tenant `vendor-{slug}` + user `{slug}@achipix.local` (password random 12-char, harus di-reset).

---

## Multi-Tenant

Routing dipusatkan di `resolveTenant(host)` (`db.mjs`):

| Host | Arah |
|------|------|
| `localhost` / IP / root `achipix.web.id` | admin SPA |
| `admin.achipix.web.id` | admin SPA |
| `{slug}.achipix.web.id` | booth app bila `tenants.slug` ada & `active=true` |
| subdomain tak dikenal / nonaktif | fallback `PB_DEFAULT_TENANT` |

Pricing tiers: **Basic (1 tenant)** · **Premium (3)** · **Profesional (99)**. Batas resource
(fotos/frames/designs/presets) di-enforce via `checkTierLimit` → HTTP 403 saat terlampaui.

Akses booth per tenant bisa dibatasi **PIN 4 digit** (`tenants.access_pin`) — booth menampilkan PinGate
dan semua `/api/*` (kecuali public config/presets/designs) wajib header `x-tenant-pin`.

Dokumentasi multi-tenant lengkap (perlu sinkronisasi): `docs/MULTI_TENANT.md`.

---

## Troubleshooting

**Kamera tidak muncul**
- Buka lewat `localhost` / HTTPS (getUserMedia butuh secure context).
- Izinkan permission kamera di browser → refresh.

**Cetak tidak keluar**
- Prioritas `printSmart`: Bluetooth → USB → Serial → bridge (`localStorage.pb_bridge`) → download PNG + `.bin`.
- Printer server: set `PRINT_ENABLED=1` + `PRINTER_PATH` (mis. `/dev/ttyUSB0`), cek `docker logs photobooth`.
- Fallback: tombol **Simpan ESC/POS (.bin)** / download PNG.

**Admin tidak bisa login**
- Credential seed: `ADMIN_EMAIL` / `ADMIN_PASSWORD` (compose default `admin@photobooth.local` / `admin123` — **ganti**).
- Rate limit: 5 gagal / 15 menit / email → tunggu.
- `docker logs photobooth` untuk error Postgres/auth.

**License code ditolak**
- Pastikan `LICENSE_SECRET_KEY` == `VITE_LICENSE_SECRET` saat build.
- Cek `license_codes` — sudah diredeem/direvoke?
- Secret sudah di-rotasi → encode kode baru pakai secret versi baru (DB lookup otomatis).
- Redeem rate-limit 5/mnt/IP.

**Data tenant tercampur**
- Semua query wajib filter `tenant_id` (aturan hard di `db.mjs`).
- Hapus tenant = cascade (`ON DELETE CASCADE`).

---

## Extension Points

- **Template / bingkai baru** — `src/modules/templates/TemplateEngine.ts` + daftar frame di `useSession.ts`.
- **Printer lain** — implement di `src/modules/escpos/` + daftarkan di `printService.ts` (`printSmart`).
- **Field branding baru** — tambah di `BrandingConfig` (`useSession.ts`) + editor di `admin/src/pages/Settings.tsx` + render di `TemplateEngine.ts`.
- **QRIS gateway beneran** — ganti `payQrisSim` di `useSession.ts` dengan polling status pembayaran.
- **Cloud storage** — ganti implementasi `/api/upload` + `getPhoto` di `db.mjs` (sekarang bytea Postgres).