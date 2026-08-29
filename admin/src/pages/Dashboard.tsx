import { useEffect, useState } from 'react'
import { Box, Paper, Typography, Grid } from '@mui/material'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { api } from '@/api/client'

interface Stats {
  tenants: number
  photos: number
  transactions: number
  revenue: number
  trend: { label: string; prints: number; revenue: number }[]
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Stats>('/api/admin/overview').then(setStats).catch((e) => setError(String(e)))
  }, [])

  if (error) return <Typography color="error">{error}</Typography>
  if (!stats) return <Typography>Memuat data…</Typography>

  const cards = [
    { label: 'Total Tenant', value: stats.tenants },
    { label: 'Total Foto', value: stats.photos },
    { label: 'Total Cetak', value: stats.transactions },
    { label: 'Pendapatan', value: 'Rp ' + stats.revenue.toLocaleString('id-ID') },
  ]

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>Overview</Typography>
      <Grid container spacing={2} mb={4}>
        {cards.map((c) => (
          <Grid item xs={6} md={3} key={c.label}>
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800}>{c.value}</Typography>
              <Typography variant="body2" color="text.secondary">{c.label}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={2}>Tren Cetak & Pendapatan</Typography>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={stats.trend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Area type="monotone" dataKey="prints" name="Cetak" stroke="#1976d2" fill="#1976d2" fillOpacity={0.2} />
            <Area type="monotone" dataKey="revenue" name="Pendapatan" stroke="#ed6c02" fill="#ed6c02" fillOpacity={0.2} />
          </AreaChart>
        </ResponsiveContainer>
      </Paper>
    </Box>
  )
}
