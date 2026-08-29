import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, TextField, MenuItem, Alert, Button,
} from '@mui/material'
import { api } from '@/api/client'

interface Frame {
  id: string
  name: string
  template: string | null
  created_at: string
}

export default function Frames() {
  const [rows, setRows] = useState<Frame[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tenants, setTenants] = useState<{ slug: string; name: string }[]>([])
  const [tenantFilter, setTenantFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tenantFilter) params.set('tenantSlug', tenantFilter)
      const data = await api<{ items: Frame[]; total: number }>(`/api/admin/frames?${params}`)
      setRows(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat frame')
    } finally {
      setLoading(false)
    }
  }, [tenantFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api<{ items: { slug: string; name: string }[] }>('/api/admin/tenants?pageSize=500')
      .then((d) => setTenants(d.items.map((t) => ({ slug: t.slug, name: t.name }))))
      .catch(() => {})
  }, [])

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
        <Typography variant="h5" fontWeight={700}>Manajemen Frame ({total})</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            size="small" select label="Filter Tenant" value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)} sx={{ minWidth: 200 }}
          >
            <MenuItem value="">Semua tenant</MenuItem>
            {tenants.map((t) => (
              <MenuItem key={t.slug} value={t.slug}>{t.name} ({t.slug})</MenuItem>
            ))}
          </TextField>
          <Button variant="outlined" onClick={load}>Refresh</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Preview</TableCell>
              <TableCell>ID</TableCell>
              <TableCell>Nama</TableCell>
              <TableCell>Template</TableCell>
              <TableCell>Dibuat</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} align="center">Memuat…</TableCell></TableRow>}
            {!loading && rows.length === 0 && <TableRow><TableCell colSpan={5} align="center">Belum ada frame</TableCell></TableRow>}
            {rows.map((f) => (
              <TableRow key={f.id} hover>
                <TableCell>
                  <Box
                    component="img"
                    src={`/api/frames/${encodeURIComponent(f.id)}`}
                    alt={f.name}
                    loading="lazy"
                    sx={{ width: 80, height: 50, objectFit: 'contain', bgcolor: '#eee' }}
                  />
                </TableCell>
                <TableCell className="mono" sx={{ fontSize: 12 }}>{f.id}</TableCell>
                <TableCell>{f.name}</TableCell>
                <TableCell className="mono" sx={{ fontSize: 12 }}>{f.template || '-'}</TableCell>
                <TableCell>{new Date(f.created_at).toLocaleString('id-ID')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
