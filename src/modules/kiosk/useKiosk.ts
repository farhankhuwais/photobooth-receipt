// src/modules/kiosk/useKiosk.ts
// Full kiosk mode untuk tablet booth:
//   - requestFullscreen best-effort begitu config siap (iOS tidak support → catch silent).
//   - Blokir gesture yang merusak kiosk: contextmenu + pinch iOS (gesturestart/change/end).
//     Double-tap zoom ditangani lewat `touch-action: manipulation` di index.css.
//   - Screen Wake Lock: tahan layar nyala saat visible, lepas saat hidden,
//     minta ulang saat kembali visible.
//
// Semua best-effort: API yang tidak ada / ditolak browser di-catch diam-diam.
// Di localhost diniatkan OFF supaya tidak mengganggu proses dev.

import { useEffect, useRef } from 'react'

interface WakeLockSentinelLike {
  release?: () => Promise<void>
  addEventListener?: (type: string, listener: () => void) => void
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

function isDevHost(): boolean {
  if (typeof window === 'undefined') return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/**
 * @param ready true setelah GET /api/config pertama sukses.
 */
export function useKiosk(ready: boolean): void {
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const fullscreenTried = useRef(false)

  // Blokir gesture perusak kiosk (contextmenu + pinch iOS).
  useEffect(() => {
    if (isDevHost()) return
    const prevent = (e: Event) => e.preventDefault()
    document.addEventListener('contextmenu', prevent)
    document.addEventListener('gesturestart', prevent)
    document.addEventListener('gesturechange', prevent)
    document.addEventListener('gestureend', prevent)
    return () => {
      document.removeEventListener('contextmenu', prevent)
      document.removeEventListener('gesturestart', prevent)
      document.removeEventListener('gesturechange', prevent)
      document.removeEventListener('gestureend', prevent)
    }
  }, [])

  // Fullscreen best-effort setelah config OK (sekali saja).
  useEffect(() => {
    if (!ready || isDevHost() || fullscreenTried.current) return
    fullscreenTried.current = true
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void
      }
      if (typeof el.requestFullscreen === 'function') {
        const p = el.requestFullscreen({ navigationUI: 'hide' })
        if (p && typeof p.catch === 'function') p.catch(() => { /* ditolak browser */ })
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        const p = el.webkitRequestFullscreen()
        if (p && typeof p.catch === 'function') p.catch(() => { /* ditolak browser */ })
      }
    } catch { /* iOS / API tidak ada */ }
  }, [ready])

  // Wake Lock: jaga layar tetap nyala selama booth dipakai.
  useEffect(() => {
    if (isDevHost()) return
    let disposed = false

    const requestWakeLock = async () => {
      if (disposed || document.visibilityState !== 'visible') return
      const nav = navigator as NavigatorWithWakeLock
      if (!nav.wakeLock) return
      try {
        const sentinel = await nav.wakeLock.request('screen')
        if (disposed) {
          sentinel.release?.().catch(() => { /* ignore */ })
          return
        }
        wakeLockRef.current = sentinel
        sentinel.addEventListener?.('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null
        })
      } catch { /* tidak didukung / ditolak */ }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock()
      } else {
        wakeLockRef.current?.release?.().catch(() => { /* ignore */ })
        wakeLockRef.current = null
      }
    }

    requestWakeLock()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      wakeLockRef.current?.release?.().catch(() => { /* ignore */ })
      wakeLockRef.current = null
    }
  }, [])
}
