import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, Button, Snackbar, CircularProgress,
  Grid, Chip, MenuItem, TextField,
} from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DeleteIcon from '@mui/icons-material/Delete'
import ImageIcon from '@mui/icons-material/Image'
import MovieIcon from '@mui/icons-material/Movie'
import { api } from '@/api/client'
import { useAuth } from '@/context/AuthContext'

interface AttrAssetInfo { has: boolean; mediaType: string | null }
interface AttrStatus {
  regular: { background: AttrAssetInfo; icon: AttrAssetInfo }
  event: { background: AttrAssetInfo; icon: AttrAssetInfo }
}

export default function Attract() {
  const { user } = useAuth()
  const isSuper = user?.role === 'super_admin'
  const [tenantSlug, setTenantSlug] = useState('')
  const [tenantList, setTenantList] = useState<{ slug: string; name: string }[]>([])
  const [status, setStatus] = useState<AttrStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [snack, setSnack] = useState('')

  useEffect(() => {
    if (isSuper) {
      api<{ items: { slug: string; name: string }[] }>('/api/admin/tenants?pageSize=500')
        .then((d) => {
          const list = d.items.map((t) => ({ slug: t.slug, name: t.name }))
          setTenantList(list)
          if (list.length > 0) setTenantSlug(list[0].slug)
          else setLoading(false)
        })
        .catch(() => { setError('Gagal memuat tenant'); setLoading(false) })
    } else {
      if (user?.tenant_id) setTenantSlug(user.tenant_id)
      else { setError('Akun tidak terikat tenant'); setLoading(false) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!tenantSlug) return
    setLoading(true)
    setError('')
    try {
      const s = await api<AttrStatus>(`/api/admin/attract/status?tenantSlug=${tenantSlug}`)
      setStatus(s || { regular: { background: { has: false, mediaType: null }, icon: { has: false, mediaType: null } }, event: { background: { has: false, mediaType: null }, icon: { has: false, mediaType: null } } })
    } catch (e) {
      setStatus(null)
      setError(e instanceof Error ? e.message : 'Gagal memuat status attract')
    } finally {
      setLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => { if (tenantSlug) load() }, [load])

  const assetUrl = (type: 'background' | 'icon', mode: 'regular' | 'event', ts: number) =>
    `/api/admin/attract/file/${type}/${mode}?tenantSlug=${tenantSlug}&t=${ts}`

  const handleUpload = async (type: 'background' | 'icon', mode: 'regular' | 'event', file: File) => {
    if (!file) return
    setUploading(true)
    setError('')
    const fd = new FormData()
    const field = type === 'background' ? 'media' : 'image'
    fd.append(field, file)
    try {
      const accept = `/api/admin/attract/${mode}${type === 'icon' ? '/icon' : ''}?tenantSlug=${tenantSlug}`
      await api(accept, { method: 'POST', body: fd })
      setSnack(`Upload ${type} (mode ${mode}) sukses`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload gagal')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (type: 'background' | 'icon', mode: 'regular' | 'event') => {
    if (!window.confirm(`Hapus ${type} (mode ${mode})?`)) return
    setError('')
    try {
      const accept = `/api/admin/attract/${mode}${type === 'icon' ? '/icon' : ''}?tenantSlug=${tenantSlug}`
      await api(accept, { method: 'DELETE' })
      setSnack(`${type} (${mode}) dihapus`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal hapus')
    }
  }

  const renderAsset = (type: 'background' | 'icon', mode: 'regular' | 'event') => {
    const modeInfo = status?.[mode]?.[type]
    const has = !!modeInfo?.has
    const isVideo = !!modeInfo?.mediaType?.startsWith('video/')
    const label = `${type === 'background' ? 'Background' : 'Icon'} (${mode})`
    return (
      <Paper key={label} variant="outlined" sx={{ p: 2, width: '100%' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography fontWeight={600}>{label}</Typography>
          <Chip size="small" color={has ? 'success' : 'default'} label={has ? 'Ada' : 'Kosong'} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {has && (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {type === 'background' ? (
                isVideo
                  ? <Box sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}><MovieIcon fontSize="small" /> Video attract</Box>
                  : <img src={assetUrl(type, mode, Date.now())} alt={label} style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <img src={assetUrl(type, mode, Date.now())} alt={label} style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 4, border: '1px solid #eee' }} />
                  <Chip size="small" icon={<ImageIcon />} label={modeInfo?.mediaType || ''} variant="outlined" />
                </Box>
              )}
            </Box>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button
              component="label" size="small" variant="contained"
              startIcon={<CloudUploadIcon />} disabled={uploading}
            >
              {has ? 'Ganti' : 'Upload'}
              <input type="file" hidden
                accept={type === 'background' ? 'image/*,video/*' : 'image/*'}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(type, mode, f); e.target.value = '' }}
              />
            </Button>
            {has && (
              <Button size="small" color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => handleDelete(type, mode)} disabled={uploading}>
                Hapus
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    )
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={1}>Attract Screen</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Kelola background &amp; ikon layar awal (attract) untuk tiap mode photo booth. Background bisa gambar atau video; ikon harus gambar.
      </Typography>

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

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" fontWeight={600} mb={1}>Mode Regular</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {renderAsset('background', 'regular')}
              {renderAsset('icon', 'regular')}
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" fontWeight={600} mb={1}>Mode Event</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {renderAsset('background', 'event')}
              {renderAsset('icon', 'event')}
            </Box>
          </Grid>
        </Grid>
      )}

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
