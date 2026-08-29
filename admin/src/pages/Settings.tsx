import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, MenuItem, TextField, Button, Snackbar,
  CircularProgress, Grid, FormControl, InputLabel, Select, Slider, FormControlLabel, Checkbox,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'

interface Branding {
  // Logo & text
  logoUrl?: string
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

  const b = form.branding

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
                  <TextField
                    fullWidth label="Preset Default" value={form.preset_name || ''} size="small"
                    onChange={(e) => setForm({ ...form, preset_name: e.target.value || null })}
                    placeholder="Nama preset yang aktif saat app dibuka"
                  />
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
                  <TextField fullWidth label="Logo URL" value={b.logoUrl || ''} size="small"
                    onChange={(e) => setBranding({ logoUrl: e.target.value })}
                    placeholder="https://example.com/logo.png"
                  />
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
          </Grid>

          {/* ── Save ──────────────────────────────────────────── */}
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
              <Button variant="outlined" onClick={load}>Reset</Button>
            </Box>
          </Grid>
        </Grid>
      )}

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
