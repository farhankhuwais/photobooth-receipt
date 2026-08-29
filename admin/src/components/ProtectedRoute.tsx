import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { ReactNode } from 'react'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const location = useLocation()

  if (state.status === 'loading') {
    return <div style={{ padding: 40, textAlign: 'center' }}>Memuat…</div>
  }

  if (state.status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
