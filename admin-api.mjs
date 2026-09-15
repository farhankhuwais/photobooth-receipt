// Admin SPA API — mounted at /api/admin/* in serve.mjs
// Mounted only on the admin subdomain (server.mjs handles host gating).
// Authentication: httpOnly + SameSite=Strict cookie (admin_session).
// CSRF: double-submit token (X-XSRF-TOKEN header must match XSRF-TOKEN cookie).
// Rate limit: 5 failed logins per 15 minutes per email.

import { Router, json as expressJsonRaw } from 'express'
import crypto from 'node:crypto'
import multer from 'multer'
import { verifyLicenseCode } from './src/lib/licenseUtil.js'
import {
  verifyAdmin, createSession, destroySession, getSessionUser, recordLoginAttempt,
 recentFailedLogins, logAudit, listAudit, listTenantsWithStats, createTenant,
 updateTenant, deleteTenant, listUsers, createUser, updateUser, deleteUser,
 getUserById, setLastLogin, getGlobalOverview, listPhotos, deletePhoto,
 listDesigns, getDesign, deleteDesign, saveDesign, updateDesign,
 getConfig, saveConfig, listPresets, getPreset, savePreset, deletePreset,
 listTiers, getTier, createTier, updateTier, deleteTier,
 generateUserCode, assignUserCode, setUserTier, checkTierLimit, getUserTierLimit, getTenantUsage,
 countTenantsByOwner, listTenantsByOwner, isTenantOwner,
 listPendingRegistrations, rejectTenantRegistration,
 recordLicenseCode, getLicenseByHash, listLicenseCodes, listActivationCodes,
 revokeLicenseCode, markLicenseRedeemed,
 getSecretByVersion, listSecretVersions, rotateSecret,
 findUserByEmail,
 createUserSession, getUserSessionUser, destroyUserSession,
  activateTenantSubscription, getTenantSubscription, approveTenantRegistration,
  getEffectiveTenantStatus, createSubscriptionPayment, markSubscriptionPaymentPaid,
  markSubscriptionPaymentFailed, setSubscriptionPaymentSnapToken,
  pool,
} from './db.mjs'

function expressJson() {
  return expressJsonRaw({ limit: '20mb' })
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
  // Secure dihilangkan agar bisa dipakai via HTTP (Cloudflare Tunnel, localhost dev).
  return `${CSRF_COOKIE}=${value}; Path=/; SameSite=Strict`
}

function genCsrf() {
  return crypto.randomBytes(24).toString('hex')
}

function genToken() {
  return crypto.randomBytes(32).toString('hex')
}

// Kode aktivasi 6 karakter alfanumerik (charset tanpa I/O/0/1) — selalu UPPERCASE.
// Sama charset dengan access code booth; pakai crypto (bukan Math.random).
const ACTIVATION_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomActivationCode() {
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += ACTIVATION_CHARSET[crypto.randomInt(0, ACTIVATION_CHARSET.length)]
  }
  return out
}

function clientIp(req) {
  return (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress || null
}

function buildSessionCookie(token, remember) {
  return cookie(ADMIN_COOKIE, token, { maxAge: remember ? REMEMBER_TTL : SESSION_TTL, secure: false })
}

function clearSessionCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
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
    // Clear user_session cookie to avoid conflict
    res.set('Set-Cookie', [buildSessionCookie(token, rememberMe), csrfCookie(genCsrf()), 'user_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'])
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

  // ── Approval registrasi vendor ──────────────────────────────────────────────
  // Registrasi /api/auth/register membuat tenant status 'pending'; trial baru
  // mulai setelah approve.
  //   GET  /pending-registrations      → daftar tenant pending + email pendaftar
  //   POST /registrations/:slug/approve → status 'trial' + trial_ends_at di-set
  //   POST /registrations/:slug/reject  → status 'rejected' (tenant tetap ada)
  r.get('/pending-registrations', requireSession, requireRole('super_admin'), async (_req, res) => {
    const items = await listPendingRegistrations()
    res.json({ items, total: items.length })
  })

  r.post('/registrations/:slug/approve', requireSession, requireRole('super_admin'), requireCsrf, async (req, res) => {
    const slug = String(req.params.slug || '').trim()
    const sub = await getTenantSubscription(slug)
    if (!sub) return res.status(404).json({ error: 'Tenant tidak ditemukan' })
    // Idempotent: approve ulang tetap aman (helper set active=true + mulai trial).
    await approveTenantRegistration(slug)
    await logAudit({ userId: req.user.id, tenantSlug: slug, action: 'registration_approve', target: slug, ip: clientIp(req) })
    const tenant = await getTenantSubscription(slug)
    res.json({ ok: true, tenant })
  })

  r.post('/registrations/:slug/reject', requireSession, requireRole('super_admin'), requireCsrf, async (req, res) => {
    const slug = String(req.params.slug || '').trim()
    const sub = await getTenantSubscription(slug)
    if (!sub) return res.status(404).json({ error: 'Tenant tidak ditemukan' })
    await rejectTenantRegistration(slug)
    await logAudit({ userId: req.user.id, tenantSlug: slug, action: 'registration_reject', target: slug, ip: clientIp(req) })
    const tenant = await getTenantSubscription(slug)
    res.json({ ok: true, tenant })
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
    const { email, password, tenant_id = null, name = null, pricing_tier_id = null } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'email dan password wajib' })
    if (String(password).length < 8) return res.status(400).json({ error: 'password minimal 8 karakter' })
    const user = await createUser({ email, password, role: req.body.role || 'tenant_admin', tenantId: tenant_id, name, pricingTierId: pricing_tier_id })
    await logAudit({ userId: req.user.id, action: 'user_create', target: user.email, ip: clientIp(req) })
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

  // ── Kode Aktivasi (6 char alfanumerik) — SATU-SATUNYA jalur aktivasi admin ───
  // Generate: POST /api/admin/license/generate
  //   Body: { userId, expiresDays? }  (expiresDays default 7, di-clamp 1..30)
  //   Returns: { code: 'AB3K7Q', expires_at, id }
  //   Kode disimpan sebagai SHA256 hash + plaintext (buat re-copy admin),
  //   secret_version NULL menandai ini kode aktivasi (bukan HMAC legacy).
  //   Catatan: HMAC legacy tetap hidup untuk LicenseGate vendor via /license/redeem,
  //   tapi TIDAK lagi digenerate dari endpoint ini.
  r.post('/license/generate', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const { userId } = req.body || {}

    // expiresDays opsional: default 7 hari, dibatasi 1..30 hari.
    let expiresDays = Number(req.body?.expiresDays)
    if (!Number.isFinite(expiresDays) || expiresDays <= 0) expiresDays = 7
    expiresDays = Math.min(30, Math.max(1, Math.round(expiresDays)))

    if (!userId) return res.status(400).json({ error: 'userId wajib untuk kode aktivasi' })
    const { rows } = await pool.query(
      `SELECT u.id, u.email, t.slug AS tier_slug
       FROM admin_user u LEFT JOIN pricing_tiers t ON t.id = u.pricing_tier_id
       WHERE u.id = $1`,
      [userId]
    )
    if (!rows.length) return res.status(404).json({ error: 'User tidak ditemukan' })
    const targetUser = rows[0]
    const expiresAt = new Date(Date.now() + expiresDays * 86400000)

    // Generate 6 char unik; retry kalau tabrakan code_hash (ON CONFLICT DO NOTHING → null).
    let code = ''
    let inserted = null
    for (let attempt = 0; attempt < 10 && !inserted; attempt++) {
      code = randomActivationCode()
      inserted = await recordLicenseCode({
        code,
        vendorId: targetUser.email,
        tierSlug: targetUser.tier_slug || null,
        expiresAt,
        issuedBy: req.user.id,
        secretVersion: null, // kode aktivasi tidak HMAC-signable
        forUserId: targetUser.id,
      }).catch(() => null)
    }
    if (!inserted) return res.status(500).json({ error: 'Gagal membuat kode, coba lagi' })
    await logAudit({ userId: req.user.id, action: 'license_generate', target: targetUser.email, metadata: { format: 'code6', forUserId: targetUser.id }, ip: clientIp(req) })
    return res.json({ code, expires_at: inserted.expires_at, id: inserted.id })
  })

  // List issued codes for admin UI
  //   GET /api/admin/license/list?limit=20&offset=0&vendor_id=...
  //   (campur kode HMAC legacy + kode aktivasi; dipertahankan apa adanya)
  r.get('/license/list', requireSession, requireRole('super_admin'), async (req, res) => {
    const { items, total } = await listLicenseCodes({
      limit: Math.min(Number(req.query.limit) || 20, 200),
      offset: Number(req.query.offset) || 0,
      vendorId: req.query.vendor_id || null,
    })
    res.json({ items, total })
  })

  // List kode aktivasi 6 char khusus tabel "Kode Aktivasi" di UI.
  //   GET /api/admin/license/codes?limit=50&offset=0
  // Endpoint BARU + query terpisah supaya /license/list lama tidak tersentuh.
  // Kolom: id, code_plain, tier_slug, expires_at, active, created_at, redeemed_at,
  //        redeemed_by_email, redeemed_tenant, redeemed_user_email, for_user_email,
  //        secret_version (NULL = kode aktivasi).
  r.get('/license/codes', requireSession, requireRole('super_admin'), async (req, res) => {
    const { items, total } = await listActivationCodes({
      limit: Math.min(Number(req.query.limit) || 50, 200),
      offset: Number(req.query.offset) || 0,
    })
    res.json({ items, total })
  })

  // Revoke a license (admin can revoke before expiry)
  //   POST /api/admin/license/:id/revoke
  r.post('/license/:id/revoke', requireSession, requireRole('super_admin'), requireCsrf, async (req, res) => {
    const revoked = await revokeLicenseCode(Number(req.params.id), req.user.id)
    if (!revoked) return res.status(404).json({ error: 'Kode tidak ditemukan atau sudah nonaktif' })
    await logAudit({ userId: req.user.id, action: 'license_revoke', target: String(req.params.id), ip: clientIp(req) })
    res.json({ ok: true, id: revoked.id })
  })

  // ── Simple in-memory rate limiter for unauthenticated endpoints ────────────
  const redeemRateMap = new Map()
  function checkRateLimit(ip, key = 'redeem', limit = 5, windowMs = 60000) {
    const now = Date.now()
    const entry = redeemRateMap.get(ip) || { count: 0, resetAt: now + windowMs }
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs }
    entry.count++
    redeemRateMap.set(ip, entry)
    return entry.count <= limit
  }

  // LEGACY vendor HMAC redeem — jangan dipakai flow SaaS baru.
  // Dipakai booth LicenseGate (vendor build VITE_LICENSE_ENFORCE=1), perilakunya
  // sengaja TIDAK diubah. Aktivasi SaaS user pakai /license/redeem-for-user.
  //   POST /api/admin/license/redeem
  //   Body: { code, deviceFingerprint }
  //   Unauthenticated — no session required (vendor has no account yet).
  //   Rate-limited: 5 attempts/minute per IP.
  //   Validates HMAC + expiry + not-revoked, then:
  //     - creates a tenant (1 user = 1 tenant)
  //     - creates a tenant_admin user bound to that tenant
  //   Returns { valid, vendorId, license: { vendorId, expiry, deviceFingerprint } }
  r.post('/license/redeem', expressJson(), async (req, res) => {
    const ip = clientIp(req)
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ valid: false, error: 'Terlalu banyak percobaan. Coba lagi dalam 1 menit.' })
    }
    const { code, deviceFingerprint } = req.body || {}
    if (!code) return res.status(400).json({ error: 'code wajib' })
    if (!deviceFingerprint) return res.status(400).json({ error: 'deviceFingerprint wajib untuk binding' })

    // 2. Check revocation status first (need DB record to know secret version)
    const dbRec = await getLicenseByHash(code)

    // Resolve signing secret: prefer the version stored in DB record,
    // fallback to current secret (for codes issued before versioning existed).
    let secret
    let secretVersion = 1
    if (dbRec) {
      secretVersion = dbRec.secret_version || 1
      const rec = await getSecretByVersion(secretVersion).catch(() => null)
      if (rec) secret = rec.secret
    }
    if (!secret) secret = process.env.LICENSE_SECRET_KEY || null
    if (!secret) return res.status(500).json({ valid: false, error: 'License secret belum dikonfigurasi' })

    // 1. Verify HMAC + expiry (server-side, authoritative)
    const result = verifyLicenseCode(code, secret)
    if (!result.valid) return res.status(400).json(result)

    if (dbRec && !dbRec.active) {
      return res.status(403).json({ valid: false, error: 'Kode telah dicabut/dipakai' })
    }
    // Code not in DB = never officially issued via admin → suspicious
    if (!dbRec) {
      // Allow only if HMAC valid (codes are singleton per issue). Warn in audit.
      await logAudit({ userId: req.user?.id ?? null, action: 'license_redeem_unknown_code', target: result.vendorId, ip: clientIp(req) })
    }

    // 3. Create tenant + tenant_admin user (idempotent-ish: reuse if exists)
    const { vendorId, expiry } = result

    // Tenant slug based on vendor vend (slugified, ensure unique)
    const baseSlug = vendorId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vendor'
    let tenantSlug = baseSlug
    try {
      let n = 2
      while (true) {
        const exists = await pool.query('SELECT 1 FROM tenants WHERE slug = $1', [tenantSlug])
        if (!exists.rows[0]) break
        tenantSlug = `${baseSlug}-${n++}`
      }

      // Create tenant
      const actorId = req.user?.id ?? null
      await createTenant({ slug: tenantSlug, name: `Tenant ${vendorId}`, accessPin: null, ownerUserId: null })
      await logAudit({ userId: actorId, action: 'tenant_create', target: tenantSlug, ip: clientIp(req) })

      // Create tenant_admin user bound to this tenant
      const userEmail = `${tenantSlug}@achipix.local`
      let user = await findUserByEmail(userEmail)
      if (!user) {
        // Use createUser helper (accepts role+tenant). Password is a random 12-char
        // default — vendor must reset it via admin. Assign tier if tierSlug given.
        try {
          const tierRec = dbRec && dbRec.tier_slug
            ? (await pool.query('SELECT id, slug FROM pricing_tiers WHERE slug = $1 AND active = true', [dbRec.tier_slug])).rows[0]
            : null
          user = await createUser({
            email: userEmail, name: vendorId, role: 'tenant_admin',
            tenantId: tenantSlug, active: true,
            password: crypto.randomBytes(6).toString('hex'),   // random default
            pricingTierId: tierRec ? tierRec.id : null,
          })
        } catch (err) {
          console.error('[redeem] createUser failed:', err.message)
          user = null
        }
      }

      // Mark code redeemed
      await markLicenseRedeemed({ code, userEmail, tenantSlug })
      await logAudit({ userId: actorId, action: 'license_redeem', target: tenantSlug, ip: clientIp(req) })

      res.json({
        valid: true,
        vendorId,
        expiry,
        tenant: { slug: tenantSlug },
        license: { vendorId, expiry, deviceFingerprint },
      })
    } catch (err) {
      res.status(500).json({ valid: false, error: `Gagal provision tenant: ${err.message}` })
    }
  })

  // Verify: POST /api/admin/license/verify
  //   Body: { code }
  //   Returns: { valid, vendorId, expiry, error? }
  //   Used by booth app to validate codes fetched from server or stored locally
  r.post('/license/verify', requireSession, async (req, res) => {
    const { code } = req.body || {}
    if (!code) return res.status(400).json({ error: 'code wajib' })

    // Resolve signing secret by version (DB record), fallback to current/env
    const dbRec = await getLicenseByHash(code).catch(() => null)
    let secret
    if (dbRec) {
      const rec = await getSecretByVersion(dbRec.secret_version || 1).catch(() => null)
      if (rec) secret = rec.secret
    }
    if (!secret) secret = process.env.LICENSE_SECRET_KEY || null
    if (!secret) return res.status(500).json({ valid: false, error: 'License secret belum dikonfigurasi' })

    const result = verifyLicenseCode(code, secret)
    // Add revocation check
    if (result.valid) {
      if (dbRec && !dbRec.active) {
        return res.json({ valid: false, vendorId: result.vendorId, expiry: result.expiry, error: 'Kode telah dicabut/dipakai' })
      }
    }
    res.json(result)
  })

  // List secret versions: GET /api/admin/license/secrets
  //   super_admin only. Returns current + historical versions (for audit).
  r.get('/license/secrets', requireSession, requireRole('super_admin'), async (req, res) => {
    const versions = await listSecretVersions()
    res.json({ versions })
  })

  // Rotate license secret: POST /api/admin/license/secret/rotate
  //   Body: { confirmPassword } — operator must re-auth to rotate (sensitive op)
  //   super_admin only. Old secrets stay valid for previously issued codes
  //   (versioned HMAC), so rotation does NOT break existing licenses.
  //   NOTE: the booth frontend bundle was built with the OLD secret baked in —
  //   offline validation will use the old secret version. We only rotate the
  //   SERVER-side signing secret, so new codes are signed with the new version.
  //   To also update the frontend bundle, rebuild with VITE_LICENSE_SECRET=<new>.
  r.post('/license/secret/rotate', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const { confirmPassword } = req.body || {}
    if (!confirmPassword) return res.status(400).json({ error: 'confirmPassword wajib untuk rotasi secret' })

    // Re-auth: user must confirm their own password
    const authed = await verifyAdmin(req.user.email, confirmPassword)
    if (!authed || authed !== req.user.id) return res.status(403).json({ error: 'Password salah' })

    const newSecret = crypto.randomBytes(32).toString('hex')
    try {
      const version = await rotateSecret(newSecret, req.user.id)
      await logAudit({ userId: req.user.id, action: 'license_secret_rotate', target: `v${version}`, ip: clientIp(req) })
      res.json({ ok: true, version, message: `Secret di-rotasi ke versi ${version}. Kode baru akan pakai secret baru; kode lama tetap valid (via DB version lookup).` })
    } catch (e) {
      res.status(500).json({ error: `Rotasi gagal: ${e.message}` })
    }
  })

  // Audit log
  r.get('/audit', requireSession, requireRole('super_admin'), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50))
    const out = await listAudit({ limit: pageSize, offset: (page - 1) * pageSize })
    res.json({ ...out, page, pageSize })
  })

  r.delete('/audit/:id', requireSession, requireRole('super_admin'), requireCsrf, async (req, res) => {
    await pool.query('DELETE FROM admin_audit_log WHERE id = $1', [Number(req.params.id)])
    res.json({ ok: true })
  })

  // Audit cleanup: hapus entri lebih lama dari X hari
  r.post('/audit/cleanup', requireSession, requireRole('super_admin'), requireCsrf, expressJson(), async (req, res) => {
    const olderThanDays = Number(req.body?.older_than_days ?? 30)
    if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
      return res.status(400).json({ error: 'older_than_days harus angka positif' })
    }
    const result = await pool.query(
      `DELETE FROM admin_audit_log WHERE created_at < now() - make_interval(days => $1) RETURNING id`,
      [olderThanDays]
    )
    await logAudit({ userId: req.user.id, action: 'audit_cleanup', ip: clientIp(req) })
    res.json({ ok: true, deleted: result.rowCount })
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
    // Strip raw Buffer (frame_data) — only send base64 (frameBuf) to keep response lean
    const { frame_data, ...jsonSafe } = item
    res.json(jsonSafe)
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
    await logAudit({
      userId: req.user.id,
      action: 'config_update',
      target: tenantSlug,
      ip: clientIp(req),
    })
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

  // GET /attract/file/:type/:mode?tenantSlug=X → binary image/video (for <img src>)
  // Note: attract assets removed in favor of inline branding.attractMedia in presets.
  r.get('/attract/file/:type/:mode', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    res.status(404).end()
  })

  // POST /designs (multipart: image=frame, name, slots, canvas_w, canvas_h, tenantSlug)
  r.post('/designs', requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, upload.single('image'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.body?.tenantSlug || req.query.tenantSlug) : req.user.tenant_id
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    const tierCheck = await checkTierLimit(req.user.id, tenantSlug, 'designs')
    if (!tierCheck.ok) return res.status(403).json({ error: tierCheck.error })
    const id = crypto.randomUUID()
    const name = req.body?.name || `design-${Date.now()}`
    let slots = []
    try { slots = JSON.parse(req.body?.slots || '[]') } catch { slots = [] }
    const cw = Number(req.body?.canvas_w) || 308
    const ch = Number(req.body?.canvas_h) || 454
    await saveDesign(id, name, req.file ? req.file.buffer : null, cw, ch, slots, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'design_create', target: id, ip: clientIp(req) })
    res.json({ id, name })
  })

  // PUT /designs/:id (update slots, frame, name; partial allowed)
  r.put('/designs/:id', requireSession, requireRole('super_admin', 'tenant_admin'), requireCsrf, upload.single('image'), async (req, res) => {
    const tenantSlug = req.user.role === 'super_admin' ? (req.body?.tenantSlug || req.query.tenantSlug) : req.user.tenant_id
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug wajib' })
    let slots
    try { slots = req.body?.slots ? JSON.parse(req.body.slots) : undefined } catch { slots = undefined }
    const canvasW = req.body?.canvas_w ? Number(req.body.canvas_w) : undefined
    const canvasH = req.body?.canvas_h ? Number(req.body.canvas_h) : undefined
    await updateDesign(req.params.id, {
      name: req.body?.name,
      frameBuf: req.file ? req.file.buffer : undefined,
      slots,
      canvasW,
      canvasH,
    }, tenantSlug)
    await logAudit({ userId: req.user.id, action: 'design_update', target: req.params.id, ip: clientIp(req) })
    res.json({ ok: true })
  })

  // POST /attract/:mode (background upload) — removed (attract is now part of preset branding)
  r.post('/attract/:mode', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    res.status(410).json({ error: 'attract feature removed; use preset branding.attractMedia' })
  })

  // DELETE /attract/:mode (background delete) — removed
  r.delete('/attract/:mode', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    res.status(410).json({ error: 'attract feature removed; use preset branding.attractMedia' })
  })

  // POST /attract/:mode/icon (icon upload) — removed
  r.post('/attract/:mode/icon', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    res.status(410).json({ error: 'attract feature removed; use preset branding.attractIcon' })
  })

  // DELETE /attract/:mode/icon (icon delete) — removed
  r.delete('/attract/:mode/icon', requireSession, requireRole('super_admin', 'tenant_admin'), async (req, res) => {
    res.status(410).json({ error: 'attract feature removed; use preset branding.attractIcon' })
  })

  // GET /attract/status — removed (returns empty status for legacy clients)
  r.get('/attract/status', requireSession, requireRole('super_admin', 'tenant_admin'), async (_req, res) => {
    res.json({
      regular: { background: { has: false, mediaType: null }, icon: { has: false, mediaType: null } },
      event:   { background: { has: false, mediaType: null }, icon: { has: false, mediaType: null } },
    })
  })

  // POST /api/admin/license/redeem-for-user — JALUR KODE 6 DIGIT (SaaS).
  //   Dipanggil user yang sudah login untuk menukar kode aktivasi 6 char
  //   (dibuat via POST /license/generate) → aktivasi langganan tenant 30 hari.
  //   Body: { code } → Response: { ok: true, tenant: <getTenantSubscription> }
  //   Bukan jalur HMAC vendor — itu tetap di POST /license/redeem (legacy).
  r.post('/license/redeem-for-user', requireUserSession, requireCsrf, expressJson(), async (req, res) => {
    const { code } = req.body || {}
    if (!code) return res.status(400).json({ error: 'Kode akses wajib diisi' })
    const rawCode = String(code).trim()
    // Kode aktivasi disimpan UPPERCASE tanpa spasi. Normalisasi dulu, tapi tetap
    // fallback ke raw code supaya kode HMAC legacy (case-sensitive) tetap valid.
    const normCode = rawCode.replace(/\s+/g, '').toUpperCase()
    const hashInputs = [...new Set([normCode, rawCode].filter(Boolean))]
    const codeHashes = hashInputs.map((c) => crypto.createHash('sha256').update(c).digest('hex'))

    try {
      // Lookup by SHA256 — berlaku untuk kode aktivasi maupun HMAC legacy.
      const { rows: codeRows } = await pool.query(
        `SELECT id, code_hash, expires_at, active, for_user_id
         FROM license_codes WHERE code_hash = ANY($1)`,
        [codeHashes]
      )
      if (!codeRows.length) return res.status(400).json({ error: 'Kode akses tidak valid' })
      const lc = codeRows[0]
      const matchedCode = hashInputs[codeHashes.indexOf(lc.code_hash)] ?? normCode
      if (!lc.active) return res.status(400).json({ error: 'Kode sudah digunakan atau dicabut' })
      if (new Date(lc.expires_at) < new Date()) return res.status(400).json({ error: 'Kode sudah kadaluarsa' })
      // Kode bisa di-bind ke user tertentu (1:1).
      if (lc.for_user_id && lc.for_user_id !== req.user.id) {
        return res.status(403).json({ error: 'Kode ini hanya bisa digunakan oleh user yang ditentukan' })
      }

      // Cari tenant user: dari sesi dulu, fallback ke owner_user_id.
      let tenantSlug = req.user.tenant_id || null
      if (!tenantSlug) {
        const owner = await pool.query(
          'SELECT slug FROM tenants WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 1',
          [req.user.id]
        )
        tenantSlug = owner.rows[0]?.slug || null
      }
      if (!tenantSlug) return res.status(400).json({ error: 'Anda belum memiliki tenant' })

      // Kalau user belum terhubung tenant (ketemu via owner_user_id), sambungkan.
      if (!req.user.tenant_id) {
        await pool.query(
          `UPDATE admin_user SET tenant_id = $1, role = 'tenant_admin', updated_at = now() WHERE id = $2`,
          [tenantSlug, req.user.id]
        )
      }

      // Aktifkan langganan 30 hari + tandai kode terpakai.
      await activateTenantSubscription(tenantSlug, 30)
      await markLicenseRedeemed({ code: matchedCode, userEmail: req.user.email, tenantSlug, userId: req.user.id })
      await logAudit({ userId: req.user.id, tenantSlug, action: 'license_redeem_user', target: tenantSlug, ip: clientIp(req) })

      const tenant = await getTenantSubscription(tenantSlug)
      res.json({ ok: true, tenant })
    } catch (e) {
      console.error('Redeem-for-user error:', e)
      res.status(500).json({ error: 'Gagal mengaktifkan kode akses' })
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Subscription self-pay (Midtrans Snap)
  //   Harga FLAT bulanan dari env PB_FLAT_PRICE (default 150000 IDR).
  //   Endpoint butuh session user (user_session) — bukan admin_session.
  //   Server key TIDAK pernah dikirim ke client; client hanya dapat client_key.
  // ──────────────────────────────────────────────────────────────────────────
  const MIDTRANS_FLAT_PRICE = Number(process.env.PB_FLAT_PRICE || 150000)
  const MIDTRANS_IS_PRODUCTION = ['1', 'true'].includes(String(process.env.MIDTRANS_IS_PRODUCTION || '').toLowerCase())
  const midtransClientKey = () => process.env.MIDTRANS_CLIENT_KEY || ''

  // GET /subscription/price — info harga + client key untuk Snap.js. Session apa pun.
  r.get('/subscription/price', requireSession, (_req, res) => {
    res.json({
      price: MIDTRANS_FLAT_PRICE,
      currency: 'IDR',
      client_key: midtransClientKey(),
      is_production: MIDTRANS_IS_PRODUCTION,
    })
  })

  // POST /subscription/pay — buat transaksi Snap untuk tenant user.
  // Response: { token, redirect_url, client_key, is_production, order_id }
  //   atau { mock:true, ... } bila MIDTRANS_SERVER_KEY belum diset (mode simulasi dev).
  r.post('/subscription/pay', requireUserSession, requireCsrf, expressJson(), async (req, res) => {
    try {
      // Tenant scope: dari sesi, fallback owner_user_id (1 user = 1 tenant utama).
      let tenantSlug = req.user.tenant_id || null
      if (!tenantSlug) {
        const owner = await pool.query(
          'SELECT slug FROM tenants WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 1',
          [req.user.id]
        )
        tenantSlug = owner.rows[0]?.slug || null
      }
      if (!tenantSlug) return res.status(400).json({ error: 'Anda belum memiliki tenant' })

      // Tenant harus trial/active (termasuk suspended/expired → tolak jelas).
      const eff = await getEffectiveTenantStatus(tenantSlug)
      if (!['trial', 'active'].includes(eff)) {
        return res.status(403).json({
          error: `Langganan tidak bisa diperpanjang (status: ${eff || 'tidak diketahui'}).`,
        })
      }

      const amount = MIDTRANS_FLAT_PRICE
      const orderId = `SUB-${tenantSlug}-${Date.now()}`
      await createSubscriptionPayment({ tenantSlug, orderId, amount })

      const serverKey = process.env.MIDTRANS_SERVER_KEY || ''
      if (!serverKey) {
        // MOCK MODE (dev/simulasi): tanpa server key, tandai lunas + aktifkan 30 hari
        // langsung supaya alur dashboard bisa dites tanpa kredensial Midtrans.
        await markSubscriptionPaymentPaid(orderId)
        await activateTenantSubscription(tenantSlug, 30)
        const tenant = await getTenantSubscription(tenantSlug)
        await logAudit({ userId: req.user.id, tenantSlug, action: 'subscription_pay_mock', target: orderId, ip: clientIp(req) })
        return res.json({
          mock: true,
          token: null,
          redirect_url: null,
          client_key: midtransClientKey(),
          is_production: MIDTRANS_IS_PRODUCTION,
          order_id: orderId,
          tenant,
        })
      }

      const snapUrl = MIDTRANS_IS_PRODUCTION
        ? 'https://app.midtrans.com/snap/v1/transactions'
        : 'https://app.sandbox.midtrans.com/snap/v1/transactions'
      const auth = Buffer.from(`${serverKey}:`).toString('base64')
      const snapResp = await fetch(snapUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          transaction_details: { order_id: orderId, gross_amount: amount },
          customer_details: { email: req.user.email },
        }),
      })
      const data = await snapResp.json().catch(() => ({}))
      if (!snapResp.ok || !data.token) {
        await markSubscriptionPaymentFailed(orderId)
        // Jangan bocorkan server key; catat pesan error Midtrans saja.
        console.error('[midtrans] snap error', snapResp.status, data.error_messages || data.status_message || '')
        return res.status(502).json({ error: 'Gagal membuat transaksi pembayaran' })
      }
      await setSubscriptionPaymentSnapToken(orderId, data.token)
      await logAudit({ userId: req.user.id, tenantSlug, action: 'subscription_pay_created', target: orderId, ip: clientIp(req) })
      res.json({
        token: data.token,
        redirect_url: data.redirect_url || null,
        client_key: midtransClientKey(),
        is_production: MIDTRANS_IS_PRODUCTION,
        order_id: orderId,
      })
    } catch (e) {
      console.error('[midtrans] pay error:', e.message)
      res.status(500).json({ error: 'Gagal memproses pembayaran' })
    }
  })

  return r
}

// =============== Middleware ===============
async function requireSession(req, res, next) {
  const cookieHeader = req.get('cookie') || ''
  // Dual auth: admin_session diprioritaskan, user_session fallback.
  // Kedua token di-lookup INDEPENDEN — jangan pakai token admin untuk lookup user
  // (bug lama: token pertama dipakai untuk kedua lookup → 401 palsu).
  const m = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/)
  const m2 = cookieHeader.match(/(?:^|;\s*)user_session=([^;]+)/)
  const adminToken = m ? m[1] : null
  const userToken = m2 ? m2[1] : null
  if (!adminToken && !userToken) return res.status(401).json({ error: 'Sesi tidak ditemukan' })
  let user = null
  let token = null
  if (adminToken) {
    user = await getSessionUser(adminToken)
    if (user) token = adminToken
  }
  if (!user && userToken) {
    user = await getUserSessionUser(userToken)
    if (user) token = userToken
  }
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

// ──────────────────────────────────────────────────────────────
// User Session Middleware & Endpoints
// ──────────────────────────────────────────────────────────────

// Middleware: require user session (reads user_session cookie)
async function requireUserSession(req, res, next) {
  const cookieHeader = req.get('cookie') || ''
  const m = cookieHeader.match(/(?:^|;\s*)user_session=([^;]+)/)
  const token = m ? m[1] : null
  if (!token) return res.status(401).json({ error: 'Sesi tidak ditemukan' })
  const user = await getUserSessionUser(token)
  if (!user) return res.status(401).json({ error: 'Sesi kadaluarsa' })
  req.user = user
  next()
}


