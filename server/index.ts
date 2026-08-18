import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printBuffer } from './bridge.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS = path.join(__dirname, 'uploads')
await fs.mkdir(UPLOADS, { recursive: true })

const app = express()
app.use(cors())
app.use('/u', express.static(UPLOADS))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// Simpan strip PNG -> balikan URL publik (dipakai di QR foto digital)
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no image' })
  const name = `${Date.now()}.png`
  await fs.writeFile(path.join(UPLOADS, name), req.file.buffer)
  res.json({ url: `${req.protocol}://${req.get('host')}/u/${name}` })
})

// Terima ESC/POS bytes (base64) dari web app -> tulis ke printer via serial COM
app.post('/api/print', express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const data = req.body?.data
    if (!data) return res.status(400).json({ error: 'no data' })
    const buf = Buffer.from(data, 'base64')
    await printBuffer(buf)
    res.json({ ok: true, bytes: buf.length })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, () => console.log(`photobooth server on :${PORT} (printer ${process.env.PRINTER_PATH || 'COM3'})`))
