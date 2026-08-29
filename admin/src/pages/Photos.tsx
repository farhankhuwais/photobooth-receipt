import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, Pagination, IconButton, MenuItem, TextField, Button,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '@/api/client'

interface Photo {
  id: string
  tenant_id: string
  created_at: string
  url: string
}

export default function Photos() {
  const [rows, setRows] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(60)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tenants, setTenants] = useState<{ slug: string; name: string }[]>([])
  const [tenantFilter, setTenantFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (tenantFilter) params.set('tenantSlug', tenantFilter)
      const data = await api<{ items: Photo[]; total: number }>(`/api/admin/photos?${params}`)
      setRows(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat foto')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, tenantFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api<{ items: { slug: string; name: string }[] }>('/api/admin/tenants?pageSize=500')
      .then((d) => setTenants(d.items.map((t) => ({ slug: t.slug, name: t.name }))))
      .catch(() => {})
  }, [])

  const handleDelete = async (p: Photo) => {
    if (!window.confirm(`Hapus foto ini?`)) return
    try {
      await api(`/api/admin/photos/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal hapus')
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
        <Typography variant="h5" fontWeight={700}>Manajemen Foto ({total})</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            size="small" select label="Filter Tenant" value={tenantFilter}
            onChange={(e) => { setTenantFilter(e.target.value); setPage(1) }}
            sx={{ minWidth: 200 }}
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

      {loading ? (
        <Typography>Memuat…</Typography>
      ) : rows.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}><Typography>Belum ada foto</Typography></Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2 }}>
          {rows.map((p) => (
            <Paper key={p.id} sx={{ overflow: 'hidden', position: 'relative' }}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <Box
                  component="img"
                  src={p.url}
                  alt={p.id}
                  loading="lazy"
                  sx={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block', bgcolor: '#eee' }}
                />
              </a>
              <Box sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ overflow: 'hidden' }}>
                  <Typography variant="caption" display="block" noWrap>{p.tenant_id}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    {new Date(p.created_at).toLocaleString('id-ID')}
                  </Typography>
                </Box>
                <IconButton size="small" color="error" onClick={() => handleDelete(p)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Paper>
          ))}
        </Box>
      )}

      {total > pageSize && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination count={Math.ceil(total / pageSize)} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
        </Box>
      )}
    </Box>
  )
}
