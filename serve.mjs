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
import { initDb, savePhoto, getPhoto, savePreset, listPresets, getPreset } from './db.mjs'

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
