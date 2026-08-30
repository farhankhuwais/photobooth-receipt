// admin/src/pages/LicenseCodes.tsx
// Generate + manage HMAC-signed license codes for vendors
// super_admin only

import { useState, useEffect } from 'react'
import {
  Box, Paper, Typography, Button, TextField, MenuItem, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  TablePagination,
  IconButton, Tooltip, Snackbar, Alert, CircularProgress, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import ContentCopy from '@mui/icons-material/ContentCopy'
import VpnKey from '@mui/icons-material/VpnKey'
import Block from '@mui/icons-material/Block'
import CheckCircle from '@mui/icons-material/CheckCircle'
import HourglassEmpty from '@mui/icons-material/HourglassEmpty'
import { licenseApi, licenseSecretApi, type LicenseCode } from '@/api/client'

export default function LicenseCodes() {
  const [vendorId, setVendorId] = useState('')
  const [expiryDays, setExpiryDays] = useState(30)
  const [tierSlug, setTierSlug] = useState('')
  const [generatedCode, setGeneratedCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [snack, setSnack] = useState<{ msg: string; severity: 'success' | 'error' | 'info' } | null>(null)
  const [codes, setCodes] = useState<LicenseCode[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)        // 0-based, TablePagination convention
  const [rowsPerPage, setRowsPerPage] = useState(20)

  const loadList = async () => {
    setListLoading(true)
    try {
      const res = await licenseApi.list(rowsPerPage, page * rowsPerPage)
      setCodes(res.items)
      setTotal(res.total)
    } catch (e) {
      setSnack({ msg: (e as Error).message, severity: 'error' })
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rowsPerPage])

  const handleGenerate = async () => {
    if (!vendorId.trim()) {
      setSnack({ msg: 'Vendor ID wajib diisi', severity: 'error' })
      return
    }
    setLoading(true)
    try {
      const res = await licenseApi.generate(vendorId.trim(), expiryDays, tierSlug || undefined)
      setGeneratedCode(res.code)
      setSnack({ msg: 'Kode license berhasil di-generate!', severity: 'success' })
      setVendorId('')
      setPage(0)            // jump back to first page so user sees new code
      loadList()
    } catch (e) {
      setSnack({ msg: (e as Error).message || 'Gagal generate kode', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async (id: number) => {
    if (!confirm('Yakin revoke kode ini? Kode akan langsung nonaktif dan tidak bisa divalidasi.')) return
    try {
      await licenseApi.revoke(id)
      setSnack({ msg: 'Kode di-revoke', severity: 'success' })
      loadList()
    } catch (e) {
      setSnack({ msg: (e as Error).message, severity: 'error' })
    }
  }

  // ── Secret version management ────────────────────────────────────────────────
  const [secrets, setSecrets] = useState<{
    version: number; created_at: string; is_current: boolean
    rotated_by_email: string | null; rotated_from: number | null
  }[]>([])
  const [secretsLoading, setSecretsLoading] = useState(false)
  const [showRotate, setShowRotate] = useState(false)
  const [rotatePassword, setRotatePassword] = useState('')
  const [rotating, setRotating] = useState(false)

  const loadSecrets = async () => {
    setSecretsLoading(true)
    try {
      const res = await licenseSecretApi.listVersions()
      setSecrets(res.versions)
    } catch (e) {
      setSnack({ msg: (e as Error).message, severity: 'error' })
    } finally {
      setSecretsLoading(false)
    }
  }

  const handleRotate = async () => {
    if (!rotatePassword) return
    setRotating(true)
    try {
      const res = await licenseSecretApi.rotate(rotatePassword)
      setSnack({ msg: res.message, severity: 'success' })
      setShowRotate(false)
      setRotatePassword('')
      loadSecrets()
    } catch (e) {
      setSnack({ msg: (e as Error).message, severity: 'error' })
    } finally {
      setRotating(false)
    }
  }

  useEffect(() => { loadSecrets() }, [])

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setSnack({ msg: 'Kode disalin!', severity: 'info' })
  }

  const statusChip = (c: LicenseCode) => {
    if (c.revoked_at) return <Chip label="Revoked" size="small" color="error" icon={<Block />} />
    if (c.redeemed_at) return <Chip label="Redeemed" size="small" color="success" icon={<CheckCircle />} />
    if (new Date(c.expires_at) < new Date()) return <Chip label="Expired" size="small" color="warning" />
    return <Chip label="Active" size="small" color="primary" icon={<HourglassEmpty />} />
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <VpnKey color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Kode Lisensi
        </Typography>
      </Box>

      {/* Generator */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={2}>Generate Kode Baru</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Kode akses HMAC-signed untuk vendor. Berlaku untuk satu device, satu kali aktivasi.
          Setelah di-redeem, otomatis terbuat tenant + tenant_admin user.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} flexWrap="wrap" useFlexGap>
          <TextField
            label="Vendor ID"
            placeholder="Contoh: vendor-budi, paket-wedding-2026"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            size="small"
            sx={{ minWidth: 260 }}
          />
          <TextField
            select
            label="Durasi"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            size="small"
            sx={{ minWidth: 160 }}
          >
            <MenuItem value={7}>7 hari</MenuItem>
            <MenuItem value={14}>14 hari</MenuItem>
            <MenuItem value={30}>30 hari</MenuItem>
            <MenuItem value={60}>60 hari</MenuItem>
            <MenuItem value={90}>90 hari</MenuItem>
            <MenuItem value={180}>180 hari</MenuItem>
            <MenuItem value={365}>365 hari</MenuItem>
          </TextField>
          <TextField
            label="Tier (opsional)"
            placeholder="basic / premium / profesional"
            value={tierSlug}
            onChange={(e) => setTierSlug(e.target.value)}
            size="small"
            sx={{ minWidth: 200 }}
            helperText="Slug tier yang akan di-assign saat redeem"
          />
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={loading || !vendorId.trim()}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <VpnKey />}
          >
            {loading ? 'Generate...' : 'Generate Kode'}
          </Button>
        </Stack>

        {generatedCode && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
              Kode License (salin dan kirim ke vendor):
            </Typography>
            <Box sx={{
              display: 'flex', gap: 1, alignItems: 'center',
              bgcolor: 'grey.100', borderRadius: 1, p: 1.5,
              border: '1px solid', borderColor: 'divider',
            }}>
              <Typography
                component="code"
                sx={{ fontFamily: 'monospace', fontSize: '0.75rem', flex: 1, wordBreak: 'break-all' }}
              >
                {generatedCode}
              </Typography>
              <Tooltip title="Salin">
                <Button size="small" variant="outlined" onClick={() => copyCode(generatedCode)}>
                  <ContentCopy fontSize="small" />
                </Button>
              </Tooltip>
            </Box>
          </Box>
        )}
      </Paper>

      {/* List of issued codes */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>Kode yang Sudah Diterbitkan</Typography>
          <Button size="small" onClick={loadList} disabled={listLoading}>
            {listLoading ? 'Loading...' : 'Refresh'}
          </Button>
        </Box>

        {listLoading && codes.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : codes.length === 0 ? (
          <Alert severity="info">Belum ada kode yang diterbitkan.</Alert>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Vendor</TableCell>
                    <TableCell>Tier</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Diterbitkan</TableCell>
                    <TableCell>Expired</TableCell>
                    <TableCell>Redeemed by</TableCell>
                    <TableCell>Tenant</TableCell>
                    <TableCell align="right">Aksi</TableCell>
                  </TableRow>
                </TableHead>
              <TableBody>
                {codes.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{c.vendor_id}</TableCell>
                    <TableCell>{c.tier_slug || <Typography variant="caption" color="text.disabled">—</Typography>}</TableCell>
                    <TableCell>{statusChip(c)}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(c.issued_at).toLocaleDateString('id-ID')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color={new Date(c.expires_at) < new Date() ? 'error' : 'text.secondary'}>
                        {new Date(c.expires_at).toLocaleDateString('id-ID')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {c.redeemed_by ? (
                        <Typography variant="caption">{c.redeemed_by}</Typography>
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.redeemed_tenant ? (
                        <Chip
                          label={c.redeemed_tenant}
                          size="small"
                          variant="outlined"
                          onClick={() => window.open(`https://${c.redeemed_tenant}.achipix.web.id`, '_blank')}
                          sx={{ cursor: 'pointer' }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {c.active && !c.redeemed_at && (
                        <Tooltip title="Revoke (nonaktifkan)">
                          <IconButton size="small" color="error" onClick={() => handleRevoke(c.id)}>
                            <Block fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10))
              setPage(0)
            }}
            rowsPerPageOptions={[10, 20, 50, 100]}
            labelRowsPerPage="Per halaman:"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} dari ${count}`}
          />
          </>
        )}
      </Paper>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack?.severity} onClose={() => setSnack(null)}>
          {snack?.msg}
        </Alert>
      </Snackbar>

      {/* ── Secret management ─────────────────────────────────────────────────── */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6" fontWeight={600}>Manajemen Secret</Typography>
            <Typography variant="caption" color="text.secondary">(versioned — kode lama tetap valid)</Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            onClick={loadSecrets}
            disabled={secretsLoading}
          >
            {secretsLoading ? 'Loading...' : 'Refresh'}
          </Button>
        </Box>

        {/* Secret versions list */}
        {secretsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={20} />
          </Box>
        ) : secrets.length === 0 ? (
          <Alert severity="info">Belum ada data secret.</Alert>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Versi</TableCell>
                  <TableCell>Dibuat</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Di-rotasi oleh</TableCell>
                  <TableCell>Rotated from</TableCell>
                  <TableCell align="right">Aksi</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {secrets.map((s) => (
                  <TableRow key={s.version} hover>
                    <TableCell>
                      <Chip
                        label={`v${s.version}`}
                        size="small"
                        color={s.is_current ? 'success' : 'default'}
                        variant={s.is_current ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {new Date(s.created_at).toLocaleString('id-ID')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {s.is_current
                        ? <Chip label="Aktif" size="small" color="success" />
                        : <Chip label="Non-aktif" size="small" color="default" />}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{s.rotated_by_email || '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{s.rotated_from ? `v${s.rotated_from}` : 'Initial'}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      {s.is_current && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          onClick={() => setShowRotate(true)}
                        >
                          Rotate Secret
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Rotate confirmation dialog */}
        <Dialog open={showRotate} onClose={() => setShowRotate(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Rotate License Secret</DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>Peringatan:</strong> Setelah rotasi, semua kode BARU akan di-sign dengan secret baru.
              Kode LAMA tetap valid karena server menyimpan semua secret version.
              Frontend bundle (offline validation) tetap pakai secret lama — rebuild dengan
              <code>VITE_LICENSE_SECRET</code> baru jika ingin update offline validation.
            </Alert>
            <TextField
              fullWidth
              label="Konfirmasi password Anda"
              type="password"
              value={rotatePassword}
              onChange={(e) => setRotatePassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRotate() }}
              sx={{ mt: 1 }}
              autoFocus
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setShowRotate(false); setRotatePassword('') }}>Batal</Button>
            <Button
              variant="contained"
              color="warning"
              onClick={handleRotate}
              disabled={rotating || !rotatePassword}
            >
              {rotating ? 'Merotasi...' : 'Rotate Sekarang'}
            </Button>
          </DialogActions>
        </Dialog>
      </Paper>
    </Box>
  )
}
