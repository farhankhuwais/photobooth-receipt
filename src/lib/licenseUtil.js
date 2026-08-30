// src/lib/licenseUtil.js
// License code generation and verification utility
// Uses HMAC-SHA256 to sign vendor ID and expiration timestamp
//
// SECURITY NOTES:
// - This file is the SHARED generator between backend (admin) and, conceptually,
//   frontend. Realistically the HMAC secret lives ONLY on the server.
// - The frontend should NOT bundle the secret. Instead, the frontend may embed the
//   secret only for demo/local use; production should verify codes server-side
//   (POST /api/admin/license/verify) and cache the result for offline use.
// - HMAC alone is not DRM. It prevents casual tampering but a determined attacker
//   who extracts the secret can forge codes. Combine with:
//     * server-side revocation check when online
//     * short expiry windows
//     * device fingerprint binding
//     * rotating the secret periodically

import crypto from 'node:crypto'

// Generate a license code: vendorId-expiryTimestampMs-hmacSha256hex
export function generateLicenseCode(vendorId, expiryDays, secretKey) {
  const expiryTimestamp = Date.now() + expiryDays * 86400000
  const data = `${vendorId}-${expiryTimestamp}-${secretKey}`
  const hmac = crypto.createHmac('sha256', secretKey).update(data).digest('hex')
  return `${vendorId}-${expiryTimestamp}-${hmac}`
}

// Verify a license code. Returns { valid, vendorId, expiry (ms), error? }
export function verifyLicenseCode(code, secretKey) {
  try {
    const raw = String(code || '').trim()
    // Format: vendorId-<timestampMs>-<64 hex hmac>
    // Ambil hmac = 64 hex char terakhir; sisa sebelum adalah vendorId-timestamp
    if (!/^[0-9a-f]{64}$/i.test(raw.slice(-64))) {
      return { valid: false, vendorId: '', expiry: 0, error: 'Format kode tidak valid' }
    }
    const providedHmac = raw.slice(-64)
    const remainder = raw.slice(0, -64) // "vendorId-timestamp-"
    // Timestamp = angka terakhir di remainder (sebelum strip terakhir)
    const m = remainder.match(/-(\d+)-$/)
    if (!m) return { valid: false, vendorId: '', expiry: 0, error: 'Format kode tidak valid' }
    const expiryMs = parseInt(m[1], 10)
    const vendorId = remainder.slice(0, -(m[1].length + 2)) // hapus "-timestamp-"
    if (isNaN(expiryMs)) return { valid: false, vendorId, expiry: 0, error: 'Format kode tidak valid' }

    // Check expiry
    if (expiryMs <= Date.now()) {
      return { valid: false, vendorId, expiry: expiryMs, error: 'Kode sudah expired' }
    }

    // Verify HMAC
    const data = `${vendorId}-${expiryMs}-${secretKey}`
    const hmac = crypto.createHmac('sha256', secretKey).update(data).digest('hex')
    if (providedHmac !== hmac) {
      return { valid: false, vendorId, expiry: expiryMs, error: 'Signature tidak valid' }
    }

    return { valid: true, vendorId, expiry: expiryMs }
  } catch (e) {
    return { valid: false, vendorId: '', expiry: 0, error: 'Format kode tidak valid' }
  }
}

export default { generateLicenseCode, verifyLicenseCode }
