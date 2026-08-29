import type { AuthState, PagedQuery, ApiList, Tenant, User, PricingTier } from '@/types'

// API client dengan credentials (cookie httpOnly) + double-submit CSRF.

let csrfToken = ''

async function getCsrf(): Promise<string> {
  if (csrfToken) return csrfToken
  // Token dikirim via cookie readable ("double-submit"), baca dari document.cookie.
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
  csrfToken = m ? decodeURIComponent(m[1]) : ''
  return csrfToken
}

export async function api<T>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = 'GET', body } = options
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

  if (res.status === 401) {
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

export const authApi = {
  login: (email: string, password: string) =>
    api<{ user: User }>('/api/admin/login', { method: 'POST', body: { email, password } }),
  logout: () => api<{ ok: boolean }>('/api/admin/logout', { method: 'POST' }),
  me: () => api<AuthState>('/api/admin/me'),
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
