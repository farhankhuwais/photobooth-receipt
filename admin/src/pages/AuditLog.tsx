import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography, TextField, Chip, Alert, Pagination,
} from '@mui/material'
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

  const filtered = search
    ? rows.filter((r) => {
        const s = search.toLowerCase()
        return r.action.toLowerCase().includes(s) ||
          (r.target && r.target.toLowerCase().includes(s)) ||
          (r.tenant_slug && r.tenant_slug.toLowerCase().includes(s))
      })
    : rows

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>Log Audit ({total})</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Box sx={{ mb: 2 }}>
        <TextField
          size="small" placeholder="Cari action / target / tenant" value={search}
          onChange={(e) => setSearch(e.target.value)} sx={{ width: 360 }}
        />
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Waktu</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Tenant</TableCell>
              <TableCell>Target</TableCell>
              <TableCell>Metadata</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={6} align="center">Memuat…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={6} align="center">Belum ada log</TableCell></TableRow>}
            {filtered.map((r) => (
              <TableRow key={r.id} hover>
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
