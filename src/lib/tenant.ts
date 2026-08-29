// Multi-tenant helper: resolve tenant dari subdomain.
// Contoh: {slug}.achipix.web.id -> slug
export function resolveTenantSlug(host = ''): string | null {
  const parts = host.replace(/:\d+$/, '').split('.')
  if (parts.length >= 3) return parts[0] || null
  return null
}

export function getTenantSlug(): string | null {
  if (typeof window === 'undefined') return null
  return resolveTenantSlug(window.location.hostname)
}

export function withTenantHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const slug = getTenantSlug()
  return slug ? { 'X-Tenant-Slug': slug, ...extra } : { ...extra }
}
