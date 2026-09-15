// admin/src/pages/LicenseCodes.tsx
// Kode Aktivasi — generate + kelola kode aktivasi 6 digit untuk vendor.
// Satu-satunya jalur aktivasi: admin generate di sini → kirim kode → vendor
// masukkan di Dashboard. HMAC legacy sudah tidak digenerate dari halaman ini.
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
import EventBusy from '@mui/icons-material/EventBusy'
import { licenseApi, userApi } from '@/api/client'
import type { LicenseCode } from '@/types'

interface GeneratedCode {
  code: string
  expiresAt: string | null
  email: string
}

function isExpired(c: LicenseCode): boolean {
  return new Date(c.expires_at) < new Date()
}

// Kode 6 digit: secret_version NULL & code_plain 6 digit. Sisanya = legacy HMAC.
function isLegacy(c: LicenseCode): boolean {
  return c.secret_version != null || !c.code_plain || !/^\d{6}$/.test(c.code_plain)
}

export default function LicenseCodes() {
  const [expiryDays, setExpiryDays] = useState(7)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedCode | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [snack, setSnack] = useState<{ msg: string; severity: 'success' | 'error' | 'info' } | null>(null)
  const [codes, setCodes] = useState<LicenseCode[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)        // 0-based, TablePagination convention
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [users, setUsers] = useState<{ id: number; email: string; name: string }[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)

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

  // Load users untuk dropdown tujuan kode
  useEffect(() => {
    userApi.list({ page: 1, pageSize: 500 })
      .then(res => setUsers(res.items.map(u => ({ id: u.id, email: u.email, name: u.name || u.email }))))
      .catch(e => setSnack({ msg: (e as Error).message, severity: 'error' }))
  }, [])

  const handleGenerate = async () => {
    if (!selectedUserId) {
      setSnack({ msg: 'User wajib dipilih', severity: 'error' })
      return
    }
    setGenerating(true)
    try {
      const res = await licenseApi.generate(selectedUserId, expiryDays)
      const user = users.find(u => u.id === selectedUserId)
      setGenerated({ code: res.code, expiresAt: res.expires_at ?? null, email: user?.email || '' })
      setDialogOpen(true)
      setSnack({ msg: `Kode aktivasi dibuat untuk ${user?.email || 'user'}!`, severity: 'success' })
      setSelectedUserId(null)
      setPage(0)            // balik ke halaman pertama supaya kode baru kelihatan
      loadList()
    } catch (e) {
      setSnack({ msg: (e as Error).message || 'Gagal generate kode', severity: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  const handleRevoke = async (id: number) => {
    if (!confirm('Yakin cabut kode ini? Kode akan langsung nonaktif dan tidak bisa dipakai lagi.')) return
    try {
      await licenseApi.revoke(id)
      setSnack({ msg: 'Kode dicabut', severity: 'success' })
      loadList()
    } catch (e) {
      setSnack({ msg: (e as Error).message, severity: 'error' })
    }
  }

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setSnack({ msg: 'Kode disalin!', severity: 'info' })
  }

  const statusChip = (c: LicenseCode) => {
    if (!c.active && c.revoked_at) return <Chip label="Dicabut" size="small" color="error" icon={<Block />} />
    if (c.redeemed_at) return <Chip label="Terisi" size="small" color="success" icon={<CheckCircle />} />
    if (isExpired(c)) return <Chip label="Kadaluarsa" size="small" color="warning" icon={<EventBusy />} />
    return <Chip label="Aktif" size="small" color="primary" icon={<HourglassEmpty />} />
  }

  const canRevoke = (c: LicenseCode) => c.active && !c.redeemed_at && !c.revoked_at && !isExpired(c)

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <VpnKey color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Kode Aktivasi
        </Typography>
      </Box>

      {/* Generator */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={2}>Generate Kode Baru</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Buat kode aktivasi 6 digit untuk satu user, lalu kirim kodenya ke vendor.
          Kode berlaku sekali pakai dan otomatis aktif saat dimasukkan di Dashboard.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} flexWrap="wrap" useFlexGap>
          <TextField
            select
            label="User"
            value={selectedUserId ?? ''}
            onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            size="small"
            sx={{ minWidth: 260 }}
            disabled={users.length === 0}
            helperText={users.length === 0 ? 'Memuat daftar user...' : 'User yang akan memakai kode ini'}
          >
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id}>{u.name || u.email}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Durasi"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            size="small"
            sx={{ minWidth: 160 }}
            helperText="Masa aktif setelah diaktifkan"
          >
            <MenuItem value={1}>1 hari</MenuItem>
            <MenuItem value={3}>3 hari</MenuItem>
            <MenuItem value={7}>7 hari</MenuItem>
            <MenuItem value={14}>14 hari</MenuItem>
            <MenuItem value={30}>30 hari</MenuItem>
          </TextField>
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generating || !selectedUserId}
            startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <VpnKey />}
          >
            {generating ? 'Generate...' : 'Generate Kode'}
          </Button>
        </Stack>
      </Paper>

      {/* List kode aktivasi */}
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
                    <TableCell>Kode</TableCell>
                    <TableCell>User Tujuan</TableCell>
                    <TableCell>Tenant</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Dibuat</TableCell>
                    <TableCell>Kedaluarsa</TableCell>
                    <TableCell>Redeem</TableCell>
                    <TableCell align="right">Aksi</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {codes.map((c) => (
                    <TableRow key={c.id} hover>
                      <TableCell sx={{ maxWidth: 160 }}>
                        {isLegacy(c) ? (
                          <Tooltip title="Kode HMAC legacy — tidak dipakai lagi">
                            <Typography variant="caption" color="text.disabled">—(legacy)</Typography>
                          </Tooltip>
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', letterSpacing: '0.08em' }}>
                              {c.code_plain}
                            </Typography>
                            <Tooltip title="Salin kode">
                              <IconButton size="small" onClick={() => copyCode(c.code_plain!)}>
                                <ContentCopy fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>
                        {c.for_user_email || c.vendor_id || c.redeemed_user_email || (
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
                      <TableCell>{statusChip(c)}</TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(c.created_at || c.issued_at).toLocaleDateString('id-ID')}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color={isExpired(c) ? 'error' : 'text.secondary'}>
                          {new Date(c.expires_at).toLocaleDateString('id-ID')}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {c.redeemed_at ? (
                          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Typography variant="caption">
                              {new Date(c.redeemed_at).toLocaleDateString('id-ID')}
                            </Typography>
                            {(c.redeemed_by_email || c.redeemed_by) && (
                              <Typography variant="caption" color="text.secondary">
                                {c.redeemed_by_email || c.redeemed_by}
                              </Typography>
                            )}
                          </Box>
                        ) : (
                          <Typography variant="caption" color="text.disabled">—</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {canRevoke(c) && (
                          <Tooltip title="Cabut kode">
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

      {/* Dialog hasil generate kode 6 digit */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Kode Aktivasi</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Salin dan kirim kode ini ke vendor{generated?.email ? ` (${generated.email})` : ''}.
            Kode hanya berlaku untuk satu kali aktivasi.
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
          {generated?.expiresAt && (
            <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 2 }}>
              Berlaku sampai {new Date(generated.expiresAt).toLocaleDateString('id-ID')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Tutup</Button>
          <Button
            variant="contained"
            startIcon={<ContentCopy />}
            onClick={() => generated && copyCode(generated.code)}
          >
            Salin Kode
          </Button>
        </DialogActions>
      </Dialog>

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
    </Box>
  )
}
