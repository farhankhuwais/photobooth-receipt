import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, TextField, IconButton, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, Snackbar, CircularProgress,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import { tenantApi, approvalApi, type PendingRegistration } from '@/api/client'
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

      {isSuperAdmin && <PendingRegistrationsPanel />}

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

// --- Panel "Pendaftaran Menunggu" (super_admin) ---
// Vendor yang daftar sendiri masuk dengan status `pending` sampai disetujui di sini.
function PendingRegistrationsPanel() {
  const [items, setItems] = useState<PendingRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ slug: string; name: string; action: 'approve' | 'reject' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [snack, setSnack] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await approvalApi.list()
      setItems(d.items ?? [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat pendaftaran menunggu')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleConfirm = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      if (confirm.action === 'approve') await approvalApi.approve(confirm.slug)
      else await approvalApi.reject(confirm.slug)
      setSnack({
        msg: confirm.action === 'approve'
          ? `Akun "${confirm.name}" disetujui`
          : `Pendaftaran "${confirm.name}" ditolak`,
        severity: 'success',
      })
      setConfirm(null)
      await load()
    } catch (e) {
      setSnack({ msg: e instanceof Error ? e.message : 'Gagal memproses pendaftaran', severity: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="h6" fontWeight={600}>Pendaftaran Menunggu</Typography>
        {items.length > 0 && <Chip size="small" color="warning" label={items.length} />}
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Akun booth yang mendaftar sendiri dan menunggu persetujuan. Setujui untuk mengaktifkan
        masa trial, atau tolak pendaftarannya.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : items.length === 0 ? (
        <Alert severity="info">Tidak ada pendaftaran menunggu.</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {items.map((r) => (
            <Paper
              key={r.slug} variant="outlined"
              sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
            >
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography fontWeight={600}>{r.name}</Typography>
                  <Chip size="small" label={r.slug} />
                </Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  {r.owner_email}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Daftar {new Date(r.created_at).toLocaleString('id-ID')}
                </Typography>
              </Box>
              <Button
                size="small" variant="contained" color="success"
                startIcon={<CheckCircleIcon />}
                onClick={() => setConfirm({ slug: r.slug, name: r.name, action: 'approve' })}
              >
                Setujui
              </Button>
              <Button
                size="small" variant="outlined" color="error"
                startIcon={<CancelIcon />}
                onClick={() => setConfirm({ slug: r.slug, name: r.name, action: 'reject' })}
              >
                Tolak
              </Button>
            </Paper>
          ))}
        </Box>
      )}

      <Dialog open={!!confirm} onClose={() => (busy ? null : setConfirm(null))} maxWidth="xs" fullWidth>
        <DialogTitle>
          {confirm?.action === 'approve' ? 'Setujui pendaftaran ini?' : 'Tolak pendaftaran ini?'}
        </DialogTitle>
        <DialogContent>
          <Alert severity={confirm?.action === 'approve' ? 'info' : 'warning'}>
            {confirm?.action === 'approve'
              ? `Akun "${confirm?.name}" akan disetujui dan masa trial dimulai.`
              : `Pendaftaran "${confirm?.name}" akan ditolak dan tidak bisa masuk.`}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={busy}>Batal</Button>
          <Button
            variant="contained"
            color={confirm?.action === 'approve' ? 'success' : 'error'}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? 'Memproses…' : confirm?.action === 'approve' ? 'Setujui' : 'Tolak'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack} autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack?.severity} onClose={() => setSnack(null)}>{snack?.msg}</Alert>
      </Snackbar>
    </Paper>
  )
}
