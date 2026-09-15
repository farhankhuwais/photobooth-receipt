# Task: Implementasi Flow SaaS Photobooth - Activation Code

**Status:** 🟡 In Progress  
**Prioritas:** Tinggi  
**Target:** Flow baru hasil 20 keputusan (lihat "Rombakan Flow v2") di bawah.

---

## 🎯 Keputusan Rombakan Flow v2 (dari 20 pertanyaan user)

| # | Area | Keputusan |
|---|------|-----------|
| 1 | Registrasi | Daftar + approval admin (tenant 'pending' → trial setelah disetujui) |
| 2 | Akun | Produk dibaca "1 akun = 1 booth = 1 device" — tenant jadi konsep internal invisibel (jangan dihapus dari kode) |
| 3 | Email verifikasi | Tanpa verifikasi (sekarang); nanti: verifikasi email / login Google |
| 4 | Reset password | Via admin (sekarang) |
| 5 | Trial | 3 hari + countdown |
| 6 | Grace | 3 hari |
| 7 | Habis trial/langganan | Dashboard tetap bisa dilihat (laporan), booth saja terkunci |
| 8 | Perpanjang | Gabungan: self-pay Midtrans + kode manual dari admin |
| 9 | Format kode | 6 char alphanumeric (`A-Z2-9`, tanpa I/O/0/1) — aktivasi & pairing |
| 10 | Masa aktif kode aktivasi | 7 hari (asumsi, user tidak eksplisit) |
| 11 | Limit device | 1 device per akun; re-pairing = putuskan lama → pair baru (gratis) |
| 12 | Kode pairing | Single-use |
| 13 | TTL pairing | 15 menit |
| 14 | Booth akses | Pairing code saja (tanpa login email di tablet) |
| 15 | Payment | Midtrans Snap (self-pay) |
| 16 | Model harga | Flat (PB_FLAT_PRICE env) |
| 17 | Kiosk | Full kiosk (fullscreen, wake lock, disable gesture) |
| 18 | Bahasa booth | ID + EN (field `lang` di config) |
| 19 | Notifikasi | Email + WhatsApp, H-3 trial berakhir + expired |
| 20 | Skala | Flow + UX (UI existing dipertahankan) |
| 21 | **Routing** | **Device-based**: tenant dari device fingerprint (`X-Device-Fp`), bukan subdomain. Subdomain jadi alias kosmetik. Fallback lama dipertahankan |

Gelombang 1 (fondasi): routing device-based, approval, kode alphanumeric, limit 1 device, kiosk, i18n, dashboard 1-akun. — ✅ selesai + verifikasi
Gelombang 2: Midtrans + notifikasi Email/WA + field `lang`. — ✅ selesai + verifikasi 25/25 OK

**Status deployment:** ter-deploy & terverifikasi via `scripts/verify-saas.sh --e2e` (register → pending → approve → trial 3 hari → kode 6 char → redeem 30 hari → pairing device single-use → revoke → self-pay simulasi).

**Env baru (opsional, .env):**
- Midtrans: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION`, `PB_FLAT_PRICE` (default 150000), `PB_APP_URL`
- Notifikasi: `SMTP_HOST/PORT/USER/PASS/FROM`, `WA_API_URL` (Fonnte), `WA_TOKEN`
- Tanpa server key → mode simulasi (self-pay langsung aktif, untuk dev)

**Flow final (device-based):**
```
Vendor: register → tenant 'pending' → admin approve di halaman Vendors → trial 3 hari (countdown)
   → habis? dashboard tetap bisa dilihat, booth terkunci → Perpanjang (Midtrans) atau kode aktivasi 6 char
Booth tablet: buka app (domain apa pun) → layar "Hubungkan Booth" → kode pairing 6 char (TTL 15 menit, single-use)
   → device fingerprint terikat → langsung jalan; di-revoke dari dashboard → otomatis kembali ke pairing
Resolusi tenant: X-Device-Fp → subdomain alias → default tenant fallback

---

## 📋 Ringkasan Perubahan Flow

### Flow Lama (dihapus)
```
Admin generate LICENSE code (HMAC panjang) → user copy-paste → redeem → tenant dibuat
```

### Flow Baru (diimplementasi)
```
Register → langsung buat tenant (trial 3 hari) → user bisa pakai booth
Admin kirim kode 6 digit → user masukkan di dashboard → status jadi "Active"
```

---

## 🔄 Status Implementasi

### ✅ Selesai
- [x] Database: `user_sessions` table, `license_codes.redeemed_user_id`, `license_codes.for_user_id`
- [x] Backend: `/api/auth/register`, `/api/auth/login`, `/api/auth/status`, `/api/auth/logout`
- [x] Backend: `/api/admin/license/generate` (bound ke userId)
- [x] Backend: `/api/admin/license/redeem-for-user` (buat tenant + bind user)
- [x] Frontend: RegisterPage, LoginPage, RedeemPage, Dashboard
- [x] State: trial → active → expired → suspended
- [x] Rombak flow register: buat tenant langsung (trial 3 hari) saat register — `startTenantTrial` dipanggil
- [x] Rombak activation code: SATU sistem kode aktivasi 6 digit
  - `POST /license/generate {userId, expiresDays?}` → hanya kode 6 digit (param `format` dihapus)
  - `GET /license/codes` — list kode aktivasi (status Aktif/Terisi/Kadaluarsa/Dicabut)
  - Halaman admin jadi "Kode Aktivasi" (UI HMAC + manajemen secret dihapus)
  - RedeemPage + route `/redeem` dihapus; login user → `/`
  - HMAC legacy tetap di backend untuk vendor LicenseGate build (`VITE_LICENSE_ENFORCE=1`)
- [x] Fix bug redeem mental-ke-login: 401 dari redeem-for-user tidak lagi memicu logout global (`skipAuthLogout`), kartu aktivasi hanya utk user tenant_admin, handler `auth-unauthorized` re-check `/api/auth/status`
- [x] Script verifikasi: `scripts/verify-saas.sh` (smoke 6 cek + e2e 9 cek + pairing 6 cek, cleanup otomatis) — 21/21 OK

### ✅ Fitur: Unlock Booth (Pairing Device) — referensi flow industri
Riset sejenis: dslrBooth/LumaBooth, Foto Master, Sparkbooth, Snappic, + produk lokal (Jepreto, SnapDulu, Boothlab, Sebooth). Pola terpilih: **kiosk pairing code** (seperti Ultiracer/Sephona) — tablet kiosk friendly tanpa keyboard.
- [x] DB: `booth_devices` (tenant_slug + device_fp UNIQUE, last_seen, is_active) + `access_codes.used_by_fp` — kode pairing **single-use**
- [x] `POST /api/access-code/validate {code, deviceFp}` (public) → bind device + tandai kode terpakai
- [x] `GET /api/config` bawa `device_paired` (true/false/null; null = fitur belum aktif untuk tenant) + heartbeat last_seen via `X-Device-Fp`
- [x] Dashboard: card "Booth & Perangkat" — daftar device (Online/Offline, last seen), generate kode pairing (TTL 15 menit) + dialog countdown + salin, revoke device & kode
- [x] Booth: `UnlockGate` (TenantStatusGate → UnlockGate → PinGate) — layar "Hubungkan Booth", simpan `pb_booth_unlock_v1` (bind device fingerprint), revoke → otomatis balik ke layar pairing via polling 5 detik
- [x] Dev loop tanpa rebuild: Vite proxy (booth/admin → :8099) + `docker-compose.dev.yml` (`node --watch serve.mjs`)
- [ ] Belum: limit device per pricing tier (riset: tier-based, mis. Basic 1/Premium 3)
- [x] Dashboard: chip status dinamis + countdown "sisa X hari" + card "Masukkan Kode Akses"
- [x] Booth app: `TenantStatusGate` — cek `tenant_status` dari `/api/config` (poll 5s), blokir saat expired/suspended
- [x] `getEffectiveTenantStatus` (db.mjs) + cron subscription check (hourly)
- [x] Security fix: extend-trial/suspend/reactivate kini butuh CSRF + tenant-scope (owner only)
- [x] Fix: migration `license_codes.redeemed_user_id` + `secret_version` nullable; `markLicenseRedeemed` konsisten
- [x] Fix: import `createTenant` di serve.mjs (register 500)
- [x] Fix: `listUsers` ambiguous `name` (JOIN pricing_tiers)
- [x] E2E terverifikasi: register→trial(3 hari)→generate kode6→redeem→active(30 hari)→redeem ulang ditolak

### 🟡 Sedang Dikerjakan
- (kosong — semua item lanjut ke "Belum Dikerjakan")

### ⬜ Belum Dikerjakan
- [ ] Payment gateway (Midtrans/Xendit)
- [ ] Email notifikasi (H-3 trial berakhir)
- [ ] White-label domain
- [ ] Multi-user per tenant
- [ ] Integrasi cron `runSubscriptionCheck` setelah grace → suspend (sudah jalan, perlu monitor di prod)

---

## 🎯 Design Decisions

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Trial duration | 3 hari | Cukup untuk coba, tidak terlalu lama |
| Grace period | 2 hari | Toleransi setelah expired sebelum suspend |
| Activation code | 6 digit angka | Pendek, mudah diingat/diinput |
| Tenant per user | 1 user = 1 tenant | Simpel, tidak membingungkan |
| Payment | Via dashboard "Perpanjang" | User bayar sendiri, admin tidak perlu intervensi |

---

## 🗂️ Struktur File yang Diubah

### Backend
| File | Perubahan |
|------|-----------|
| `db.mjs` | Migration: `user_sessions`, `license_codes.redeemed_user_id`, `license_codes.for_user_id`, `license_codes.code_plain` |
| `serve.mjs` | Public endpoints: `/api/auth/*`, scheduled job, access code validate |
| `admin-api.mjs` | `requireSession` (dual auth), `redeem-for-user` |

### Frontend
| File | Perubahan |
|------|-----------|
| `admin/src/pages/RegisterPage.tsx` | Redirect ke `/` (bukan `/redeem`) |
| `admin/src/pages/RedeemPage.tsx` | Tombol Back + UX improvements |
| `admin/src/pages/Dashboard.tsx` | Card "Masukkan Kode Akses" + Quick bar |
| `admin/src/pages/Login.tsx` | Toggle admin/user |
| `admin/src/context/AuthContext.tsx` | User auth state terpisah |
| `admin/src/api/client.ts` | authApi methods |
| `admin/src/App.tsx` | Routes `/register`, `/redeem` |

---

## 🐛 Known Issues

| Issue | Status | Solusi |
|-------|--------|--------|
| Session conflict (admin vs user) | ✅ Fixed | Dual cookie handling |
| CSRF token Secure flag | ✅ Fixed | Removed Secure for HTTP |
| Refresh redirect ke login | ✅ Fixed | `/api/auth/status` returns neutral when no session |
| Tenant slug dari email | ✅ Fixed | Sanitize email ke valid slug |
| Login 401 untuk user lama | ⚠️ | User harus register ulang jika tidak ada di DB |

---

## 📝 Next Steps

1. **Rombak flow register** → buat tenant langsung (trial 3 hari) saat register
2. **Rombak activation code** → ganti HMAC dengan kode 6 digit
3. **Dashboard: trial countdown**
4. **Booth app: cek status tenant**
5. **Payment gateway**

---

## 🔄 Cara Melanjutkan Jika Terhenti

1. Baca file ini untuk memahami konteks
2. Cek `TASK_SSAAS_PHOTOOBH.md` untuk status terkini
3. Jalankan `docker ps --filter name=photobooth --format '{{.Status}}'` untuk cek container
4. Jalankan test API via curl untuk verifikasi
5. Mulai dari bagian "Sedang Dikerjakan" yang belum dicentang
