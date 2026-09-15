import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Box, Paper, Typography, Grid, Alert, Chip, TextField, MenuItem,
  LinearProgress, Button, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, Snackbar, CircularProgress,
} from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import DevicesIcon from '@mui/icons-material/Devices'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { api, myTenantsApi, boothApi, subscriptionApi, type TenantStatusKind } from '@/api/client'
import type { BoothDevice, PairingCode } from '@/types'
import { useAuth } from '@/context/AuthContext'

interface OverviewStats {
  tenants: number
  photos: number
  transactions: number
  revenue: number
  trend: { label: string; prints: number; revenue: number }[]
}

interface TenantInfo {
  slug: string
  name: string
  active: boolean
  has_pin: boolean
  created_at: string
}

interface PerTenantStats {
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

interface TenantOption {
  slug: string
  name: string
}

// --- Status tenant -> label + warna chip MUI ---
function statusMeta(status?: TenantStatusKind) {
  switch (status) {
    case 'pending': return { label: 'Menunggu Persetujuan', color: 'warning' as const }
    case 'rejected': return { label: 'Ditolak', color: 'error' as const }
    case 'trial': return { label: 'Trial', color: 'info' as const }
    case 'active': return { label: 'Aktif', color: 'success' as const }
    case 'expired': return { label: 'Expired', color: 'error' as const }
    case 'suspended': return { label: 'Suspended', color: 'default' as const }
    default: return { label: 'Tidak diketahui', color: 'default' as const }
  }
}

// --- Booth & Perangkat: helper tampilan ---
// Mask fingerprint: tampil 8 char pertama + ellipsis (kalau device_name kosong).
function maskFp(fp: string): string {
  return fp.length > 8 ? `${fp.slice(0, 8)}…` : fp
}

// Device dianggap online kalau heartbeat terakhir < 5 menit.
function isDeviceOnline(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'belum pernah'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff) || diff < 60_000) return 'baru saja'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} menit lalu`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} jam lalu`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} hari lalu`
  return new Date(iso).toLocaleDateString('id-ID')
}

// Countdown MM:SS dari sisa milidetik.
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Midtrans Snap loader ─────────────────────────────────────────────
// Script Snap dimuat dinamis & di-dedupe per URL supaya tidak dobel walau
// tombol perpanjang diklik berkali-kali.
const SNAP_SANDBOX_URL = 'https://app.sandbox.midtrans.com/snap/snap.js'
const SNAP_PRODUCTION_URL = 'https://app.midtrans.com/snap/snap.js'
const snapScriptPromises = new Map<string, Promise<void>>()

function loadSnapScript(src: string, clientKey: string): Promise<void> {
  if (window.snap) return Promise.resolve()
  const cached = snapScriptPromises.get(src)
  if (cached) return cached
  const p = new Promise<void>((resolve, reject) => {
    // Dedupe kalau tag script-nya sudah ada di DOM (mis. HMR / navigasi ulang).
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Gagal memuat Midtrans Snap')))
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    if (clientKey) el.setAttribute('data-client-key', clientKey)
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('Gagal memuat Midtrans Snap'))
    document.head.appendChild(el)
  })
  snapScriptPromises.set(src, p)
  return p
}

// --- Reusable stat card (super: global overview / non-super: per-tenant) ---
function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Grid item xs={6} md={3}>
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h4" fontWeight={800}>{value}</Typography>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      </Paper>
    </Grid>
  )
}

export default function Dashboard() {
  const { user, userAuth, redeemCode, refreshStatus } = useAuth()
  const isSuper = user?.role === 'super_admin'
  const hasTenant = userAuth.hasTenant
  const userTenant = userAuth.tenant
  const tenantStatus = userTenant?.status
  const meta = statusMeta(tenantStatus)
  // Subscription aktif = status 'active' DAN punya tanggal berakhir langganan.
  const isSubscriptionActive = tenantStatus === 'active' && !!userTenant?.subscription_ends_at
  // Card aktivasi hanya untuk user vendor yang sudah punya tenant — bukan super_admin
  // (super_admin cuma punya admin_session, redeem-nya bakal 401).
  const isVendorUser = userAuth.user?.role === 'tenant_admin'
  // pending/rejected belum boleh aktivasi — biar user fokus nunggu tinjauan admin.
  const isPendingOrRejected = tenantStatus === 'pending' || tenantStatus === 'rejected'
  // Booth cuma bisa dibuka setelah akun tidak pending/rejected.
  const boothLinkDisabled = isPendingOrRejected
  const showActivationCard = isVendorUser && hasTenant && !isSubscriptionActive && !isPendingOrRejected
  // Tombol self-pay perpanjangan: vendor dengan tenant saat trial/active.
  // Expired juga ditampilkan (bayar = re-aktivasi); pending/rejected/suspended
  // tidak — biar user fokus nunggu tinjauan admin / hubungi support.
  const canRenew = isVendorUser && hasTenant
    && (tenantStatus === 'trial' || tenantStatus === 'active' || tenantStatus === 'expired')

  // Activation form (input kode 6 karakter alfanumerik)
  const [redeemInput, setRedeemInput] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemSnack, setRedeemSnack] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null)

  // Self-pay perpanjangan langganan (Midtrans Snap / mode mock).
  const [paying, setPaying] = useState(false)
  const [renewPrice, setRenewPrice] = useState<number | null>(null)

  // Harga flat bulanan (server-side env) — cuma buat ditampilkan.
  useEffect(() => {
    if (!canRenew) return
    let alive = true
    subscriptionApi.price()
      .then((p) => { if (alive) setRenewPrice(p.price) })
      .catch(() => { /* harga opsional — biarkan tombol tetap jalan */ })
    return () => { alive = false }
  }, [canRenew])

  const handleRenew = async () => {
    setPaying(true)
    try {
      const res = await subscriptionApi.pay()
      // Mode tanpa server key Midtrans: langsung aktif (simulasi).
      if (res.mock) {
        await refreshStatus()
        setRedeemSnack({ severity: 'success', text: 'Perpanjangan berhasil (simulasi)' })
        return
      }
      if (!res.token) {
        setRedeemSnack({ severity: 'error', text: 'Server tidak mengembalikan token pembayaran' })
        return
      }
      const src = res.is_production ? SNAP_PRODUCTION_URL : SNAP_SANDBOX_URL
      await loadSnapScript(src, res.client_key || '')
      if (!window.snap) {
        setRedeemSnack({ severity: 'error', text: 'Midtrans Snap gagal dimuat' })
        return
      }
      window.snap.pay(res.token, {
        onSuccess: async () => {
          await refreshStatus()
          setRedeemSnack({ severity: 'success', text: 'Perpanjangan berhasil — masa aktif +30 hari' })
        },
        onPending: () => setRedeemSnack({ severity: 'info', text: 'Menunggu pembayaran' }),
        onError: () => setRedeemSnack({ severity: 'error', text: 'Pembayaran gagal, coba lagi ya' }),
      })
    } catch (e: unknown) {
      setRedeemSnack({
        severity: 'error',
        text: e instanceof Error ? e.message : 'Gagal memulai pembayaran',
      })
    } finally {
      setPaying(false)
    }
  }

  const handleActivate = async () => {
    if (!/^[A-Z0-9]{6}$/i.test(redeemInput)) {
      setRedeemSnack({ severity: 'error', text: 'Kode harus 6 karakter huruf/angka' })
      return
    }
    setRedeeming(true)
    try {
      const result = await redeemCode(redeemInput)
      if (result.valid) {
        await refreshStatus()
        setRedeemInput('')
        setRedeemSnack({ severity: 'success', text: 'Berhasil diaktifkan' })
      } else {
        setRedeemSnack({ severity: 'error', text: 'Kode tidak valid atau sudah digunakan' })
      }
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : 'Gagal mengaktifkan kode'
      const isSessionError = /sesi|401|unauthor/i.test(raw)
      setRedeemSnack({
        severity: 'error',
        text: isSessionError
          ? 'Sesi user tidak aktif — silakan login ulang sebagai user vendor'
          : raw,
      })
    } finally {
      setRedeeming(false)
    }
  }

  // Global overview (super only)
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  // Tenant selector (super only)
  const [tenantList, setTenantList] = useState<TenantOption[]>([])
  const [tenantSlug, setTenantSlug] = useState('')
  // Per-tenant detail (both roles once a slug resolves)
  const [tenant, setTenant] = useState<TenantInfo | null>(null)
  const [tstats, setTstats] = useState<PerTenantStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Safety: resolve loading after 5s max to prevent stuck state
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 5000)
    return () => clearTimeout(t)
  }, [])

  // --- Super: fetch global overview once ---
  useEffect(() => {
    if (!isSuper) return
    let alive = true
    api<OverviewStats>('/api/admin/overview')
      .then((d) => { if (alive) setOverview(d) })
      .catch(() => { if (alive) setError('Gagal memuat ringkasan global') })
    return () => { alive = false }
  }, [isSuper])

  // --- Super: load tenant list for selector ---
  useEffect(() => {
    if (!isSuper) return
    let alive = true
    api<{ items: TenantOption[] }>('/api/admin/tenants?pageSize=500')
      .then((d) => {
        if (!alive) return
        const list = d.items.map((t) => ({ slug: t.slug, name: t.name }))
        setTenantList(list)
        if (list.length > 0) setTenantSlug(list[0].slug)
        else setLoading(false)
      })
      .catch(() => { if (alive) { setError('Gagal memuat daftar tenant'); setLoading(false) } })
    return () => { alive = false }
  }, [isSuper])

  // --- Non-super: bind slug from userAuth ---
  useEffect(() => {
    if (isSuper || !userAuth.user) return
    if (!hasTenant) {
      setLoading(false)
      return
    }
    setTenantSlug(userTenant?.slug || '')
  }, [isSuper, userAuth])

  // --- Load per-tenant detail whenever slug changes ---
  const load = useCallback(async () => {
    if (!tenantSlug) return
    setLoading(true)
    setError('')
    try {
      const [t, s] = await Promise.all([
        api<TenantInfo>(`/api/admin/tenant-info/${tenantSlug}`).catch(() => null),
        api<PerTenantStats>(`/api/admin/tenant-stats/${tenantSlug}`).catch(() => null),
      ])
      setTenant(t)
      setTstats(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [tenantSlug])

useEffect(() => { if (tenantSlug) load() }, [load])

  const subtitle = isSuper
    ? 'Ringkasan global, pilih tenant di bawah untuk detail tiap akun.'
    : 'Ringkasan statistik & data akun booth Anda.'

  return (
    <Box>
      {/* 1. Heading */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <HomeIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>Beranda</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={3}>{subtitle}</Typography>

      {/* Banner status akun: menunggu persetujuan / ditolak admin */}
      {!isSuper && tenantStatus === 'pending' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Akun menunggu persetujuan admin — trial dimulai setelah disetujui.
        </Alert>
      )}
      {!isSuper && tenantStatus === 'rejected' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Pendaftaran ditolak admin. Hubungi support.
        </Alert>
      )}

      {/* Banner peringatan kalau masa aktif habis / ditangguhkan */}
      {!isSuper && (tenantStatus === 'expired' || tenantStatus === 'suspended') && (
        <Alert severity={tenantStatus === 'suspended' ? 'warning' : 'error'} sx={{ mb: 2 }}>
          {tenantStatus === 'suspended'
            ? 'Masa aktif akun Anda sedang ditangguhkan. Masukkan kode akses baru di bawah untuk mengaktifkan kembali.'
            : 'Masa aktif akun Anda sudah habis. Photobooth tidak bisa dipakai sampai Anda mengaktifkan kode akses baru.'}
        </Alert>
      )}

      {/* Error banner */}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* 2. Tenant selector (super only) */}
      {isSuper && tenantList.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <TextField
            select
            label="Tenant"
            size="small"
            value={tenantSlug}
            fullWidth
            onChange={(e) => setTenantSlug(e.target.value)}
            helperText="Pilih tenant untuk melihat detail akun."
          >
            {tenantList.map((t) => (
              <MenuItem key={t.slug} value={t.slug}>{t.name} ({t.slug})</MenuItem>
            ))}
          </TextField>
        </Paper>
      )}

      {loading && !tstats && !overview ? (
        <Typography>Memuat data…</Typography>
      ) : (
        <>
          {/* Activation card — tampil selama belum ada subscription aktif (trial/expired/suspended/belum punya tenant) */}
          {showActivationCard && (
            <Paper sx={{ p: 4, mb: 4, textAlign: 'center' }}>
              <VpnKeyIcon color="primary" sx={{ fontSize: 48, mb: 2 }} />
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {hasTenant ? 'Aktifkan / Perpanjang Masa Aktif' : 'Belum Punya Akses Photobooth'}
              </Typography>
              <Typography variant="body1" color="text.secondary" paragraph sx={{ maxWidth: 520, mx: 'auto' }}>
                {hasTenant
                  ? 'Masukkan kode akses 6 karakter yang Anda terima dari admin untuk mengaktifkan atau memperpanjang masa aktif photobooth Anda.'
                  : 'Akun Anda belum terhubung ke akun booth. Masukkan kode akses 6 karakter yang Anda terima dari admin untuk mengaktifkannya.'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', mt: 3 }}>
                <TextField
                  size="small"
                  label="Kode Akses"
                  placeholder="ABC123"
                  value={redeemInput}
                  onChange={(e) => setRedeemInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleActivate() }}
                  inputProps={{ maxLength: 6, autoCapitalize: 'characters', spellCheck: false }}
                  sx={{ width: 200 }}
                />
                <Button
                  variant="contained"
                  onClick={handleActivate}
                  disabled={redeeming || redeemInput.length !== 6}
                  startIcon={redeeming ? <CircularProgress size={16} color="inherit" /> : <VpnKeyIcon />}
                >
                  {redeeming ? 'Mengaktifkan…' : 'Aktifkan'}
                </Button>
              </Box>
            </Paper>
          )}

          {/* Quick bar: tenant identity + aksi cepat (combined at top) */}
          {hasTenant && tenant && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="h6" fontWeight={600}>{tenant.name}</Typography>
                    <Chip size="small" label={tenant.slug} />
                    <Chip
                      size="small"
                      color={tenantStatus ? meta.color : (tenant.active ? 'success' : 'default')}
                      label={tenantStatus ? meta.label : (tenant.active ? 'Aktif' : 'Nonaktif')}
                    />
                    {tenantStatus === 'trial' && userTenant && (
                      <Chip
                        size="small" color="info" variant="outlined"
                        label={`Trial — sisa ${userTenant.days_remaining ?? 0} hari lagi`}
                      />
                    )}
                    {tenantStatus === 'active' && userTenant && (
                      <Chip
                        size="small" color="success" variant="outlined"
                        label={`Sisa ${userTenant.days_remaining ?? 0} hari`}
                      />
                    )}
                    {(tenantStatus === 'expired' || tenantStatus === 'suspended') && (
                      <Chip size="small" color="error" variant="outlined" label="Masa aktif habis" />
                    )}
                    {tenant.has_pin && <Chip size="small" color="warning" label="PIN aktif" />}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    Dibuat: {new Date(tenant.created_at).toLocaleString('id-ID')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {boothLinkDisabled ? (
                    <Button variant="contained" size="small" disabled startIcon={<OpenInNewIcon />}>
                      Buka aplikasi booth
                    </Button>
                  ) : (
                    <Button
                      variant="contained" size="small" component="a"
                      href={`https://${tenant.slug}.achipix.web.id`}
                      target="_blank" rel="noreferrer"
                      startIcon={<OpenInNewIcon />}
                    >
                      Buka aplikasi booth
                    </Button>
                  )}
                  {canRenew && (
                    <Button
                      variant="outlined" size="small"
                      color="success"
                      onClick={handleRenew}
                      disabled={paying}
                      startIcon={paying ? <CircularProgress size={16} color="inherit" /> : <AutorenewIcon />}
                    >
                      {paying ? 'Memproses…' : 'Perpanjang 30 Hari'}
                    </Button>
                  )}
                  {canRenew && renewPrice !== null && (
                    <Chip
                      size="small" variant="outlined"
                      label={`Rp ${renewPrice.toLocaleString('id-ID')} / 30 hari`}
                    />
                  )}
                  {isSuper && tenantList.length > 0 && (
                    <Button
                      variant="outlined" size="small"
                      href="#/tenants"
                      startIcon={<HomeIcon />}
                    >
                      Kelola semua tenant
                    </Button>
                  )}
                </Box>
              </Box>
            </Paper>
          )}

          {/* Booth & Perangkat — pairing device booth (hanya vendor user yang punya tenant) */}
          {isVendorUser && hasTenant && <BoothDevicesPanel />}

          {/* 3. Stat cards row */}
          {isSuper && overview ? (
            <Grid container spacing={2} mb={4}>
              <StatCard label="Total Tenant" value={overview.tenants} />
              <StatCard label="Total Foto" value={overview.photos} />
              <StatCard label="Total Cetak" value={overview.transactions} />
              <StatCard label="Pendapatan" value={'Rp ' + overview.revenue.toLocaleString('id-ID')} />
            </Grid>
          ) : null}

          {tstats && (
            <Grid container spacing={2} mb={4}>
              <StatCard label="Total Foto" value={tstats.total_photos} />
              <StatCard label="Total Cetak" value={tstats.total_prints} />
              <StatCard label="Cetak Hari Ini" value={tstats.today_prints} />
              <StatCard
                label="Total Pendapatan"
                value={'Rp ' + Number(tstats.total_revenue).toLocaleString('id-ID')}
              />
            </Grid>
          )}

          {/* 5. Trend chart (super only — per-tenant API has no trend) */}
          {isSuper && overview && overview.trend.length > 0 ? (
            <Paper sx={{ p: 3, mb: 4 }}>
              <Typography variant="h6" fontWeight={600} mb={2}>Tren Cetak &amp; Pendapatan</Typography>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={overview.trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Area
                    type="monotone" dataKey="prints" name="Cetak"
                    stroke="#1976d2" fill="#1976d2" fillOpacity={0.2}
                  />
                  <Area
                    type="monotone" dataKey="revenue" name="Pendapatan"
                    stroke="#ed6c02" fill="#ed6c02" fillOpacity={0.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Paper>
          ) : null}

          {/* 6. Tier usage (non-super only) */}
          {!isSuper && tenant && <TierUsagePanel />}

          {/* 7. My Tenants (non-super only; super actions live in the quick bar above) */}
          {!isSuper && <MyTenantsPanel />}

          {!loading && !tenant && !overview && !error && (
            <Alert severity="info">
              {isSuper ? 'Pilih tenant di atas untuk melihat ringkasan.' : 'Data akun booth belum tersedia.'}
            </Alert>
          )}
        </>
      )}

      {/* Snackbar hasil aktivasi kode */}
      <Snackbar
        open={!!redeemSnack}
        autoHideDuration={4000}
        onClose={() => setRedeemSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={redeemSnack?.severity} onClose={() => setRedeemSnack(null)}>
          {redeemSnack?.text}
        </Alert>
      </Snackbar>
    </Box>
  )
}

// --- Tier usage progress (non-super) ---
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
        Pemakaian sumber daya akun booth Anda terhadap batas pricing tier:
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
      setSnack({ open: true, msg: 'Akun booth berhasil dibuat!', sev: 'success' })
      load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal membuat akun booth'
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
      setSnack({ open: true, msg: 'Akun booth dihapus.', sev: 'success' })
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
        <Typography variant="h6" fontWeight={600} mb={2}>Akun Booth Saya</Typography>
        <Typography variant="body2" color="text.secondary">Memuat...</Typography>
      </Paper>
    )
  }

  const myItems = data?.items ?? []

  return (
    <>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>Akun Booth Saya</Typography>
          <Button
            variant="contained" size="small" startIcon={<AddIcon />}
            disabled={atLimit}
            onClick={() => setDialogOpen(true)}
          >
            Tambah Akun Booth
          </Button>
        </Box>

        {data?.max !== null && data?.max !== undefined && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Akun booth yang dibuat</Typography>
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
                Batas tier tercapai. Upgrade tier untuk menambah akun booth.
              </Typography>
            )}
          </Box>
        )}

        {myItems.length === 0 ? (
          <Alert severity="info">Belum ada akun booth. Klik "Tambah Akun Booth" untuk membuat akun booth pertama Anda.</Alert>
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
        <DialogTitle>Tambah Akun Booth Baru</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField
            label="Nama Akun Booth" size="small" fullWidth required
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Contoh: Wedding Pack A"
          />
          <TextField
            label="Slug URL" size="small" fullWidth required
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
            helperText="URL subdomain akun booth Anda"
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
            {saving ? 'Menyimpan...' : 'Buat Akun Booth'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog delete confirm */}
      <Dialog open={!!deleteSlug} onClose={() => setDeleteSlug(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Yakin hapus akun booth?</DialogTitle>
        <DialogContent>
          <Alert severity="warning">Akun booth "{deleteSlug}" dan semua datanya akan dihapus permanen.</Alert>
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

// --- Booth & Perangkat (non-super saja; backend butuh user_session vendor) ---
// List device ter-pair + generate kode pairing (TTL pendek, sekali pakai) + revoke.
function BoothDevicesPanel() {
  const [devices, setDevices] = useState<BoothDevice[]>([])
  const [codes, setCodes] = useState<PairingCode[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<{ code: string; expires_at: string } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revokeDeviceId, setRevokeDeviceId] = useState<number | null>(null)
  const [revokingDevice, setRevokingDevice] = useState(false)
  const [deviceLimitError, setDeviceLimitError] = useState('')
  const [snack, setSnack] = useState<{ msg: string; severity: 'success' | 'error' | 'info' } | null>(null)
  // Ticker buat countdown kode pairing.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([boothApi.listDevices(), boothApi.listPairingCodes()])
      setDevices(d.items ?? [])
      setCodes(c.items ?? [])
    } catch (e) {
      setSnack({ msg: e instanceof Error ? e.message : 'Gagal memuat data booth', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Kode yang masih berlaku: aktif, belum dipakai, belum kadaluarsa.
  const activeCodes = codes.filter(
    (c) => c.active && !c.used_at && new Date(c.expires_at).getTime() > now,
  )

  const toErrorSnack = (e: unknown, fallback: string) => {
    const raw = e instanceof Error ? e.message : fallback
    // Limit 1 device: pesan dari server ditampilkan apa adanya biar jelas.
    const isDeviceLimit = /device lain|sudah terpasang|maksimal 1 device|1 device per akun/i.test(raw)
    if (isDeviceLimit) setDeviceLimitError(raw)
    // Backend balas 403 saat tenant suspended/expired — arahkan ke aktivasi.
    const needsActivation = /suspend|expired|langganan|masa aktif|403/i.test(raw)
    setSnack({
      msg: needsActivation ? 'Langganan belum aktif — aktifkan langganan dulu.' : raw,
      severity: 'error',
    })
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setDeviceLimitError('')
    try {
      const res = await boothApi.generatePairingCode()
      setGenerated(res)
      setDialogOpen(true)
      await load()
    } catch (e) {
      toErrorSnack(e, 'Gagal membuat kode pairing')
    } finally {
      setGenerating(false)
    }
  }

  const handleRevokeCode = async (id: number) => {
    try {
      await boothApi.revokePairingCode(id)
      setSnack({ msg: 'Kode pairing dicabut', severity: 'success' })
      await load()
    } catch (e) {
      toErrorSnack(e, 'Gagal mencabut kode pairing')
    }
  }

  const handleRevokeDevice = async () => {
    if (revokeDeviceId == null) return
    setRevokingDevice(true)
    try {
      await boothApi.revokeDevice(revokeDeviceId)
      setRevokeDeviceId(null)
      setSnack({ msg: 'Perangkat diputuskan', severity: 'success' })
      await load()
    } catch (e) {
      toErrorSnack(e, 'Gagal memutuskan perangkat')
    } finally {
      setRevokingDevice(false)
    }
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setSnack({ msg: 'Kode disalin!', severity: 'info' })
    } catch {
      setSnack({ msg: 'Gagal menyalin — salin manual ya', severity: 'error' })
    }
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DevicesIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>Booth &amp; Perangkat</Typography>
        </Box>
        <Button
          variant="contained" size="small"
          startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <VpnKeyIcon />}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Membuat…' : 'Buat Kode Pairing'}
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Hubungkan tablet booth ke akun ini pakai kode pairing. Kode hanya berlaku sekali pakai
        dan otomatis kadaluarsa dalam waktu singkat. Maksimal 1 device per akun.
      </Typography>

      {deviceLimitError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeviceLimitError('')}>
          {deviceLimitError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <>
          <Typography variant="subtitle2" fontWeight={600} mb={1}>Perangkat Terhubung</Typography>
          {devices.length === 0 ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Belum ada perangkat yang terhubung. Buat kode pairing lalu masukkan di booth app.
            </Alert>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
              {devices.map((d) => {
                const online = isDeviceOnline(d.last_seen_at)
                return (
                  <Paper
                    key={d.id} variant="outlined"
                    sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
                  >
                    <Box
                      sx={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        bgcolor: online ? 'success.main' : 'grey.400',
                      }}
                    />
                    <Box sx={{ flex: 1, minWidth: 180 }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography fontWeight={600}>{d.device_name || maskFp(d.device_fp)}</Typography>
                        <Chip size="small" color={online ? 'success' : 'default'} label={online ? 'Online' : 'Offline'} />
                        {!d.is_active && <Chip size="small" color="error" label="Dicabut" />}
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        terakhir aktif: {relativeTime(d.last_seen_at)}{d.last_ip ? ` • ${d.last_ip}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Dipasangkan {new Date(d.paired_at).toLocaleString('id-ID')}
                      </Typography>
                    </Box>
                    <Button size="small" color="error" variant="outlined" onClick={() => setRevokeDeviceId(d.id)}>
                      Putuskan
                    </Button>
                  </Paper>
                )
              })}
            </Box>
          )}

          {activeCodes.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={600} mb={1}>Kode Pairing Aktif</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {activeCodes.map((c) => (
                  <Paper
                    key={c.id} variant="outlined"
                    sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
                  >
                    <Typography sx={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.2em' }}>
                      {c.code}
                    </Typography>
                    <Chip
                      size="small" color="info" variant="outlined"
                      label={`sisa ${formatCountdown(new Date(c.expires_at).getTime() - now)}`}
                    />
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" onClick={() => copyCode(c.code)}>Salin</Button>
                    <Button size="small" color="error" onClick={() => handleRevokeCode(c.id)}>Cabut</Button>
                  </Paper>
                ))}
              </Box>
            </Box>
          )}
        </>
      )}

      {/* Dialog kode pairing (style mirip dialog kode aktivasi) */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Kode Pairing Booth</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Buka booth app di tablet, tap "Hubungkan Booth", lalu masukkan kode ini.
          </Alert>
          <Box sx={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            bgcolor: 'grey.100', borderRadius: 1, p: 2.5, border: '1px solid', borderColor: 'divider',
          }}>
            <Typography
              component="code"
              sx={{ fontFamily: 'monospace', fontSize: '2rem', fontWeight: 700, letterSpacing: '0.35em' }}
            >
              {generated?.code}
            </Typography>
          </Box>
          {generated?.expires_at && (
            <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 2 }}>
              Berlaku {formatCountdown(new Date(generated.expires_at).getTime() - now)} lagi (sekali pakai)
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Tutup</Button>
          <Button
            variant="contained" startIcon={<ContentCopyIcon />}
            onClick={() => generated && copyCode(generated.code)}
          >
            Salin Kode
          </Button>
        </DialogActions>
      </Dialog>

      {/* Konfirmasi putuskan perangkat */}
      <Dialog open={revokeDeviceId != null} onClose={() => setRevokeDeviceId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Putuskan perangkat ini?</DialogTitle>
        <DialogContent>
          <Alert severity="warning">
            Booth di perangkat ini akan terputus dan harus pairing ulang untuk terhubung lagi.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDeviceId(null)}>Batal</Button>
          <Button
            variant="contained" color="error" onClick={handleRevokeDevice}
            disabled={revokingDevice}
            startIcon={revokingDevice ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {revokingDevice ? 'Memutuskan…' : 'Putuskan'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack} autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack?.severity} onClose={() => setSnack(null)}>
          {snack?.msg}
        </Alert>
      </Snackbar>
    </Paper>
  )
}
