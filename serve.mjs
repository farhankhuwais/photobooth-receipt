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
import { initDb, savePhoto, getPhoto, savePreset, listPresets, getPreset, deletePreset, saveTransaction, listTransactions, getStats, verifyAdmin, createSession, getSessionUser, destroySession, changePassword, saveFrame, listFrames, getFrame, deleteFrame, getConfig, saveConfig, saveAttract, getAttract, deleteAttract, saveAttractIcon, getAttractIcon, deleteAttractIcon, saveDesign, listDesigns, getDesign, updateDesign, deleteDesign } from './db.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')

const PRINTER_PATH = process.env.PRINTER_PATH || ''
const PRINTER_BAUD = Number(process.env.PRINTER_BAUD || 9600)
const PRINT_ENABLED = process.env.PRINT_ENABLED === '1' && !!PRINTER_PATH

await initDb()

const app = express()
app.use(cors())

// Frontend (SPA): serve dist, fallback to index.html
app.use(express.static(DIST))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// Store uploaded strips in Postgres (id = timestamp.png), serve by id
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no image' })
  const id = `${Date.now()}.png`
  await savePhoto(id, req.file.buffer)
  res.json({ url: `${req.protocol}://${req.get('host')}/u/${id}` })
})

// Serve a stored strip from Postgres (used inside the QR digital link)
app.get('/u/:id', async (req, res) => {
  try {
    const data = await getPhoto(req.params.id)
    if (!data) return res.status(404).end()
    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Presets — konfigurasi bernama (bisa banyak), tiap preset punya mode sendiri.
app.post('/api/presets', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { name, mode, price, branding } = req.body || {}
    const nm = String(name || '').trim()
    if (!nm) return res.status(400).json({ error: 'nama preset wajib' })
    const m = mode === 'event' ? 'event' : 'regular'
    const p = m === 'event' ? 0 : (price === 0 ? 0 : Number(price) || 5000)
    const saved = await savePreset(nm, m, p, branding ?? {})
    res.json({ ok: true, name: saved, mode: m })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// List preset (array). ?mode=regular|event untuk filter per mode.
app.get('/api/presets', async (req, res) => {
  try {
    let rows = await listPresets()
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
    const p = await getPreset(req.params.name)
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
    const saved = await savePreset(oldName, m, p, branding ?? {})
    res.json({ ok: true, name: saved, mode: m, updated: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Hapus preset by name.
app.delete('/api/presets/:name', async (req, res) => {
  try {
    await deletePreset(req.params.name)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Active app config (persisted; survives refresh/cache clear) ──
app.get('/api/config', async (_req, res) => {
  try {
    const cfg = await getConfig()
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
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Custom frame gallery (operator upload, customer pilih di booth) ──
// Daftar frame (tanpa blob) untuk dirender sebagai pilihan di booth.
app.get('/api/frames', async (req, res) => {
  try {
    // ?template=strip3|single|grid2x2 -> filter + frame universal (NULL).
    const t = typeof req.query.template === 'string' ? req.query.template : null
    res.json(await listFrames(t))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Upload frame PNG baru (operator, via Pengaturan Event).
app.post('/api/frames', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no image' })
    const id = crypto.randomUUID()
    const name = req.body?.name || `frame-${Date.now()}`
    // template opsional: strip3 | single | grid2x2 (kosong = universal).
    const tpl = (req.body?.template && ['strip3','single','grid2x2'].includes(req.body.template)) ? req.body.template : null
    await saveFrame(id, name, req.file.buffer, tpl)
    res.json({ id, name })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil blob PNG satu frame (dipakai saat render hasil cetak).
app.get('/api/frames/:id', async (req, res) => {
  try {
    const data = await getFrame(req.params.id)
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
    await deleteFrame(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Designs (mockup: bingkai PNG + slot foto bebas/miring) ──
// List design (tanpa blob) untuk picker di booth.
app.get('/api/designs', async (_req, res) => {
  try {
    res.json(await listDesigns())
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Upload design baru: frame PNG (opsional) + slots JSON + canvas w/h.
app.post('/api/designs', upload.single('image'), async (req, res) => {
  try {
    const id = crypto.randomUUID()
    const name = req.body?.name || `design-${Date.now()}`
    let slots = []
    try { slots = JSON.parse(req.body?.slots || '[]') } catch { slots = [] }
    const cw = Number(req.body?.canvas_w) || 308
    const ch = Number(req.body?.canvas_h) || 454
    await saveDesign(id, name, req.file ? req.file.buffer : null, cw, ch, slots)
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
    })
    res.json({ ok: true, id: req.params.id })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil detail design (JSON: slot + canvas + ada/tidak bingkai).
app.get('/api/designs/:id', async (req, res) => {
  try {
    const d = await getDesign(req.params.id)
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
    const d = await getDesign(req.params.id)
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
    await deleteDesign(req.params.id)
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
    await saveAttract(mode, mt, req.file.buffer)
    res.json({ ok: true, mode, mediaType: mt })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
// Ambil blob background untuk mode tertentu.
app.get('/api/attract/:mode', async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    const row = await getAttract(mode)
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
    await deleteAttract(mode)
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
    await saveAttractIcon(mode, mt, req.file.buffer)
    res.json({ ok: true, mode, mediaType: mt })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.get('/api/attract/:mode/icon', async (req, res) => {
  try {
    const mode = req.params.mode === 'event' ? 'event' : 'regular'
    const row = await getAttractIcon(mode)
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
    await deleteAttractIcon(mode)
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

app.get('/portal/api/stats', requireAccess, async (_req, res) => {
  try {
    res.json(await getStats())
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/portal/api/transactions', requireAccess, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10000, 100000)
    const from = typeof req.query.from === 'string' ? req.query.from : null
    const to = typeof req.query.to === 'string' ? req.query.to : null
    res.json(await listTransactions({ limit, from, to }))
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

// Halaman dashboard statis — SELALU tampilkan (form login ada di dalamnya).
// Yang wajib requireAccess hanya endpoint /portal/api/* di atas, bukan halaman ini.
app.get('/portal', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'))
})

// SPA fallback (Express 5 safe: no wildcard path)
app.use((_req, res) => res.sendFile(path.join(DIST, 'index.html')))

const PORT = Number(process.env.PORT || 8080)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`photobooth combined server on :${PORT}`)
  console.log(`  frontend : /`)
  console.log(`  api      : /api/upload, /api/print, /api/presets, /api/config, /api/frames`)
  console.log(`  storage  : Postgres (db=photobooth)`)
  console.log(`  printer  : ${PRINT_ENABLED ? PRINTER_PATH + ' @' + PRINTER_BAUD : 'disabled (set PRINT_ENABLED=1 & PRINTER_PATH to enable)'}`)
})
