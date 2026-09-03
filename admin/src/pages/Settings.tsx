import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, MenuItem, TextField, Button, Snackbar,
  CircularProgress, Grid, FormControl, InputLabel, Select, Slider, FormControlLabel, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogActions,
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
  showCapturingBox?: boolean
  qrText?: string
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
  const [presetSaving, setPresetSaving] = useState(false)
  const [presetEditing, setPresetEditing] = useState<{ name: string; mode: 'regular' | 'event'; price: number } | null>(null)
  const [presetDraft, setPresetDraft] = useState({ name: '', mode: 'regular' as 'regular' | 'event', price: 5000 })
  const [applyPresetName, setApplyPresetName] = useState<string | null>(null)
  const [updatingPreset, setUpdatingPreset] = useState(false)
  const [updatePresetName, setUpdatePresetName] = useState<string | null>(null)
  const [attractBusy, setAttractBusy] = useState(false)
  const [attractBusyIcon, setAttractBusyIcon] = useState(false)

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

          {/* ── Kanan: Branding & Layout ──────────────────────── */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>Branding</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexDirection: 'column' }}>
                    <Button variant="outlined" component="label" size="small">
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
                      <Box sx={{ width: '100%', maxWidth: 200, border: '1px solid #ccc', p: 1 }}>
                        <img src={b.logoDataUrl} alt="Logo preview" style={{ width: '100%', height: 'auto' }} />
                      </Box>
                    )}
                    {b.logoDataUrl && (
                      <Button color="error" size="small" onClick={() => setBranding({ logoDataUrl: '' })}>Hapus Logo</Button>
                    )}
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Header Text" value={b.headerText || ''} size="small"
                    onChange={(e) => setBranding({ headerText: e.target.value })}
                    placeholder="Photobooth ACHIPIX"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Footer Text" value={b.footerText || ''} size="small"
                    onChange={(e) => setBranding({ footerText: e.target.value })}
                    placeholder="Terima kasih!"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Nama Event" value={b.eventName || ''} size="small"
                    onChange={(e) => setBranding({ eventName: e.target.value })}
                    placeholder="Wedding Anto & Sari"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth label="Warna Utama" value={b.primaryColor || ''} size="small"
                    onChange={(e) => setBranding({ primaryColor: e.target.value })}
                    placeholder="#1976d2"
                    InputProps={{
                      startAdornment: b.primaryColor ? (
                        <Box sx={{ width: 20, height: 20, borderRadius: 0.5, mr: 1, bgcolor: b.primaryColor, border: '1px solid #ccc', flexShrink: 0 }} />
                      ) : null,
                    }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Watermark / Teks di hasil foto" value={b.watermark || ''} size="small"
                    onChange={(e) => setBranding({ watermark: e.target.value })}
                    placeholder="Powered by @Achipix.id!"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="URL QR Code" value={b.qrText || ''} size="small"
                    onChange={(e) => setBranding({ qrText: e.target.value })}
                    placeholder="https://instagram.com/achipix"
                    helperText="Kosongkan untuk nonaktifkan QR di struk"
                  />
                </Grid>
              </Grid>
            </Paper>

            <Paper sx={{ p: 3, mt: 2 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>Layout Struk</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth type="number" label="Jarak Atas (px)" value={b.photoTopPad ?? 20} size="small"
                    onChange={(e) => setBranding({ photoTopPad: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 400, step: 4 }}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth type="number" label="Jarak Bawah (px)" value={b.photoBottomPad ?? 20} size="small"
                    onChange={(e) => setBranding({ photoBottomPad: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 400, step: 4 }}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth type="number" label="Jarak Antar Foto (px)" value={b.photoGap ?? 20} size="small"
                    onChange={(e) => setBranding({ photoGap: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 200, step: 2 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth type="number" label="Jarak 2×2 X (px)" value={b.photoGap2x2X ?? 10} size="small"
                    onChange={(e) => setBranding({ photoGap2x2X: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 200, step: 2 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth type="number" label="Jarak 2×2 Y (px)" value={b.photoGap2x2Y ?? 10} size="small"
                    onChange={(e) => setBranding({ photoGap2x2Y: Number(e.target.value) })}
                    inputProps={{ min: 0, max: 200, step: 2 }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={<Checkbox checked={!!b.showDate} onChange={(e) => setBranding({ showDate: e.target.checked })} size="small" />}
                    label="Tampilkan tanggal di hasil"
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={<Checkbox checked={!!b.showEventNameOnPrint} onChange={(e) => setBranding({ showEventNameOnPrint: e.target.checked })} size="small" />}
                    label="Tampilkan nama event di hasil"
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={<Checkbox checked={!!b.showCapturingBox} onChange={(e) => setBranding({ showCapturingBox: e.target.checked })} size="small" />}
                    label="Tampilkan kotak capturing (lingkaran capture area)"
                  />
                </Grid>
              </Grid>
            </Paper>

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

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
