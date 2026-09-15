import { useState } from 'react'
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom'
import {
  Box, Button, Card, CardContent, TextField, Typography, Alert, CircularProgress, FormControlLabel, Checkbox, Link as MuiLink
} from '@mui/material'
import { useAuth } from '@/context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [isUserLogin, setIsUserLogin] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, userLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isUserLogin) {
        // `userLogin` hanya resolve setelah `state` auth disinkronkan
        // (applyUserStatus + refresh dual-auth), jadi navigate aman di sini.
        await userLogin(email, password, remember)
        // Status 'pending'/'rejected' tetap boleh masuk — banner di dashboard yang
        // menjelaskan. Jangan blok login di sini.
        navigate('/')
      } else {
        const user = await signIn(email, password)
        const from = (location.state as { from?: string } | null)?.from || '/'
        if (user.role === 'super_admin') navigate(from)
        else navigate('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    setIsUserLogin(!isUserLogin)
    setError('')
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
            {isUserLogin ? 'Achipix User' : 'Achipix Admin'}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3} align="center">
            {isUserLogin ? 'Masuk untuk mengelola photobooth Anda' : 'Masuk ke dasbor administrasi'}
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={onSubmit}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              autoComplete={isUserLogin ? 'email' : 'username'}
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
              sx={{ mb: 2 }}
              required
            />
            {isUserLogin && (
              <FormControlLabel
                control={<Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
                label="Ingat saya (30 hari)"
                sx={{ mb: 2 }}
              />
            )}
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

          <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 3, display: 'block' }}>
            {isUserLogin ? (
              <>
                Belum punya akun? <MuiLink component={RouterLink} to="/register" underline="hover"> Daftar di sini</MuiLink>
              </>
            ) : (
              <>
                Login sebagai user? <a href="#" onClick={(e) => { e.preventDefault(); toggleMode(); }} style={{ cursor: 'pointer', textDecoration: 'underline', color: 'inherit' }}> Masuk sebagai user</a>
              </>
            )}
          </Typography>

          {!isUserLogin && (
            <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 1, display: 'block' }}>
              Admin login hanya untuk super_admin & tenant_admin
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}