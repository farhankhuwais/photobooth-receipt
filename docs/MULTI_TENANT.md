# Multi-Tenant Photobooth — Dokumentasi

## Arsitektur

```
User browser
   │
   ├─ booth.achipix.web.id     → photobooth app (tenant: booth)
   ├─ hallo.achipix.web.id     → photobooth app (tenant: hallo)
   ├─ {slug}.achipix.web.id   → photobooth app (tenant baru)
   └─ admin.achipix.web.id     → Admin dashboard SPA (super_admin)
```

- **Single container** — semua subdomain masuk container yang sama.
- **Single codebase** — satu deployment untuk semua tenant.
- **Admin dashboard** di subdomain khusus `admin.achipix.web.id`.
- **License system** — kode HMAC-SHA256 untuk aktivasi vendor + auto-provision tenant.

---

## Subdomain Routing

| Subdomain | Akses | Role |
|-----------|-------|------|
| `achipix.web.id` | Redirect ke `/admin` | super_admin |
| `admin.achipix.web.id` | Admin dashboard SPA | super_admin |
| `{slug}.achipix.web.id` | Photobooth app tenant | tenant_admin |

Route di `serve.mjs`:
1. Host `admin.achipix.web.id` → serve admin SPA (`/admin/*`)
2. Root domain `/admin` → redirect ke admin
3. Subdomain known (`booth`, `hallo`, `testing`) → serve booth SPA
4. Subdomain lain → resolve tenant dari DB → filter by `tenant_id`
5. Unknown subdomain → redirect ke default tenant (`booth`)

---

## Tenant Management

### Tambah Tenant (via Admin Dashboard)

1. Buka **`https://admin.achipix.web.id`** → login.
2. Menu **🏢 Tenants**.
3. Isi form:
   - **Slug**: subdomain (huruf, angka, dash; 1-40 char). Contoh: `cust1`, `client-abc`.
   - **Nama Tenant**: nama display.
4. Klik **+ Tambah Tenant**.
5. Langsung akses **`https://{slug}.achipix.web.id`**.

### Pin Access (Opsional)

Tenant bisa di-assign PIN. Vendor buka `https://{slug}.achipix.web.id?pin=XXXX` untuk akses tanpa login.

### Hapus Tenant

Tombol **Hapus** di tabel → semua data terkait ikut terhapus (`ON DELETE CASCADE`).

---

## License Code System

Vendor tidak bisa akses booth app langsung — harus aktivasi dulu dengan **license code**.

### Alur Vendor

```
1. Admin generate kode di dashboard
   → POST /api/admin/license/generate { vendorId, expiryDays, tierSlug }

2. Admin kirim kode ke vendor (via WhatsApp/dll)

3. Vendor buka booth app di tablet
   → LicenseGate muncul → paste kode

4. Frontend HMAC local verify (Web Crypto API)
   → Jika valid → auto POST /api/admin/license/redeem { code, deviceFingerprint }

5. Server: verify HMAC → create tenant + user → mark redeemed
   → Return { valid: true, vendorId, tenant }

6. LicenseGate → PinGate → photobooth app jalan
```

### Format Kode

```
{vendorId}-{expiryTimestamp}-{hmacSha256Hex}
Contoh: vendor-xyz-1790700000000-a1b2c3d4e5f6...
```

### Keamanan

- **HMAC-SHA256** — kode ditandatangani server-side, verifikasi offline bisa dilakukan di browser.
- **Versioned secrets** — rotasi secret tidak invalidasi kode lama (DB lookup by version).
- **Rate limiting** — 5 percobaan redeem per menit per IP.
- **Device fingerprint** — kode bind ke device saat redeem.
- **One-time use** — setelah redeem, `active=false`, tidak bisa dipakai lagi.

### Rotasi Secret

Admin bisa rotasi secret kapan saja:
1. Menu **🔑 License Codes** → scroll ke bawah "Manajemen Secret".
2. Klik **Rotate Secret** → konfirmasi password.
3. Secret baru di-generate → semua kode baru pakai secret baru.
4. **Kode lama tetap valid** (server lookup secret by version).
5. Offline validation di browser tetap pakai secret lama (baked di bundle).
   → Rebuild dengan `VITE_LICENSE_SECRET` baru jika perlu update offline.

---

## Pricing Tiers

| Tier | Max Tenants | Fitur |
|------|-------------|-------|
| Basic (id=1) | 1 | Attract + Presets + Frames |
| Premium (id=2) | 3 | + semua fitur |
| Profesional (id=3) | 10 | + semua fitur |

Tenant dibatasi jumlah berdasarkan tier saat dibuat. Enforcement ada di:
- `checkTierLimit(tenantOwnerUserId)` → di `serve.mjs`
- POST `/api/presets`, `/api/frames`, `/api/designs` → return 402 jika exceeded

### Tier Management

Admin: menu **💰 Pricing Tiers** → CRUD tier.

---

## User Roles

| Role | Akses |
|------|-------|
| `super_admin` | Admin dashboard, semua tenant, semua fitur |
| `tenant_admin` | Booth app tenant, manajemen preset/attract/frames sendiri |
| `user` | Booth app (tanpa manage) |

Tenant admin dibuat otomatis saat license code di-redeem:
- Email: `{tenantSlug}@achipix.local`
- Password default: `vendor123` (harus ganti)

---

## Database Schema

### Tabel Utama

| Tabel | Keterangan |
|-------|-----------|
| `tenants` | Daftar tenant (slug PK, name, owner_user_id, pricing_tier_id, pin, access_pin) |
| `admin_user` | User (id, email, password_hash, role, tenant_id, pricing_tier_id) |
| `admin_sessions` | Session (sid PK, user_id, expires) |
| `admin_audit_log` | Audit trail (action, target, ip, user_id) |
| `admin_login_attempts` | Rate limit login (email, ts) |

### Tabel Aplikasi

| Tabel | Tenant-scoped | Keterangan |
|-------|:---:|-----------|
| `photos` | ✅ | Foto capture |
| `presets` | ✅ | Template preset |
| `frames` | ✅ | Frame/bingkai |
| `designs` | ✅ | Desain custom |
| `attract_assets` | ✅ | Attract screen assets |
| `transactions` | ✅ | Riwayat transaksi |
| `app_config` | ✅ | Konfigurasi per-tenant |
| `ai_settings` | ✅ | AI sketch settings |

### Tabel License

| Tabel | Keterangan |
|-------|-----------|
| `license_codes` | Kode issued (code_hash, vendor_id, tier_slug, expires_at, active, redeemed_at, secret_version) |
| `license_secrets` | Secret versions (version, secret, is_current, rotated_by, rotated_from) |

---

## Troubleshooting

**Subdomain tidak resolve**
- Pastikan Cloudflare tunnel wildcard aktif (`*` → container).
- Cek DNS di Cloudflare dashboard.

**Data tenant tercampur**
- Semua query difilter by `tenant_id` di `db.mjs`.
- Menu **Attract & Presets** di admin dashboard bisa pilih tenant via dropdown.

**Vendor tidak bisa redeem kode**
- Cek `docker logs photobooth` — error LICENSE_SECRET_KEY?
- Cek apakah kode sudah di-redeem sebelumnya.
- Cek apakah kode expired (timestamp).

**Admin tidak bisa login**
- Credential default: `admin@achipix.com` + password admin (lihat credential sheet).
- Cek `docker logs photobooth` untuk error Postgres/auth.