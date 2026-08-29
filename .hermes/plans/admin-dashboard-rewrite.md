# Plan: Admin Dashboard Rewrite

## Tech Stack
- React 18 + TypeScript + Vite (bundle terpisah: `admin/`)
- React Router v6 (hash mode untuk Cloudflare Tunnel)
- Material UI v5 (UI components)
- Recharts (charts)
- i18next (i18n ready, Bahasa Indonesia first)
- bcrypt (password hashing)
- cookie-parser + express-session (session httpOnly + Postgres)

## Structure
```
admin/
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Root + routing
│   ├── routes/
│   │   ├── index.tsx            # Route definitions
│   │   ├── AuthRoutes.tsx       # Login, logout
│   │   ├── AdminRoutes.tsx      # Super admin routes
│   │   └── TenantRoutes.tsx     # Client tenant routes
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx        # Overview
│   │   ├── Tenants.tsx          # List + CRUD
│   │   ├── TenantDetail.tsx     # Drill down
│   │   ├── Users.tsx            # User management
│   │   ├── Photos.tsx           # Photos management
│   │   ├── Frames.tsx           # Frames CRUD
│   │   ├── Designs.tsx          # Designs CRUD
│   │   ├── AISettings.tsx       # AI config
│   │   ├── AuditLog.tsx         # Simple audit log
│   │   ├── Billing.tsx          # Revenue
│   │   └── Settings.tsx         # Global settings
│   ├── components/
│   │   ├── Layout.tsx           # Sidebar + header
│   │   ├── ProtectedRoute.tsx   # Auth guard
│   │   ├── DataTable.tsx        # Reusable table + pagination/search/sort
│   │   ├── StatsCard.tsx        # Dashboard cards
│   │   └── ...
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useApi.ts
│   │   └── useI18n.ts
│   ├── api/
│   │   ├── client.ts            # Axios/fetch wrapper
│   │   └── endpoints.ts
│   ├── context/
│   │   └── AuthContext.tsx
│   ├── i18n/
│   │   ├── index.ts
│   │   └── locales/id.json
│   └── types/
│       └── index.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── Dockerfile
```

## Backend Changes (serve.mjs)
- Session middleware: cookie httpOnly + Postgres store
- Auth endpoints: `/api/admin/login`, `/api/admin/logout`, `/api/admin/me`
- Admin CRUD endpoints: `/api/admin/tenants`, `/api/admin/users`, `/api/admin/audit-log`
- Rate limiter: 5 req / 15 min di login
- CSRF: double-submit cookie pattern + SameSite=Strict
- RBAC: super_admin, tenant_admin, tenant_user roles

## Database (db.mjs)
- Tabel `admin_users` (existing)
- Tabel `admin_sessions` (existing)
- Tabel `admin_audit_log` (baru: id, user_id, action, target_type, target_id, metadata, created_at)
- Tabel `tenant_users` (baru: id, tenant_id UUID, email, password_hash, role, created_at)
- Migrasi: tenant.id = UUID, tenant.slug = unique string

## Security
- Helmet headers
- CORS: `*.achipix.web.id`
- Rate limit: express-rate-limit
- bcrypt cost 12
- Session: 8h + sliding window (remember-me 30d)
- CSRF: double-submit token
- Input validation: zod
- Audit log: login, logout, create/update/delete tenant, user, frame, design

## Build & Deploy
- `admin/Dockerfile` → build output ke `/app/admin-dist`
- `serve.mjs` serve admin bundle di `/admin` (super admin) dan `/manage` (tenant)
- Single container deploy

## Priority Order
1. Setup project + build config + auth (login/logout/session)
2. Layout + routing + i18n
3. Dashboard overview
4. Tenants CRUD
5. Tenant detail + users
6. Photos / Frames / Designs
7. AI Settings
8. Audit Log + Billing
9. Settings global
10. Test & deploy