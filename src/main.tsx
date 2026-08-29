import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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
  return rawFetch(input, { ...init, headers })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
