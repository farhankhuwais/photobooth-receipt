# Photobooth Receipt

> **For AI coding agents**: lihat [`AGENTS.md`](AGENTS.md) — tech stack, konvensi, dan panduan develop.

Aplikasi **photobooth web (PWA)** multi-tenant — ambil foto via kamera, susun strip foto
bergaya (multi-template + branding), cetak ke **printer thermal** dan bagi via QR + Web Share.

---

## Arsitektur

```
User browser
   │
   ├─ booth.achipix.web.id     → photobooth app (vendor/tenant)
   ├─ hallo.achipix.web.id     → photobooth app (vendor/tenant)
   ├─ {slug}.achipix.web.id   → photobooth app (vendor/tenant)
   └─ admin.achipix.web.id     → Admin dashboard SPA (super_admin)
                                    └─ /admin/ → License Codes
                                    └─ /admin/ → Tenants, Users, Pricing Tiers
                                    └─ /admin/ → Attract & Presets (per tenant)
                                    └─ /admin/ → Billing (mockup)
```

- **Single container** — semua subdomain masuk container yang sama.
- **Single codebase** — frontend booth (React/Vite) + admin SPA (MUI) + API server (Express/Node).
- **Multi-tenant** — filter by `tenant_id` di semua query.
- **License system** — HMAC-signed code (vendor-id-expiry-hmacsha256), versioned secrets, auto-provision tenant.
- **Pricing tiers** — Basic / Premium / Profesional dengan batasan fitur.

Target printer: **IWARE XS-80BT** (80mm, ESC/POS) atau printer thermal lain.

---

## Prasyarat

- **Docker** + **Docker Compose** (cara deploy utama)
- Browser **Chrome / Edge** (butuh `getUserMedia` + Web Serial). Safari/iOS tidak didukung untuk cetak langsung.
- Kamera (webcam/laptop) untuk mode capture.
- Printer thermal (opsional; tanpa printer app tetap jalan → download).
- Cloudflare tunnel dengan wildcard subdomain `*.achipix.web.id`.

---

## Cara Menjalankan

### Deploy production (Docker Compose)

```bash
# Generate secret (64-char hex)
SECRET=$(openssl rand -hex 32)

# Build + start
VITE_LICENSE_SECRET="$SECRET" \
LICENSE_SECRET_KEY="$SECRET" \
docker compose up -d --build --force-recreate

# Verifikasi
docker ps
curl https://booth.achipix.web.id/     # → 200
curl https://admin.achipix.web.id/     # → 200
```

**Variable env yang wajib:**
| Var | Fungsi |
|-----|--------|
| `VITE_LICENSE_SECRET` | Secret untuk HMAC license codes (baked ke frontend bundle) |
| `LICENSE_SECRET_KEY` | Secret untuk server-side signing & verification |

> Tanpa keduanya, server tetap jalan tapi license system tidak aktif.

**Opsional:**
| Var | Default | Fungsi |
|-----|---------|--------|
| `PORT` | `8080` | Port internal container |
| `PG_HOST` | `postgres` | Host Postgres |
| `PG_PORT` | `5432` | Port Postgres |
| `PG_DATABASE` | `photobooth` | Nama DB |
| `PG_USER` | `photobooth` | Username DB |
| `VITE_LICENSE_ENFORCE` | `0` | 1 = enforce license gate (vendor build only) |

### Development lokal

```bash
# Frontend booth app
npm install
VITE_LICENSE_SECRET="<64-char-hex>" npm run dev   # localhost:5173

# Admin SPA (separate dir)
cd admin && npm install && npm run dev

# Backend (serve.mjs)
node serve.mjs
```

---

## Struktur Folder

```
photobooth/
├─ AGENTS.md              # Panduan agent AI (tech stack, konvensi, pitfalls)
├─ serve.mjs              # Combined server: Express API + static file serving
├─ admin-api.mjs          # Admin REST API (mounted di /api/admin/*)
├─ db.mjs                 # Postgres helpers + schema init + migrations
├─ docker-compose.yml     # Container definition (booth + Postgres)
├─ Dockerfile             # Multi-stage build
│
├─ src/                   # Booth frontend (React/Vite/PWA)
│  ├─ App.tsx             # Root: LicenseGate + PinGate + routing
│  ├─ components/
│  │  └─ LicenseGate.tsx  # License activation UI (conditional)
│  └─ lib/
│     └─ licenseUtil.js   # HMAC-SHA256: generate + verify license codes
│
├─ admin/                 # Admin dashboard SPA (MUI/React Router v6)
│  ├─ src/
│  │  ├─ App.tsx          # Routes: / /tenants /users /pricing /license /attract
│  │  ├─ pages/
│  │  │  └─ LicenseCodes.tsx  # Generate / list / revoke codes + secret rotation
│  │  └─ api/client.ts    # REST client untuk admin-api.mjs
│  └─ package.json
│
└─ docs/
   └─ MULTI_TENANT.md     # Dokumentasi multi-tenant
```

---

## License Code System

### Alur Vendor (offline-first)

```
1. Admin generate kode di dashboard → kirim ke vendor
2. Vendor buka app di tablet
3. LicenseGate muncul → paste kode
4. Frontend: HMAC local verify (Web Crypto API) → "Kode valid, tapi perlu online untuk aktivasi"
5. Frontend: POST /api/admin/license/redeem {code, deviceFingerprint}
6. Server: verify HMAC → check DB → create tenant + user → mark redeemed
7. Server: return { valid: true, vendorId, tenant }
8. LicenseGate → PinGate → app jalan
```

### Format Kode

```
{vendorId}-{expiryTimestamp}-{hmacSha256Hex}
Contoh: vendor-xyz-1790700000000-a1b2c3d4e5f6...
```

### API Endpoints

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| `POST` | `/api/admin/license/generate` | super_admin + CSRF | Generate kode HMAC |
| `GET` | `/api/admin/license/list` | super_admin | List kode (paginated) |
| `POST` | `/api/admin/license/revoke` | super_admin + CSRF | Revoke kode |
| `POST` | `/api/admin/license/redeem` | **tidak ada** | Aktivasi kode + auto-provision |
| `POST` | `/api/admin/license/verify` | session | Verifikasi kode |
| `GET` | `/api/admin/license/secrets` | super_admin | List secret versions |
| `POST` | `/api/admin/license/secret/rotate` | super_admin + CSRF + password confirm | Rotasi secret |

### Rotating Secret (Versioned)

- Setiap kode menyimpan `secret_version` saat di-generate.
- Rotasi secret baru TIDAK invalidasi kode lama — server lookup secret berdasarkan version.
- Rotasi butuh **password konfirmasi** (re-auth super_admin).
- Semua secret version disimpan di DB (`license_secrets` table).
- **Offline validation** di frontend tetap pakai secret lama (baked di bundle) — rebuild dengan secret baru jika perlu update offline.

---

## Multi-Tenant

Dokumentasi lengkap: [`docs/MULTI_TENANT.md`](docs/MULTI_TENANT.md)

### Subdomain Routing

```
achipix.web.id         → redirect ke /admin (super_admin)
admin.achipix.web.id   → admin dashboard SPA
{slug}.achipix.web.id → photobooth app (tenant)
```

### Pricing Tiers

| Tier | Max Tenants | Fitur |
|------|-------------|-------|
| Basic | 1 | Attract + Presets + Frames |
| Premium | 3 | + semua fitur |
| Profesional | 10 | + semua fitur |

---

## Fitur

- [x] Kamera + countdown + multi-shot + thumbnail progres.
- [x] Template: strip-vertikal / grid-2x2 / single.
- [x] Branding: logo, event name, tanggal, watermark.
- [x] Encoder ESC/POS (dither 1-bit Floyd–Steinberg) — tanpa lib eksternal.
- [x] Cetak: Web Serial + Node bridge + download fallback.
- [x] QR di struk + auto-upload → link digital.
- [x] Share (Web Share API / download).
- [x] Settings persist + PWA installable.
- [x] Multi-tenant dengan subdomain routing.
- [x] Admin dashboard (MUI SPA) untuk manajemen tenant, user, preset, attract.
- [x] License code system (HMAC-SHA256, versioned secrets, auto-provision).
- [ ] Tes cetak nyata ke XS-80BT.
- [ ] Billing integration (mockup).

---

## Troubleshooting

**Kamera tidak bisa diakses**
- Buka lewat **localhost**, bukan IP (http://192.168.x.x). Kamera butuh secure context.
- Izinkan kamera di browser → refresh.

**Cetak tidak keluar**
- Web Serial: pasang printer → COM port → pilih port di tombol Cetak.
- Bridge: `server` jalan + `bridgeUrl` benar.
- Fallback: download PNG / `.bin` ESC/POS.

**Admin tidak bisa login**
- Cek credential: `admin@achipix.com` + password admin.
- Cek `docker logs photobooth` untuk error.

**License code ditolak**
- Pastikan `LICENSE_SECRET_KEY` env sama dengan `VITE_LICENSE_SECRET` saat build.
- Cek `license_codes` table di DB — kode sudah di-redeem?
- Cek apakah secret sudah di-rotasi (kode lama mungkin perlu refresh).

---

## Extension Points

- **Template baru**: tambah case di `TemplateEngine.ts` + opsi di `App.tsx`.
- **Printer lain**: implement di `src/modules/escpos/` + daftarkan di `printService.ts`.
- **Field branding baru**: tambah ke `BrandingConfig` + `Settings.tsx` + `TemplateEngine.ts`.
- **Cloud storage**: ganti implementasi `/api/upload` di `serve.mjs`.
- **Billing**: implementasi dari mockup di `admin/src/pages/Billing.tsx`.
