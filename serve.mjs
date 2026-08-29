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
import { initDb, savePhoto, getPhoto, listPhotos, deletePhoto, savePreset, listPresets, getPreset, deletePreset, saveTransaction, listTransactions, getStats, verifyAdmin, createSession, getSessionUser, destroySession, changePassword, saveFrame, listFrames, getFrame, deleteFrame, getConfig, saveConfig, saveAttract, getAttract, deleteAttract, saveAttractIcon, getAttractIcon, deleteAttractIcon, saveDesign, listDesigns, getDesign, updateDesign, deleteDesign, DEFAULT_TENANT, resolveTenant, pool, checkTierLimit } from './db.mjs'
import { adminApi } from './admin-api.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')

const PRINTER_PATH = process.env.PRINTER_PATH || ''
const PRINTER_BAUD = Number(process.env.PRINTER_BAUD || 9600)
const PRINT_ENABLED = process.env.PRINT_ENABLED === '1' && !!PRINTER_PATH

await initDb()

const app = express()
app.use(cors())

// Multi-tenant resolver: baca subdomain dari host, fallback ke DEFAULT_TENANT.
app.use(async (req, _res, next) => {
  req.tenantId = await resolveTenant(req.get('host') || '')
  next()
})

// Block unknown tenants
app.use(async (req, res, next) => {
  if (req.tenantId === null) {
    res.set('Cache-Control', 'no-store, max-age=0')
    return res.status(404).end()
  }
  next()
})

// Require tenant PIN for protected tenant API routes (skip admin subdomain and public endpoints)
app.use('/api', async (req, res, next) => {
  if (req.tenantId === null) return res.status(404).end()
  // admin tenant: allow /api/admin/* to pass through (handled by separate router below)
  // block all other /api/* on admin tenant (root domain serves SPA only)
  if (req.tenantId === 'admin') {
    const path = String(req.path || '')
    if (path.startsWith('/admin/')) return next()
    res.set('Cache-Control', 'no-store, max-age=0')
    return res.status(404).end()
  }
  const path = String(req.path || '')
  if (path === '/tenant/pin-status' || path === '/tenant/verify-pin' || path.startsWith('/admin/')) return next()
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

// Redirect root on admin subdomain to /admin (new SPA). On tenant subdomains, serve the booth app.
app.get('/', async (req, res) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host)
  if (slug === 'admin') return res.redirect('/admin')
  if (slug === null) { res.status(404).end(); return }
  res.set('Cache-Control', 'no-store')
  res.sendFile(path.join(DIST, 'index.html'))
})

// New admin SPA — only on admin subdomain, served from dist/admin
const ADMIN_DIST = path.join(DIST, 'admin')
app.use('/admin', async (req, res, next) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host)
  if (slug !== 'admin') return res.status(404).end()
  if (req.method !== 'GET') return next()
  if (req.path !== '/' && req.path !== '/index.html') return next()
  res.set('Cache-Control', 'no-store')
  res.sendFile(path.join(ADMIN_DIST, 'index.html'))
})
app.use('/admin/assets', async (req, res, next) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host)
  if (slug !== 'admin') return res.status(404).end()
  next()
}, express.static(ADMIN_DIST, { setHeaders: (r) => r.set('Cache-Control', 'public, max-age=300') }))

// New admin API — only on admin subdomain
app.use('/api/admin', async (req, res, next) => {
  const host = (req.get('host') || '').split(':')[0]
  const slug = await resolveTenant(host)
  if (slug !== 'admin') return res.status(404).end()
  next()
}, adminApi())

// Frontend (SPA): serve dist, fallback to index.html
app.use(express.static(DIST, { setHeaders: (res) => res.set('Cache-Control', 'no-store') }))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// Store uploaded strips in Postgres (id = timestamp.png), serve by id
app.post('/api/upload', upload.single('image'), async (req, res) => {
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
app.post('/api/presets', express.json({ limit: '1mb' }), async (req, res) => {
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
app.put('/api/presets/:name', express.json({ limit: '1mb' }), async (req, res) => {
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
app.get('/api/config', async (req, res) => {
  try {
    const cfg = await getConfig(req.tenantId)
    res.json(cfg || { mode: 'regular', price: 5000, preset_name: null, branding: null })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.post('/api/config', express.json({ limit: '1mb' }), async (req, res) => {
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
      hasFrame: !!d.frame_data,
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil blob PNG bingkai satu design (dipakai saat render hasil cetak).
app.get('/api/designs/:id/frame', async (req, res) => {
  try {
    const d = await getDesign(req.params.id, req.tenantId)
    if (!d || !d.frame_data) return res.status(404).end()
    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(d.frame_data)
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

// ── Attract background (image/video) per mode, disimpan di DB ──
// Upload/simpan background untuk mode tertentu (regular/event).
app.post('/api/attract/:mode', upload.single('media'), async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    if (!req.file) return res.status(400).json({ error: 'no media' })
    const mt = req.file.mimetype || 'application/octet-stream'
    if (!/^image\//.test(mt) && !/^video\//.test(mt)) {
      return res.status(400).json({ error: 'hanya image/video' })
    }
    await saveAttract(mode, mt, req.file.buffer, req.tenantId)
    res.json({ ok: true, mode, mediaType: mt })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil blob background untuk mode tertentu.
app.get('/api/attract/:mode', async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    const row = await getAttract(mode, req.tenantId)
    if (!row) return res.status(404).end()
    res.set('Content-Type', row.media_type)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(row.data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Hapus background mode tertentu.
app.delete('/api/attract/:mode', async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    await deleteAttract(mode, req.tenantId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Attract tap icon (custom PNG per mode) ──
app.post('/api/attract/:mode/icon', upload.single('image'), async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    if (!req.file) return res.status(400).json({ error: 'no image' })
    const mt = req.file.mimetype || 'image/png'
    if (!/^image\//.test(mt)) return res.status(400).json({ error: 'hanya image' })
    await saveAttractIcon(mode, mt, req.file.buffer, req.tenantId)
    res.json({ ok: true, mode, mediaType: mt })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.get('/api/attract/:mode/icon', async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    const row = await getAttractIcon(mode, req.tenantId)
    if (!row) return res.status(404).end()
    res.set('Content-Type', row.media_type)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(row.data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.delete('/api/attract/:mode/icon', async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    await deleteAttractIcon(mode, req.tenantId)
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

function parseCookies(req) {
  const out = {}
  for (const c of (req.headers.cookie || '').split('; ')) {
    const i = c.indexOf('=')
    if (i > 0) out[c.slice(0, i)] = c.slice(i + 1)
  }
  return out
}

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
  const slug = await resolveTenant(host)
  if (slug !== 'admin') return res.status(404).end()
  // Redirect ke /admin (SPA baru)
  const buildTime = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const spaHtml = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Admin</title><script>location.replace('/admin?v=${buildTime}')</script></head><body><noscript>Admin Dashboard — <a href="/admin">Buka</a></noscript></body></html>`
  res.set('Cache-Control', 'no-store')
  res.send(spaHtml)
})

// SPA fallback (Express 5 safe: no wildcard path; block /admin.html explicitly)
app.get('/admin.html', (_req, res) => res.status(404).end())
app.use((_req, res) => res.sendFile(path.join(DIST, 'index.html')))

const PORT = Number(process.env.PORT || 8080)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`photobooth combined server on :${PORT}`)
  console.log(`  frontend : /`)
  console.log(`  api      : /api/upload, /api/print, /api/presets, /api/config, /api/frames`)
  console.log(`  storage  : Postgres (db=photobooth)`)
  console.log(`  printer  : ${PRINT_ENABLED ? PRINTER_PATH + ' @' + PRINTER_BAUD : 'disabled (set PRINT_ENABLED=1 & PRINTER_PATH to enable)'}`)
})
