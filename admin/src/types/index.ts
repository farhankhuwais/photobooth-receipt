export type Role = 'super_admin' | 'tenant_admin'

export interface PricingTier {
  id: number
  slug: string
  name: string
  description?: string | null
  max_tenants: number
  max_photos: number
  max_frames: number
  max_designs: number
  max_presets: number
  active: boolean
}

export interface User {
  id: number
  email: string
  role: Role
  name?: string | null
  tenant_id?: string | null
  tenant_slug?: string | null
  last_login_at?: string | null
  created_at: string
  code?: string | null
  pricing_tier_id?: number | null
  // tier info (joined)
  tier_slug?: string | null
  tier_name?: string | null
  tier_max_tenants?: number | null
  tier_max_photos?: number | null
  tier_max_frames?: number | null
  tier_max_designs?: number | null
  tier_max_presets?: number | null
}

export interface Session {
  user: User
  expires_at: string
}

export interface Tenant {
  id: string
  slug: string
  name: string
  active: boolean
  access_pin: string | null
  created_at: string
  updated_at: string
  stats?: {
    photos: number
    transactions: number
    revenue: number
  }
}

export interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  user: User | null
}

export interface ApiList<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface PagedQuery {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  tenantId?: string
}

// Kode aktivasi (6 digit) dari `GET /api/admin/license/codes`.
// Endpoint ini query terpisah dari `/license/list` legacy, tapi baris HMAC lama
// masih mungkin ikut kalau `code_plain`-nya terisi. Deteksi legacy lewat
// `secret_version != null` (kode 6 digit menyimpan secret_version = NULL).
export interface LicenseCode {
  id: number
  code_hash?: string
  code_plain: string | null
  vendor_id?: string | null
  tier_slug: string | null
  expires_at: string
  issued_at: string
  created_at?: string
  issued_by_email?: string | null
  redeemed_at: string | null
  redeemed_by?: string | null
  redeemed_by_email?: string | null
  redeemed_user_email?: string | null
  redeemed_tenant: string | null
  revoked_at: string | null
  revoked_by_email?: string | null
  active: boolean
  for_user_id: number | null
  for_user_email: string | null
  // NULL = kode aktivasi 6 digit; terisi = kode HMAC legacy.
  secret_version?: number | null
  // Metadata pagination (COUNT OVER, bukan kolom tabel).
  total_count?: number
}

// Kode pairing booth (6 digit, TTL pendek, sekali pakai).
// Dari `GET /api/tenant/access-codes`.
export interface PairingCode {
  id: number
  code: string
  tenant_slug: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by_fp: string | null
  active: boolean
}

// Perangkat booth yang sudah ter-pair ke tenant.
// Dari `GET /api/tenant/devices`.
export interface BoothDevice {
  id: number
  device_fp: string
  device_name: string | null
  last_seen_at: string | null
  last_ip: string | null
  is_active: boolean
  paired_at: string
}

// Bahasa booth per akun. Disimpan di branding config (`app_config.branding.lang`)
// dan dibaca booth lewat `GET /api/config`.
export type BoothLang = 'id' | 'en'

// Potongan branding config yang dipakai lintas modul (field lengkap ada di
// Settings.tsx). `lang` mengatur bahasa default aplikasi booth.
export interface BrandingConfig {
  lang?: BoothLang
  [key: string]: unknown
}
