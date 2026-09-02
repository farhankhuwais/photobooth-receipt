import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, TextField, IconButton, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, Snackbar,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import { tenantApi } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import type { Tenant } from '@/types'

export default function Tenants() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Tenant | null>(null)
  const [snack, setSnack] = useState('')
  const [form, setForm] = useState({ slug: '', name: '', access_pin: '' })
  const isSuperAdmin = user?.role === 'super_admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await tenantApi.list({ pageSize: 500 })
      setRows(data.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat tenants')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({ slug: '', name: '', access_pin: '' })
    setOpen(true)
  }

  const openEdit = (t: Tenant) => {
    setEditing(t)
    setForm({ slug: t.slug, name: t.name, access_pin: t.access_pin || '' })
    setOpen(true)
  }

  const handleSave = async () => {
    try {
      if (editing) {
        await tenantApi.update(editing.slug, { name: form.name, access_pin: form.access_pin || null })
      } else {
        await tenantApi.create({ slug: form.slug, name: form.name, access_pin: form.access_pin || undefined })
      }
      setOpen(false)
      setSnack('Tenant tersimpan')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal simpan')
    }
  }

  const handleDelete = async (t: Tenant) => {
    if (!window.confirm(`Hapus tenant "${t.name}"? Semua data akan terhapus.`)) return
    try {
      await tenantApi.remove(t.slug)
      setSnack('Tenant terhapus')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal hapus')
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Manajemen Tenant</Typography>
        {isSuperAdmin && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Tambah Tenant</Button>}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Slug</TableCell>
              <TableCell>Nama</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>PIN</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Dibuat</TableCell>
              <TableCell align="right">Aksi</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} align="center">Memuat…</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={7} align="center">Belum ada tenant</TableCell></TableRow>
            )}
            {rows.map((t) => (
              <TableRow key={t.id} hover>
                <TableCell>{t.slug}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell>
                  <a href={`https://${t.slug}.achipix.web.id`} target="_blank" rel="noreferrer">
                    {t.slug}.achipix.web.id
                  </a>
                </TableCell>
                <TableCell className="mono">{t.access_pin || '-'}</TableCell>
                <TableCell>
                  <Chip size="small" color={t.active ? 'success' : 'default'} label={t.active ? 'Aktif' : 'Nonaktif'} />
                </TableCell>
                <TableCell>{new Date(t.created_at).toLocaleDateString('id-ID')}</TableCell>
                <TableCell align="right">
                  <IconButton onClick={() => openEdit(t)}><EditIcon /></IconButton>
                  <IconButton color="error" onClick={() => handleDelete(t)}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit Tenant' : 'Tambah Tenant'}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth label="Slug (subdomain)" value={form.slug} disabled={!!editing}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
            sx={{ mt: 2, mb: 2 }} placeholder="customer1"
          />
          <TextField
            fullWidth label="Nama" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth label="PIN (4 digit, opsional)" value={form.access_pin} inputProps={{ maxLength: 4 }}
            onChange={(e) => setForm({ ...form, access_pin: e.target.value.replace(/\D/g, '') })}
            placeholder="0000"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={handleSave}>Simpan</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')}
        message={snack} />
    </Box>
  )
}
