import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  roles?: string[]
}

export default function RoleRoute({ children, roles }: Props) {
  const { state, user } = useAuth()
  const location = useLocation()

  if (state.status === 'loading') {
    return <div style={{ padding: 40, textAlign: 'center' }}>Memuat…</div>
  }

  if (state.status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (roles && roles.length > 0 && (!user || !roles.includes(user.role))) {
    // User tidak punya akses ke route ini, redirect ke Manage (halaman default tenant)
    return <Navigate to="/manage" replace />
  }

  return <>{children}</>
}
