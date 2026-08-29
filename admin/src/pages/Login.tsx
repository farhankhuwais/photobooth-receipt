import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Box, Button, Card, CardContent, TextField, Typography, Alert, CircularProgress,
} from '@mui/material'
import { useAuth } from '@/context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await signIn(email, password)
      const from = (location.state as { from?: string } | null)?.from || '/'
      if (user.role === 'super_admin') navigate(from)
      else if (user.role === 'tenant_admin') navigate('/manage')
      else navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'primary.main',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" fontWeight={700} mb={0.5} align="center">
            Achipix Admin
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3} align="center">
            Masuk ke dasbor administrasi
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={onSubmit}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              sx={{ mb: 2 }}
              required
            />
            <TextField
              fullWidth
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              sx={{ mb: 3 }}
              required
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={loading}
            >
              {loading ? <CircularProgress size={22} color="inherit" /> : 'Masuk'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  )
}
