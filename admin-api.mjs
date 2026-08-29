// Admin SPA API — mounted at /api/admin/* in serve.mjs
// Mounted only on the admin subdomain (server.mjs handles host gating).
// Authentication: httpOnly + SameSite=Strict cookie (admin_session).
// CSRF: double-submit token (X-XSRF-TOKEN header must match XSRF-TOKEN cookie).
// Rate limit: 5 failed logins per 15 minutes per email.

import { Router, json as expressJsonRaw } from 'express'
import crypto from 'node:crypto'
import multer from 'multer'
import {
  verifyAdmin, createSession, destroySession, getSessionUser, recordLoginAttempt,
  recentFailedLogins, logAudit, listAudit, listTenantsWithStats, createTenant,
  updateTenant, deleteTenant, listUsers, createUser, updateUser, deleteUser,
  getUserById, setLastLogin, getGlobalOverview, listPhotos, deletePhoto,
  listFrames, listDesigns, getDesign, deleteDesign,
  getConfig, saveConfig, listPresets, getPreset, savePreset, deletePreset,
  getAttract, saveAttract, deleteAttract, getAttractIcon, saveAttractIcon, deleteAttractIcon,
  listTiers, getTier, createTier, updateTier, deleteTier,
  generateUserCode, assignUserCode, setUserTier, checkTierLimit, getUserTierLimit, getTenantUsage,
  countTenantsByOwner, listTenantsByOwner, isTenantOwner,
  pool,
} from './db.mjs'

function expressJson() {
  return expressJsonRaw({ limit: '1mb' })
}

const jsonMiddleware = expressJson()

const ADMIN_COOKIE = 'admin_session'
const CSRF_COOKIE = 'XSRF-TOKEN'
const SESSION_TTL = 8 * 3600 // 8 hours
const REMEMBER_TTL = 30 * 24 * 3600 // 30 days
const FAILED_LOGIN_WINDOW = 15
const FAILED_LOGIN_MAX = 5

function cookie(name, value, opts = {}) {
  const parts = [`${name}=${value}`]
  parts.push('Path=/')
  parts.push('HttpOnly')
  parts.push('SameSite=Strict')
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`)
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

function csrfCookie(value) {
  // CSRF cookie must be readable by JS for double-submit pattern.
  return `${CSRF_COOKIE}=${value}; Path=/; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

function genCsrf() {
  return crypto.randomBytes(24).toString('hex')
}

function genToken() {
  return crypto.randomBytes(32).toString('hex')
}

function clientIp(req) {
  return (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress || null
}

function buildSessionCookie(token, remember) {
  return cookie(ADMIN_COOKIE, token, { maxAge: remember ? REMEMBER_TTL : SESSION_TTL, secure: true })
}

function clearSessionCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`
}

export function adminApi() {
  const r = Router()

  // CSRF token — read/update readable cookie (NOT httpOnly).
  r.get('/csrf', (req, res) => {
    const existing = (req.get('cookie') || '').match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
    const token = existing ? existing[1] : genCsrf()
    res.set('Set-Cookie', csrfCookie(token))
    res.json({ csrfToken: token })
  })

  // Login with rate limit and remember-me.
  r.post('/login', expressJson(), async (req, res) => {
    const { email, password, rememberMe = false } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' })
    const ip = clientIp(req)
    const failed = await recentFailedLogins(email, FAILED_LOGIN_WINDOW)
    if (failed >= FAILED_LOGIN_MAX) {
      await recordLoginAttempt(email, false, ip)
      return res.status(429).json({ error: 'Terlalu banyak percobaan gagal. Coba lagi nanti.' })
    }
    const userId = await verifyAdmin(email, password)
    if (!userId) {
      await recordLoginAttempt(email, false, ip)
      await logAudit({ action: 'login_failed', target: String(email).toLowerCase(), ip, ua: req.get('user-agent') })
      return res.status(401).json({ error: 'Email atau password salah' })
    }
    await recordLoginAttempt(email, true, ip)
    await setLastLogin(userId)
    const user = await getUserById(userId)
    if (!user.active) {
      await logAudit({ action: 'login_blocked_inactive', userId, ip, ua: req.get('user-agent') })
      return res.status(403).json({ error: 'Akun nonaktif' })
    }
    const token = await createSession(userId, rememberMe ? REMEMBER_TTL : SESSION_TTL)
    await logAudit({ action: 'login_success', userId, ip, ua: req.get('user-agent') })
    res.set('Set-Cookie', [buildSessionCookie(token, rememberMe), csrfCookie(genCsrf())])
    res.json({
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        tenant_id: user.tenant_id, tenant_slug: user.tenant_id, created_at: user.created_at,
      },
    })
  })

  // Logout
  r.post('/logout', requireSession, async (req, res) => {
    await destroySession(req.sessionToken)
    await logAudit({ action: 'logout', userId: req.user.id, ip: clientIp(req) })
    res.set('Set-Cookie', clearSessionCookie())
    res.set('Set-Cookie', `${CSRF_COOKIE}=; Path=/; Max-Age=0`)
    res.json({ ok: true })
  })

  // Get current session
  r.get('/me', requireSession, (req, res) => {
    res.json({
      status: 'authenticated',
      user: {
        id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role,
        tenant_id: req.user.tenant_id, tenant_slug: req.user.tenant_id, created_at: req.user.created_at,
        pricing_tier_id: req.user.pricing_tier_id, code: req.user.code,
      },
    })
  })

  // Tier info + usage untuk user yang login (untuk display limit & progress bar)
  r.get('/my-tier', requireSession, async (req, res) => {
    if (!req.user.tenant_id) {
      return res.json({ tier: null, usage: null }) // super_admin: tidak terkait tenant
    }
    const limit = await getUserTierLimit(req.user.id, req.user.tenant_id)
    const usage = await getTenantUsage(req.user.tenant_id)
    res.json({
      tier: limit ? { ...limit } : null,
      usage,
    })
  })

  // Overview stats
  r.get('/overview', requireSession, async (_req, res) => {
    res.json(await getGlobalOverview())
  })

  // Tenants CRUD
  r.get('/tenants', requireSession, requireRole('super_admin'), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50))
    const search = String(req.query.search || '')
    const items = await listTenantsWithStats({ search, limit: pageSize, offset: (page - 1) * pageSize })
    res.json({ items, total: items.length, page, pageSize })
  })

  r.post('/tenants', requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, expressJson(), async (req, res) => {
    const { slug, name, access_pin } = req.body || {}
    if (!slug || !name) return res.status(400).json({ error: 'slug dan name wajib' })
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return res.status(400).json({ error: 'slug hanya boleh huruf kecil, angka, dan strip' })

    // Tier enforcement untuk tenant_admin: cek max_tenants
    if (req.user.role === 'tenant_admin') {
      const tier = await getUserTierLimit(req.user.id, req.user.tenant_id)
      if (tier) {
        const count = await countTenantsByOwner(req.user.id)
        if (count >= tier.max_tenants) {
          return res.status(403).json({
            error: `Batas tier tercapai: Anda hanya boleh memiliki ${tier.max_tenants} tenant. Upgrade tier untuk menambah.`,
          })
        }
      }
      // tenant_admin boleh buat tenant baru dengan dirinya sebagai owner
      const tenant = await createTenant({ slug, name, accessPin: access_pin || null, ownerUserId: req.user.id })
      await logAudit({ userId: req.user.id, tenantSlug: tenant.slug, action: 'tenant_create', target: tenant.slug, ip: clientIp(req) })
      return res.json(tenant)
    }

    // super_admin: tanpa tier limit
    const tenant = await createTenant({ slug, name, accessPin: access_pin || null })
    await logAudit({ userId: req.user.id, tenantSlug: tenant.slug, action: 'tenant_create', target: tenant.slug, ip: clientIp(req) })
    res.json(tenant)
  })

  r.patch('/tenants/:slug', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const tenant = await updateTenant(req.params.slug, {
      name: req.body.name ?? null,
      accessPin: req.body.access_pin === undefined ? undefined : (req.body.access_pin || null),
      active: req.body.active === undefined ? undefined : !!req.body.active,
    })
    if (!tenant) return res.status(404).json({ error: 'Tenant tidak ditemukan' })
    await logAudit({ userId: req.user.id, tenantSlug: tenant.slug, action: 'tenant_update', target: tenant.slug, ip: clientIp(req) })
    res.json(tenant)
  })

  r.delete('/tenants/:slug', requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, async (req, res) => {
    // tenant_admin hanya boleh hapus tenant miliknya
    if (req.user.role === 'tenant_admin') {
      const owner = await isTenantOwner(req.params.slug, req.user.id)
      if (!owner) return res.status(403).json({ error: 'Anda tidak memiliki akses ke tenant ini' })
    }
    await deleteTenant(req.params.slug)
    await logAudit({ userId: req.user.id, action: 'tenant_delete', target: req.params.slug, ip: clientIp(req) })
    res.json({ ok: true })
  })

  // Tenants milik user (untuk tenant_admin): list + tier info
  r.get('/my-tenants', requireSession, requireRole('tenant_admin'), async (req, res) => {
    const items = await listTenantsByOwner(req.user.id)
    const tier = await getUserTierLimit(req.user.id, req.user.tenant_id)
    const used = await countTenantsByOwner(req.user.id)
    res.json({ items, tier: tier ? { ...tier } : null, used, max: tier ? tier.max_tenants : null })
  })

  // Users CRUD (super_admin only)
  r.get('/users', requireSession, requireRole('super_admin'), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50))
    const search = String(req.query.search || '')
    const out = await listUsers({ search, limit: pageSize, offset: (page - 1) * pageSize })
    res.json({ ...out, page, pageSize })
  })

  r.post('/users', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const { email, password, role = 'tenant_admin', tenant_id = null, name = null, pricing_tier_id = null } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'email dan password wajib' })
    if (String(password).length < 8) return res.status(400).json({ error: 'password minimal 8 karakter' })
    const user = await createUser({ email, password, role, tenantId: tenant_id, name, pricingTierId: pricing_tier_id })
    await logAudit({ userId: req.user.id, action: 'user_create', target: user.email, metadata: { role }, ip: clientIp(req) })
    res.json(user)
  })

  r.patch('/users/:id', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const user = await updateUser(Number(req.params.id), {
      role: req.body.role,
      active: req.body.active,
      name: req.body.name,
      password: req.body.password && String(req.body.password).length >= 8 ? req.body.password : undefined,
      pricing_tier_id: req.body.pricing_tier_id === undefined ? undefined : req.body.pricing_tier_id,
    })
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
    await logAudit({ userId: req.user.id, action: 'user_update', target: user.email, ip: clientIp(req) })
    res.json(user)
  })

  // Generate kode akses untuk user
  r.post('/users/:id/code', requireSession, requireRole('super_admin'), requireCsrf, async (req, res) => {
    const code = await generateUserCode()
    const user = await assignUserCode(req.params.id, code)
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
    await logAudit({ userId: req.user.id, action: 'user_code_generate', target: String(user.id), ip: clientIp(req) })
    res.json(user)
  })

  // Assign pricing tier ke user
  r.post('/users/:id/tier', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const user = await setUserTier(req.params.id, req.body?.pricing_tier_id ?? null)
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
    await logAudit({ userId: req.user.id, action: 'user_tier_set', target: String(user.id), ip: clientIp(req) })
    res.json(user)
  })

  // ── Pricing Tiers CRUD (super_admin) ───────────────────────────
  r.get('/tiers', requireSession, requireRole('super_admin'), async (req, res) => {
    const list = await listTiers({ activeOnly: req.query.active === '1' })
    res.json({ items: list })
  })

  r.get('/tiers/:id', requireSession, requireRole('super_admin'), async (req, res) => {
    const tier = await getTier(Number(req.params.id))
    if (!tier) return res.status(404).json({ error: 'Tier tidak ditemukan' })
    res.json(tier)
  })

  r.post('/tiers', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const { slug, name, description, max_tenants, max_photos, max_frames, max_designs, max_presets } = req.body || {}
    if (!slug || !name) return res.status(400).json({ error: 'slug dan name wajib' })
    const tier = await createTier({ slug, name, description, max_tenants, max_photos, max_frames, max_designs, max_presets })
    await logAudit({ userId: req.user.id, action: 'tier_create', target: tier.slug, ip: clientIp(req) })
    res.json(tier)
  })

  r.patch('/tiers/:id', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const tier = await updateTier(Number(req.params.id), req.body || {})
    if (!tier) return res.status(404).json({ error: 'Tier tidak ditemukan' })
    await logAudit({ userId: req.user.id, action: 'tier_update', target: tier.slug, ip: clientIp(req) })
    res.json(tier)
  })

  r.delete('/tiers/:id', requireSession, requireRole('super_admin'), requireCsrf, async (req, res) => {
    await deleteTier(Number(req.params.id))
    await logAudit({ userId: req.user.id, action: 'tier_delete', target: String(req.params.id), ip: clientIp(req) })
    res.json({ ok: true })
  })

  r.delete('/users/:id', requireSession, requireRole('super_admin'), requireCsrf, async (req, res) => {
    await deleteUser(Number(req.params.id))
    await logAudit({ userId: req.user.id, action: 'user_delete', target: String(req.params.id), ip: clientIp(req) })
    res.json({ ok: true })
  })

  // Audit log
  r.get('/audit', requireSession, requireRole('super_admin'), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50))
    const out = await listAudit({ limit: pageSize, offset: (page - 1) * pageSize })
    res.json({ ...out, page, pageSize })
  })

  // Photos - list per tenant (super_admin can choose tenant or all)
  r.get('/photos', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 60))
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    const all = await listPhotos({ limit: pageSize, tenantId: tenantSlug || undefined })
    const items = (all || []).map((p) => ({
      id: p.id, tenant_id: p.tenant_id, created_at: p.created_at, url: `/u/${p.id}`,
    }))
    res.json({ items, total: items.length, page, pageSize })
  })

  r.delete('/photos/:id', requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, async (req, res) => {
    await deletePhoto(req.params.id)
    await logAudit({ userId: req.user.id, action: 'photo_delete', target: req.params.id, ip: clientIp(req) })
    res.json({ ok: true })
  })

  // Frames list per tenant
  r.get('/frames', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    const items = await listFrames(null, tenantSlug || undefined)
    res.json({ items, total: items.length })
  })

  // Designs list per tenant
  r.get('/designs', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    const items = await listDesigns(tenantSlug || undefined)
    res.json({ items, total: items.length })
  })

  // Design detail (raw data including slots, frame buffer url)
  r.get('/designs/:id', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    const item = await getDesign(req.params.id, tenantSlug || undefined)
    if (!item) return res.status(404).json({ error: 'Design tidak ditemukan' })
    res.json(item)
  })

  r.delete('/designs/:id', requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    await deleteDesign(req.params.id, tenantSlug || undefined)
    await logAudit({ userId: req.user.id, action: 'design_delete', target: req.params.id, ip: clientIp(req) })
    res.json({ ok: true })
  })

  // Tenant info (for Manage page) - super_admin can fetch any, tenant_admin only own
  r.get('/tenant-info/:slug', requireSession, async (req, res) => {
    const slug = req.params.slug
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== slug) {
      return res.status(403).json({ error: 'Akses ditolak' })
    }
    const r2 = await pool.query('SELECT slug, name, active, access_pin, created_at FROM tenants WHERE slug = $1', [slug])
    if (!r2.rows[0]) return res.status(404).json({ error: 'Tenant tidak ditemukan' })
    const t = r2.rows[0]
    res.json({
      slug: t.slug, name: t.name, active: t.active,
      has_pin: !!t.access_pin, created_at: t.created_at,
    })
  })

  // Tenant stats (for Manage page)
  r.get('/tenant-stats/:slug', requireSession, async (req, res) => {
    const slug = req.params.slug
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== slug) {
      return res.status(403).json({ error: 'Akses ditolak' })
    }
    const photos = await pool.query('SELECT COUNT(*)::int AS c FROM photos WHERE tenant_id = $1', [slug])
    const totalTx = await pool.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(amount), 0)::bigint AS rev FROM transactions WHERE tenant_id = $1', [slug])
    const todayTx = await pool.query(`SELECT COUNT(*)::int AS c, COALESCE(SUM(amount), 0)::bigint AS rev FROM transactions WHERE tenant_id = $1 AND created_at >= date_trunc('day', now())`, [slug])
    res.json({
      total_photos: photos.rows[0].c,
      total_prints: totalTx.rows[0].c,
      total_revenue: Number(totalTx.rows[0].rev),
      today_prints: todayTx.rows[0].c,
      today_revenue: Number(todayTx.rows[0].rev),
    })
  })

  // App config per tenant (mode/price/preset/branding)
  r.get('/config', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    const c = await getConfig(tenantSlug || undefined)
    res.json(c || { mode: 'regular', price: 5000, preset_name: null, branding: {} })
  })

  r.put('/config', jsonMiddleware, requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.body.tenantSlug || null) : req.user.tenant_id
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    await saveConfig(req.body, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'config_update', target: tenantSlug, ip: clientIp(req) })
    res.json({ ok: true })
  })

  // Billing summary - revenue per tenant, last 30 days
  r.get('/billing', requireSession, requireRole('super_admin'), async (req, res) => {
    const summary = await pool.query(`
      SELECT t.slug, t.name, t.active, t.created_at,
             COUNT(tx.id)::int AS tx_count,
             COALESCE(SUM(tx.amount), 0)::bigint AS total_revenue,
             COALESCE(SUM(CASE WHEN tx.created_at >= date_trunc('month', now()) THEN tx.amount ELSE 0 END), 0)::bigint AS mtd_revenue,
             COALESCE(SUM(CASE WHEN tx.created_at >= date_trunc('day', now()) THEN tx.amount ELSE 0 END), 0)::bigint AS today_revenue
      FROM tenants t
      LEFT JOIN transactions tx ON tx.tenant_id = t.slug
      GROUP BY t.slug, t.name, t.active, t.created_at
      ORDER BY total_revenue DESC
    `)
    const grand = await pool.query(`
      SELECT
        COALESCE(SUM(amount), 0)::bigint AS grand_total,
        COUNT(*)::int AS grand_count
      FROM transactions
    `)
    res.json({
      tenants: summary.rows.map((r) => ({
        slug: r.slug, name: r.name, active: r.active, created_at: r.created_at,
        tx_count: r.tx_count,
        total_revenue: Number(r.total_revenue),
        mtd_revenue: Number(r.mtd_revenue),
        today_revenue: Number(r.today_revenue),
      })),
      grand: {
        total_revenue: Number(grand.rows[0].grand_total),
        tx_count: grand.rows[0].grand_count,
      },
    })
  })

  // ── Presets (CRUD) ──────────────────────────────────────────────
  r.get('/presets', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const rows = await listPresets(tenantSlug)
    res.json(rows)
  })

  r.get('/presets/:name', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const p = await getPreset(req.params.name, tenantSlug)
    if (!p) return res.status(404).json({ error: 'Preset tidak ditemukan' })
    res.json(p)
  })

  r.put('/presets/:name', jsonMiddleware, requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.body.tenantSlug || null) : req.user.tenant_id
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const { name, mode, price, branding } = req.body
    if (!name) return res.status(400).json({ error: 'name wajib' })
    await savePreset(name, mode, price, branding || {}, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'preset_upsert', target: name, ip: clientIp(req) })
    res.json({ ok: true })
  })

  r.delete('/presets/:name', requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.query.tenantSlug || null) : req.user.tenant_id
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    await deletePreset(req.params.name, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'preset_delete', target: req.params.name, ip: clientIp(req) })
    res.json({ ok: true })
  })

  // ── Attract assets (background + icon per mode) ──────────────────
  // Multipart upload (max 50MB — video/image attract files)
  const upload = multer({
    limits: { fileSize: 50 * 1024 * 1024 },
    storage: multer.memoryStorage(),
  })

  // GET /attract/status?tenantSlug=X → metadata for all assets (no binary)
  r.get('/attract/status', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.query.tenantSlug
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const [regBg, evBg, regIcon, evIcon] = await Promise.all([
      getAttract('regular', tenantSlug).catch(() => null),
      getAttract('event', tenantSlug).catch(() => null),
      getAttractIcon('regular', tenantSlug).catch(() => null),
      getAttractIcon('event', tenantSlug).catch(() => null),
    ])
    res.json({
      regular: {
        background: regBg ? { has: true, mediaType: regBg.media_type } : { has: false, mediaType: null },
        icon: regIcon ? { has: true, mediaType: regIcon.media_type } : { has: false, mediaType: null },
      },
      event: {
        background: evBg ? { has: true, mediaType: evBg.media_type } : { has: false, mediaType: null },
        icon: evIcon ? { has: true, mediaType: evIcon.media_type } : { has: false, mediaType: null },
      },
    })
  })

  // GET /attract/file/:type/:mode?tenantSlug=X → binary image/video (for <img src>)
  r.get('/attract/file/:type/:mode', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const { type, mode } = req.params
    const tenantSlug = req.query.tenantSlug
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const cleanMode = mode === 'event' ? 'event' : 'regular'
    try {
      const fn = type === 'icon' ? getAttractIcon : getAttract
      const row = await fn(cleanMode, tenantSlug)
      if (!row) return res.status(404).end()
      res.set('Content-Type', row.media_type)
      res.set('Cache-Control', 'public, max-age=0')
      res.send(row.data)
    } catch (e) {
      res.status(500).json({ error: String(e) })
    }
  })

  // POST /attract/:mode (background upload) — multipart/form-data 'media'
  r.post('/attract/:mode', requireSession, requireRole('super_admin', 'tenant_admin'), upload.single('media'), async (req, res) => {
    const tenantSlug = req.query.tenantSlug
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    if (!req.file) return res.status(400).json({ error: 'no media file' })
    const mt = req.file.mimetype || 'application/octet-stream'
    if (!/^image\//.test(mt) && !/^video\//.test(mt)) {
      return res.status(400).json({ error: 'hanya image atau video' })
    }
    const cleanMode = req.params.mode === 'event' ? 'event' : 'regular'
    await saveAttract(cleanMode, mt, req.file.buffer, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'attract_upload', target: `${cleanMode}/background`, ip: clientIp(req) })
    res.json({ ok: true, mode: cleanMode, mediaType: mt })
  })

  // DELETE /attract/:mode (background delete)
  r.delete('/attract/:mode', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.query.tenantSlug
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const cleanMode = req.params.mode === 'event' ? 'event' : 'regular'
    await deleteAttract(cleanMode, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'attract_delete', target: `${cleanMode}/background`, ip: clientIp(req) })
    res.json({ ok: true })
  })

  // POST /attract/:mode/icon (icon upload) — multipart/form-data 'image'
  r.post('/attract/:mode/icon', requireSession, requireRole('super_admin', 'tenant_admin'), upload.single('image'), async (req, res) => {
    const tenantSlug = req.query.tenantSlug
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    if (!req.file) return res.status(400).json({ error: 'no image file' })
    const mt = req.file.mimetype || 'image/png'
    if (!/^image\//.test(mt)) return res.status(400).json({ error: 'hanya image' })
    const cleanMode = req.params.mode === 'event' ? 'event' : 'regular'
    await saveAttractIcon(cleanMode, mt, req.file.buffer, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'attract_upload', target: `${cleanMode}/icon`, ip: clientIp(req) })
    res.json({ ok: true, mode: cleanMode, mediaType: mt })
  })

  // DELETE /attract/:mode/icon (icon delete)
  r.delete('/attract/:mode/icon', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    const tenantSlug = req.query.tenantSlug
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const cleanMode = req.params.mode === 'event' ? 'event' : 'regular'
    await deleteAttractIcon(cleanMode, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'attract_delete', target: `${cleanMode}/icon`, ip: clientIp(req) })
    res.json({ ok: true })
  })

  return r
}

// =============== Middleware ===============
async function requireSession(req, res, next) {
  const cookieHeader = req.get('cookie') || ''
  const m = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/)
  const token = m ? m[1] : null
  if (!token) return res.status(401).json({ error: 'Sesi tidak ditemukan' })
  const user = await getSessionUser(token)
  if (!user) return res.status(401).json({ error: 'Sesi kadaluarsa' })
  // Re-check tenant access: tenant_admin can only operate on their tenant
  if (user.role === 'tenant_admin' && user.tenant_id) {
    // Add tenant context so downstream routes can scope data
    req.tenantScope = user.tenant_id
  }
  req.sessionToken = token
  req.user = user
  next()
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Akses ditolak' })
    }
    next()
  }
}

function requireCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  const cookieHeader = req.get('cookie') || ''
  const cookieToken = (cookieHeader.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1]
  const headerToken = req.get('x-xsrf-token')
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token tidak valid' })
  }
  next()
}
