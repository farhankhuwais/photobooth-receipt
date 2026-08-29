import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Alert, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Grid, Chip, Divider,
} from '@mui/material'
import { api } from '@/api/client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

interface TenantBilling {
  slug: string
  name: string
  active: boolean
  created_at: string
  tx_count: number
  total_revenue: number
  mtd_revenue: number
  today_revenue: number
}

const formatIDR = (n: number) => `Rp ${Number(n).toLocaleString('id-ID')}`

const PRICING_TIERS = [
  { tier: 'Free', price: 'Rp 0', features: '1 tenant, 100 foto/bulan, branding default' },
  { tier: 'Starter', price: 'Rp 199.000/bln', features: '1 tenant, unlimited foto, custom branding, PIN gate' },
  { tier: 'Pro', price: 'Rp 499.000/bln', features: '5 tenant, multi-user, AI Gemini, audit log' },
  { tier: 'Enterprise', price: 'Hubungi kami', features: 'Unlimited tenant, dedicated support, SLA' },
]

export default function Billing() {
  const [data, setData] = useState<{ tenants: TenantBilling[]; grand: { total_revenue: number; tx_count: number } } | null>(null)
  const [trend, setTrend] = useState<Array<{ label: string; prints: number; revenue: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, o] = await Promise.all([
        api<{ tenants: TenantBilling[]; grand: { total_revenue: number; tx_count: number } }>('/api/admin/billing'),
        api<{ trend: typeof trend }>('/api/admin/overview'),
      ])
      setData(b)
      setTrend(o.trend || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat billing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>Billing & Revenue</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {data && (
        <Grid container spacing={2} mb={3}>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800} color="primary">
                {formatIDR(data.grand.total_revenue)}
              </Typography>
              <Typography variant="body2" color="text.secondary">Total Revenue</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>{data.grand.tx_count}</Typography>
              <Typography variant="body2" color="text.secondary">Total Transaksi</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>
                {formatIDR(data.tenants.reduce((s, t) => s + t.mtd_revenue, 0))}
              </Typography>
              <Typography variant="body2" color="text.secondary">Bulan Ini (MTD)</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>{data.tenants.length}</Typography>
              <Typography variant="body2" color="text.secondary">Total Tenant</Typography>
            </Paper>
          </Grid>
        </Grid>
      )}

      {trend.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" fontWeight={600} gutterBottom>Tren Revenue (7 hari terakhir)</Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number, n: string) => n === 'revenue' ? formatIDR(v) : v}
                />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#1976d2" strokeWidth={2} />
                <Line type="monotone" dataKey="prints" name="Cetak" stroke="#9c27b0" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Revenue per Tenant</Typography>
        <Divider sx={{ mb: 2 }} />
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Tenant</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Transaksi</TableCell>
                <TableCell align="right">Hari Ini</TableCell>
                <TableCell align="right">Bulan Ini</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={6} align="center">Memuat…</TableCell></TableRow>}
              {data?.tenants.map((t) => (
                <TableRow key={t.slug} hover>
                  <TableCell>
                    <Box>
                      <Typography fontWeight={600}>{t.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{t.slug}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={t.active ? 'Aktif' : 'Nonaktif'}
                      color={t.active ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell align="right">{t.tx_count}</TableCell>
                  <TableCell align="right">{formatIDR(t.today_revenue)}</TableCell>
                  <TableCell align="right">{formatIDR(t.mtd_revenue)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{formatIDR(t.total_revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Pricing Tier</Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          {PRICING_TIERS.map((p) => (
            <Grid item xs={12} sm={6} md={3} key={p.tier}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Typography variant="overline" color="primary" fontWeight={700}>{p.tier}</Typography>
                <Typography variant="h6" fontWeight={700} gutterBottom>{p.price}</Typography>
                <Typography variant="body2" color="text.secondary">{p.features}</Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          * Pricing tier di atas adalah display plan produk. Integrasi payment gateway belum diaktifkan.
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          <strong>TODO:</strong> Integrasi billing otomatis (payment gateway, invoice, subscription) belum diaktifkan.
          Saat ini tier hanya sebagai paket metadata yang di-assign manual oleh super admin ke user client via menu{' '}
          <a href="#/tiers">Pricing Tiers</a> & <a href="#/users">Users</a>.
        </Alert>
      </Paper>
    </Box>
  )
}
