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
import { fileURLToPath } from 'node:url'
import { initDb, savePhoto, getPhoto, savePreset, listPresets, getPreset, saveTransaction, listTransactions, getStats, verifyAdmin, createSession, getSessionUser, destroySession, changePassword } from './db.mjs'

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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

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

// Event branding presets (server-side, replaces localStorage-only storage)
app.post('/api/presets', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { name, branding } = req.body || {}
    if (!name) return res.status(400).json({ error: 'no name' })
    const id = await savePreset(name, branding ?? {})
    res.json({ id, name })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.get('/api/presets', async (_req, res) => {
  try {
    res.json(await listPresets())
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.get('/api/presets/:name', async (req, res) => {
  try {
    const branding = await getPreset(req.params.name)
    if (!branding) return res.status(404).json({ error: 'not found' })
    res.json(branding)
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
    const { method, amount, template, note } = req.body || {}
    if (!method || !amount) return res.status(400).json({ error: 'method & amount required' })
    if (!['qris', 'cash'].includes(method)) return res.status(400).json({ error: 'method tidak valid' })
    const row = await saveTransaction({ method, amount: Number(amount), template: template || null, note: note || null })
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
    const header = ['id', 'waktu', 'metode', 'template', 'nominal', 'catatan']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([
        r.id,
        new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19),
        r.method,
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
  console.log(`  api      : /api/upload, /api/print, /api/presets`)
  console.log(`  storage  : Postgres (db=photobooth)`)
  console.log(`  printer  : ${PRINT_ENABLED ? PRINTER_PATH + ' @' + PRINTER_BAUD : 'disabled (set PRINT_ENABLED=1 & PRINTER_PATH to enable)'}`)
})
