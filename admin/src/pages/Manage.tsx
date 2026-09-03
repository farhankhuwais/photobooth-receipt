import { useCallback, useEffect, useState } from 'react'
import { Box, Paper, Typography, Grid, Alert, Chip, Divider, MenuItem, TextField, LinearProgress, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Snackbar } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { api, myTenantsApi } from '@/api/client'
import { useAuth } from '@/context/AuthContext'

interface Stats {
  total_photos: number
  total_prints: number
  total_revenue: number
  today_prints: number
  today_revenue: number
}

interface TierInfo {
  tier: { max_tenants: number; max_photos: number; max_frames: number; max_designs: number; max_presets: number } | null
  usage: { photos: number; frames: number; designs: number; presets: number } | null
}

interface TenantInfo {
  slug: string
  name: string
  active: boolean
  has_pin: boolean
  created_at: string
}

export default function Manage() {
  const { user } = useAuth()
  const isSuper = user?.role === 'super_admin'

  const [tenantList, setTenantList] = useState<{ slug: string; name: string }[]>([])
  const [tenantSlug, setTenantSlug] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [tenant, setTenant] = useState<TenantInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Tentukan tenant target berdasarkan role
  useEffect(() => {
    if (!user) return
    if (isSuper) {
      api<{ items: { slug: string; name: string }[] }>('/api/admin/tenants?pageSize=500')
        .then((d) => {
          const list = d.items.map((t) => ({ slug: t.slug, name: t.name }))
          setTenantList(list)
          if (list.length > 0) setTenantSlug(list[0].slug)
          else setLoading(false)
        })
        .catch(() => { setError('Gagal memuat daftar tenant'); setLoading(false) })
    } else {
      if (!user.tenant_id) { setError('Akun Anda belum terikat ke tenant.'); setLoading(false); return }
      setTenantSlug(user.tenant_id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const load = useCallback(async () => {
    if (!tenantSlug) return
    setLoading(true)
    setError('')
    try {
      const [t, s] = await Promise.all([
        api<TenantInfo>(`/api/admin/tenant-info/${tenantSlug}`).catch(() => null),
        api<Stats>(`/api/admin/tenant-stats/${tenantSlug}`).catch(() => null),
      ])
      setTenant(t)
      setStats(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => { if (tenantSlug) load() }, [load])

  if (user && !isSuper && !user.tenant_id) {
    return <Alert severity="warning">Akun Anda belum terikat ke tenant.</Alert>
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={1}>Kelola Tenant</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {isSuper
          ? 'Lihat ringkasan statistik & data tiap tenant.'
          : 'Ringkasan statistik & data tenant Anda.'}
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

      {tenant && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="h6" fontWeight={600}>{tenant.name}</Typography>
            <Chip size="small" label={tenant.slug} />
            <Chip
              size="small"
              color={tenant.active ? 'success' : 'default'}
              label={tenant.active ? 'Aktif' : 'Nonaktif'}
            />
            {tenant.has_pin && <Chip size="small" color="warning" label="PIN aktif" />}
          </Box>
          <Typography variant="body2" color="text.secondary">
            URL: <a href={`https://${tenant.slug}.achipix.web.id`} target="_blank" rel="noreferrer" style={{ color: '#1976d2' }}>
              https://{tenant.slug}.achipix.web.id
            </a>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Dibuat: {new Date(tenant.created_at).toLocaleString('id-ID')}
          </Typography>
        </Paper>
      )}

      {stats && (
        <Grid container spacing={2} mb={3}>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>{stats.total_photos}</Typography>
              <Typography variant="body2" color="text.secondary">Total Foto</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>{stats.total_prints}</Typography>
              <Typography variant="body2" color="text.secondary">Total Cetak</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>{stats.today_prints}</Typography>
              <Typography variant="body2" color="text.secondary">Cetak Hari Ini</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>
                Rp {Number(stats.total_revenue).toLocaleString('id-ID')}
              </Typography>
              <Typography variant="body2" color="text.secondary">Total Revenue</Typography>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Tier usage progress — hanya untuk tenant_admin */}
      {!isSuper && tenant && (
        <TierUsagePanel />
      )}

      {/* My Tenants — hanya untuk tenant_admin */}
      {!isSuper && (
        <MyTenantsPanel />
      )}

      {tenant && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={600} mb={2}>Akses Cepat</Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary" mb={2}>
            Untuk mengelola foto, frame, presets, dan setting aplikasi, silakan buka subdomain tenant langsung atau gunakan menu di sidebar.
          </Typography>
          <Box sx={{ mt: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <a
              href={`https://${tenant.slug}.achipix.web.id`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#1976d2', textDecoration: 'underline' }}
            >
              Buka aplikasi booth →
            </a>
          </Box>
        </Paper>
      )}

      {!loading && !tenant && !error && (
        <Alert severity="info">Pilih tenant di atas untuk melihat ringkasan.</Alert>
      )}
    </Box>
  )
}

function UsageRow({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0
  const color = pct >= 100 ? 'error' : pct >= 80 ? 'warning' : 'primary'
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" fontWeight={600}>{used} / {max}</Typography>
      </Box>
      <LinearProgress variant="determinate" value={pct} color={color} sx={{ borderRadius: 1 }} />
    </Box>
  )
}

function TierUsagePanel() {
  const [data, setData] = useState<TierInfo | null>(null)

  useEffect(() => {
    api<TierInfo>('/api/admin/my-tier')
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data?.tier) {
    return (
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={1}>Limit Tier</Typography>
        <Alert severity="info">Akun ini belum memiliki pricing tier — tidak ada batasan resource.</Alert>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Hubungi super admin untuk meng-assign tier (Basic / Premium / Profesional).
        </Typography>
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" fontWeight={600} mb={1}>Limit Tier</Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Pemakaian sumber daya tenant Anda terhadap batas pricing tier:
      </Typography>
      <UsageRow label="Foto" used={data.usage?.photos || 0} max={data.tier.max_photos} />
      <UsageRow label="Frames" used={data.usage?.frames || 0} max={data.tier.max_frames} />
      <UsageRow label="Designs" used={data.usage?.designs || 0} max={data.tier.max_designs} />
      <UsageRow label="Presets" used={data.usage?.presets || 0} max={data.tier.max_presets} />
    </Paper>
  )
}

interface MyTenantItem {
  slug: string
  name: string
  active: boolean
  access_pin: string | null
  created_at: string
}

function MyTenantsPanel() {
  const [data, setData] = useState<{
    items: MyTenantItem[]
    tier: { max_tenants: number } | null
    used: number
    max: number | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ slug: '', name: '', access_pin: '' })
  const [saving, setSaving] = useState(false)
  const [snack, setSnack] = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({ open: false, msg: '', sev: 'success' })
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await myTenantsApi.get()
      setData(d)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.slug || !form.name) return
    setSaving(true)
    try {
      await myTenantsApi.create(form)
      setDialogOpen(false)
      setForm({ slug: '', name: '', access_pin: '' })
      setSnack({ open: true, msg: 'Tenant berhasil dibuat!', sev: 'success' })
      load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal membuat tenant'
      setSnack({ open: true, msg, sev: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteSlug) return
    try {
      await myTenantsApi.remove(deleteSlug)
      setDeleteSlug(null)
      setSnack({ open: true, msg: 'Tenant dihapus.', sev: 'success' })
      load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menghapus'
      setSnack({ open: true, msg, sev: 'error' })
    }
  }

  const atLimit = !!data && data.max !== null && data.used >= data.max

  if (loading) {
    return (
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={2}>Tenant Saya</Typography>
        <Typography variant="body2" color="text.secondary">Memuat...</Typography>
      </Paper>
    )
  }

  const myItems = data?.items ?? []

  return (
    <>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>Tenant Saya</Typography>
          <Button
            variant="contained" size="small" startIcon={<AddIcon />}
            disabled={atLimit}
            onClick={() => setDialogOpen(true)}
          >
            Tambah Tenant
          </Button>
        </Box>

        {data?.max !== null && data?.max !== undefined && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Tenant yang dibuat</Typography>
              <Typography variant="body2" fontWeight={600}>{data.used} / {data.max}</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (data.used / (data.max || 1)) * 100)}
              color={atLimit ? 'error' : 'primary'}
              sx={{ borderRadius: 1 }}
            />
            {atLimit && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                Batas tier tercapai. Upgrade tier untuk menambah tenant.
              </Typography>
            )}
          </Box>
        )}

        {myItems.length === 0 ? (
          <Alert severity="info">Belum ada tenant. Klik "Tambah Tenant" untuk membuat tenant pertama Anda.</Alert>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {myItems.map((t) => (
              <Paper key={t.slug} variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography fontWeight={600}>{t.name}</Typography>
                    <Chip size="small" label={t.slug} />
                    <Chip size="small" color={t.active ? 'success' : 'default'} label={t.active ? 'Aktif' : 'Nonaktif'} />
                    {t.access_pin && <Chip size="small" color="warning" label="PIN" />}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {t.slug}.achipix.web.id &nbsp;|&nbsp; Dibuat {new Date(t.created_at).toLocaleDateString('id-ID')}
                  </Typography>
                </Box>
                <IconButton size="small" component="a" href={`https://${t.slug}.achipix.web.id`} target="_blank" rel="noreferrer" sx={{ color: 'text.secondary' }}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => setDeleteSlug(t.slug)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        )}
      </Paper>

      {/* Dialog create */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Tambah Tenant Baru</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField
            label="Nama Tenant" size="small" fullWidth required
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Contoh: Wedding Pack A"
          />
          <TextField
            label="Slug URL" size="small" fullWidth required
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
            helperText="achipix.web.id/admin/#/booth/{slug}"
            placeholder="Contoh: wedding-pack-a"
          />
          <TextField
            label="PIN Akses (opsional)" size="small" fullWidth
            value={form.access_pin} onChange={(e) => setForm({ ...form, access_pin: e.target.value })}
            helperText="Kosongkan jika tidak pakai PIN"
            placeholder="4-6 digit"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving || !form.slug || !form.name}>
            {saving ? 'Menyimpan...' : 'Buat Tenant'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog delete confirm */}
      <Dialog open={!!deleteSlug} onClose={() => setDeleteSlug(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Yakin hapus tenant?</DialogTitle>
        <DialogContent>
          <Alert severity="warning">Tenant "{deleteSlug}" dan semua datanya akan dihapus permanen.</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteSlug(null)}>Batal</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Hapus</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open} autoHideDuration={4000}
        onClose={() => setSnack({ ...snack, open: false })}
        message={snack.msg}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  )
}
