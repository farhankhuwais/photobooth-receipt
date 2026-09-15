// Combined deploy server for photobooth-receipt.
// Serves the built frontend (dist/) AND the bridge API (/api/upload, /api/print)
// from a single origin so one Cloudflare Tunnel is enough.
//
// Env:
//   PORT          (default 8080)
//   PRINTER_PATH  serial device, e.g. /dev/ttyUSB0 (default: disabled)
//   PRINTER_BAUD  (default 9600)
//   PRINT_ENABLED set "1" to actually write ESC/POS to the serial printer

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import { initDb, savePhoto, getPhoto, listPhotos, deletePhoto, savePreset, listPresets, getPreset, deletePreset, saveTransaction, listTransactions, getStats, verifyAdmin, createSession, getSessionUser, destroySession, changePassword, saveFrame, listFrames, getFrame, deleteFrame, getConfig, saveConfig, saveDesign, listDesigns, getDesign, updateDesign, deleteDesign, DEFAULT_TENANT, resolveTenant, pool, checkTierLimit, createUserSession, getUserSessionUser, destroyUserSession, createTenant, createUser, generateAccessCode, validateAccessCode, markAccessCodeUsed, runSubscriptionCheck, getTenantSubscription, getEffectiveTenantStatus, upsertBoothDevice, listBoothDevices, deactivateBoothDevice, getBoothDevice, touchBoothDevice, activateTenantSubscription, getSubscriptionPayment, markSubscriptionPaymentPaid, markSubscriptionPaymentFailed, runNotifications } from './db.mjs'
import { adminApi } from './admin-api.mjs'
// NOTE: License secret is versioned and stored in the database.
// The process.env.LICENSE_SECRET_KEY env is the source of truth.
// Admin-api.mjs handles secret versioning (DB lookup per code's secret_version).
// License codes are verified via admin-api.mjs routes (not inline in serve.mjs).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')

const PRINTER_PATH = process.env.PRINTER_PATH || ''
const PRINTER_BAUD = Number(process.env.PRINTER_BAUD || 9600)
const PRINT_ENABLED = process.env.PRINT_ENABLED === '1' && !!PRINTER_PATH

await initDb()

const app = express()
app.use(cors())

// ── Midtrans webhook (PUBLIC: tanpa session, CSRF, maupun PIN tenant) ────────
// Didaftarkan SEBELUM tenant resolver + middleware PIN agar bisa dipanggil
// Midtrans dari host mana pun. Autentikasi = signature SHA512(server key).
// Response selalu 200 {ok:true} (selain signature mismatch → 403) supaya
// Midtrans tidak retry tanpa henti.
app.post('/api/midtrans/webhook', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const { order_id, status_code, gross_amount, signature_key, transaction_status } = req.body || {}
    const serverKey = process.env.MIDTRANS_SERVER_KEY || ''
    if (!order_id || !signature_key || !serverKey) return res.json({ ok: true })
    const expected = crypto
      .createHash('sha512')
      .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
      .digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(String(signature_key))
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      // Jangan pernah log server key / signature.
      console.warn('[midtrans] signature mismatch untuk order', order_id)
      return res.status(403).json({ ok: false })
    }
    const payment = await getSubscriptionPayment(order_id)
    if (!payment) return res.json({ ok: true })
    const st = String(transaction_status || '').toLowerCase()
    if (st === 'settlement' || st === 'capture') {
      // Idempotent: hanya aktifkan kalau transisi ke 'paid' berhasil (belum paid).
      const updated = await markSubscriptionPaymentPaid(order_id)
      if (updated) {
        await activateTenantSubscription(payment.tenant_slug, 30)
        console.log(`[midtrans] paid ${order_id} → tenant ${payment.tenant_slug} aktif 30 hari`)
      }
    } else if (['expire', 'cancel', 'deny', 'failed', 'failure'].includes(st)) {
      await markSubscriptionPaymentFailed(order_id)
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[midtrans] webhook error:', e.message)
    res.json({ ok: true })
  }
})

// Ambil device fingerprint dari header (trim + batasi panjang untuk keamanan).
function deviceFpFrom(req) {
  const raw = req.headers['x-device-fp'] || ''
  return String(raw).trim().slice(0, 128)
}

// Multi-tenant resolver: prioritas device fingerprint → subdomain → default tenant.
app.use(async (req, _res, next) => {
  req.tenantId = await resolveTenant(req.get('host') || '', deviceFpFrom(req) || null)
  next()
})

// Block unknown tenants. Tenant null = device belum di-pair (booth satu domain):
// non-API tetap dilayani supaya SPA bisa render layar pairing; /api publik tertentu
// dilewatkan, sisanya 404.
app.use(async (req, res, next) => {
  if (req.tenantId === null) {
    const path = String(req.originalUrl || '').split('?')[0]
    if (path.startsWith('/api/')) {
      if (path === '/api/config' || path.startsWith('/api/access-code/') || path.startsWith('/api/auth/')) return next()
      res.set('Cache-Control', 'no-store, max-age=0')
      return res.status(404).end()
    }
    return next()
  }
  next()
})

// Require tenant PIN for protected tenant API routes (skip admin subdomain and public endpoints)
app.use('/api', async (req, res, next) => {
  // Tenant null: tidak ada tenant context → skip PIN middleware (endpoint publik
  // yang lolos blok di atas yang menangani).
  if (req.tenantId === null) return next()
  // admin tenant: allow /api/admin/* to pass through (handled by separate router below)
  // block all other /api/* on admin tenant (root domain serves SPA only)
  if (req.tenantId === 'admin') {
    const fullPath = String(req.originalUrl || '').split('?')[0]
    if (fullPath.startsWith('/admin/') || fullPath.startsWith('/api/admin/') || fullPath.startsWith('/api/auth/') || fullPath.startsWith('/api/access-code/') || fullPath.startsWith('/api/tenant/')) return next()
    res.set('Cache-Control', 'no-store, max-age=0')
    return res.status(404).end()
  }
  const path = String(req.originalUrl || '').split('?')[0]
  if (path === '/api/tenant/pin-status' || path === '/api/tenant/verify-pin' || path.startsWith('/admin/')) return next()
  // Allow auth endpoints without PIN (public user registration/login)
  if (path.startsWith('/api/auth/')) return next()
  // Allow access-code validation (public tablet pairing)
  if (path.startsWith('/api/access-code/')) return next()
  // Allow design metadata and frame image endpoints without PIN
  // (<img> tags don't send headers, so frame must be public; metadata is non-sensitive)
  if (path.startsWith('/api/designs/')) return next()
  if (path === '/api/designs') return next()
  // Allow app config (mode, price, branding) without PIN
  // App booth fetches this on boot without <img>/fetch headers in same chain
  if (path === '/api/config') return next()
  // Preset metadata is public per-tenant (used in app picker)
  if (path === '/api/presets' || path.startsWith('/api/presets/')) return next()
  try {
    const { rows } = await pool.query('SELECT access_pin FROM tenants WHERE slug = $1', [req.tenantId])
    const pin = rows[0]?.access_pin || null
    if (!pin) return next()
    const reqPin = String(req.headers['x-tenant-pin'] || '').trim()
    if (!reqPin) return res.status(403).json({ error: 'PIN required', code: 'PIN_REQUIRED' })
    if (reqPin !== pin) return res.status(403).json({ error: 'PIN salah', code: 'PIN_INVALID' })
    next()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ──────────────────────────────────────────────────────────────
// Guard status tenant: booth tidak boleh dipakai selama pendaftaran masih
// 'pending' / 'rejected' (tenant dibuat active=false sampai di-approve admin).
// getEffectiveTenantStatus hanya dipanggil di endpoint booth yang di-guard,
// dengan cache in-memory 30 detik supaya tidak query DB tiap request.
// ──────────────────────────────────────────────────────────────
const tenantStatusCache = new Map() // slug -> { status, at }
const TENANT_STATUS_TTL_MS = 30 * 1000
async function cachedEffectiveTenantStatus(slug) {
  if (!slug) return null
  const now = Date.now()
  const hit = tenantStatusCache.get(slug)
  if (hit && now - hit.at < TENANT_STATUS_TTL_MS) return hit.status
  const status = await getEffectiveTenantStatus(slug)
  tenantStatusCache.set(slug, { status, at: now })
  return status
}
function requireApprovedTenant(req, res, next) {
  // Tenant null (device belum di-pair) & 'admin' lewat — bukan konteks booth.
  if (!req.tenantId || req.tenantId === 'admin') return next()
  cachedEffectiveTenantStatus(req.tenantId)
    .then((status) => {
      if (status === 'pending') {
        return res.status(403).json({ error: 'Pendaftaran menunggu persetujuan admin', code: 'TENANT_PENDING' })
      }
      if (status === 'rejected') {
        return res.status(403).json({ error: 'Pendaftaran ditolak', code: 'TENANT_REJECTED' })
      }
      next()
    })
    // Fail-open: error tak terduga jangan sampai memblok booth yang sudah aktif.
    .catch(() => next())
}
// Guard ringan untuk endpoint booth (metadata/upload). `/api/config` GET & `/api/upload`
// di-guard langsung di route-nya karena scope method-nya spesifik.
app.use('/api/presets', requireApprovedTenant)
app.use('/api/frames', requireApprovedTenant)
app.use('/api/designs', requireApprovedTenant)

// Redirect root on admin subdomain to /admin (new SPA). On tenant subdomains, serve the booth app.
app.get('/', async (req, res) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host, deviceFpFrom(req) || null)
  if (slug === 'admin') {
    // Serve landing page for root domain, admin subdomain redirect to /admin
    if (host === 'achipix.web.id' || host === 'localhost') {
      return res.sendFile(path.join(__dirname, 'public', 'landing.html'))
    }
    return res.redirect('/admin')
  }
  // null = device belum di-pair / host tak dikenal → tetap serve SPA booth supaya
  // layar pairing bisa tampil (bukan 404).
  res.set('Cache-Control', 'no-store')
  res.sendFile(path.join(DIST, 'index.html'))
})

// New admin SPA — only on admin subdomain, served from dist/admin
const ADMIN_DIST = path.join(DIST, 'admin')
app.use('/admin', async (req, res, next) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host, deviceFpFrom(req) || null)
  if (slug !== 'admin') return res.status(404).end()
  if (req.method !== 'GET') return next()
  if (req.path !== '/' && req.path !== '/index.html') return next()
  res.set('Cache-Control', 'no-store')
  res.sendFile(path.join(ADMIN_DIST, 'index.html'))
})
app.use('/admin/assets', async (req, res, next) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host, deviceFpFrom(req) || null)
  if (slug !== 'admin') return res.status(404).end()
  next()
}, express.static(ADMIN_DIST, { setHeaders: (r) => r.set('Cache-Control', 'public, max-age=300') }))

// New admin API — only on admin subdomain
app.use('/api/admin', async (req, res, next) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host, deviceFpFrom(req) || null)
  if (slug !== 'admin') return res.status(404).end()
  next()
}, adminApi())

// ──────────────────────────────────────────────────────────────
// User Auth Endpoints (public, no tenant PIN required)
// Cookie: user_session (HttpOnly, SameSite=Strict, Secure)
// CSRF: XSRF-TOKEN cookie (shared with admin)
// ──────────────────────────────────────────────────────────────

// In-memory rate limiter for register endpoint
const registerLimiter = new Map()
function checkRegisterLimit(ip) {
  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute
  const max = 5
  const key = `reg:${ip}`
  const arr = registerLimiter.get(key) || []
  const recent = arr.filter((t) => now - t < windowMs)
  if (recent.length >= max) return false
  recent.push(now)
  registerLimiter.set(key, recent)
  return true
}

// CSRF token endpoint (shared with admin)
app.get('/api/auth/csrf', (req, res) => {
  const token = crypto.randomBytes(32).toString('hex')
  // Set XSRF-TOKEN cookie (readable by JS for CSRF header)
  res.set('Set-Cookie', `XSRF-TOKEN=${token}; Path=/; HttpOnly=false; Secure; SameSite=Strict; Max-Age=${30 * 24 * 3600}`)
  res.json({ csrfToken: token })
})

// Helper: parse cookies (shared with admin session)
function parseCookies(req) {
  const out = {}
  for (const c of (req.headers.cookie || '').split('; ')) {
    const i = c.indexOf('=')
    if (i > 0) out[c.slice(0, i)] = c.slice(i + 1)
  }
  return out
}

// Middleware: require user session (reads user_session cookie)
async function requireUserSession(req, res, next) {
  const cookies = parseCookies(req)
  const token = cookies.user_session
  if (!token) return res.status(401).json({ error: 'Unauthenticated' })
  const user = await getUserSessionUser(token)
  if (!user) return res.status(401).json({ error: 'Session expired or invalid' })
  req.user = user
  next()
}

// Middleware: require CSRF for mutating endpoints (shared XSRF-TOKEN cookie)
function requireUserCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const cookies = parseCookies(req)
  const cookieToken = cookies['XSRF-TOKEN']
  const headerToken = req.headers['x-xsrf-token']
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token invalid' })
  }
  next()
}

// POST /api/auth/register — public, creates tenant_admin with no tenant
app.post('/api/auth/register', express.json({ limit: '1mb' }), async (req, res) => {
  const clientIp = (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
  if (!checkRegisterLimit(clientIp)) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan daftar, coba lagi nanti' })
  }
  const { email, password, name } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email & password wajib' })
  const emailNorm = String(email).toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) return res.status(400).json({ error: 'Format email tidak valid' })
  if (String(password).length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' })
  try {
    // Check if email already exists
    const { rows: existing } = await pool.query('SELECT id FROM admin_user WHERE LOWER(email) = $1', [emailNorm])
    if (existing.length) return res.status(409).json({ error: 'Email sudah terdaftar' })

    // Generate tenant slug from email
    const tenantSlug = String(emailNorm).replace(/@.*/, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '')

    // Create tenant dengan status 'pending' — trial baru mulai setelah admin approve
    // (lihat POST /api/admin/registrations/:slug/approve).
    const tenant = await createTenant({ slug: tenantSlug, name: name?.trim() || emailNorm, accessPin: null, status: 'pending', active: false })

    // Create user as tenant_admin with tenant
    const user = await createUser({
      email: emailNorm,
      password,
      role: 'tenant_admin',
      tenantId: tenantSlug,
      name: name?.trim() || null,
      pricingTierId: null
    })
    // Set owner tenant ke user pendaftar (dipakai approval/list).
    await pool.query('UPDATE tenants SET owner_user_id = $1, updated_at = now() WHERE slug = $2', [user.id, tenantSlug])

    // Create user session
    const token = await createUserSession(user.id, false)
    // Set user_session cookie + bersihkan cookie admin_session/XSRF-TOKEN lama
    // (konsisten dengan /api/auth/login) supaya tidak ada cookie ganda yang bikin 401 palsu.
    res.set('Set-Cookie', [
      `user_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${24 * 3600}`,
      'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      'XSRF-TOKEN=; Path=/; Max-Age=0'
    ])
    // Audit log
    await pool.query(
      `INSERT INTO admin_audit_log (user_id, action, target, ip, ua) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, 'user_register', user.email, clientIp, req.get('user-agent')]
    )
    res.json({ user: { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, name: user.name }, redirect: '/' })
  } catch (e) {
    console.error('Register error:', e)
    res.status(500).json({ error: 'Gagal mendaftar' })
  }
})

// POST /api/auth/login — public, verifies password, creates session
app.post('/api/auth/login', express.json({ limit: '1mb' }), async (req, res) => {
  const { email, password, remember } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email & password wajib' })
  const emailNorm = String(email).toLowerCase().trim()
  try {
    const userId = await verifyAdmin(emailNorm, password)
    if (!userId) {
      // Log failed attempt
      await pool.query(
        `INSERT INTO admin_audit_log (action, target, ip, ua) VALUES ($1, $2, $3, $4)`,
        ['user_login_failed', emailNorm, (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress, req.get('user-agent')]
      )
      return res.status(401).json({ error: 'Email atau password salah' })
    }
    // Get full user
    const { rows } = await pool.query(
      `SELECT id, email, role, tenant_id, name, active FROM admin_user WHERE id = $1`,
      [userId]
    )
    const user = rows[0]
    if (!user || user.active === false) return res.status(401).json({ error: 'Akun tidak aktif' })
    // Create user session
    const token = await createUserSession(user.id, !!remember)
    const maxAge = remember ? 30 * 24 * 3600 : 24 * 3600
    // Clear admin_session & XSRF-TOKEN to avoid conflict
    res.set('Set-Cookie', [
      `user_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
      'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      'XSRF-TOKEN=; Path=/; Max-Age=0'
    ])
    // Audit log
    await pool.query(
      `INSERT INTO admin_audit_log (user_id, action, ip, ua) VALUES ($1, $2, $3, $4)`,
      [user.id, 'user_login', (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress, req.get('user-agent')]
    )
    res.json({ user: { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, name: user.name }, redirect: '/' })
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).json({ error: 'Gagal login' })
  }
})

// GET /api/auth/status — returns user profile + tenant info if logged in, neutral response if not
app.get('/api/auth/status', async (req, res) => {
  const cookies = parseCookies(req)
  const token = cookies.user_session
  if (!token) return res.json({ user: null, tenant: null, hasTenant: false })
  const user = await getUserSessionUser(token)
  if (!user) return res.json({ user: null, tenant: null, hasTenant: false })
  let tenant = null
  if (user.tenant_id) {
    const { rows } = await pool.query(
      `SELECT slug, name, active, status, trial_ends_at, subscription_ends_at, grace_period_ends_at
       FROM tenants WHERE slug = $1`,
      [user.tenant_id]
    )
    const row = rows[0]
    if (row) {
      // Status efektif (hitung tenggat) + sisa hari untuk UI.
      const status = await getEffectiveTenantStatus(row.slug)
      let base = null
      if (status === 'trial') base = row.trial_ends_at
      else if (status === 'active') base = row.subscription_ends_at
      const days_remaining = base
        ? Math.max(0, Math.ceil((new Date(base).getTime() - Date.now()) / 86400000))
        : 0
      tenant = {
        slug: row.slug,
        name: row.name,
        active: row.active,
        status,
        trial_ends_at: row.trial_ends_at,
        subscription_ends_at: row.subscription_ends_at,
        grace_period_ends_at: row.grace_period_ends_at,
        days_remaining,
      }
    }
  }
  res.json({ user: { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, name: user.name }, tenant, hasTenant: !!tenant })
})

// POST /api/auth/logout — authenticated, destroys session
app.post('/api/auth/logout', requireUserSession, async (req, res) => {
  const cookies = parseCookies(req)
  const token = cookies.user_session
  if (token) await destroyUserSession(token)
  res.set('Set-Cookie', 'user_session=; Path=/; HttpOnly; Max-Age=0')
  res.json({ ok: true })
})

// Frontend (SPA): serve dist, fallback to index.html
app.use(express.static(DIST, { setHeaders: (res) => res.set('Cache-Control', 'no-store') }))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// Store uploaded strips in Postgres (id = timestamp.png), serve by id
app.post('/api/upload', requireApprovedTenant, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no image' })
    const id = `${Date.now()}.png`
    await savePhoto(id, req.file.buffer, req.tenantId)
    res.json({ url: `${req.protocol}://${req.get('host')}/u/${id}` })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Serve a stored strip from Postgres (used inside the QR digital link)
app.get('/u/:id', async (req, res) => {
  try {
    const data = await getPhoto(req.params.id)
    if (!data) return res.status(404).end()
    res.set('Content-Type', 'image/png')
    // Tanpa Content-Disposition: attachment -> browser buka preview gambar
    // di tab (user bisa lihat & download manual), bukan langsung download.
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Presets — konfigurasi bernama (bisa banyak), tiap preset punya mode sendiri.
app.post('/api/presets', express.json({ limit: '15mb' }), async (req, res) => {
  try {
    if (req.tenantId === 'admin') return res.status(404).end()
    // Tier enforcement: cek batas preset
    const tierCheck = await checkTierLimit(null, req.tenantId, 'presets')
    if (!tierCheck.ok) return res.status(403).json({ error: tierCheck.error })
    const { name, mode, price, branding } = req.body || {}
    const nm = String(name || '').trim()
    if (!nm) return res.status(400).json({ error: 'nama preset wajib' })
    const m = mode === 'event' ? 'event' : 'regular'
    const p = m === 'event' ? 0 : (price === 0 ? 0 : Number(price) || 5000)
    const saved = await savePreset(nm, m, p, branding ?? {}, req.tenantId)
    res.json({ ok: true, name: saved, mode: m })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// List preset (array). ?mode=regular|event untuk filter per mode.
app.get('/api/presets', async (req, res) => {
  try {
    let rows = await listPresets(req.tenantId)
    const mode = req.query.mode
    if (mode === 'regular' || mode === 'event') {
      rows = rows.filter((r) => r.mode === mode)
    }
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil satu preset by name.
app.get('/api/presets/:name', async (req, res) => {
  try {
    const p = await getPreset(req.params.name, req.tenantId)
    if (!p) return res.status(404).json({ error: 'not found' })
    res.json(p)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Update preset yang sudah ada (by name) — untuk edit tanpa bikin duplikat.
app.put('/api/presets/:name', express.json({ limit: '15mb' }), async (req, res) => {
  try {
    const oldName = req.params.name
    const { mode, price, branding } = req.body || {}
    const m = mode === 'event' ? 'event' : 'regular'
    const p = m === 'event' ? 0 : (price === 0 ? 0 : Number(price) || 5000)
    const saved = await savePreset(oldName, m, p, branding ?? {}, req.tenantId)
    res.json({ ok: true, name: saved, mode: m, updated: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Hapus preset by name.
app.delete('/api/presets/:name', async (req, res) => {
  try {
    await deletePreset(req.params.name, req.tenantId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Active app config (persisted; survives refresh/cache clear) ──
app.get('/api/config', requireApprovedTenant, async (req, res) => {
  // Tenant null = device belum di-pair ke tenant mana pun → booth tampilkan
  // layar pairing (HTTP 200, bukan 404).
  if (req.tenantId === null) {
    res.set('Cache-Control', 'no-store, max-age=0')
    return res.json({ device_paired: false, tenant_status: null })
  }
  try {
    const cfg = await getConfig(req.tenantId)
    const base = cfg || { mode: 'regular', price: 5000, preset_name: null, branding: null }
    // Info status langganan tenant (untuk gating UI booth). Field lama tidak diubah.
    const sub = await getTenantSubscription(req.tenantId)
    // Device pairing: booth kirim header X-Device-Fp tiap poll.
    // null = tenant belum punya device sama sekali (fitur belum aktif), true/false = status fp tersebut.
    const fp = deviceFpFrom(req)
    let devicePaired = null
    const devices = await listBoothDevices(req.tenantId)
    if (devices.length > 0) {
      devicePaired = !!fp && devices.some((d) => d.device_fp === fp && d.is_active !== false)
    }
    // Update last_seen device (fire-and-forget, jangan blok response).
    if (fp) touchBoothDevice(req.tenantId, fp).catch(() => {})
    const final = {
      ...base,
      tenant_status: sub ? await getEffectiveTenantStatus(req.tenantId) : null,
      trial_ends_at: sub?.trial_ends_at ?? null,
      subscription_ends_at: sub?.subscription_ends_at ?? null,
      device_paired: devicePaired,
      // Bahasa booth (id/en) disimpan di branding config tenant. Default 'id'.
      lang: base.branding && base.branding.lang === 'en' ? 'en' : 'id',
    }
    // ETag: MD5 dari canonical JSON (sort keys, no undefined). Booth pakai ini
    // untuk deteksi perubahan config (reload page kalau etag berbeda) tanpa
    // perlu DB migration untuk version counter.
    const canonical = JSON.stringify(final, Object.keys(final).sort())
    const etag = '"' + crypto.createHash('md5').update(canonical).digest('hex') + '"'
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'no-cache')
    res.json(final)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.post('/api/config', express.json({ limit: '1mb' }), async (req, res) => {
  if (req.tenantId === null) return res.status(400).json({ error: 'Tenant belum aktif' })
  try {
    const { mode, price, preset_name, branding } = req.body || {}
    const p = Number(price)
    const finalPrice = p === 0 ? 0 : p || 5000
    await saveConfig({
      mode: mode === 'event' ? 'event' : 'regular',
      price: finalPrice,
      preset_name: preset_name ?? null,
      branding: branding ?? {},
    }, req.tenantId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── AI Sketch (Gemini) — settings + generate ───────────────────────────────
// GET: status utk frontend. API key TIDAK pernah dikirim ke client — cuma flag ada/tidak.
app.get('/api/ai/status', async (req, res) => {
  try {
    const s = await getAiSettings(req.tenantId)
    res.json({ enabled: !!s.enabled && !!s.api_key, hasKey: !!s.api_key, model: s.model })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PIN tenant status: return whether pin is required or not (no secret)
app.get('/api/tenant/pin-status', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT access_pin FROM tenants WHERE slug = $1', [req.tenantId])
    const pin = rows[0]?.access_pin || null
    res.json({ required: !!pin })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.post('/api/tenant/verify-pin', express.json({ limit: '1kb' }), async (req, res) => {
  try {
    const { pin } = req.body || {}
    const reqPin = String(pin || '').trim()
    const { rows } = await pool.query('SELECT access_pin FROM tenants WHERE slug = $1', [req.tenantId])
    const stored = rows[0]?.access_pin || null
    if (!stored) return res.status(400).json({ error: 'PIN tidak diaktifkan untuk tenant ini' })
    if (reqPin === stored) return res.json({ ok: true })
    return res.status(403).json({ error: 'PIN salah', code: 'PIN_INVALID' })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET admin view: key disamarkan (hanya 6 char terakhir) biar operator bisa cek key mana yg tersimpan.
app.get('/api/ai/settings', async (req, res) => {
  try {
    const s = await getAiSettings(req.tenantId)
    res.json({
      api_key_masked: s.api_key ? `••••••••${s.api_key.slice(-6)}` : '',
      model: s.model,
      prompt: s.prompt,
      enabled: !!s.enabled && !!s.api_key,
      hasKey: !!s.api_key,
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST admin: simpan. api_key kosong string = hapus; tidak dikirim = tetap.
app.post('/api/ai/settings', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const b = req.body || {}
    await saveAiSettings({
      api_key: typeof b.api_key === 'string' ? b.api_key.trim() : undefined,
      model: typeof b.model === 'string' ? b.model : undefined,
      prompt: typeof b.prompt === 'string' ? b.prompt : undefined,
      enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
    }, req.tenantId)
    const s = await getAiSettings(req.tenantId)
    res.json({
      ok: true,
      api_key_masked: s.api_key ? `••••••••${s.api_key.slice(-6)}` : '',
      model: s.model,
      prompt: s.prompt,
      enabled: !!s.enabled && !!s.api_key,
      hasKey: !!s.api_key,
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST: foto (dataURL base64 atau multipart image) -> Gemini -> sketsa (dataURL).
// Selalu balik JSON { ok } ATAU { error }; frontend wajib punya fallback lokal.
app.post('/api/ai/sketch', upload.single('image'), async (req, res) => {
  try {
    const s = await getAiSettings(req.tenantId)
    if (!s.enabled || !s.api_key) return res.status(400).json({ error: 'AI sketch belum diaktifkan / API key belum diisi' })

    // Sumber gambar: file upload (multipart) ATAU JSON {image: dataURL}.
    let buf = req.file?.buffer
    let mime = req.file?.mimetype || 'image/png'
    if (!buf) {
      const body = req.body || {}
      const dataUrl = typeof body.image === 'string' ? body.image : ''
      const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl)
      if (!m) return res.status(400).json({ error: 'no image' })
      mime = m[1]
      buf = Buffer.from(m[2], 'base64')
    }
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'gambar terlalu besar (max 8MB)' })

    const prompt = s.prompt?.trim() || 'Transform this photo into a minimalist black-and-white pencil sketch.'
    const model = s.model || 'gemini-2.5-flash-image'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)

    const gres = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(s.api_key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mime, data: buf.toString('base64') } },
          ],
        }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    }).finally(() => clearTimeout(timeout))

    if (!gres.ok) {
      const txt = await gres.text().catch(() => '')
      console.error('[ai-sketch] gemini error', gres.status, txt.slice(0, 300))
      return res.status(502).json({ error: `Gemini error ${gres.status}` })
    }
    const gj = await gres.json()
    const parts = gj?.candidates?.[0]?.content?.parts || []
    const imgPart = parts.find((p) => p.inlineData || p.inline_data)
    const ip = imgPart?.inlineData || imgPart?.inline_data
    if (!ip?.data) return res.status(502).json({ error: 'Gemini tidak mengembalikan gambar' })
    res.json({ image: `data:${ip.mimeType || ip.mime_type || 'image/png'};base64,${ip.data}` })
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'timeout — Gemini terlalu lama merespons' : String(e)
    console.error('[ai-sketch]', msg)
    res.status(502).json({ error: msg })
  }
})


// ── Custom frame gallery (operator upload, customer pilih di booth) ──
// Daftar frame (tanpa blob) untuk dirender sebagai pilihan di booth.
app.get('/api/frames', async (req, res) => {
  try {
    const t = typeof req.query.template === 'string' ? req.query.template : null
    res.json(await listFrames(t, req.tenantId))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Upload frame PNG baru (operator, via Pengaturan Event).
app.post('/api/frames', upload.single('image'), async (req, res) => {
  try {
    if (req.tenantId === 'admin') return res.status(404).end()
    const tierCheck = await checkTierLimit(null, req.tenantId, 'frames')
    if (!tierCheck.ok) return res.status(403).json({ error: tierCheck.error })
    if (!req.file) return res.status(400).json({ error: 'no image' })
    const id = crypto.randomUUID()
    const name = req.body?.name || `frame-${Date.now()}`
    const tpl = (req.body?.template && ['strip3','single','grid2x2'].includes(req.body.template)) ? req.body.template : null
    await saveFrame(id, name, req.file.buffer, tpl, req.tenantId)
    res.json({ id, name })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil blob PNG satu frame (dipakai saat render hasil cetak).
app.get('/api/frames/:id', async (req, res) => {
  try {
    const data = await getFrame(req.params.id, req.tenantId)
    if (!data) return res.status(404).end()
    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Hapus frame (operator).
app.delete('/api/frames/:id', async (req, res) => {
  try {
    await deleteFrame(req.params.id, req.tenantId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Designs (mockup: bingkai PNG + slot foto bebas/miring) ──
// List design (tanpa blob) untuk picker di booth.
app.get('/api/designs', async (req, res) => {
  try {
    res.json(await listDesigns(req.tenantId))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Upload design baru: frame PNG (opsional) + slots JSON + canvas w/h.
app.post('/api/designs', upload.single('image'), async (req, res) => {
  try {
    if (req.tenantId === 'admin') return res.status(404).end()
    const tierCheck = await checkTierLimit(null, req.tenantId, 'designs')
    if (!tierCheck.ok) return res.status(403).json({ error: tierCheck.error })
    const id = crypto.randomUUID()
    const name = req.body?.name || `design-${Date.now()}`
    let slots = []
    try { slots = JSON.parse(req.body?.slots || '[]') } catch { slots = [] }
    const cw = Number(req.body?.canvas_w) || 308
    const ch = Number(req.body?.canvas_h) || 454
    await saveDesign(id, name, req.file ? req.file.buffer : null, cw, ch, slots, req.tenantId)
    res.json({ id, name })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Update design: ganti slots (dan/atau bingkai). Field opsional.
app.put('/api/designs/:id', upload.single('image'), async (req, res) => {
  try {
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
    }, req.tenantId)
    res.json({ ok: true, id: req.params.id })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil detail design (JSON: slot + canvas + ada/tidak bingkai).
app.get('/api/designs/:id', async (req, res) => {
  try {
    const d = await getDesign(req.params.id, req.tenantId)
    if (!d) return res.status(404).json({ error: 'not found' })
    res.json({
      id: d.id,
      name: d.name,
      canvas_w: d.canvas_w,
      canvas_h: d.canvas_h,
      slots: d.slots,
      hasFrame: d.hasFrame,
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil blob PNG bingkai satu design (dipakai saat render hasil cetak).
app.get('/api/designs/:id/frame', async (req, res) => {
  try {
    const r = await pool.query('SELECT frame_data FROM designs WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId])
    if (!r.rows[0] || !r.rows[0].frame_data) return res.status(404).end()
    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(r.rows[0].frame_data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Hapus design.
app.delete('/api/designs/:id', async (req, res) => {
  try {
    await deleteDesign(req.params.id, req.tenantId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.post('/api/print', express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const data = req.body?.data
    if (!data) return res.status(400).json({ error: 'no data' })
    const buf = Buffer.from(data, 'base64')
    if (!PRINT_ENABLED) {
      console.log(`[print] disabled (no printer) — ${buf.length} bytes received, dropped`)
      return res.json({ ok: true, bytes: buf.length, note: 'printer disabled' })
    }
    const { SerialPort } = await import('serialport')
    const port = new SerialPort({ path: PRINTER_PATH, baudRate: PRINTER_BAUD })
    await new Promise((resolve, reject) => {
      port.on('open', resolve)
      port.on('error', reject)
    })
    await new Promise((resolve, reject) => port.write(buf, (e) => (e ? reject(e) : resolve())))
    await new Promise((resolve) => port.drain(() => port.close(() => resolve())))
    res.json({ ok: true, bytes: buf.length })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Admin dashboard (email+password, scrypt + DB session, model spt kontrakan) ──
const ADMIN_SESSION_COOKIE = 'pb_admin_session'

function requireAccess(req, res, next) {
  const token = parseCookies(req).admin_session || parseCookies(req)[ADMIN_SESSION_COOKIE]
  getSessionUser(token)
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'unauthorized' })
      req.adminUser = user
      next()
    })
    .catch(() => res.status(401).json({ error: 'unauthorized' }))
}

// ── Tenant management (global admin only) ────────────────────────────────────
app.post('/portal/api/tenants', express.json({ limit: '1mb' }), requireAccess, async (req, res) => {
  try {
    const { slug, name, access_pin } = req.body || {}
    const s = String(slug || '').trim().toLowerCase()
    if (!s || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(s)) return res.status(400).json({ error: 'slug wajib huruf/angka/-, 1-40 char, mulai huruf/angka' })
    const n = String(name || s).trim() || s
    const pin = String(access_pin || '').trim() || null
    await pool.query(
      `INSERT INTO tenants (slug, name, access_pin) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, access_pin = EXCLUDED.access_pin, updated_at = now()`,
      [s, n, pin]
    )
    res.json({ ok: true, slug: s, name: n, access_pin: pin })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/portal/api/tenants', requireAccess, async (_req, res) => {
  try {
    const r = await pool.query('SELECT slug, name, active, access_pin, created_at, updated_at FROM tenants ORDER BY created_at ASC')
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.patch('/portal/api/tenants/:slug', express.json({ limit: '1mb' }), requireAccess, async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim()
    const { name, active, access_pin } = req.body || {}
    const sets = []
    const params = []
    if (typeof name === 'string' && name.trim()) { sets.push(`name = $${params.length + 1}`); params.push(name.trim()) }
    if (typeof active === 'boolean') { sets.push(`active = $${params.length + 1}`); params.push(active) }
    if (typeof access_pin === 'string' && access_pin.trim()) { sets.push(`access_pin = $${params.length + 1}`); params.push(access_pin.trim()) }
    if (!sets.length) return res.status(400).json({ error: 'tidak ada yang diubah' })
    sets.push(`updated_at = now()`)
    params.push(slug)
    const r = await pool.query(`UPDATE tenants SET ${sets.join(', ')} WHERE slug = $${params.length} RETURNING slug, name, active, access_pin`, params)
    if (!r.rows.length) return res.status(404).json({ error: 'tenant tidak ditemukan' })
    res.json({ ok: true, ...r.rows[0] })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/portal/api/tenants/:slug', requireAccess, async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim()
    if (!slug) return res.status(400).json({ error: 'slug kosong' })
    await pool.query('DELETE FROM tenants WHERE slug = $1', [slug])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.post('/portal/api/login', express.json({ limit: '1mb' }), async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email & password wajib' })
  const userId = await verifyAdmin(email, password)
  if (!userId) return res.status(401).json({ error: 'email atau password salah' })
  const token = await createSession(userId)
  res.set(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${token}; Path=/portal; HttpOnly; SameSite=Strict; Max-Age=${30 * 24 * 3600}`
  )
  res.json({ ok: true })
})

app.post('/portal/api/logout', express.json({ limit: '1mb' }), async (req, res) => {
  const token = parseCookies(req)[ADMIN_SESSION_COOKIE]
  if (token) await destroySession(token)
  res.set('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/portal; HttpOnly; Max-Age=0`)
  res.json({ ok: true })
})

// App memanggil ini saat transaksi lunas (QRIS simulasi ATAU cash dikonfirmasi).
// Endpoint INI SENGAJA TIDAK pakai requireAccess: kiosk booth tidak punya session
// admin, jadi kalau dilindungi auth transaksi tidak akan tercatat (401).
// Hanya validasi field wajib; bukan endpoint baca data sensitif.
app.post('/portal/api/log', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { method, amount, template, note, preset, mode } = req.body || {}
    if (!method || !amount) return res.status(400).json({ error: 'method & amount required' })
    if (!['qris', 'cash'].includes(method)) return res.status(400).json({ error: 'method tidak valid' })
    const row = await saveTransaction({
      method,
      amount: Number(amount),
      template: template || null,
      note: note || null,
      preset: preset || null,
      mode: mode || 'regular',
    })
    res.json({ ok: true, id: row.id })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/portal/api/stats', requireAccess, async (req, res) => {
  try {
    res.json(await getStats(req.tenantId))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/portal/api/transactions', requireAccess, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10000, 100000)
    const from = typeof req.query.from === 'string' ? req.query.from : null
    const to = typeof req.query.to === 'string' ? req.query.to : null
    res.json(await listTransactions({ tenantId: req.tenantId, limit, from, to }))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Daftar foto hasil yang masuk ke DB (terbaru dulu). Preview via /u/:id.
// Filter tanggal optional: ?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/portal/api/photos', requireAccess, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000)
    const from = typeof req.query.from === 'string' ? req.query.from : null
    const to = typeof req.query.to === 'string' ? req.query.to : null
    const rows = await listPhotos({ limit, from, to })
    res.json(rows.map((r) => ({ id: r.id, created_at: r.created_at, url: `/u/${r.id}` })))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Hapus satu foto by id.
app.delete('/portal/api/photos/:id', requireAccess, async (req, res) => {
  try {
    await deletePhoto(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Ganti password admin (verifikasi password lama dulu).
app.post('/portal/api/change-password', express.json({ limit: '1mb' }), requireAccess, async (req, res) => {
  const { current, next } = req.body || {}
  if (!current || !next) return res.status(400).json({ error: 'password lama & baru wajib' })
  const out = await changePassword(req.adminUser.id, current, next)
  if (!out.ok) return res.status(400).json({ error: out.error })
  res.json({ ok: true })
})

// Export transaksi (filter from/to) ke CSV.
app.get('/portal/api/export', requireAccess, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : null
    const to = typeof req.query.to === 'string' ? req.query.to : null
    const rows = await listTransactions({ limit: 100000, from, to })
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = ['id', 'waktu', 'metode', 'mode', 'preset', 'template', 'nominal', 'catatan']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([
        r.id,
        new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19),
        r.method,
        r.mode || 'regular',
        r.preset || '',
        r.template || '',
        r.amount,
        r.note || '',
      ].map(esc).join(','))
    }
    const stamp = new Date().toISOString().slice(0, 10)
    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="photobooth-transaksi-${stamp}.csv"`)
    res.send('﻿' + lines.join('\n')) // BOM biar Excel baca UTF-8
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// /portal -> redirect to /admin (new SPA, admin subdomain only)
app.get('/portal', async (req, res) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host, deviceFpFrom(req) || null)
  if (slug !== 'admin') return res.status(404).end()
  // Redirect ke /admin (SPA baru)
  const buildTime = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const spaHtml = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Admin</title><script>location.replace('/admin?v=${buildTime}')</script></head><body><noscript>Admin Dashboard — <a href="/admin">Buka</a></noscript></body></html>`
  res.set('Cache-Control', 'no-store')
  res.send(spaHtml)
})

// ──────────────────────────────────────────────────────────────────
// Subscription status check: runs every hour to transition expired tenants
// trial → expired → suspended (grace period = 3 days)
const SUBSCRIPTION_CHECK_INTERVAL = 60 * 60 * 1000 // 1 hour
setInterval(async () => {
  try {
    const result = await runSubscriptionCheck()
    if (result.updated > 0) console.log(`[subscription-check] ${result.updated} tenant status updated`)
  } catch (e) {
    console.error('[subscription-check] error:', e.message)
  }
  try {
    const n = await runNotifications()
    if (n.sent || n.failed) console.log(`[notify] sent=${n.sent} failed=${n.failed} skipped=${n.skipped}`)
  } catch (e) {
    console.error('[notify] error:', e.message)
  }
}, SUBSCRIPTION_CHECK_INTERVAL)
// Run once on startup (notifikasi selalu best-effort, jangan sampai crash startup)
runSubscriptionCheck().catch(e => console.error('[subscription-check] startup error:', e.message))
runNotifications().catch(e => console.error('[notify] startup error:', e.message))

// ── Access Code API (for tablet pairing) ────────────────────────────────────
// POST /api/access-code/validate — tablet validates a 6-char access code
app.post('/api/access-code/validate', express.json({ limit: '1kb' }), async (req, res) => {
  const { code, deviceFp } = req.body || {}
  if (!code) return res.status(400).json({ valid: false, error: 'Kode wajib diisi' })
  const result = await validateAccessCode(code)
  if (!result) return res.status(404).json({ valid: false, error: 'Kode akses tidak valid' })
  // Kode sudah dipakai → 400; error lain (expired/diblokir) tetap 403.
  if (result.error) return res.status(result.used ? 400 : 403).json({ valid: false, error: result.error })
  const fp = deviceFp ? String(deviceFp).trim().slice(0, 128) : ''
  // Limit 1 device booth per tenant: kalau fp ini BARU (belum ter-pair) dan tenant
  // sudah punya device aktif lain → tolak SEBELUM kode ditandai terpakai.
  if (fp) {
    const existing = await getBoothDevice(result.tenant_slug, fp)
    const alreadyPaired = !!(existing && existing.is_active)
    if (!alreadyPaired) {
      const devices = await listBoothDevices(result.tenant_slug)
      const activeOther = devices.some((d) => d.is_active !== false && d.device_fp !== fp)
      if (activeOther) {
        return res.status(400).json({ valid: false, error: 'Booth ini sudah terpasang di device lain. Putuskan lewat dashboard dulu.' })
      }
    }
  }
  // Single-use: tandai dipakai + nonaktifkan. Simpan fp pemakai kalau dikirim.
  await markAccessCodeUsed(result.id, { deviceFp: fp || null })
  // Daftarkan device yang berhasil pairing ke tenant (kalau fp tersedia).
  if (fp) {
    const ip = (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
    await upsertBoothDevice({ tenantSlug: result.tenant_slug, deviceFp: fp, ip })
  }
  // Return tenant config for offline caching
  const config = await getConfig(result.tenant_slug)
  res.json({
    valid: true,
    tenant: { slug: result.tenant_slug, name: result.name || null, status: result.status },
    config: config || null,
    subscription: {
      status: result.status,
      trial_ends_at: result.trial_ends_at,
      subscription_ends_at: result.subscription_ends_at,
    },
  })
})

// GET /api/access-code/status/:slug — re-validate subscription (for offline recheck)
// Query param ?fp=<fingerprint> → tambah device_paired (status pairing device itu).
app.get('/api/access-code/status/:slug', async (req, res) => {
  const sub = await getTenantSubscription(req.params.slug)
  if (!sub) return res.status(404).json({ valid: false, error: 'Tenant tidak ditemukan' })
  const eff = await getEffectiveTenantStatus(req.params.slug)
  const payload = { valid: eff === 'trial' || eff === 'active', subscription: sub }
  const fp = String(req.query.fp || '').trim()
  if (fp) {
    const dev = await getBoothDevice(req.params.slug, fp)
    payload.device_paired = !!(dev && dev.is_active)
  }
  res.json(payload)
})

// ── Tenant dashboard: access code generation ────────────────────────────────
// POST /api/tenant/access-code — tenant_admin generates a new pairing code
app.post('/api/tenant/access-code', requireUserSession, requireUserCsrf, express.json({ limit: '1kb' }), async (req, res) => {
  const user = req.user
  if (!user.tenant_id) return res.status(400).json({ error: 'Anda belum memiliki tenant' })
  if (!(await assertTenantScope(req, res, user.tenant_id))) return
  const tenant = await getTenantSubscription(user.tenant_id)
  if (!tenant) return res.status(404).json({ error: 'Tenant tidak ditemukan' })
  if (tenant.status === 'pending') return res.status(403).json({ error: 'Pendaftaran masih menunggu persetujuan admin' })
  if (tenant.status === 'rejected') return res.status(403).json({ error: 'Pendaftaran ditolak' })
  if (tenant.status === 'suspended') return res.status(403).json({ error: 'Tenant diblokir' })
  if (tenant.status === 'expired') return res.status(403).json({ error: 'Langganan berakhir' })
  // Masa aktif kode default 15 menit (clamp 5..1440), bisa dioverride body.expiryMinutes.
  const mins = Math.min(1440, Math.max(5, Number(req.body?.expiryMinutes) || 15))
  const expiry = new Date(Date.now() + mins * 60 * 1000)
  const ac = await generateAccessCode(user.tenant_id, { expiry })
  res.json({ code: ac.code, expires_at: ac.expires_at })
})

// GET /api/tenant/access-codes — list active codes for this tenant
app.get('/api/tenant/access-codes', requireUserSession, async (req, res) => {
  const user = req.user
  if (!user.tenant_id) return res.json({ items: [] })
  const { listActiveAccessCodes } = await import('./db.mjs')
  const items = await listActiveAccessCodes(user.tenant_id)
  res.json({ items })
})

// GET /api/tenant/devices — daftar device yang sudah di-pair ke tenant user
app.get('/api/tenant/devices', requireUserSession, async (req, res) => {
  const user = req.user
  if (!user.tenant_id) return res.json({ items: [] })
  const items = await listBoothDevices(user.tenant_id)
  res.json({ items })
})

// POST /api/tenant/devices/:id/revoke — nonaktifkan (unpair) device milik tenant user
app.post('/api/tenant/devices/:id/revoke', requireUserSession, requireUserCsrf, express.json({ limit: '1kb' }), async (req, res) => {
  const user = req.user
  if (!user.tenant_id) return res.status(400).json({ error: 'Anda belum memiliki tenant' })
  if (!(await assertTenantScope(req, res, user.tenant_id))) return
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id device tidak valid' })
  await deactivateBoothDevice(user.tenant_id, id)
  res.json({ ok: true })
})

// ── Tenant admin: extend trial / suspend / reactivate ───────────────────────
// Scope: user hanya boleh mengelola tenant miliknya (owner_user_id) atau
// tenant tempat dia terdaftar (admin_user.tenant_id). Lain → 403.
async function assertTenantScope(req, res, slug) {
  if (!slug) { res.status(400).json({ error: 'slug wajib' }); return false }
  const { rows } = await pool.query('SELECT owner_user_id FROM tenants WHERE slug = $1', [slug])
  if (!rows.length) { res.status(404).json({ error: 'Tenant tidak ditemukan' }); return false }
  const ownerId = rows[0].owner_user_id
  const isOwner = ownerId != null && ownerId === req.user.id
  const isMember = req.user.tenant_id === slug
  if (!isOwner && !isMember) { res.status(403).json({ error: 'Akses ditolak' }); return false }
  return true
}

app.post('/api/tenant/extend-trial', requireUserSession, requireUserCsrf, express.json({ limit: '1mb' }), async (req, res) => {
  const { slug, days = 3 } = req.body || {}
  if (!(await assertTenantScope(req, res, slug))) return
  const { extendTenantTrial } = await import('./db.mjs')
  await extendTenantTrial(slug, days)
  res.json({ ok: true })
})
app.post('/api/tenant/suspend', requireUserSession, requireUserCsrf, express.json({ limit: '1mb' }), async (req, res) => {
  const { slug } = req.body || {}
  if (!(await assertTenantScope(req, res, slug))) return
  const { suspendTenant } = await import('./db.mjs')
  await suspendTenant(slug)
  res.json({ ok: true })
})
app.post('/api/tenant/reactivate', requireUserSession, requireUserCsrf, express.json({ limit: '1mb' }), async (req, res) => {
  const { slug, days = 30 } = req.body || {}
  if (!(await assertTenantScope(req, res, slug))) return
  const { reactivateTenant } = await import('./db.mjs')
  await reactivateTenant(slug, days)
  res.json({ ok: true })
})

// SPA fallback (Express 5 safe: no wildcard path; block /admin.html explicitly)
app.get('/admin.html', (_req, res) => res.status(404).end())
app.use((_req, res) => res.sendFile(path.join(DIST, 'index.html')))

const PORT = Number(process.env.PORT || 8080)

app.listen(PORT, '0.0.0.0', () => {
  const secretSet = !!(process.env.LICENSE_SECRET_KEY)
  console.log(`photobooth combined server on :${PORT}`)
  console.log(`  frontend : /`)
  console.log(`  api      : /api/upload, /api/print, /api/presets, /api/config, /api/frames`)
  console.log(`  storage  : Postgres (db=${process.env.PG_DATABASE || 'photobooth'})`)
  console.log(`  printer  : ${process.env.PRINT_ENABLED === '1' ? 'enabled' : 'disabled'} (set PRINT_ENABLED=1 & PRINTER_PATH to enable)`)
  console.log(`  license  : ${secretSet ? '(secret loaded)' : '(warning: no secret)'}`)
})

