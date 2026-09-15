import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Box, Paper, TextField, Button, Typography, Alert, CircularProgress, Link as MuiLink
} from '@mui/material'
import LockIcon from '@mui/icons-material/Lock'
import PersonIcon from '@mui/icons-material/Person'
import EmailIcon from '@mui/icons-material/Email'
import { useAuth } from '@/context/AuthContext'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('Password dan konfirmasi password tidak sama')
      return
    }
    setLoading(true)
    try {
      // `register` men-sinkronkan status user + `state` admin (refresh dual-auth)
      // sebelum resolve, jadi navigate('/') dijamin sudah authenticated.
      await register(form.email, form.password, form.name || undefined)
      navigate('/')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mendaftar'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.50', p: 3 }}>
      <Paper elevation={3} sx={{ width: '100%', maxWidth: 420, p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h5" fontWeight={700} color="primary">Daftar Akun</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Buat akun untuk mengelola photobooth Anda
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Nama (opsional)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nama Anda"
            InputProps={{ startAdornment: <PersonIcon color="action" /> }}
            margin="normal"
            size="small"
          />
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="email@domain.com"
            InputProps={{ startAdornment: <EmailIcon color="action" /> }}
            margin="normal"
            size="small"
            required
            autoComplete="email"
          />
          <TextField
            fullWidth
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Minimal 8 karakter"
            InputProps={{ startAdornment: <LockIcon color="action" /> }}
            margin="normal"
            size="small"
            required
            autoComplete="new-password"
            helperText="Minimal 8 karakter"
          />
          <TextField
            fullWidth
            label="Konfirmasi Password"
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            placeholder="Ulangi password"
            InputProps={{ startAdornment: <LockIcon color="action" /> }}
            margin="normal"
            size="small"
            required
            autoComplete="new-password"
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            sx={{ mt: 3, mb: 2, py: 1.5 }}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
          >
            {loading ? 'Mendaftar...' : 'Daftar'}
          </Button>
        </form>

        <Typography variant="body2" color="text.secondary" align="center">
          Sudah punya akun? <MuiLink component={Link} to="/login" underline="hover">Masuk di sini</MuiLink>
        </Typography>
      </Paper>
    </Box>
  )
}