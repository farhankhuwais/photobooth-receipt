// src/lib/licenseSecret.mjs
// License secret loader: generates a random secret on first boot, persists it
// to the mounted volume (/data/license_secret), and reuses it across restarts.
//
// IMPORTANT: This secret MUST match the VITE_LICENSE_SECRET used when building
// the frontend bundle (so the booth app can validate HMAC offline).
//   - If VITE_LICENSE_SECRET was provided at build time, set that SAME value
//     here via env LICENSE_SECRET_KEY for consistency.
//   - If not, the server generates its own — but then the bundled frontend
//     secret will NOT match, and offline validation will fail.
//   - For production consistency, pass BOTH:
//       LICENSE_SECRET_KEY=<secret>  (server)
//       VITE_LICENSE_SECRET=<secret> (Docker build arg)
//
// SECURITY: never commit the secret. Kept in /data/license_secret on host.

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const SECRET_FILE = '/data/license_secret'

export async function loadLicenseSecret() {
  // 1. Explicit env always wins (matches VITE_LICENSE_SECRET in bundle)
  if (process.env.LICENSE_SECRET_KEY) return process.env.LICENSE_SECRET_KEY

  // 2. Persisted secret from previous boot
  try {
    const existing = (await fs.readFile(SECRET_FILE, 'utf8')).trim()
    if (existing) return existing
  } catch { /* not found — generate below */ }

  // 3. Generate + persist (random 64-char hex)
  const secret = crypto.randomBytes(32).toString('hex')
  try {
    await fs.mkdir(path.dirname(SECRET_FILE), { recursive: true })
    await fs.writeFile(SECRET_FILE, secret, { mode: 0o600 })
    console.log('[license] Generated new license secret (saved to /data/license_secret)')
  } catch (err) {
    console.warn('[license] Could not persist secret:', err.message)
  }
  return secret
}