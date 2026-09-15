# SaaS User Onboarding — Task Specification

**Tujuan**: User mendaftar manual → dapat dashboard → masukkan kode akses → dapat 1 tenant → akses booth app.

---

## Arsitektur yang Dipilih

| Item | Keputusan |
|------|-----------|
| **Session cookie** | Terpisah: `user_session` (user) + `admin_session` (admin) |
| **Domain cookie** | `achipix.web.id` (wildcard) |
| **CSRF token** | Shared `XSRF-TOKEN` cookie |
| **User ↔ Tenant** | 1 user = 1 tenant (kecuali super_admin) |
| **Auth flow** | Register/Login manual dulu (OAuth nanti) |
| **Dashboard** | Extend admin SPA (`admin/`) — tambah route publik |

---

## Phase 1 — Backend & DB

### 1.1 Database Migration
- [ ] `ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS redeemed_user_id INTEGER REFERENCES admin_user(id);`
- [ ] Buat tabel `user_sessions`:
  ```sql
  CREATE TABLE IF NOT EXISTS user_sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    remember    BOOLEAN NOT NULL DEFAULT false
  );
  CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id, expires_at DESC);
  ```

### 1.2 `db.mjs` — Helper Functions
- [ ] `createUserSession(userId, remember)` → insert ke `user_sessions`, return sessionId
- [ ] `getUserSessionUser(sessionId)` → join `user_sessions` + `admin_user`, return user object atau null
- [ ] `destroyUserSession(sessionId)` → delete
- [ ] `markLicenseRedeemed()` tambah param `userId` → update `redeemed_user_id`
- [ ] Di `initDb()` / `migrate()`: jalankan migration di atas

### 1.3 `serve.mjs` — Public Auth Endpoints
| Endpoint | Method | Auth | Body | Response |
|----------|--------|------|------|----------|
| `/api/auth/csrf` | GET | ❌ | — | `{ csrfToken }` + set `XSRF-TOKEN` cookie |
| `/api/auth/register` | POST | ❌ | `{ email, password, name? }` | `{ user, redirect: '/redeem' }` + set `user_session` |
| `/api/auth/login` | POST | ❌ | `{ email, password, remember? }` | `{ user, redirect: '/redeem' }` + set `user_session` |
| `/api/auth/status` | GET | `requireUserSession` | — | `{ user, tenant?, hasTenant: boolean }` |
| `/api/auth/logout` | POST | `requireUserSession` | — | `{ ok: true }` + clear `user_session` |

**Validasi register**:
- Email unik (case-insensitive)
- Password ≥ 8 char
- Role default: `tenant_user`, `tenant_id=NULL`

**Cookie settings**:
- `user_session`: HttpOnly, Secure, SameSite=Strict, Path=/, Domain=.achipix.web.id, Max-Age: 24h (default) / 30d (remember)
- `XSRF-TOKEN`: HttpOnly=false (readable), Secure, SameSite=Strict, Path=/

### 1.4 `admin-api.mjs` — Redeem for Authenticated User
- [ ] Middleware `requireUserSession` — baca cookie `user_session`, validasi via `getUserSessionUser()`, attach `req.user`
- [ ] Endpoint `POST /api/admin/license/redeem-for-user`
  - Auth: `requireUserSession` + `requireCsrf`
  - Body: `{ code }`
  - Logic:
    1. Cek `req.user.tenant_id` != null → 400 "Sudah memiliki tenant"
    2. Verifikasi HMAC + revocation (reuse logic dari `/license/redeem`)
    3. Create tenant dari `vendorId` (via `createTenant()`)
    4. `UPDATE admin_user SET tenant_id=$1, role='tenant_admin' WHERE id=$2`
    5. `UPDATE license_codes SET redeemed_user_id=$1 WHERE code_hash=$2`
    6. `logAudit({ userId: req.user.id, action: 'license_redeem_user', target: tenantSlug })`
    7. **Issue NEW `user_session` cookie** (role berubah → session baru)
    8. Return `{ valid: true, tenantSlug, redirectUrl: \`https://${tenantSlug}.achipix.web.id\` }`

---

## Phase 2 — Frontend (Admin SPA Extend)

### 2.1 Routing & Auth Context (`admin/src/`)
- [ ] `App.tsx`: Tambah route publik (tanpa `RoleRoute`):
  - `/register` → `RegisterPage`
  - `/login` → `LoginPage` (extend existing)
  - `/redeem` → `RedeemPage`
- [ ] `AuthContext.tsx`: Tambah `userSession` state, `loginUser()`, `logoutUser()`, `fetchStatus()` yang pakai `/api/auth/*` endpoints
- [ ] `api/client.ts`: Tambah `authApi.register()`, `authApi.login()`, `authApi.status()`, `authApi.logout()`, `authApi.redeemCode()`

### 2.2 Pages Baru
| File | Fungsi |
|------|--------|
| `RegisterPage.tsx` | Form email/password/nama → submit → redirect `/redeem` |
| `LoginPage.tsx` | Extend existing, redirect `/redeem` setelah login |
| `RedeemPage.tsx` | Input kode akses → submit → loading → sukses → redirect ke booth URL |

### 2.3 Dashboard (Existing `Dashboard.tsx`)
- [ ] Kalau `user.tenant_id` null → tampilkan card "Masukkan kode akses" + link ke `/redeem`
- [ ] Kalau sudah punya tenant → tampilkan "Buka aplikasi booth" + info tenant

---

## Phase 3 — Verification & Deploy

- [ ] `npx tsc --noEmit` di `admin/` — pass
- [ ] `npm run build` di `admin/` — pass
- [ ] `node --check serve.mjs db.mjs admin-api.mjs` — pass
- [ ] Docker rebuild & restart
- [ ] Smoke test:
  - Register user baru
  - Login
  - Masukkan kode valid (generate via admin)
  - Redirect ke booth app berhasil
  - Session terpisah dari admin

---

## Catatan Teknis

### TTL Session
- Default: 24 jam
- Remember: 30 hari

### Rate Limiting
- Register: 5/menit/IP (in-memory map, mirip redeem)
- Login: 5 gagal/15 menit/email (reuse existing `admin_login_attempts` atau buat baru)

### Audit Log
- `user_register` — saat register
- `user_login` — saat login
- `license_redeem_user` — saat redeem (user_id tercatat)

### Error Handling
- Semua endpoint return JSON `{ error: 'message' }` dengan status code yang tepat (400, 401, 403, 409, 429, 500)
- Frontend tampilkan error toast/alert yang user-friendly

---

## Dependensi File

### Baru (akan dibuat)
- `admin/src/pages/RegisterPage.tsx`
- `admin/src/pages/RedeemPage.tsx`

### Dimodifikasi
- `db.mjs` — migration + helper session user
- `serve.mjs` — public auth endpoints + middleware `requireUserSession`
- `admin-api.mjs` — middleware `requireUserSession` + endpoint redeem-for-user
- `admin/src/App.tsx` — route publik baru
- `admin/src/context/AuthContext.tsx` — user session logic
- `admin/src/api/client.ts` — authApi methods
- `admin/src/pages/LoginPage.tsx` — redirect logic
- `admin/src/pages/Dashboard.tsx` — conditional render berdasarkan `hasTenant`

---

## Open Questions (Sudah Dijawab)

| Pertanyaan | Jawaban |
|------------|---------|
| 1 user = 1 tenant? | **Ya** — enforce di redeem endpoint |
| Session cookie terpisah? | **Ya** — `user_session` vs `admin_session` |
| OAuth Google? | **Nanti** — Phase 1 manual saja |
| Password reset? | **Nanti** — Phase 1 tidak butuh |
| Email verification? | **Tidak** — register langsung login |

---

## Estimasi Waktu

| Phase | Estimasi |
|-------|----------|
| Phase 1 (Backend + DB) | 2-3 jam |
| Phase 2 (Frontend) | 2-3 jam |
| Phase 3 (Verify + Deploy) | 30-60 menit |
| **Total** | **~5-7 jam** |

---

## Next Steps

1. ✅ Spec approved
2. ▶️ Mulai Phase 1 — DB migration + `db.mjs` helpers
3. ▶️ `serve.mjs` endpoints + `admin-api.mjs` redeem-for-user
4. ▶️ Phase 2 — Frontend pages
5. ▶️ Phase 3 — Build, rebuild container, smoke test