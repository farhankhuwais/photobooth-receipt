import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, TextField, Button, Snackbar, CircularProgress,
  Grid, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Switch, FormControlLabel,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import { tierApi } from '@/api/client'
import type { PricingTier } from '@/types'

const EMPTY: TierForm = {
  slug: '', name: '', description: '',
  max_tenants: 1, max_photos: 100, max_frames: 3, max_designs: 3, max_presets: 3,
}

interface TierForm {
  slug: string
  name: string
  description: string
  max_tenants: number
  max_photos: number
  max_frames: number
  max_designs: number
  max_presets: number
}

export default function PricingTiers() {
  const [rows, setRows] = useState<PricingTier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [snack, setSnack] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PricingTier | null>(null)
  const [form, setForm] = useState<TierForm>(EMPTY)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await tierApi.list()
      setRows(d.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat pricing tiers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true) }
  const openEdit = (t: PricingTier) => {
    setEditing(t)
    setForm({
      slug: t.slug, name: t.name, description: t.description || '',
      max_tenants: t.max_tenants, max_photos: t.max_photos, max_frames: t.max_frames,
      max_designs: t.max_designs, max_presets: t.max_presets,
    })
    setOpen(true)
  }

  const handleSave = async () => {
    try {
      const payload = {
        ...form,
        max_tenants: Number(form.max_tenants), max_photos: Number(form.max_photos),
        max_frames: Number(form.max_frames), max_designs: Number(form.max_designs), max_presets: Number(form.max_presets),
      }
      if (editing) await tierApi.update(editing.id, payload)
      else await tierApi.create(payload)
      setOpen(false)
      setSnack('Tier tersimpan')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal simpan')
    }
  }

  const handleDelete = async (t: PricingTier) => {
    if (!window.confirm(`Hapus tier "${t.name}"?`)) return
    try {
      await tierApi.remove(t.id)
      setSnack('Tier terhapus')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal hapus')
    }
  }

  const handleToggle = async (t: PricingTier) => {
    try {
      await tierApi.update(t.id, { active: !t.active })
      setSnack(t.active ? 'Tier dinonaktifkan' : 'Tier diaktifkan')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal update')
    }
  }

  const numField = (label: string, key: keyof Omit<TierForm, 'slug' | 'name' | 'description'>) => (
    <TextField
      fullWidth label={label} type="number" size="small"
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      inputProps={{ min: 0 }}
    />
  )

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Pricing Tier</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Tambah Tier</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Grid container spacing={2}>
        {loading && <CircularProgress sx={{ mt: 4, mx: 'auto', display: 'block' }} />}
        {!loading && rows.length === 0 && (
          <Grid item xs={12}><Alert severity="info">Belum ada pricing tier. Klik "Tambah Tier" untuk membuat.</Alert></Grid>
        )}
        {rows.map((t) => (
          <Grid item xs={12} md={6} lg={4} key={t.id}>
            <Paper sx={{ p: 3, position: 'relative', height: '100%', opacity: t.active ? 1 : 0.6 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>{t.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{t.slug}</Typography>
                  {t.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t.description}</Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <FormControlLabel
                    control={<Switch size="small" checked={t.active} onChange={() => handleToggle(t)} />}
                    label={t.active ? 'Aktif' : 'Nonaktif'}
                    labelPlacement="start"
                  />
                </Box>
              </Box>

              <Grid container spacing={1} sx={{ mt: 1 }}>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Tenant</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" fontWeight={600} textAlign="right">{t.max_tenants}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Foto</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" fontWeight={600} textAlign="right">{t.max_photos}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Frames</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" fontWeight={600} textAlign="right">{t.max_frames}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Designs</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" fontWeight={600} textAlign="right">{t.max_designs}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Presets</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" fontWeight={600} textAlign="right">{t.max_presets}</Typography></Grid>
              </Grid>

              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <IconButton onClick={() => openEdit(t)}><EditIcon fontSize="small" /></IconButton>
                <IconButton color="error" onClick={() => handleDelete(t)}><DeleteIcon fontSize="small" /></IconButton>
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit Tier' : 'Tambah Tier'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}>
              <TextField fullWidth label="Slug" size="small" value={form.slug} disabled={!!editing}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="basic" />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Nama" size="small" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Basic" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Deskripsi" size="small" multiline rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Cocok untuk individu / 1 booth" />
            </Grid>
            <Grid item xs={4}>{numField('Max Tenant', 'max_tenants')}</Grid>
            <Grid item xs={4}>{numField('Max Foto', 'max_photos')}</Grid>
            <Grid item xs={4}>{numField('Max Frames', 'max_frames')}</Grid>
            <Grid item xs={6}>{numField('Max Designs', 'max_designs')}</Grid>
            <Grid item xs={6}>{numField('Max Presets', 'max_presets')}</Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={handleSave}>Simpan</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
