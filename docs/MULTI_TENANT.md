# Multi-Tenant Photobooth — Dokumentasi Add Tenant

## Arsitektur
- Single app + single codebase + single deployment.
- Semua subdomain `*.achipix.web.id` diarahkan ke container yang sama via Cloudflare tunnel wildcard.
- Backend resolve tenant dari subdomain → filter semua query by `tenant_id`.

## Prasyarat
1. Cloudflare tunnel sudah aktif dengan public hostname wildcard:
   - Subdomain: `*`
   - Domain: `achipix.web.id`
   - Service: menuju container photobooth
2. Container photobooth running (`docker compose ps`).
3. Admin dashboard accessible di `https://achipix.web.id/admin.html`.

## Langkah Tambah Tenant Baru
1. Buka **`https://admin.achipix.web.id`** dan login.
2. Klik menu **🏢 Tenants**.
3. Isi form:
   - **Slug**: subdomain tenant (huruf, angka, dash; mulai huruf/angka; 1-40 char). Contoh: `cust1`, `client-abc`.
   - **Nama Tenant**: nama display untuk tenant. Contoh: `Customer ABC`.
4. Klik **+ Tambah Tenant**.
5. Langsung akses **`https://{slug}.achipix.web.id`**.

## Catatan: Admin Dashboard vs Tenant
- Admin dashboard **hanya** di subdomain **`https://admin.achipix.web.id`**.
- Root domain `https://achipix.web.id` adalah aplikasi photobooth tenant utama.
- Tenant lain tidak bisa akses `/admin.html` atau `/portal` — akan dapat 404.

## Verifikasi
- `https://{slug}.achipix.web.id/api/config` → return data kosong/default untuk tenant baru.
- `https://{slug}.achipix.web.id/api/presets` → array kosong `[]`.
- `https://{slug}.achipix.web.id/api/frames` → array kosong `[]`.
- Upload foto/preset via UI tenant → tersimpan terpisah dari tenant lain (cek via admin dashboard).

## Batasan & Rules
- Admin dashboard **hanya** di `https://achipix.web.id/admin.html`. Tidak bisa diakses dari subdomain tenant.
- Hapus tenant via tombol **Hapus** di tabel → **semua data terkait ikut terhapus** (ON DELETE CASCADE di semua tabel).
- Slug tidak bisa diubah setelah dibuat (karena jadi subdomain). Jika perlu, hapus tenant dan buat ulang.
- Tenant `achipix` adalah tenant utama untuk domain root. Jangan dihapus kecuali tahu yang dilakukan.

## Troubleshooting
- **Subdomain tidak resolve**: Pastikan wildcard Cloudflare sudah ditambahkan (Public Hostname `*`).
- **Data kosong setelah tambah tenant**: Normal. Tenant baru mulai dengan data kosong. Upload preset/frame via UI tenant.
- **Ingin pindah data dari tenant lain**: Tidak ada fitur import/export antar tenant saat ini. Gunakan DB script jika perlu.

## Database Schema (Ringkas)
- `tenants`: daftar tenant (slug PK).
- Semua tabel lain: `photos`, `presets`, `app_config`, `transactions`, `ai_settings`, `frames`, `designs`, `attract_assets` memiliki kolom `tenant_id` dengan foreign key ke `tenants(slug) ON DELETE CASCADE`.
- PK composite `(tenant_id, id)` untuk `app_config`, `frames`, `designs`.
