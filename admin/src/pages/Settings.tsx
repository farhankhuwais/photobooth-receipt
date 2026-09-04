import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Alert, MenuItem, TextField, Button, Snackbar,
  CircularProgress, Grid, FormControl, InputLabel, Select, Slider, FormControlLabel, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogActions,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'

// Limit ukuran file (sebelum base64, base64 = ~1.37x byte)
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB
const MAX_ATTRACT_BG_BYTES = 4 * 1024 * 1024 // 4 MB input limit, akan dikompres ke ≤300KB
const MAX_ATTRACT_BG_OUTPUT_BYTES = 320 * 1024 // 320 KB (after compression)

// Compress image (resize + JPEG quality) agar dataURL tidak membebani /api/config.
async function compressImage(
  file: File,
  maxBytes: number,
  maxDim = 1920,
  quality = 0.78,
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * ratio)
  const h = Math.round(bitmap.height * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // Flatten alpha ke putih (transparan → putih agar tidak hitam saat JPEG).
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality),
  )
  if (blob.size <= maxBytes) {
    return await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.readAsDataURL(blob)
    })
  }
  // Turunkan quality jika masih > maxBytes.
  for (const q of [0.6, 0.45, 0.3]) {
    const b2: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', q),
    )
    if (b2.size <= maxBytes) {
      return await new Promise<string>((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.readAsDataURL(b2)
      })
    }
  }
  // Fallback: kembalikan blob terkecil yang ada.
  return await new Promise<string>((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.readAsDataURL(blob)
  })
}

// ── Struk preview render (canvas) ────────────────────────────
// Render mini struk pakai algoritma yang sama dengan TemplateEngine, diskala
// 1:3 agar muat di admin panel. Pakai foto placeholder abu-abu (bukan foto
// sungguhan) — tujuan preview bukan WYSIWYG hasil jepretan, tapi cek layout
// & konflik elemen (logo + event name + header text bentrik?).
const STRUK_PREVIEW_WIDTH = 192 // 1/3 dari 576 (PRINT_WIDTH)
const STRUK_PREVIEW_SCALE = STRUK_PREVIEW_WIDTH / 576

function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function makePlaceholderImg(w: number, h: number, label: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // Gradient vertikal (placeholder foto, tidak mempengaruhi branding)
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#cfd8dc')
  grad.addColorStop(1, '#90a4ae')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  // Bingkai tipis biar slot keliatan jelas
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  ctx.fillStyle = '#37474f'
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.16)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, w / 2, h / 2)
  return c
}

// ────────────────────────────────────────────────────────────────────
// Preview render — MIRROR PERSIS algoritma TemplateEngine.composeStrip()
// di src/modules/templates/TemplateEngine.ts. Preview diskala 1:3 dari
// PRINT_WIDTH=576 ke STRUK_PREVIEW_WIDTH=192. Foto asli diganti placeholder
// (atau sampleDataUrl jika ada). Frame (drawFrame) tidak di-preview karena
// customer pilih frame di booth, bukan dari branding setting.
//
// Kalau TemplateEngine diubah, fungsi ini HARUS ikut di-update. Lihat
// composeStrip di line ~220 TemplateEngine.ts untuk reference.
// ────────────────────────────────────────────────────────────────────
async function renderStrukPreview(
  canvas: HTMLCanvasElement,
  b: Branding,
  template: 'single' | 'dual' | 'strip3' | 'grid2x2',
  onRendered?: (h: number) => void
) {
  const ctx = canvas.getContext('2d')!
  const W = STRUK_PREVIEW_WIDTH // 192 (setara PRINT_WIDTH=576 di scale 1:3)
  const s = STRUK_PREVIEW_SCALE // 1/3

  // ── Match TemplateEngine.composeStrip (line 220–367) ─────────────
  // Header H: kalau ada eventName (below-logo) + logo → butuh space ekstra +42px
  // supaya event name tidak menumpuk dengan logo. Rumus SAMA dengan TemplateEngine.
  const hasBelowLogoEventName = !!(b.eventName && b.showEventNameOnPrint)
  const baseH = b.logoDataUrl ? 266 : 64
  const headerH = baseH + (b.logoDataUrl && hasBelowLogoEventName ? 42 : 0)
  let footerH = 12
  if (b.showDate) footerH += 34
  if (b.watermark) footerH += 44
  footerH += 10
  if (footerH < (b.watermark ? 56 : 48)) footerH = b.watermark ? 56 : 48

  // Padding
  const topPad = (b.photoTopPad ?? 24)
  const bottomPad = (b.photoBottomPad ?? 24)
  const gapX = template === 'grid2x2' ? (b.photoGap2x2X ?? 20) : (b.photoGap ?? 20)
  const gapY = template === 'grid2x2' ? (b.photoGap2x2Y ?? 20) : (b.photoGap ?? 20)
  const sidePad = 20

  // Scale semua dimensi ke preview (1/3)
  const _h = (px: number) => px * s
  const sSP = _h(sidePad)
  const sGX = _h(gapX)
  const sInnerW = W - sSP * 2
  let shotW = sInnerW
  let shotH = Math.round(shotW * 0.75)
  let cols = 1
  let rows: number
  if (template === 'grid2x2') {
    cols = 2
    shotW = (sInnerW - sGX) / 2
    shotH = Math.round(shotW * 0.75)
    rows = 2
  } else if (template === 'dual') {
    rows = 2
  } else if (template === 'single') {
    rows = 1
  } else {
    // strip3
    rows = 3
  }
  const contentH = rows * shotH + (rows - 1) * _h(gapY)
  const sH = _h(headerH)
  const sTP = _h(topPad)
  const sBP = _h(bottomPad)
  const sGY = _h(gapY)
  const sSW = _h(shotW)
  const sSH = _h(shotH)
  const sFH = _h(footerH)
  const sContentH = _h(contentH)

  const totalH = Math.round(sH + sTP + sContentH + sBP + sFH)
  canvas.width = W
  canvas.height = totalH
  onRendered?.(totalH)

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, totalH)

  // Header
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const logo = b.logoDataUrl ? await loadImageSafe(b.logoDataUrl) : null
  if (logo) {
    // Kotak logo max 250px di resolusi asli → diskala
    const pad = _h(4)
    const box = Math.min(sH - pad * 2, _h(250))
    const lx = (W - box) / 2
    const ly = (sH - box) / 2
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(lx, ly, box, box)
    // contain
    const ar = logo.width / logo.height
    let dw = box
    let dh = box
    if (ar > 1) dh = box / ar
    else dw = box * ar
    ctx.drawImage(logo, lx + (box - dw) / 2, ly + (box - dh) / 2, dw, dh)
    // Event name di bawah logo (hanya jika posisi = 'below-logo' atau tidak diset)
    if (b.eventName && b.showEventNameOnPrint && b.eventNamePosition !== 'footer') {
      ctx.fillStyle = '#000000'
      const fontSize = _h(24)
      ctx.font = `bold ${fontSize}px sans-serif`
      ctx.textBaseline = 'alphabetic'
      // Y = logoBottom + gap (visual, default 14) + fontSize
      // supaya text tidak menumpuk dengan logo. Setting `eventNameGapBelowLogo`
      // admin-controlled. Konsisten dengan TemplateEngine.composeStrip.
      const gap = (b.eventNameGapBelowLogo ?? 14) * s
      const eventY = ly + dh + gap + fontSize
      ctx.fillText(b.eventName, W / 2, eventY)
    }
  } else {
    // TANPA LOGO: TemplateEngine hanya render eventName (headerText diabaikan!)
    // Sesuai TemplateEngine line 308-309. Kalau mau render headerText juga, edit
    // TemplateEngine dulu, lalu update sini.
    if (b.eventName && b.showEventNameOnPrint) {
      ctx.font = `bold ${_h(30)}px sans-serif`
      ctx.fillText(b.eventName, W / 2, sH / 2)
    }
  }

  // Body — placeholder foto
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = sSP + c * (sSW + sGX)
      const y = sH + sTP + r * (sSH + sGY)
      const ph = makePlaceholderImg(Math.max(1, Math.round(sSW)), Math.max(1, Math.round(sSH)), `${i + 1}`)
      ctx.drawImage(ph, x, y, sSW, sSH)
      i++
    }
  }

  // Footer
  const fy = sH + sTP + sContentH + sBP
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000000'
  let cursorY = fy + _h(10)
  // QR tidak lagi dicetak di struk — preview hanya render tanggal + watermark.
  if (b.showDate) {
    ctx.font = `${_h(18)}px sans-serif`
    ctx.fillText(new Date().toLocaleString('id-ID'), W / 2, cursorY + _h(18))
    cursorY += _h(34)
  }
  if (b.watermark) {
    ctx.font = `${_h(15)}px sans-serif`
    ctx.fillStyle = '#000000'
    // Selalu di jalur terbawah (44px → _h(44) di preview)
    ctx.fillText(b.watermark, W / 2, totalH - _h(22))
  }

  // Event name di posisi footer (jika eventNamePosition='footer')
  if (b.eventName && b.showEventNameOnPrint && b.eventNamePosition === 'footer') {
    // Taruh di atas watermark
    const evtY = totalH - _h(b.watermark ? 64 : 20)
    ctx.font = `bold ${_h(18)}px sans-serif`
    ctx.fillStyle = '#000000'
    ctx.fillText(b.eventName, W / 2, evtY)
  }
  // footerText TIDAK di-render di TemplateEngine.composeStrip (cuma di preview lawas)
  // Jadi skip di sini juga.
}

function validateFile(file: File, maxBytes: number, label: string): string | null {
  if (file.size > maxBytes) {
    const mb = (file.size / 1024 / 1024).toFixed(2)
    const max = (maxBytes / 1024 / 1024).toFixed(0)
    return `${label} terlalu besar: ${mb} MB. Maksimal ${max} MB. Kompres file atau gunakan format yang lebih kecil.`
  }
  return null
}

interface Branding {
  // Logo & text
  logoDataUrl?: string
  headerText?: string
  footerText?: string
  eventName?: string
  // Visual
  primaryColor?: string
  watermark?: string
  // Print / receipt
  paperWidth?: string
  printDarkness?: number
  // Layout
  showDate?: boolean
  showEventNameOnPrint?: boolean
  eventNamePosition?: 'below-logo' | 'footer' // 'below-logo' (default) atau 'footer' (hindari bentrokan dkk)
  eventNameGapBelowLogo?: number // Jarak event name ke logo (px). Default 6, range 0-40
  showCapturingBox?: boolean
  // QR struk dihapus — QR tidak lagi dicetak, hanya tombol QR di app.
  photoTopPad?: number
  photoBottomPad?: number
  photoGap?: number
  photoGap2x2X?: number
  photoGap2x2Y?: number
  // Attract screen (Layar Awal)
  attractMedia?: string | null
  attractIcon?: string | null
}

interface AppConfig {
  mode: 'regular' | 'event'
  price: number
  preset_name: string | null
  branding: Branding
}

const PAPER_WIDTHS = ['58mm', '80mm']

export default function Settings() {
  const { user } = useAuth()
  const isSuper = user?.role === 'super_admin'

  const [tenantList, setTenantList] = useState<{ slug: string; name: string }[]>([])
  const [tenantSlug, setTenantSlug] = useState('')
  const [form, setForm] = useState<AppConfig>({
    mode: 'regular', price: 5000, preset_name: null, branding: {},
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [snack, setSnack] = useState('')
  const [presetList, setPresetList] = useState<{ name: string; mode: 'regular' | 'event'; price: number }[]>([])
  const loadPresetList = useCallback(async () => {
    if (!tenantSlug) return
    try {
      const rows = await api<{ name: string; mode: 'regular' | 'event'; price: number }[]>(`/api/admin/presets?tenantSlug=${tenantSlug}`)
      setPresetList(rows)
    } catch { /* ignore */ }
  }, [tenantSlug])
  useEffect(() => { if (tenantSlug) loadPresetList() }, [loadPresetList])
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [logoModalOpen, setLogoModalOpen] = useState(false)
  const [presetSaving, setPresetSaving] = useState(false)
  const [presetEditing, setPresetEditing] = useState<{ name: string; mode: 'regular' | 'event'; price: number } | null>(null)
  const [presetDraft, setPresetDraft] = useState({ name: '', mode: 'regular' as 'regular' | 'event', price: 5000 })
  const [applyPresetName, setApplyPresetName] = useState<string | null>(null)
  const [updatingPreset, setUpdatingPreset] = useState(false)
  const [updatePresetName, setUpdatePresetName] = useState<string | null>(null)
  const [attractBusy, setAttractBusy] = useState(false)
  const [attractBusyIcon, setAttractBusyIcon] = useState(false)
  // Layout struk preview mode (strip vertikal atau grid 2x2). Default 'strip'
  // karena lebih umum dipakai; user bisa switch untuk lihat efek jarak X/Y.
  // Template mode: 'single' | 'dual' | 'strip3' | 'grid2x2' — SAMA dengan TemplateEngine
  // supaya preview identik dengan hasil cetak. Default 'strip3' (3 foto) karena
  // paling sering dipakai di booth.
  const [templateMode, setTemplateMode] = useState<'single' | 'dual' | 'strip3' | 'grid2x2'>('strip3')
  // Canvas ref untuk render preview struk
  const strukCanvasRef = useRef<HTMLCanvasElement>(null)

  // Auto-set initial tenant
  useEffect(() => {
    if (isSuper) {
      api<{ items: { slug: string; name: string }[] }>('/api/admin/tenants?pageSize=500')
        .then((d) => {
          const list = d.items.map((t) => ({ slug: t.slug, name: t.name }))
          setTenantList(list)
          if (list.length > 0) setTenantSlug(list[0].slug)
          else setLoading(false)
        })
        .catch(() => {
          setError('Gagal memuat daftar tenant')
          setLoading(false)
        })
    } else {
      if (user?.tenant_id) setTenantSlug(user.tenant_id)
      else { setError('Akun belum terikat ke tenant'); setLoading(false) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!tenantSlug) return
    setLoading(true)
    setError('')
    try {
      const c = await api<AppConfig>(`/api/admin/config?tenantSlug=${tenantSlug}`)
      setForm(c || { mode: 'regular', price: 5000, preset_name: null, branding: {} })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat config')
      setForm({ mode: 'regular', price: 5000, preset_name: null, branding: {} })
    } finally {
      setLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => { if (tenantSlug) load() }, [load])

  // Re-render struk preview setiap branding atau template berubah
  useEffect(() => {
    const canvas = strukCanvasRef.current
    if (!canvas) return
    renderStrukPreview(canvas, form.branding, templateMode).catch((e) => {
      console.warn('Struk preview render error:', e)
    })
  }, [form.branding, templateMode])

  const setBranding = (patch: Partial<Branding>) =>
    setForm((f) => ({ ...f, branding: { ...f.branding, ...patch } }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await api('/api/admin/config', {
        method: 'PUT',
        body: { tenantSlug, mode: form.mode, price: form.price, preset_name: form.preset_name, branding: form.branding },
      })
      setSnack('Settings tersimpan')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal simpan')
    } finally {
      setSaving(false)
    }
  }

  const confirmUpdatePresetAndSave = async () => {
    const presetName = form.preset_name
    if (presetName) {
      setUpdatePresetName(presetName)
    } else {
      await handleSave()
    }
  }

  const applyPresetAsConfig = async (name: string) => {
    setSaving(true)
    try {
      const p = await api<{ name: string; mode: 'regular' | 'event'; price: number; branding: Record<string, unknown> }>(`/api/admin/presets/${encodeURIComponent(name)}?tenantSlug=${tenantSlug}`)
      const branding = { ...(p.branding || {}) }
      await api('/api/admin/config', {
        method: 'PUT',
        body: { tenantSlug, mode: p.mode, price: p.price, preset_name: p.name, branding },
      })
      setForm({ mode: p.mode, price: p.price, preset_name: p.name, branding })
      setSnack('Preset diterapkan sebagai config aktif')
      loadPresetList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal terapkan preset')
    } finally {
      setSaving(false)
      setApplyPresetName(null)
    }
  }

  const updatePreset = async (name: string) => {
    setUpdatingPreset(true)
    try {
      const branding = { ...(form.branding || {}) }
      await api(`/api/admin/presets/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { tenantSlug, name, mode: form.mode, price: form.price, branding },
      })
      await api('/api/admin/config', {
        method: 'PUT',
        body: { tenantSlug, mode: form.mode, price: form.price, preset_name: form.preset_name, branding: form.branding },
      })
      setSnack('Preset diperbarui')
      loadPresetList()
      load()
      setUpdatePresetName(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal update preset')
    } finally {
      setUpdatingPreset(false)
    }
  }

  const savePreset = async (draft: { name: string; mode: 'regular' | 'event'; price: number }) => {
    setPresetSaving(true)
    try {
      const branding = { ...(form.branding || {}) }
      await api(`/api/admin/presets/${encodeURIComponent(draft.name.trim())}`, {
        method: 'PUT',
        body: { tenantSlug, name: draft.name.trim(), mode: draft.mode, price: draft.price, branding },
      })
      setPresetDialogOpen(false)
      setPresetEditing(null)
      setPresetDraft({ name: '', mode: 'regular', price: 5000 })
      setSnack('Preset tersimpan')
      loadPresetList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal simpan preset')
    } finally {
      setPresetSaving(false)
    }
  }

  const openSavePresetFromCurrent = () => {
    setPresetEditing(null)
    setPresetDraft({ name: '', mode: form.mode, price: form.price })
    setPresetDialogOpen(true)
  }

  // ── Layar Awal (attract) handlers ─────────────────────
  // Image dikompres dulu (resize + JPEG quality) agar dataURL inline tidak
  // membebani /api/config. State "busy" menampilkan indikator upload.
  const handleAttractMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_ATTRACT_BG_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(2)
      setError(`File terlalu besar: ${mb} MB. Maksimal ${(MAX_ATTRACT_BG_BYTES / 1024 / 1024).toFixed(0)} MB sebelum kompres.`)
      return
    }
    setAttractBusy(true)
    try {
      const dataUrl = await compressImage(file, MAX_ATTRACT_BG_OUTPUT_BYTES)
      setBranding({ attractMedia: dataUrl })
      setSnack(`Background Layar Awal terupload (${Math.round(dataUrl.length / 1024)} KB)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses gambar')
    } finally {
      setAttractBusy(false)
    }
  }

  const handleAttractIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 512 * 1024) {
      setError('Ikon terlalu besar: maksimal 512 KB sebelum kompres.')
      return
    }
    setAttractBusyIcon(true)
    try {
      // Icon biasanya kecil & bisa PNG (transparan). Compress tapi izinkan PNG
      // kalau inputnya PNG dengan alpha.
      let dataUrl: string
      if (file.type === 'image/png') {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = () => reject(new Error('Gagal membaca file'))
          r.readAsDataURL(file)
        })
        if (dataUrl.length > 200 * 1024) {
          // PNG transparan > 200KB: turunkan dimensi dan re-encode.
          const compressed = await compressImage(file, 200 * 1024, 512, 0.9)
          dataUrl = compressed
        }
      } else {
        dataUrl = await compressImage(file, 200 * 1024, 512, 0.9)
      }
      setBranding({ attractIcon: dataUrl })
      setSnack(`Ikon Layar Awal terupload (${Math.round(dataUrl.length / 1024)} KB)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses ikon')
    } finally {
      setAttractBusyIcon(false)
    }
  }

  const b = form.branding

  const presetDialog = (
    <Dialog open={presetDialogOpen} onClose={() => setPresetDialogOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>{presetEditing ? 'Edit Preset' : 'Tambah Preset'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Nama Preset"
            value={presetDraft.name}
            onChange={(e) => setPresetDraft({ ...presetDraft, name: e.target.value })}
            size="small"
            fullWidth
          />
          <TextField
            select fullWidth label="Mode" value={presetDraft.mode} size="small"
            onChange={(e) => setPresetDraft({ ...presetDraft, mode: e.target.value as 'regular' | 'event' })}
          >
            <MenuItem value="regular">Regular</MenuItem>
            <MenuItem value="event">Event (gratis)</MenuItem>
          </TextField>
          <TextField
            fullWidth type="number" label="Harga (Rp)" value={presetDraft.price} size="small"
            onChange={(e) => setPresetDraft({ ...presetDraft, price: Number(e.target.value) })}
            inputProps={{ min: 0, step: 500 }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPresetDialogOpen(false)} disabled={presetSaving}>Batal</Button>
        <Button onClick={() => savePreset(presetDraft)} variant="contained" disabled={presetSaving}>
          {presetSaving ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </DialogActions>
    </Dialog>
  )

  const applyConfirmDialog = applyPresetName ? (
    <Dialog open={!!applyPresetName} onClose={() => setApplyPresetName(null)} maxWidth="xs" fullWidth>
      <DialogTitle>Terapkan Preset</DialogTitle>
      <DialogContent>
        <Typography>Yakin ganti semua setting ke preset <strong>{applyPresetName}</strong>?</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setApplyPresetName(null)} disabled={saving}>Batal</Button>
        <Button onClick={() => applyPresetAsConfig(applyPresetName)} variant="contained" disabled={saving}>
          {saving ? 'Menerapkan...' : 'Ya, terapkan'}
        </Button>
      </DialogActions>
    </Dialog>
  ) : null

  const updatePresetConfirm = updatePresetName ? (
    <Dialog open={!!updatePresetName} onClose={() => setUpdatePresetName(null)} maxWidth="xs" fullWidth>
      <DialogTitle>Update Preset</DialogTitle>
      <DialogContent>
        <Typography>Yakin ingin menimpa setting preset <strong>{updatePresetName}</strong> dengan setting form saat ini?</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setUpdatePresetName(null)} disabled={updatingPreset}>Batal</Button>
        <Button onClick={() => updatePreset(updatePresetName)} variant="contained" disabled={updatingPreset}>
          {updatingPreset ? 'Menyimpan...' : 'Ya, update preset'}
        </Button>
      </DialogActions>
    </Dialog>
  ) : null

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>Tenant Settings</Typography>

      {error && !loading && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
      )}

      {isSuper && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <TextField
            select fullWidth label="Tenant" value={tenantSlug} size="small"
            onChange={(e) => setTenantSlug(e.target.value)}
          >
            {tenantList.map((t) => (
              <MenuItem key={t.slug} value={t.slug}>{t.name} ({t.slug})</MenuItem>
            ))}
          </TextField>
        </Paper>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : (
        <Grid container spacing={2}>
          {/* ── Kiri: Mode & Print ─────────────────────────────── */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>Mode &amp; Harga</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    select fullWidth label="Mode" value={form.mode} size="small"
                    onChange={(e) => setForm({ ...form, mode: e.target.value as 'regular' | 'event' })}
                  >
                    <MenuItem value="regular">Regular</MenuItem>
                    <MenuItem value="event">Event (gratis)</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth type="number" label="Harga (Rp)" value={form.price} size="small"
                    onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                    disabled={form.mode === 'event'}
                    inputProps={{ min: 0, step: 500 }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Preset Default</InputLabel>
                      <Select
                        label="Preset Default"
                        value={form.preset_name || ''}
                        onChange={(e) => {
                          const v = e.target.value || null
                          if (v && v !== form.preset_name) setApplyPresetName(v)
                          else setForm({ ...form, preset_name: v })
                        }}
                      >
                        <MenuItem value="">— Tanpa preset —</MenuItem>
                        {presetList.map((p) => (
                          <MenuItem key={p.name} value={p.name}>{p.name} ({p.mode})</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Button variant="contained" onClick={() => { setPresetEditing(null); setPresetDraft({ name: '', mode: form.mode, price: form.price }); setPresetDialogOpen(true) }}>Add</Button>
                    </Box>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Pilih preset aktif untuk app, atau buat preset baru dengan tombol Add.
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            <Paper sx={{ p: 3, mt: 2 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>Cetak / Struk</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Lebar Kertas</InputLabel>
                    <Select
                      label="Lebar Kertas" value={b.paperWidth || '58mm'}
                      onChange={(e) => setBranding({ paperWidth: e.target.value })}
                    >
                      {PAPER_WIDTHS.map((w) => (
                        <MenuItem key={w} value={w}>{w}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth type="number" label="Kegelapan Cetak (%)" value={b.printDarkness ?? 100}
                    onChange={(e) => setBranding({ printDarkness: Number(e.target.value) })}
                    size="small"
                    inputProps={{ min: 30, max: 200, step: 5 }}
                    helperText="30–200 (default 100)"
                  />
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" gutterBottom>
                    Kegelapan: {b.printDarkness ?? 100}%
                    <Slider
                      value={b.printDarkness ?? 100}
                      onChange={(_, v) => setBranding({ printDarkness: v as number })}
                      min={30} max={200} step={5}
                      size="small"
                    />
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3, mt: 2 }}>
              {/* ── Branding fields ──────────────────────────────── */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <Box
                  sx={{
                    width: 34, height: 34, borderRadius: 1.5,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: 'rgba(25,118,210,0.08)', color: 'primary.main',
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>🎨</span>
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={600} lineHeight={1.2}>
                    Branding &amp; Layout Struk
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Logo, teks, warna, layout struk &amp; template dalam satu tempat
                  </Typography>
                </Box>
              </Box>

              {/* ── Visual Preview ──────────────────────────── */}
              <Box sx={{ mt: 2, p: 2, bgcolor: '#f7f7f7', borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="body2" fontWeight={500}>
                    Template
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={templateMode}
                    onChange={(_, v) => v && setTemplateMode(v)}
                    sx={{ ml: 1 }}
                  >
                    <ToggleButton value="single" sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: 12 }}>
                      1 Foto
                    </ToggleButton>
                    <ToggleButton value="dual" sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: 12 }}>
                      2 Foto
                    </ToggleButton>
                    <ToggleButton value="strip3" sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: 12 }}>
                      Strip 3
                    </ToggleButton>
                    <ToggleButton value="grid2x2" sx={{ textTransform: 'none', px: 1.5, py: 0.25, fontSize: 12 }}>
                      Grid 2×2
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'center', overflow: 'auto' }}>
                  <Box
                    sx={{
                      border: '1px solid #d0d0d0',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                      bgcolor: '#fafafa',
                      p: 1.5,
                      borderRadius: 1,
                    }}
                  >
                    <canvas
                      ref={strukCanvasRef}
                      data-testid="struk-preview"
                      style={{
                        display: 'block',
                        width: STRUK_PREVIEW_WIDTH,
                        maxWidth: '100%',
                        height: 'auto',
                        imageRendering: 'auto',
                      }}
                    />
                  </Box>
                </Box>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', mt: 1.5 }}>
                  Preview diskala 1:4 (lebar cetak 58mm = 576px). Nilai {`{...}`} px berlaku pada struk asli.
                </Typography>
              </Box>

              {/* Separator: Branding & Layout Settings (logo, text, jarak) */}
              <Box sx={{ mt: 3, mb: 1, borderTop: '1px solid #e0e0e0', pt: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                  Branding &amp; Pengaturan
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Logo, teks brand, warna, dan jarak antar foto
                </Typography>
              </Box>

              {/* ── Branding fields (logo, text, colors) ──────────── */}
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12}>
                  {/* Logo upload + thumbnail (klik untuk full screen) */}
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button variant="outlined" component="label" size="small" startIcon={<span>📷</span>}>
                      Upload Logo
                      <input type="file" accept="image/*" hidden onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const err = validateFile(file, MAX_LOGO_BYTES, 'Logo')
                        if (err) { setError(err); e.target.value = ''; return }
                        const reader = new FileReader()
                        reader.onload = () => setBranding({ logoDataUrl: reader.result as string })
                        reader.readAsDataURL(file)
                      }} />
                    </Button>
                    {b.logoDataUrl && (
                      <Box
                        onClick={() => setLogoModalOpen(true)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setLogoModalOpen(true) }}
                        sx={{
                          width: 80, height: 80, cursor: 'pointer',
                          border: '1px solid #d0d0d0', borderRadius: 1,
                          overflow: 'hidden', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor: '#fafafa',
                          transition: 'border-color 0.15s, transform 0.15s',
                          '&:hover': { borderColor: 'primary.main', transform: 'scale(1.04)' },
                          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                        }}
                        title="Klik untuk lihat full screen"
                      >
                        <img
                          src={b.logoDataUrl}
                          alt="Logo"
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        />
                      </Box>
                    )}
                    {b.logoDataUrl && (
                      <Button color="error" size="small" onClick={() => setBranding({ logoDataUrl: '' })}>
                        Hapus Logo
                      </Button>
                    )}
                    {b.logoDataUrl && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                        Klik thumbnail untuk lihat full screen
                      </Typography>
                    )}
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Nama Event" value={b.eventName || ''} size="small"
                    onChange={(e) => setBranding({ eventName: e.target.value })}
                    helperText="Ditampilkan di header/footer struk"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Warna Utama (primary)" value={b.primaryColor || ''} size="small"
                    onChange={(e) => setBranding({ primaryColor: e.target.value })}
                    placeholder="#1976d2"
                    InputProps={{
                      startAdornment: b.primaryColor ? (
                        <Box sx={{ width: 20, height: 20, borderRadius: 0.5, mr: 1, bgcolor: b.primaryColor, border: '1px solid #ccc', flexShrink: 0 }} />
                      ) : null,
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Header Teks (merek)" value={b.headerText || ''} size="small"
                    onChange={(e) => setBranding({ headerText: e.target.value })}
                    placeholder="ACARA"
                    helperText="Tampil di header struk saat tidak ada logo"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Footer Teks" value={b.footerText || ''} size="small"
                    onChange={(e) => setBranding({ footerText: e.target.value })}
                    placeholder="Terima kasih!"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Watermark" value={b.watermark || ''} size="small"
                    onChange={(e) => setBranding({ watermark: e.target.value })}
                    placeholder="Powered by @Achipix.id!"
                  />
                </Grid>
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!b.showDate}
                          onChange={(e) => setBranding({ showDate: e.target.checked })}
                          size="small"
                        />
                      }
                      label="Tampilkan tanggal di hasil"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!b.showEventNameOnPrint}
                          onChange={(e) => setBranding({ showEventNameOnPrint: e.target.checked })}
                          size="small"
                        />
                      }
                      label="Tampilkan nama event di hasil"
                    />
                    <FormControl
                      fullWidth
                      size="small"
                      disabled={!b.showEventNameOnPrint}
                      sx={{ mt: 0.5 }}
                    >
                      <InputLabel id="event-name-position-label">Posisi Nama Event</InputLabel>
                      <Select
                        labelId="event-name-position-label"
                        label="Posisi Nama Event"
                        value={b.eventNamePosition || 'below-logo'}
                        onChange={(e) => setBranding({ eventNamePosition: e.target.value as 'below-logo' | 'footer' })}
                      >
                        <MenuItem value="below-logo">Di bawah logo</MenuItem>
                        <MenuItem value="footer">Di footer (bawah foto)</MenuItem>
                      </Select>
                    </FormControl>
                    {/* Jarak event name ke logo (hanya aktif saat posisi = below-logo) */}
                    <Box sx={{ mt: 0.5 }}>
                      <TextField
                        fullWidth
                        type="number"
                        size="small"
                        label="Jarak Nama Event ke Logo (px)"
                        value={b.eventNameGapBelowLogo ?? 14}
                        onChange={(e) => setBranding({ eventNameGapBelowLogo: Number(e.target.value) })}
                        inputProps={{ min: 0, max: 80, step: 2 }}
                        helperText={`Preview: ${b.eventNameGapBelowLogo ?? 14}px jarak visual antara logo & nama event`}
                        disabled={!b.showEventNameOnPrint || b.eventNamePosition === 'footer'}
                        sx={(!b.showEventNameOnPrint || b.eventNamePosition === 'footer') ? { '& .MuiInputBase-input': { color: 'text.disabled' } } : {}}
                      />
                    </Box>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!b.showCapturingBox}
                          onChange={(e) => setBranding({ showCapturingBox: e.target.checked })}
                          size="small"
                        />
                      }
                      label="Tampilkan kotak capturing (lingkaran capture area)"
                    />
                  </Box>
                </Grid>
              </Grid>


              {/* ── Form input ──────────────────────────────── */}
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth type="number" label="Jarak Atas (px)" value={b.photoTopPad ?? 24} size="small"
                    onChange={(e) => setBranding({ photoTopPad: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 400, step: 4 }}
                    helperText={`Preview: ${b.photoTopPad ?? 24}px di atas foto`}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth type="number" label="Jarak Bawah (px)" value={b.photoBottomPad ?? 24} size="small"
                    onChange={(e) => setBranding({ photoBottomPad: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 400, step: 4 }}
                    helperText={`Preview: ${b.photoBottomPad ?? 24}px di bawah foto`}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth type="number" label="Jarak Antar Foto (px)" value={b.photoGap ?? 20} size="small"
                    onChange={(e) => setBranding({ photoGap: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 200, step: 2 }}
                    helperText={`Preview: ${b.photoGap ?? 20}px (khusus Strip & 2 Foto)`}
                    disabled={templateMode === 'grid2x2' || templateMode === 'single'}
                    sx={(templateMode === 'grid2x2' || templateMode === 'single') ? { '& .MuiInputBase-input': { color: 'text.disabled' } } : {}}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth type="number" label="Jarak 2×2 X (px)" value={b.photoGap2x2X ?? 20} size="small"
                    onChange={(e) => setBranding({ photoGap2x2X: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 200, step: 2 }}
                    helperText={`Preview: ${b.photoGap2x2X ?? 20}px horizontal (khusus Grid 2×2)`}
                    disabled={templateMode !== 'grid2x2'}
                    sx={templateMode !== 'grid2x2' ? { '& .MuiInputBase-input': { color: 'text.disabled' } } : {}}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth type="number" label="Jarak 2×2 Y (px)" value={b.photoGap2x2Y ?? 20} size="small"
                    onChange={(e) => setBranding({ photoGap2x2Y: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 200, step: 2 }}
                    helperText={`Preview: ${b.photoGap2x2Y ?? 20}px vertikal (khusus Grid 2×2)`}
                    disabled={templateMode !== 'grid2x2'}
                    sx={templateMode !== 'grid2x2' ? { '& .MuiInputBase-input': { color: 'text.disabled' } } : {}}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!b.showCapturingBox}
                          onChange={(e) => setBranding({ showCapturingBox: e.target.checked })}
                          size="small"
                        />
                      }
                      label="Tampilkan kotak capturing (lingkaran capture area)"
                    />
                  </Box>
                </Grid>
              </Grid>
            </Paper>
          </Grid>


          <Grid item xs={12} md={6}>
            {/* ── Layar Awal (Attract) ─────────────────────────── */}
            <Paper sx={{ p: 3, mt: 2, border: '1px solid #e3e3e3' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                <Box
                  sx={{
                    width: 34, height: 34, borderRadius: 1.5,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: 'rgba(25,118,210,0.08)', color: 'primary.main',
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>🖼️</span>
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={600} lineHeight={1.2}>
                    Layar Awal (Attract)
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Background &amp; ikon layar &quot;Sentuh untuk mulai&quot;
                  </Typography>
                </Box>
              </Box>

              <Grid container spacing={3} sx={{ mt: 0.5 }}>
                {/* ── Background ─────────────────────────────── */}
                <Grid item xs={12} md={6}>
                  <Box
                    sx={{
                      border: '1px solid #ececec',
                      borderRadius: 2,
                      overflow: 'hidden',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      bgcolor: '#fafafa',
                    }}
                  >
                    {/* Preview area */}
                    <Box
                      sx={{
                        flex: 1,
                        minHeight: 220,
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: b.attractMedia ? '#f8f8f8' : '#f4f4f4',
                        borderBottom: '1px solid #ececec',
                        overflow: 'hidden',
                      }}
                    >
                      {b.attractMedia ? (
                        <img
                          src={b.attractMedia}
                          alt="Background preview"
                          style={{
                            width: '100%',
                            height: 220,
                            objectFit: 'contain',
                            background:
                              'repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 0 0/16px 16px',
                          }}
                        />
                      ) : (
                        <Box sx={{ textAlign: 'center', color: '#bdbdbd', p: 3 }}>
                          <Box sx={{ fontSize: 44, mb: 1 }}>🖼️</Box>
                          <Typography variant="body2">Belum ada background</Typography>
                          <Typography variant="caption" color="text.disabled">
                            Upload gambar untuk layar awal booth
                          </Typography>
                        </Box>
                      )}
                      {attractBusy && (
                        <Box
                          sx={{
                            position: 'absolute', inset: 0,
                            display: 'flex', flexDirection: 'column', gap: 1,
                            alignItems: 'center', justifyContent: 'center',
                            bgcolor: 'rgba(255,255,255,0.85)',
                          }}
                        >
                          <CircularProgress size={32} />
                          <Typography variant="caption" color="text.secondary">
                            Mengompres &amp; memproses…
                          </Typography>
                        </Box>
                      )}
                    </Box>

                    {/* Controls */}
                    <Box sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                        <Button
                          variant="contained"
                          component="label"
                          size="small"
                          disabled={attractBusy}
                          sx={{ textTransform: 'none' }}
                        >
                          {attractBusy ? 'Memproses…' : 'Upload Background'}
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={handleAttractMediaUpload}
                          />
                        </Button>
                        {b.attractMedia && (
                          <Button
                            color="error"
                            variant="outlined"
                            size="small"
                            onClick={() => setBranding({ attractMedia: null })}
                            disabled={attractBusy}
                            sx={{ textTransform: 'none' }}
                          >
                            Hapus
                          </Button>
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {b.attractMedia
                          ? `±${Math.round(b.attractMedia.length / 1024)} KB inline · otomatis dikompres ≤1920px`
                          : 'Maks 4 MB · otomatis dikompres'}
                      </Typography>
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
                        Rekomendasi: <strong>16:9</strong> (landscape 1920×1080) atau <strong>9:16</strong> (portrait 1080×1920). Display cover, semua rasio work.
                      </Typography>
                    </Box>
                  </Box>
                </Grid>

                {/* ── Icon ───────────────────────────────────── */}
                <Grid item xs={12} md={6}>
                  <Box
                    sx={{
                      border: '1px solid #ececec',
                      borderRadius: 2,
                      overflow: 'hidden',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      bgcolor: '#fafafa',
                    }}
                  >
                    {/* Preview area */}
                    <Box
                      sx={{
                        flex: 1,
                        minHeight: 220,
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: 1.5,
                        bgcolor: '#f4f4f4',
                        borderBottom: '1px solid #ececec',
                      }}
                    >
                      {b.attractIcon ? (
                        <>
                          <img
                            src={b.attractIcon}
                            alt="Icon preview"
                            style={{
                              width: 120,
                              height: 120,
                              objectFit: 'contain',
                              background:
                                'repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 0 0/16px 16px',
                              borderRadius: 8,
                            }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            Ikon di tengah layar &quot;Sentuh untuk mulai&quot;
                          </Typography>
                        </>
                      ) : (
                        <Box sx={{ textAlign: 'center', color: '#bdbdbd' }}>
                          <Box sx={{ fontSize: 44, mb: 1 }}>👆</Box>
                          <Typography variant="body2">Belum ada ikon</Typography>
                          <Typography variant="caption" color="text.disabled">
                            Gunakan ikon default tap-to-start
                          </Typography>
                        </Box>
                      )}
                      {attractBusyIcon && (
                        <Box
                          sx={{
                            position: 'absolute', inset: 0,
                            display: 'flex', flexDirection: 'column', gap: 1,
                            alignItems: 'center', justifyContent: 'center',
                            bgcolor: 'rgba(255,255,255,0.85)',
                          }}
                        >
                          <CircularProgress size={32} />
                          <Typography variant="caption" color="text.secondary">
                            Memproses ikon…
                          </Typography>
                        </Box>
                      )}
                    </Box>

                    {/* Controls */}
                    <Box sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                        <Button
                          variant="contained"
                          component="label"
                          size="small"
                          disabled={attractBusyIcon}
                          sx={{ textTransform: 'none' }}
                        >
                          {attractBusyIcon ? 'Memproses…' : 'Upload Ikon'}
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            hidden
                            onChange={handleAttractIconUpload}
                          />
                        </Button>
                        {b.attractIcon && (
                          <Button
                            color="error"
                            variant="outlined"
                            size="small"
                            onClick={() => setBranding({ attractIcon: null })}
                            disabled={attractBusyIcon}
                            sx={{ textTransform: 'none' }}
                          >
                            Reset
                          </Button>
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {b.attractIcon
                          ? `±${Math.round(b.attractIcon.length / 1024)} KB inline · disarankan transparan (PNG)`
                          : 'Maks 512 KB · PNG transparan disarankan'}
                      </Typography>
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
                        Rekomendasi: <strong>1:1 (persegi)</strong>, ideal <strong>256×256</strong> atau <strong>512×512</strong> piksel. Tampil di tengah tombol 720×540 (4:3).
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          {/* ── Save ──────────────────────────────────────────── */}
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={confirmUpdatePresetAndSave} disabled={saving || attractBusy}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
              <Button variant="outlined" onClick={load}>Reset</Button>
              <Button variant="text" onClick={openSavePresetFromCurrent} disabled={saving}>Save as Preset</Button>
            </Box>
          </Grid>
        </Grid>
      )}

      {applyConfirmDialog}

      {updatePresetConfirm}

      {presetDialog}

      {/* Logo full-screen modal (klik thumbnail di branding) */}
      <Dialog
        open={logoModalOpen}
        onClose={() => setLogoModalOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: { bgcolor: 'rgba(0,0,0,0.92)', boxShadow: 'none' },
        }}
      >
        <DialogTitle sx={{ color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Logo Preview</span>
          <Button
            size="small"
            onClick={() => setLogoModalOpen(false)}
            sx={{ color: '#fff', minWidth: 'auto' }}
          >
            ✕ Tutup
          </Button>
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: { xs: 300, sm: 500, md: 600 },
            p: 3, bgcolor: '#fafafa',
            backgroundImage: b.logoDataUrl
              ? 'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)'
              : 'none',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, 10px 0px',
          }}
        >
          {b.logoDataUrl ? (
            <img
              src={b.logoDataUrl}
              alt="Logo full screen"
              style={{
                maxWidth: '100%', maxHeight: '70vh',
                objectFit: 'contain',
              }}
            />
          ) : (
            <Typography variant="body2" color="text.disabled">Tidak ada logo</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ bgcolor: 'rgba(0,0,0,0.92)', justifyContent: 'center', pb: 2 }}>
          <Button onClick={() => setLogoModalOpen(false)} variant="outlined" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>
            Tutup (Esc)
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
