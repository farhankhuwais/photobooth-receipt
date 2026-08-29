import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, MenuItem, TextField, Button, Snackbar,
  CircularProgress, Grid, IconButton, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import SaveIcon from '@mui/icons-material/Save'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'

interface Preset {
  name: string
  mode: 'regular' | 'event'
  price: number
  branding: Record<string, unknown>
}

export default function Presets() {
  const { user } = useAuth()
  const isSuper = user?.role === 'super_admin'

  const [tenantSlug, setTenantSlug] = useState('')
  const [tenantList, setTenantList] = useState<{ slug: string; name: string }[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [snack, setSnack] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Preset | null>(null)
  const [draft, setDraft] = useState({
    name: '', mode: 'regular' as 'regular' | 'event', price: 5000,
    branding: {} as Record<string, unknown>,
  })

  // tenant_admin langsung pakai tenant_id sendiri
  useEffect(() => {
    if (isSuper) {
      api<{ items: { slug: string; name: string }[] }>('/api/admin/tenants?pageSize=500')
        .then((d) => {
          const list = d.items.map((t) => ({ slug: t.slug, name: t.name }))
          setTenantList(list)
          if (list.length > 0) setTenantSlug(list[0].slug)
        })
        .catch(() => setError('Gagal memuat daftar tenant'))
    } else {
      if (user?.tenant_id) setTenantSlug(user.tenant_id)
      else setError('Akun belum terikat ke tenant')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!tenantSlug) return
    setLoading(true)
    try {
      const rows = await api<Preset[]>(`/api/admin/presets?tenantSlug=${tenantSlug}`)
      setPresets(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat preset')
    } finally {
      setLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => { if (tenantSlug) load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setDraft({ name: '', mode: 'regular', price: 5000, branding: {} })
    setDialogOpen(true)
  }

  const openEdit = (p: Preset) => {
    setEditing(p)
    setDraft({ name: p.name, mode: p.mode, price: Number(p.price) || 5000, branding: p.branding || {} })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!draft.name.trim()) { setError('Nama preset wajib'); return }
    setSaving(true)
    try {
      await api(`/api/admin/presets/${encodeURIComponent(draft.name.trim())}`, {
        method: 'PUT',
        body: { tenantSlug, name: draft.name.trim(), mode: draft.mode, price: draft.price, branding: draft.branding },
      })
      setSnack('Preset disimpan')
      setDialogOpen(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal simpan preset')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p: Preset) => {
    if (!window.confirm(`Hapus preset "${p.name}"?`)) return
    try {
      await api(`/api/admin/presets/${encodeURIComponent(p.name)}?tenantSlug=${tenantSlug}`, { method: 'DELETE' })
      setSnack('Preset dihapus')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal hapus preset')
    }
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>Presets</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

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

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={!tenantSlug}>
          Buat Preset
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : presets.length === 0 ? (
        <Alert severity="info">Belum ada preset. Buat preset baru untuk menyimpan konfigurasi booth.</Alert>
      ) : (
        <Paper>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><b>Nama</b></TableCell>
                <TableCell><b>Mode</b></TableCell>
                <TableCell><b>Harga</b></TableCell>
                <TableCell align="right"><b>Aksi</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {presets.map((p) => (
                <TableRow key={p.name}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell><Chip size="small" label={p.mode} color={p.mode === 'event' ? 'secondary' : 'primary'} /></TableCell>
                  <TableCell>{p.mode === 'event' ? 'Gratis' : `Rp ${Number(p.price).toLocaleString('id-ID')}`}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(p)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(p)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Preset' : 'Buat Preset Baru'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth label="Nama Preset" value={draft.name} size="small"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                disabled={!!editing}
                placeholder="mis. Wedding A, Buka Puasa, Standart"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                select fullWidth label="Mode" value={draft.mode} size="small"
                onChange={(e) => setDraft({ ...draft, mode: e.target.value as 'regular' | 'event' })}
              >
                <MenuItem value="regular">Regular</MenuItem>
                <MenuItem value="event">Event (gratis)</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth type="number" label="Harga (Rp)" value={draft.price} size="small"
                onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
                disabled={draft.mode === 'event'}
                inputProps={{ min: 0, step: 500 }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Batal</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}