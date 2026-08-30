import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box, Paper, Typography, Stack, Button, TextField, IconButton, Slider,
  Alert, Switch, FormControlLabel, Divider, Chip, Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import ColorLensIcon from '@mui/icons-material/ColorLens'
import SearchIcon from '@mui/icons-material/Search'
import { api } from '@/api/client'

// Koordinat & skala (sama dengan booth DesignEditor.tsx, WYSIWYG 1:1 dengan hasil cetak)
const CANVAS_W = 308
const CANVAS_H = 454
const OUT_W = 576
const OUT_H = Math.round(CANVAS_H * (OUT_W / CANVAS_W)) // 849
const DISP_W = 248
const SCALE = DISP_W / OUT_W

export interface Slot {
  x: number
  y: number
  w: number
  h: number
  rot: number
}

type DragMode = 'move' | 'resize' | null

interface Design {
  id: string
  name: string
  canvas_w?: number
  canvas_h?: number
  slots?: Slot[]
  hasFrame?: boolean
  frameBuf?: string
}

interface DesignEditorProps {
  tenantSlug: string
  initialDesignId?: string
  onSaved?: () => void
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '')
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) }
}
function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = rej
    im.src = src
  })
}
interface ZoneBox { x: number; y: number; w: number; h: number }

function mergeBoxes(bs: ZoneBox[]): ZoneBox[] {
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j]
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        const inter = ix * iy
        const small = Math.min(a.w * a.h, b.w * b.h)
        if (inter > 0.5 * small) {
          bs[i] = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
                    w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
                    h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }
          bs.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return bs
}

async function scanColorZones(src: string, colorHex: string, tol: number): Promise<ZoneBox[]> {
  const img = await loadImageEl(src)
  const W = img.naturalWidth, H = img.naturalHeight
  if (!W || !H) return []
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, W, H).data
  const t = hexToRgb(colorHex)
  const tol2 = tol * tol * 3
  const mask = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const dr = data[i] - t.r, dg = data[i + 1] - t.g, db = data[i + 2] - t.b
    if (dr * dr + dg * dg + db * db <= tol2) mask[p] = 1
  }
  const visited = new Uint8Array(W * H)
  const raw: ZoneBox[] = []
  const stack: number[] = []
  for (let p0 = 0; p0 < mask.length; p0++) {
    if (!mask[p0] || visited[p0]) continue
    let minX = W, minY = H, maxX = 0, maxY = 0, n = 0
    stack.length = 0; stack.push(p0); visited[p0] = 1
    while (stack.length) {
      const q = stack.pop()!
      const x = q % W, y = (q / W) | 0
      n++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && mask[q - 1] && !visited[q - 1]) { visited[q - 1] = 1; stack.push(q - 1) }
      if (x < W - 1 && mask[q + 1] && !visited[q + 1]) { visited[q + 1] = 1; stack.push(q + 1) }
      if (y > 0 && mask[q - W] && !visited[q - W]) { visited[q - W] = 1; stack.push(q - W) }
      if (y < H - 1 && mask[q + W] && !visited[q + W]) { visited[q + W] = 1; stack.push(q + W) }
    }
    if (maxX - minX + 1 >= 24 && maxY - minY + 1 >= 24 && n >= 0.35 * (maxX - minX + 1) * (maxY - minY + 1)) {
      raw.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
    }
  }
  return mergeBoxes(raw)
}

export default function DesignEditor({ tenantSlug, initialDesignId, onSaved }: DesignEditorProps) {
  const [designs, setDesigns] = useState<{ id: string; name: string }[]>([])
  const [selId, setSelId] = useState<string>('')
  const [name, setName] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [framePending, setFramePending] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [active, setActive] = useState<number | null>(null)

  // Zone detection
  const [zoneColor, setZoneColor] = useState('#a5d6a7')
  const [zoneTol, setZoneTol] = useState(60)
  const [zoneBoxes, setZoneBoxes] = useState<ZoneBox[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [stripZones, setStripZones] = useState(true)

  const canvasRef = useRef<HTMLDivElement>(null)
  const frameInput = useRef<HTMLInputElement>(null)
  const drag = useRef<{ mode: DragMode; i: number; sx: number; sy: number; orig: Slot } | null>(null)

  const listUrl = `/api/admin/designs?tenantSlug=${encodeURIComponent(tenantSlug)}`
  const detailUrl = (id: string) => `/api/admin/designs/${encodeURIComponent(id)}?tenantSlug=${encodeURIComponent(tenantSlug)}`

  const loadList = useCallback(async () => {
    if (!tenantSlug) return
    try {
      const data = await api<{ items: { id: string; name: string }[] }>(listUrl)
      if (Array.isArray(data.items)) setDesigns(data.items)
    } catch { /* ignore */ }
  }, [tenantSlug])

  useEffect(() => {
    loadList().then(() => {
      if (initialDesignId) loadDesign(initialDesignId)
    })
  }, [tenantSlug, initialDesignId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDesign(id: string) {
    if (!id) {
      setSelId(''); setName(''); setSlots([]); setFrameUrl(null); setFramePending(null); setZoneBoxes(null)
      return
    }
    setSelId(id)
    try {
      const d = await api<Design>(detailUrl(id))
      if (!d) return
      setName(d.name || '')
      const cw = d.canvas_w || CANVAS_W
      const maxCoord = Array.isArray(d.slots)
        ? Math.max(0, ...d.slots.flatMap((s) => [s.x + s.w, s.y + s.h]))
        : 0
      const k = cw !== OUT_W && maxCoord <= cw * 1.5 ? OUT_W / cw : 1
      setSlots(Array.isArray(d.slots) ? d.slots.map((s) => ({
        x: Math.round(s.x * k), y: Math.round(s.y * k),
        w: Math.round(s.w * k), h: Math.round(s.h * k), rot: s.rot || 0,
      })) : [])
      setFrameUrl(d.hasFrame && d.frameBuf ? `data:image/png;base64,${d.frameBuf}` : null)
      setFramePending(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal muat design')
    }
  }

  async function detectZones() {
    if (!frameUrl || scanning) return
    setScanning(true)
    try {
      const raw = await scanColorZones(frameUrl, zoneColor, zoneTol)
      const im = await loadImageEl(frameUrl)
      const kx = OUT_W / (im.naturalWidth || OUT_W)
      const ky = OUT_H / (im.naturalHeight || OUT_H)
      setZoneBoxes(raw.map((z) => ({
        x: Math.round(z.x * kx), y: Math.round(z.y * ky),
        w: Math.round(z.w * kx), h: Math.round(z.h * ky),
      })))
    } catch {
      setZoneBoxes([])
    } finally {
      setScanning(false)
    }
  }

  function applyZone(i: number) {
    if (!zoneBoxes) return
    const z = zoneBoxes[i]
    if (!z) return
    setSlots((prev) => [...prev, { ...z, rot: 0 }])
  }

  // Strip color zone from frame (make transparent) before upload
  async function stripFrameZones(file: File): Promise<File> {
    const url = URL.createObjectURL(file)
    try {
      const im = await loadImageEl(url)
      const W = im.naturalWidth, H = im.naturalHeight
      if (!W || !H) return file
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return file
      ctx.drawImage(im, 0, 0)
      const idata = ctx.getImageData(0, 0, W, H)
      const px = idata.data
      const t = hexToRgb(zoneColor)
      const tol2 = zoneTol * zoneTol * 3
      let hit = 0
      for (let i = 0; i < px.length; i += 4) {
        const dr = px[i] - t.r, dg = px[i + 1] - t.g, db = px[i + 2] - t.b
        if (dr * dr + dg * dg + db * db <= tol2) { px[i + 3] = 0; hit++ }
      }
      if (!hit) return file
      ctx.putImageData(idata, 0, 0)
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
      if (!blob) return file
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-transparent.png', { type: 'image/png' })
    } catch {
      return file
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  function onDown(e: React.PointerEvent, mode: DragMode, i: number) {
    e.preventDefault(); e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setActive(i)
    const s = slots[i]
    drag.current = { mode, i, sx: e.clientX, sy: e.clientY, orig: { ...s } }
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / SCALE
    const dy = (e.clientY - d.sy) / SCALE
    setSlots((prev) => {
      const next = prev.slice()
      const s = { ...next[d.i] }
      if (d.mode === 'move') {
        s.x = Math.max(0, Math.min(OUT_W - s.w, d.orig.x + dx))
        s.y = Math.max(0, Math.min(OUT_H - s.h, d.orig.y + dy))
      } else if (d.mode === 'resize') {
        s.w = Math.max(20, Math.min(OUT_W - s.x, d.orig.w + dx))
        s.h = Math.max(20, Math.min(OUT_H - s.y, d.orig.h + dy))
      }
      next[d.i] = s
      return next
    })
  }
  function onUp(e: React.PointerEvent) {
    if (drag.current) {
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    drag.current = null
  }
  function updateSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addSlot() { setSlots((prev) => [...prev, { x: 40, y: 40, w: 120, h: 160, rot: 0 }]) }
  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i))
    setActive((a) => (a === i ? null : a))
  }

  function onFrameFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFramePending(f)
    setFrameUrl(URL.createObjectURL(f))
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  async function save() {
    if (!tenantSlug) { setError('Tenant belum dipilih'); return }
    setBusy(true); setError(''); setSuccess('')
    try {
      const fd = new FormData()
      fd.append('name', name.trim() || `design-${Date.now()}`)
      fd.append('canvas_w', String(OUT_W))
      fd.append('canvas_h', String(OUT_H))
      fd.append('slots', JSON.stringify(slots))
      fd.append('tenantSlug', tenantSlug)
      let frameFile = framePending
      if (frameFile && stripZones) {
        frameFile = await stripFrameZones(frameFile)
        setFrameUrl(URL.createObjectURL(frameFile))
        setFramePending(frameFile)
      }
      if (frameFile) fd.append('image', frameFile)
      if (selId) {
        await api(detailUrl(selId), { method: 'PUT', body: fd })
        setSuccess('Design diperbarui')
      } else {
        const j = await api<{ id: string; name: string }>('/api/admin/designs', { method: 'POST', body: fd })
        setSelId(j.id); setSuccess(`Design "${j.name}" dibuat`)
      }
      await loadList()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal simpan')
    } finally {
      setBusy(false)
    }
  }

  if (!tenantSlug) {
    return <Alert severity="info">Pilih tenant dulu untuk membuat/mengedit design.</Alert>
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <TextField
          select size="small" label="Design" value={selId}
          onChange={(e) => loadDesign(e.target.value)} sx={{ minWidth: 200 }}
          SelectProps={{ native: true }}
        >
          <option value="">+ Design Baru</option>
          {designs.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
        </TextField>
        <Button size="small" variant="outlined" onClick={() => loadDesign('')}>Reset Baru</Button>
        <Chip size="small" label={`Tenant: ${tenantSlug}`} color="primary" variant="outlined" />
      </Stack>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {/* Preview canvas (kiri) */}
        <Box>
          <Box
            sx={{
              position: 'relative', border: '2px solid #000', bgcolor: 'white', overflow: 'hidden',
              touchAction: 'none', userSelect: 'none', mb: 1,
              width: DISP_W, height: DISP_W * (CANVAS_H / CANVAS_W),
            }}
          >
            <Box
              ref={canvasRef}
              onPointerMove={onMove} onPointerUp={onUp}
              sx={{ position: 'absolute', top: 0, left: 0, transformOrigin: 'top left',
                    width: OUT_W, height: OUT_H, transform: `scale(${SCALE})` }}
            >
              {frameUrl && <img src={frameUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }} />}
              {zoneBoxes?.map((z, i) => (
                <Box key={`z${i}`} sx={{
                  position: 'absolute', left: z.x, top: z.y, width: z.w, height: z.h,
                  border: '2px dashed #16a34a', bgcolor: 'rgba(74, 222, 128, 0.3)', pointerEvents: 'none',
                  display: 'flex', justifyContent: 'flex-end',
                }}>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); applyZone(i) }}
                    sx={{ width: 24, height: 24, bgcolor: '#16a34a', color: 'white', borderRadius: 0, m: 0.5, '&:hover': { bgcolor: '#15803d' } }}
                  >
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'white' }}>+{i + 1}</Typography>
                  </IconButton>
                </Box>
              ))}
              {slots.map((s, i) => (
                <Box key={i} onPointerDown={(e) => onDown(e, 'move', i)} sx={{
                  position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h,
                  transform: `rotate(${s.rot}deg)`,
                  border: active === i ? '2px solid #1976d2' : '2px solid #000',
                  bgcolor: 'rgba(0,0,0,0.2)', cursor: 'move',
                }}>
                  <Typography sx={{ position: 'absolute', top: 0, left: 0, bgcolor: '#000', color: '#fff', fontSize: 9, px: 0.5, lineHeight: 1.2 }}>{i + 1}</Typography>
                  <Box onPointerDown={(e) => onDown(e, 'resize', i)} sx={{
                    position: 'absolute', bottom: -4, right: -4, width: 16, height: 16,
                    bgcolor: '#1976d2', border: '2px solid #000', cursor: 'nwse-resize',
                  }} />
                </Box>
              ))}
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Drag slot untuk pindah, pojok kanan-bawah untuk resize
          </Typography>
        </Box>

        {/* Kontrol (kanan) */}
        <Box sx={{ flex: 1, minWidth: 300 }}>
          <TextField
            fullWidth size="small" label="Nama design" placeholder="cth: Klasik Cinta"
            value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 1.5 }}
          />
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addSlot}>+ Slot</Button>
            <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => frameInput.current?.click()}>Bingkai PNG</Button>
            <input ref={frameInput} type="file" accept="image/png,image/*" hidden onChange={onFrameFile} />
          </Stack>

          {/* Zone detection panel */}
          {frameUrl && (
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: '#fafafa' }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <ColorLensIcon fontSize="small" />
                <Typography variant="subtitle2">Deteksi Zona</Typography>
              </Stack>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption">Warna</Typography>
                  <input type="color" value={zoneColor} onChange={(e) => setZoneColor(e.target.value)}
                    style={{ width: 32, height: 32, border: '1px solid #000', cursor: 'pointer' }} />
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                  <Typography variant="caption">Toleransi</Typography>
                  <Slider size="small" min={10} max={120} step={5} value={zoneTol}
                    onChange={(_, v) => setZoneTol(v as number)} sx={{ width: 100 }} />
                  <Typography variant="caption">{zoneTol}</Typography>
                </Stack>
                <Tooltip title="Scan zona warna di bingkai">
                  <span>
                    <Button size="small" variant="contained" color="success" startIcon={<SearchIcon />}
                      onClick={detectZones} disabled={scanning}>
                      {scanning ? 'Memindai…' : 'Scan'}
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
              {zoneBoxes && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="caption">{zoneBoxes.length} zona ketemu — klik +N di preview</Typography>
                  <Button size="small" onClick={() => setZoneBoxes(null)}>×</Button>
                </Stack>
              )}
              <FormControlLabel
                control={<Switch size="small" checked={stripZones} onChange={(e) => setStripZones(e.target.checked)} />}
                label={<Typography variant="caption">Hapus zona dari bingkai saat simpan (jadi transparan)</Typography>}
              />
            </Paper>
          )}

          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Slot Foto ({slots.length})</Typography>
          <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
            {slots.map((s, i) => (
              <Paper key={i} variant="outlined" sx={{ p: 1, mb: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="caption" fontWeight={600}>Foto {i + 1}</Typography>
                  <IconButton size="small" color="error" onClick={() => removeSlot(i)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <TextField key={k} size="small" label={k.toUpperCase()} type="number" value={Math.round(s[k])}
                      onChange={(e) => updateSlot(i, { [k]: Number(e.target.value) } as any)}
                      sx={{ width: 70 }} />
                  ))}
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ width: 40 }}>Rotasi</Typography>
                  <Slider size="small" min={-45} max={45} step={1} value={s.rot}
                    onChange={(_, v) => updateSlot(i, { rot: v as number })} sx={{ flex: 1 }} />
                  <TextField size="small" type="number" value={s.rot} sx={{ width: 60 }}
                    onChange={(e) => updateSlot(i, { rot: Number(e.target.value) })} />
                  <Typography variant="caption">°</Typography>
                </Stack>
              </Paper>
            ))}
            {slots.length === 0 && <Typography variant="caption" color="text.secondary">Belum ada slot. Klik "+ Slot" atau "Scan" zona.</Typography>}
          </Box>

          <Button fullWidth variant="contained" size="large" onClick={save} disabled={busy} sx={{ mt: 2 }}>
            {busy ? 'Menyimpan…' : selId ? 'Update Design' : 'Simpan Design'}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
