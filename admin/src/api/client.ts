import type {
  AuthState, PagedQuery, ApiList, Tenant, User, PricingTier, LicenseCode,
  PairingCode, BoothDevice,
} from '@/types'

// API client dengan credentials (cookie httpOnly) + double-submit CSRF.

let csrfToken = ''

async function getCsrf(): Promise<string> {
  if (csrfToken) return csrfToken
  const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)
  if (m) {
    csrfToken = decodeURIComponent(m[1])
    return csrfToken
  }
  try {
    const res = await fetch('/api/admin/csrf', { credentials: 'include' })
    if (res.ok) {
      const j = await res.json()
      csrfToken = j.csrfToken || ''
    }
  } catch {
    // ignore
  }
  return csrfToken
}

export async function api<T>(
  url: string,
  options: { method?: string; body?: unknown; skipAuthLogout?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, skipAuthLogout = false } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const token = await getCsrf()
  if (token) headers['X-XSRF-TOKEN'] = token

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })

  // 401 umumnya berarti sesi admin habis → paksa logout global. Tapi ada
  // endpoint (mis. redeem-for-user) yang 401 karena sesi USER tidak aktif
  // padahal sesi admin masih hidup — jangan tendang seluruh aplikasi.
  if (res.status === 401 && !skipAuthLogout) {
    window.dispatchEvent(new Event('auth-unauthorized'))
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j.error) message = j.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export type TenantStatusKind = 'pending' | 'rejected' | 'trial' | 'active' | 'expired' | 'suspended'

export interface TenantStatus {
  slug: string
  name: string
  active: boolean
  status: TenantStatusKind
  trial_ends_at: string | null
  subscription_ends_at: string | null
  grace_period_ends_at: string | null
  days_remaining: number
}

export interface UserStatus {
  user: User
  hasTenant: boolean
  tenant: TenantStatus | null
}

// Respons backend selalu `{ ok, tenant }` (kontrak baru, tanpa field legacy).
export interface RedeemCodeResponse {
  ok: boolean
  tenant: TenantStatus | null
}

export const authApi = {
  login: (email: string, password: string) =>
    api<{ user: User }>('/api/admin/login', { method: 'POST', body: { email, password } }),
  logout: () => api<{ ok: boolean }>('/api/admin/logout', { method: 'POST' }),
  // Probe sesi di boot TIDAK boleh men-dispatch event logout global:
  // 401 di sini cuma berarti "belum ada sesi", bukan sesi mati.
  me: () => api<AuthState>('/api/admin/me', { skipAuthLogout: true }),

  // User auth endpoints (public, uses user_session cookie)
  register: (email: string, password: string, name?: string) =>
    api<{ user: User; redirect: string }>('/api/auth/register', { method: 'POST', body: { email, password, name } }),
  userLogin: (email: string, password: string, remember?: boolean) =>
    api<{ user: User; redirect: string }>('/api/auth/login', { method: 'POST', body: { email, password, remember } }),
  status: () => api<UserStatus>('/api/auth/status'),
  userLogout: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  redeemCode: (code: string) =>
    api<RedeemCodeResponse>('/api/admin/license/redeem-for-user', {
      method: 'POST', body: { code }, skipAuthLogout: true,
    }),
}

export const tenantApi = {
  list: (q: PagedQuery) =>
    api<ApiList<Tenant>>(`/api/admin/tenants?${pagedQuery(q)}`),
  create: (payload: { slug: string; name: string; access_pin?: string }) =>
    api<Tenant>('/api/admin/tenants', { method: 'POST', body: payload }),
  update: (slug: string, payload: Partial<Tenant>) =>
    api<Tenant>(`/api/admin/tenants/${slug}`, { method: 'PATCH', body: payload }),
  remove: (slug: string) =>
    api<{ ok: boolean }>(`/api/admin/tenants/${slug}`, { method: 'DELETE' }),
}

// Pendaftaran vendor baru (status `pending`) — hanya super_admin.
// Super_admin meninjau lalu menyetujui / menolak pendaftaran akun booth.
export interface PendingRegistration {
  slug: string
  name: string
  owner_email: string
  created_at: string
}

export const approvalApi = {
  list: () => api<{ items: PendingRegistration[] }>('/api/admin/pending-registrations'),
  approve: (slug: string) =>
    api<{ ok: boolean }>(`/api/admin/registrations/${encodeURIComponent(slug)}/approve`, { method: 'POST' }),
  reject: (slug: string) =>
    api<{ ok: boolean }>(`/api/admin/registrations/${encodeURIComponent(slug)}/reject`, { method: 'POST' }),
}

export const userApi = {
  list: (q: PagedQuery) =>
    api<ApiList<User>>(`/api/admin/users?${pagedQuery(q)}`),
  create: (payload: { email: string; password: string; role: string; tenant_id?: string | null; pricing_tier_id?: number | null }) =>
    api<User>('/api/admin/users', { method: 'POST', body: payload }),
  update: (id: number, payload: { role?: string; active?: boolean; pricing_tier_id?: number | null }) =>
    api<User>(`/api/admin/users/${id}`, { method: 'PATCH', body: payload }),
  generateCode: (id: number) =>
    api<{ id: number; email: string; code: string }>(`/api/admin/users/${id}/code`, { method: 'POST' }),
  setTier: (id: number, pricing_tier_id: number | null) =>
    api<{ id: number; code: string; pricing_tier_id: number | null }>(`/api/admin/users/${id}/tier`, { method: 'POST', body: { pricing_tier_id } }),
  remove: (id: number) => api<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
}

export const tierApi = {
  list: () => api<{ items: PricingTier[] }>('/api/admin/tiers'),
  create: (payload: Partial<PricingTier> & { slug: string; name: string }) =>
    api<PricingTier>('/api/admin/tiers', { method: 'POST', body: payload }),
  update: (id: number, payload: Partial<PricingTier>) =>
    api<PricingTier>(`/api/admin/tiers/${id}`, { method: 'PATCH', body: payload }),
  remove: (id: number) => api<{ ok: boolean }>(`/api/admin/tiers/${id}`, { method: 'DELETE' }),
}

export const myTenantsApi = {
  get: () => api<{
    items: { slug: string; name: string; active: boolean; access_pin: string | null; created_at: string }[]
    tier: { max_tenants: number; max_photos: number; max_frames: number; max_designs: number; max_presets: number } | null
    used: number
    max: number | null
  }>('/api/admin/my-tenants'),
  create: (payload: { slug: string; name: string; access_pin?: string }) =>
    api<{ slug: string; name: string }>('/api/admin/tenants', { method: 'POST', body: payload }),
  remove: (slug: string) => api<{ ok: boolean }>(`/api/admin/tenants/${slug}`, { method: 'DELETE' }),
}

export const licenseApi = {
  // Generate kode aktivasi 6 digit yang di-bind ke satu user.
  // Backend merombak endpoint: body `{ userId, expiresDays? }` (tanpa `format`).
  generate: (userId: number, expiresDays?: number) =>
    api<{ code: string; expires_at?: string | null; id?: number }>('/api/admin/license/generate', {
      method: 'POST', body: { userId, expiresDays },
    }),
  // Daftar kode aktivasi — endpoint baru & query terpisah dari `/license/list` legacy.
  list: (limit = 20, offset = 0) =>
    api<{ items: LicenseCode[]; total: number }>(
      `/api/admin/license/codes?limit=${limit}&offset=${offset}`,
    ),
  revoke: (id: number) => api<{ ok: boolean }>(`/api/admin/license/${id}/revoke`, { method: 'POST' }),
}

// Booth & Perangkat — pairing device booth (butuh sesi user vendor, bukan admin session).
export const boothApi = {
  // Generate kode pairing 6 digit (TTL pendek, sekali pakai).
  generatePairingCode: (expiryMinutes?: number) =>
    api<{ code: string; expires_at: string }>('/api/tenant/access-code', {
      method: 'POST', body: { expiryMinutes },
    }),
  listPairingCodes: () => api<{ items: PairingCode[] }>('/api/tenant/access-codes'),
  revokePairingCode: (id: number) =>
    api<{ ok: boolean }>(`/api/tenant/access-codes/${id}/revoke`, { method: 'POST' }),
  listDevices: () => api<{ items: BoothDevice[] }>('/api/tenant/devices'),
  revokeDevice: (id: number) =>
    api<{ ok: boolean }>(`/api/tenant/devices/${id}/revoke`, { method: 'POST' }),
}

// ── Langganan (subscription) ─────────────────────────────────────────
// Self-pay perpanjangan langganan via Midtrans Snap. `price` buat nampilin
// harga flat bulanan (server-side env); `pay` minta token Snap.
export interface SubscriptionPrice {
  price: number
  currency: 'IDR'
  client_key: string | null
  is_production: boolean
}

// Respons `pay`: kalau ada `token` → buka popup Snap. Kalau `mock: true`
// (server tanpa key Midtrans) → langganan langsung aktif tanpa popup.
export interface PayResponse {
  token?: string
  redirect_url?: string
  client_key?: string
  is_production?: boolean
  mock?: boolean
}

export const subscriptionApi = {
  price: () => api<SubscriptionPrice>('/api/admin/subscription/price'),
  // POST tanpa body — CSRF tetap dikirim oleh `api()`.
  pay: () => api<PayResponse>('/api/admin/subscription/pay', { method: 'POST' }),
}

function pagedQuery(q: PagedQuery): string {
  const p = new URLSearchParams()
  if (q.page !== undefined) p.set('page', String(q.page))
  if (q.pageSize !== undefined) p.set('pageSize', String(q.pageSize))
  if (q.search) p.set('search', q.search)
  if (q.sortBy) p.set('sortBy', q.sortBy)
  if (q.sortDir) p.set('sortDir', q.sortDir)
  if (q.tenantId) p.set('tenantId', q.tenantId)
  return p.toString()
}

// Deklarasi minimal global `window.snap` (Midtrans Snap.js) — tanpa @types
// tambahan. Script-nya dimuat dinamis dari Dashboard saat mau bayar.
declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        callbacks?: {
          onSuccess?: (result: unknown) => void
          onPending?: (result: unknown) => void
          onError?: (result: unknown) => void
          onClose?: () => void
        },
      ) => void
    }
  }
}
