import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, IconButton, MenuItem, TextField, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { api } from '@/api/client'

interface Design {
  id: string
  name: string
  canvasW: number
  canvasH: number
  slotsCount: number
  slots: Array<{ x: number; y: number; w: number; h: number; rot: number }>
  hasFrame: boolean
  created_at: string
}

export default function Designs() {
  const [rows, setRows] = useState<Design[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [snack, setSnack] = useState('')
  const [tenants, setTenants] = useState<{ slug: string; name: string }[]>([])
  const [tenantFilter, setTenantFilter] = useState('')
  const [preview, setPreview] = useState<Design | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tenantFilter) params.set('tenantSlug', tenantFilter)
      const data = await api<{ items: Design[]; total: number }>(`/api/admin/designs?${params}`)
      setRows(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat design')
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

  const openPreview = async (d: Design) => {
    setPreview(d)
    setFrameUrl(null)
    try {
      const detail = await api<{ id: string; frameBuf?: string }>(
        `/api/admin/designs/${encodeURIComponent(d.id)}${tenantFilter ? `?tenantSlug=${tenantFilter}` : ''}`
      )
      if (detail.frameBuf) {
        // Convert base64 buffer to data URL
        setFrameUrl(`data:image/png;base64,${detail.frameBuf}`)
      }
    } catch {
      // preview without frame
    }
  }

  const handleDelete = async (d: Design) => {
    if (!window.confirm(`Hapus design "${d.name}"?`)) return
    try {
      await api(`/api/admin/designs/${encodeURIComponent(d.id)}${tenantFilter ? `?tenantSlug=${tenantFilter}` : ''}`, { method: 'DELETE' })
      setSnack('Design terhapus')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal hapus')
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
        <Typography variant="h5" fontWeight={700}>Manajemen Design ({total})</Typography>
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
              <TableCell>Nama</TableCell>
              <TableCell>Canvas</TableCell>
              <TableCell>Slot</TableCell>
              <TableCell>Frame</TableCell>
              <TableCell>Dibuat</TableCell>
              <TableCell align="right">Aksi</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={7} align="center">Memuat…</TableCell></TableRow>}
            {!loading && rows.length === 0 && <TableRow><TableCell colSpan={7} align="center">Belum ada design</TableCell></TableRow>}
            {rows.map((d) => (
              <TableRow key={d.id} hover>
                <TableCell>
                  <Box
                    sx={{
                      width: 60, height: 80, bgcolor: '#eee', border: '1px solid #ccc',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {d.slots.slice(0, 4).map((s, i) => (
                      <Box key={i} sx={{
                        position: 'absolute',
                        left: `${(s.x / d.canvasW) * 100}%`,
                        top: `${(s.y / d.canvasH) * 100}%`,
                        width: `${(s.w / d.canvasW) * 100}%`,
                        height: `${(s.h / d.canvasH) * 100}%`,
                        border: '1.5px dashed #1976d2',
                        bgcolor: 'rgba(25,118,210,0.05)',
                      }} />
                    ))}
                  </Box>
                </TableCell>
                <TableCell>{d.name}</TableCell>
                <TableCell>{d.canvasW}×{d.canvasH}</TableCell>
                <TableCell>{d.slotsCount}</TableCell>
                <TableCell>{d.hasFrame ? '✓' : '—'}</TableCell>
                <TableCell>{new Date(d.created_at).toLocaleString('id-ID')}</TableCell>
                <TableCell align="right">
                  <IconButton onClick={() => openPreview(d)}><VisibilityIcon /></IconButton>
                  <IconButton color="error" onClick={() => handleDelete(d)}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!preview} onClose={() => setPreview(null)} fullWidth maxWidth="sm">
        <DialogTitle>Preview: {preview?.name}</DialogTitle>
        <DialogContent>
          {preview && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Canvas: {preview.canvasW}×{preview.canvasH} • Slot: {preview.slotsCount}
              </Typography>
              <Box sx={{
                position: 'relative', width: '100%', maxWidth: 300, mx: 'auto', my: 2,
                border: '1px solid #ccc', bgcolor: '#fafafa',
                aspectRatio: `${preview.canvasW} / ${preview.canvasH}`,
              }}>
                {frameUrl && (
                  <Box component="img" src={frameUrl} alt="frame" sx={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
                  }} />
                )}
                {preview.slots.map((s, i) => (
                  <Box key={i} sx={{
                    position: 'absolute',
                    left: `${(s.x / preview.canvasW) * 100}%`,
                    top: `${(s.y / preview.canvasH) * 100}%`,
                    width: `${(s.w / preview.canvasW) * 100}%`,
                    height: `${(s.h / preview.canvasH) * 100}%`,
                    border: '2px dashed #1976d2',
                    bgcolor: 'rgba(25,118,210,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#1976d2', fontSize: 11, fontWeight: 600,
                  }}>
                    Slot {i + 1}
                  </Box>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" display="block">
                ID: <span className="mono">{preview.id}</span>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Tutup</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
