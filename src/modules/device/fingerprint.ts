// src/modules/device/fingerprint.ts
// Fingerprint device kiosk — single source of truth.
//
// Dipakai untuk:
//   1. Header `X-Device-Fp` di setiap request (src/main.tsx) → server resolve device.
//   2. Binding pairing booth ↔ tenant (UnlockGate).
//   3. Binding lisensi offline (LicenseGate).
//
// Nilai dipersist di localStorage `pb_device_fp` supaya stabil antar reload.
// Jangan duplikat algoritma ini di tempat lain — impor dari sini.

export const DEVICE_FP_KEY = 'pb_device_fp'

/**
 * Ambil fingerprint tersimpan, atau buat baru kalau belum ada.
 * Selalu mengembalikan string non-kosong selama localStorage bisa diakses.
 */
export function getOrCreateDeviceFp(): string {
  let fp = ''
  try {
    fp = localStorage.getItem(DEVICE_FP_KEY) || ''
  } catch {
    /* localStorage tidak tersedia — fallback ke generate di bawah */
  }
  if (fp) return fp

  // Karakteristik browser + komponen acak (stabil & unik per device).
  const components = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}`,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    crypto.randomUUID(),
  ]
  let hash = 0
  const str = components.join('|')
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  fp = Math.abs(hash).toString(36) + '-' + crypto.randomUUID().slice(0, 8)
  try {
    localStorage.setItem(DEVICE_FP_KEY, fp)
  } catch {
    /* ignore — tetap kirim fp untuk sesi ini */
  }
  return fp
}
