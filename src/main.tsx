import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { getOrCreateDeviceFp } from './modules/device/fingerprint'
import './index.css'

// Inject tenant header otomatis untuk semua request fetch berbasis subdomain.
const rawFetch = window.fetch
window.fetch = (input, init = {}) => {
  const headers = new Headers(init.headers || {})
  if (!headers.has('X-Tenant-Slug')) {
    const hostname = String(window.location.hostname)
    const hostWithoutPort = hostname.split(':')[0]
    const parts = hostWithoutPort.split('.')
    if (parts.length >= 3) headers.set('X-Tenant-Slug', parts[0])
  }
  const savedPin = String(localStorage.getItem('pb_tenant_pin') || '')
  if (savedPin && !headers.has('X-Tenant-Pin')) headers.set('X-Tenant-Pin', savedPin)
  // Device fingerprint untuk pairing: baca nilai TERKINI tiap request (jangan cache saat load),
  // biar begitu booth di-unlock/revoke header langsung ikut berubah tanpa reload.
  // WAJIB selalu terkirim — kalau belum ada, generate sekali lalu persist (server
  // pakai fp ini untuk resolve device & deteksi pairing).
  if (!headers.has('X-Device-Fp')) {
    let deviceFp = ''
    try {
      const unlockRaw = localStorage.getItem('pb_booth_unlock_v1')
      if (unlockRaw) deviceFp = String(JSON.parse(unlockRaw)?.deviceFp || '')
    } catch { /* ignore JSON rusak */ }
    if (!deviceFp) deviceFp = getOrCreateDeviceFp()
    headers.set('X-Device-Fp', deviceFp)
  }
  return rawFetch(input, { ...init, headers })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
