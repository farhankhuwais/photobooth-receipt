import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, TextField, IconButton, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, Snackbar, MenuItem, Tooltip,
  CircularProgress,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import { api, userApi, tierApi } from '@/api/client'
import type { User, PricingTier } from '@/types'

const ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'tenant_admin', label: 'Tenant Admin' },
  { value: 'tenant_user', label: 'Tenant User' },
]

export default function Users() {
  const [rows, setRows] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [tiers, setTiers] = useState<PricingTier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [snack, setSnack] = useState('')
  const [tenants, setTenants] = useState<{ slug: string; name: string }[]>([])
  const [generating, setGenerating] = useState<number | null>(null)
  const [form, setForm] = useState({
    email: '', name: '', password: '', role: 'tenant_admin',
    tenant_id: '', pricing_tier_id: '', active: true,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, tierData] = await Promise.all([
        api<{ items: User[]; total: number }>('/api/admin/users?pageSize=200'),
        tierApi.list(),
      ])
      setRows(data.items)
      setTotal(data.total)
      setTiers(tierData.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api<{ items: { slug: string; name: string }[] }>('/api/admin/tenants?pageSize=500')
      .then((d) => setTenants(d.items.map((t) => ({ slug: t.slug, name: t.name }))))
      .catch(() => {})
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ email: '', name: '', password: '', role: 'tenant_admin', tenant_id: '', pricing_tier_id: '', active: true })
    setOpen(true)
  }

  const openEdit = (u: User) => {
    setEditing(u)
    setForm({
      email: u.email, name: u.name || '', password: '',
      role: u.role, tenant_id: u.tenant_id || '', pricing_tier_id: String(u.pricing_tier_id || ''), active: true,
    })
    setOpen(true)
  }

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        name: form.name || null,
        tenant_id: form.tenant_id || null,
        pricing_tier_id: form.pricing_tier_id ? Number(form.pricing_tier_id) : null,
      }
      if (editing) {
        await userApi.update(editing.id, {
          role: form.role, ...payload,
          password: form.password.length >= 8 ? form.password : undefined,
        } as Parameters<typeof userApi.update>[1])
      } else {
        if (form.password.length < 8) { setError('Password minimal 8 karakter'); return }
        await userApi.create({
          email: form.email, password: form.password, role: form.role,
          ...payload,
        } as Parameters<typeof userApi.create>[0])
      }
      setOpen(false)
      setSnack('User tersimpan')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal simpan')
    }
  }

  const handleDelete = async (u: User) => {
    if (!window.confirm(`Hapus user "${u.email}"?`)) return
    try {
      await userApi.remove(u.id)
      setSnack('User terhapus')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal hapus')
    }
  }

  const handleGenerateCode = async (u: User) => {
    setGenerating(u.id)
    try {
      const result = await userApi.generateCode(u.id)
      setSnack(`Kode generated: ${result.code}`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal generate kode')
    } finally {
      setGenerating(null)
    }
  }

  const needsTenant = form.role === 'tenant_admin' || form.role === 'tenant_user'

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Manajemen User ({total})</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Tambah User</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Email</TableCell>
              <TableCell>Nama</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Tier</TableCell>
              <TableCell>Kode Akses</TableCell>
              <TableCell>Tenant</TableCell>
              <TableCell>Login Terakhir</TableCell>
              <TableCell align="right">Aksi</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={8} align="center">Belum ada user</TableCell></TableRow>
            )}
            {rows.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell>{u.email}</TableCell>
                <TableCell>{u.name || '-'}</TableCell>
                <TableCell>
                  <Chip size="small" label={u.role}
                    color={u.role === 'super_admin' ? 'primary' : u.role === 'tenant_admin' ? 'secondary' : 'default'} />
                </TableCell>
                <TableCell>
                  {u.tier_name
                    ? <Chip size="small" label={u.tier_name} color="success" variant="outlined" />
                    : <Typography variant="caption" color="text.disabled">—</Typography>}
                </TableCell>
                <TableCell>
                  {u.code
                    ? <Chip size="small" icon={<VpnKeyIcon />} label={u.code} variant="outlined" sx={{ fontFamily: 'monospace' }} />
                    : <Tooltip title="Generate kode akses unik untuk client ini">
                        <Button size="small" variant="outlined" startIcon={<VpnKeyIcon />}
                          onClick={() => handleGenerateCode(u)}
                          disabled={generating === u.id}>
                          {generating === u.id ? '...' : 'Generate'}
                        </Button>
                      </Tooltip>}
                </TableCell>
                <TableCell>{u.tenant_id || '-'}</TableCell>
                <TableCell>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('id-ID') : <Typography variant="caption" color="text.disabled">Belum pernah</Typography>}</TableCell>
                <TableCell align="right">
                  <IconButton onClick={() => openEdit(u)}><EditIcon /></IconButton>
                  <IconButton color="error" onClick={() => handleDelete(u)}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit User' : 'Tambah User'}</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Email" type="email" value={form.email} disabled={!!editing}
            onChange={(e) => setForm({ ...form, email: e.target.value })} sx={{ mt: 2, mb: 2 }} required />
          <TextField fullWidth label="Nama" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} sx={{ mb: 2 }} />
          {!editing && (
            <TextField fullWidth label="Password (min 8 karakter)" type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} sx={{ mb: 2 }} required />
          )}
          <TextField fullWidth select label="Role" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })} sx={{ mb: 2 }}>
            {ROLES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          {needsTenant && (
            <TextField fullWidth select label="Tenant" value={form.tenant_id}
              onChange={(e) => setForm({ ...form, tenant_id: e.target.value })} sx={{ mb: 2 }}>
              <MenuItem value="">— Pilih tenant —</MenuItem>
              {tenants.map((t) => <MenuItem key={t.slug} value={t.slug}>{t.name} ({t.slug})</MenuItem>)}
            </TextField>
          )}
          <TextField fullWidth select label="Pricing Tier" value={form.pricing_tier_id}
            onChange={(e) => setForm({ ...form, pricing_tier_id: e.target.value })} sx={{ mb: 2 }}>
            <MenuItem value="">— Tanpa tier —</MenuItem>
            {tiers.filter((t) => t.active).map((t) => (
              <MenuItem key={t.id} value={String(t.id)}>
                {t.name} (max {t.max_tenants} tenant, {t.max_photos} foto, {t.max_frames} frames)
              </MenuItem>
            ))}
          </TextField>
          {editing && (
            <TextField fullWidth label="Password baru (kosongkan jika tidak diganti)" type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} sx={{ mb: 2 }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={handleSave}>Simpan</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
