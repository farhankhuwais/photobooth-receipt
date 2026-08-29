import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/api/client'
import type { AuthState, User } from '@/types'

interface AuthCtx {
  state: AuthState
  user: User | null
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })

  const refresh = async () => {
    try {
      const s = await authApi.me()
      setState(s)
    } catch {
      setState({ status: 'unauthenticated', user: null })
    }
  }

  useEffect(() => {
    refresh()
    const onUnauthorized = () => setState({ status: 'unauthenticated', user: null })
    window.addEventListener('auth-unauthorized', onUnauthorized)
    return () => window.removeEventListener('auth-unauthorized', onUnauthorized)
  }, [])

  const signIn = async (email: string, password: string): Promise<User> => {
    const { user } = await authApi.login(email, password)
    setState({ status: 'authenticated', user })
    return user
  }

  const signOut = async () => {
    await authApi.logout().catch(() => {})
    setState({ status: 'unauthenticated', user: null })
  }

  return <Ctx.Provider value={{ state, user: state.user, signIn, signOut, refresh }}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
