import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { authApi, type TenantStatus } from '@/api/client'
import type { AuthState, User } from '@/types'

interface UserAuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  user: User | null
  tenant: TenantStatus | null
  hasTenant: boolean
}

interface RedeemResult {
  valid: boolean
  tenantSlug: string
  redirectUrl: string
}

interface AuthCtx {
  // Admin auth (existing)
  state: AuthState
  user: User | null
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  // User auth (new)
  userAuth: UserAuthState
  register: (email: string, password: string, name?: string) => Promise<User>
  userLogin: (email: string, password: string, remember?: boolean) => Promise<User>
  userLogout: () => Promise<void>
  fetchUserStatus: () => Promise<void>
  /** Alias fetchUserStatus — dipakai setelah redeem buat refresh tenant/status. */
  refreshStatus: () => Promise<void>
  redeemCode: (code: string) => Promise<RedeemResult>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })
  const [userAuth, setUserAuth] = useState<UserAuthState>({ status: 'loading', user: null, tenant: null, hasTenant: false })

  // Ref cermin userAuth — dipakai userLogout() supaya tahu apakah `state` admin
  // sebelumnya berasal dari sesi user yang sama (tanpa closure basi).
  const userAuthRef = useRef(userAuth)
  useEffect(() => { userAuthRef.current = userAuth }, [userAuth])

  // Anti re-entrancy untuk handler `auth-unauthorized`: cegah re-verify berantai
  // saat endpoint verifikasi sendiri ikut membalas 401.
  const revalidatingRef = useRef(false)

  // Satu sumber kebenaran: `state` (admin) disinkronkan dari endpoint dual-auth
  // `/api/admin/me`. `fallbackUser` dipakai kalau probe gagal (mis. race backend)
  // supaya sesi yang baru sukses tidak ikut mental ke unauthenticated.
  const syncState = async (fallbackUser?: User) => {
    try {
      const s = await authApi.me()
      // Kalau caller baru login/register tapi probe malah bilang belum auth
      // (mis. race cookie), tetap pakai user yang barusan sukses.
      if (fallbackUser && s.status !== 'authenticated') {
        setState({ status: 'authenticated', user: s.user ?? fallbackUser })
      } else {
        setState(s)
      }
    } catch {
      if (fallbackUser) {
        setState({ status: 'authenticated', user: fallbackUser })
      } else {
        // Jangan turunkan status yang sudah authenticated hanya karena probe
        // boot yang telat tiba (401 stale).
        setState((prev) => prev.status === 'authenticated'
          ? prev
          : { status: 'unauthenticated', user: null })
      }
    }
  }

  const refresh = async () => {
    await syncState()
  }

  const fetchUserStatus = async () => {
    try {
      const s = await authApi.status()
      setUserAuth({ status: 'authenticated', user: s.user, tenant: s.tenant ?? null, hasTenant: !!s.hasTenant })
    } catch {
      // Jangan tendang user yang sudah login hanya karena status gagal dimuat.
      setUserAuth((prev) => prev.user
        ? { ...prev, status: 'authenticated' }
        : { status: 'unauthenticated', user: null, tenant: null, hasTenant: false })
    }
  }

  // Setelah register/login: pakai response server, lalu sinkronkan status tenant
  // secara akurat (jangan hardcode hasTenant:false — backend sudah provisioning tenant).
  const applyUserStatus = async (fallbackUser: User) => {
    try {
      const s = await authApi.status()
      setUserAuth({
        status: 'authenticated',
        user: s.user ?? fallbackUser,
        tenant: s.tenant ?? null,
        hasTenant: !!s.hasTenant,
      })
    } catch {
      setUserAuth({ status: 'authenticated', user: fallbackUser, tenant: null, hasTenant: false })
    }
  }

  useEffect(() => {
    refresh()
    fetchUserStatus()
    const onUnauthorized = async () => {
      // Guard anti berantai: endpoint verifikasi bisa ikut membalas 401 dan
      // men-dispatch event lagi. Satu re-verify cukup.
      if (revalidatingRef.current) return
      revalidatingRef.current = true
      try {
        // Jangan langsung clear state: 401 bisa datang dari probe boot yang
        // telat / stale. Verifikasi ulang sekali dengan endpoint dual-auth.
        try {
          const s = await authApi.me()
          // Masih hidup (mis. sesi user vendor) → 401 tadi stale, JANGAN clear.
          setState(s)
          return
        } catch {
          // Benar-benar 401 → baru clear state admin.
          setState({ status: 'unauthenticated', user: null })
        }
        // Sesi admin mati; cek apakah sesi user vendor masih hidup sebelum
        // menganggap sesi user ikut mati.
        try {
          const s = await authApi.status()
          if (s.user) {
            setUserAuth({ status: 'authenticated', user: s.user, tenant: s.tenant ?? null, hasTenant: !!s.hasTenant })
          } else {
            setUserAuth({ status: 'unauthenticated', user: null, tenant: null, hasTenant: false })
          }
        } catch {
          setUserAuth({ status: 'unauthenticated', user: null, tenant: null, hasTenant: false })
        }
      } finally {
        revalidatingRef.current = false
      }
    }
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

  const register = async (email: string, password: string, name?: string): Promise<User> => {
    const { user } = await authApi.register(email, password, name)
    await applyUserStatus(user)
    // Sinkronkan `state` admin (dual-auth `/api/admin/me` mengembalikan user
    // vendor) SEBELUM caller navigate. Kalau probe gagal, pakai user yang login.
    await syncState(user)
    return user
  }

  const userLogin = async (email: string, password: string, remember?: boolean): Promise<User> => {
    const { user } = await authApi.userLogin(email, password, remember)
    await applyUserStatus(user)
    // Lihat catatan di register(): state disinkronkan dulu, baru navigate.
    await syncState(user)
    return user
  }

  const userLogout = async () => {
    await authApi.userLogout().catch(() => {})
    const loggedOutUserId = userAuthRef.current.user?.id
    setUserAuth({ status: 'unauthenticated', user: null, tenant: null, hasTenant: false })
    // Kalau `state` admin sebelumnya berasal dari sesi user yang sama, reset
    // juga supaya ProtectedRoute tidak menyisakan dashboard "hantu".
    setState((prev) => (prev.status === 'authenticated' && prev.user?.id != null && prev.user.id === loggedOutUserId)
      ? { status: 'unauthenticated', user: null }
      : prev)
  }

  const redeemCode = async (code: string): Promise<RedeemResult> => {
    const result = await authApi.redeemCode(code)
    await fetchUserStatus()
    const tenant = result.tenant ?? null
    return {
      valid: !!result.ok,
      tenantSlug: tenant?.slug ?? '',
      redirectUrl: tenant ? `https://${tenant.slug}.achipix.web.id` : '',
    }
  }

  return (
    <Ctx.Provider value={{
      state, user: state.user, signIn, signOut, refresh,
      userAuth, register, userLogin, userLogout, fetchUserStatus,
      refreshStatus: fetchUserStatus, redeemCode
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
