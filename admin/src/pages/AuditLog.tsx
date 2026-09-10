import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography, TextField, Chip, Alert, Pagination, IconButton, Tooltip,
  Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material'
import { Delete } from '@mui/icons-material'
import { api } from '@/api/client'

interface AuditItem {
  id: number
  user_id: number | null
  tenant_slug: string | null
  action: string
  target: string | null
  metadata: unknown
  created_at: string
}

const ACTION_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success'> = {
  login_success: 'success',
  login_failed: 'error',
  login_blocked_inactive: 'warning',
  logout: 'default',
  tenant_create: 'primary',
  tenant_update: 'info',
  tenant_delete: 'error',
  user_create: 'primary',
  user_update: 'info',
  user_delete: 'error',
}

export default function AuditLog() {
  const [rows, setRows] = useState<AuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ items: AuditItem[]; total: number }>(`/api/admin/audit?page=${page}&pageSize=${pageSize}`)
      setRows(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat log audit')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: number) => {
    if (!window.confirm('Hapus log audit ini?')) return
    try {
      await api(`/api/admin/audit/${id}`, { method: 'DELETE' })
      setRows((prev) => prev.filter((r) => r.id !== id))
      setTotal((t) => Math.max(0, t - 1))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus log audit')
    }
  }

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = search
    ? rows.filter((r) => {
        const s = search.toLowerCase()
        return r.action.toLowerCase().includes(s) ||
          (r.target && r.target.toLowerCase().includes(s)) ||
          (r.tenant_slug && r.tenant_slug.toLowerCase().includes(s))
      })
    : rows

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const pageIds = filtered.map((r) => r.id)
      const allSelected = pageIds.length > 0 && pageIds.every((id) => prev.has(id))
      if (allSelected) {
        const next = new Set(prev)
        pageIds.forEach((id) => next.delete(id))
        return next
      }
      return new Set([...prev, ...pageIds])
    })
  }

  const allPageSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const somePageSelected = !allPageSelected && filtered.some((r) => selected.has(r.id))

  const handleBulkDelete = async () => {
    if (!window.confirm(`Hapus ${selected.size} log audit yang dipilih?`)) return
    setBulkLoading(true)
    try {
      await Promise.all([...selected].map((id) => api(`/api/admin/audit/${id}`, { method: 'DELETE' })))
      setRows((prev) => prev.filter((r) => !selected.has(r.id)))
      setTotal((t) => Math.max(0, t - selected.size))
      setSelected(new Set())
      setBulkOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus log audit')
    } finally {
      setBulkLoading(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>Log Audit ({total})</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextField
          size="small" placeholder="Cari action / target / tenant" value={search}
          onChange={(e) => setSearch(e.target.value)} sx={{ width: 360 }}
        />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {selected.size > 0 && (
            <>
              <Typography variant="body2">{selected.size} dipilih</Typography>
              <Button variant="contained" color="error" onClick={() => setBulkOpen(true)}>
                Hapus yang dipilih
              </Button>
              <Button variant="text" onClick={() => setSelected(new Set())}>Batal pilihan</Button>
            </>
          )}
        </Box>
      </Box>

      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Hapus log audit</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Kamu akan menghapus {selected.size} log audit. Aksi ini tidak bisa dibatalkan.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpen(false)} disabled={bulkLoading}>Batal</Button>
          <Button onClick={handleBulkDelete} variant="contained" color="error" disabled={bulkLoading}>
            {bulkLoading ? 'Menghapus...' : 'Ya, hapus'}
          </Button>
        </DialogActions>
      </Dialog>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = somePageSelected
                  }}
                  onChange={toggleSelectAll}
                />
              </TableCell>
              <TableCell>Waktu</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Tenant</TableCell>
              <TableCell>Target</TableCell>
              <TableCell>Metadata</TableCell>
              <TableCell align="right">Aksi</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={8} align="center">Memuat…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} align="center">Belum ada log</TableCell></TableRow>}
            {filtered.map((r) => (
              <TableRow key={r.id} hover selected={selected.has(r.id)}>
                <TableCell padding="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                </TableCell>
                <TableCell>{new Date(r.created_at).toLocaleString('id-ID')}</TableCell>
                <TableCell className="mono">{r.user_id ?? '-'}</TableCell>
                <TableCell>
                  <Chip size="small" label={r.action} color={ACTION_COLORS[r.action] || 'default'} />
                </TableCell>
                <TableCell>{r.tenant_slug || '-'}</TableCell>
                <TableCell className="mono">{r.target || '-'}</TableCell>
                <TableCell className="mono" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.metadata ? JSON.stringify(r.metadata) : '-'}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Hapus log">
                    <IconButton size="small" color="error" onClick={() => handleDelete(r.id)}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
        <Pagination
          count={Math.max(1, Math.ceil(total / pageSize))}
          page={page} onChange={(_e, p) => setPage(p)}
          color="primary"
        />
      </Box>
    </Box>
  )
}
