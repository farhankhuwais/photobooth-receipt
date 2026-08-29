export type Role = 'super_admin' | 'tenant_admin' | 'tenant_user'

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
