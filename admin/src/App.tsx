import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleRoute from '@/components/RoleRoute'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Tenants from '@/pages/Tenants'
import Users from '@/pages/Users'
import Photos from '@/pages/Photos'
import Frames from '@/pages/Frames'
import Designs from '@/pages/Designs'
import Presets from '@/pages/Presets'
import Attract from '@/pages/Attract'
import PricingTiers from '@/pages/PricingTiers'
import AuditLog from '@/pages/AuditLog'
import Billing from '@/pages/Billing'
import LicenseCodes from '@/pages/LicenseCodes'
import Settings from '@/pages/Settings'
import Manage from '@/pages/Manage'

const SUPER = ['super_admin']
const TENANT = ['super_admin', 'tenant_admin']
const ANY = ['super_admin', 'tenant_admin', 'tenant_user']

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
  },
  shape: { borderRadius: 8 },
})

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<RoleRoute roles={SUPER}><Dashboard /></RoleRoute>} />
              <Route path="tenants" element={<RoleRoute roles={SUPER}><Tenants /></RoleRoute>} />
              <Route path="users" element={<RoleRoute roles={SUPER}><Users /></RoleRoute>} />
              <Route path="photos" element={<RoleRoute roles={TENANT}><Photos /></RoleRoute>} />
              <Route path="frames" element={<RoleRoute roles={TENANT}><Frames /></RoleRoute>} />
              <Route path="designs" element={<RoleRoute roles={TENANT}><Designs /></RoleRoute>} />
              <Route path="presets" element={<RoleRoute roles={TENANT}><Presets /></RoleRoute>} />
              <Route path="attract" element={<RoleRoute roles={TENANT}><Attract /></RoleRoute>} />
              <Route path="audit" element={<RoleRoute roles={SUPER}><AuditLog /></RoleRoute>} />
              <Route path="billing" element={<RoleRoute roles={SUPER}><Billing /></RoleRoute>} />
              <Route path="tiers" element={<RoleRoute roles={SUPER}><PricingTiers /></RoleRoute>} />
              <Route path="license" element={<RoleRoute roles={SUPER}><LicenseCodes /></RoleRoute>} />
              <Route path="settings" element={<RoleRoute roles={TENANT}><Settings /></RoleRoute>} />
              <Route path="manage" element={<RoleRoute roles={ANY}><Manage /></RoleRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
