// src/modules/i18n/strings.ts
// Kamus string UI untuk layar gate (TenantStatusGate / UnlockGate / PinGate).
// Sengaja tanpa library i18n — bundle booth tetap ringan.
// Interpolasi sederhana: {nama} diganti dari argumen `vars`.

export type Lang = 'id' | 'en'

const ID = {
  // ── TenantStatusGate ──────────────────────────────────────────────
  'tenant.trialBadge': 'Trial',
  'tenant.trialUntil': 's/d {date}',
  'tenant.expiredTitle': 'Masa aktif booth sudah habis',
  'tenant.suspendedTitle': 'Booth dinonaktifkan',
  'tenant.subtitle': 'Hubungi admin untuk mengaktifkan kembali.',
  'tenant.endedOn': 'Berakhir pada {date}',
  'tenant.pendingTitle': 'Menunggu Persetujuan',
  'tenant.pendingSub': 'Akun menunggu persetujuan admin. Booth bisa dipakai setelah disetujui.',
  'tenant.rejectedTitle': 'Pendaftaran Ditolak',
  'tenant.rejectedSub': 'Hubungi admin/support untuk bantuan.',
  'tenant.loadingTitle': 'Memuat…',
  'tenant.loadingSub': 'Sedang menyiapkan booth. Tunggu sebentar ya.',

  // ── UnlockGate ────────────────────────────────────────────────────
  'unlock.invalidFormat': 'Kode harus 6 karakter huruf/angka',
  'unlock.invalid': 'Kode tidak valid/kedaluwarsa',
  'unlock.network': 'Gagal terhubung ke server. Cek koneksi lalu coba lagi.',
  'unlock.successTitle': 'Berhasil!',
  'unlock.successSub': 'Booth siap digunakan.',
  'unlock.title': 'Hubungkan Booth',
  'unlock.subtitle': 'Booth ini belum terhubung ke akun vendor. Masukkan kode dari dashboard.',
  'unlock.inputLabel': 'Kode penghubung 6 karakter',
  'unlock.connecting': '⏳ Menghubungkan...',
  'unlock.submit': 'Hubungkan Booth',
  'unlock.hint': 'Kode 6 karakter bisa didapat dari dashboard vendor di menu Perangkat.',

  // ── PinGate ───────────────────────────────────────────────────────
  'pin.badTitle': 'PIN Salah',
  'pin.checkingTitle': 'Memeriksa…',
  'pin.requiredTitle': 'Masukkan PIN',
  'pin.badSub': 'PIN yang dimasukkan tidak cocok.',
  'pin.checkingSub': 'Sedang verifikasi akses booth.',
  'pin.requiredSub': 'PIN 4 digit untuk akses booth ini.',
  'pin.retry': 'Coba Lagi',
  'pin.errCheck': 'Gagal memeriksa status PIN',
  'pin.errVerify': 'Gagal verifikasi PIN',
  'pin.errNetwork': 'Gagal terhubung ke server',
} as const

const EN: Record<keyof typeof ID, string> = {
  // ── TenantStatusGate ──────────────────────────────────────────────
  'tenant.trialBadge': 'Trial',
  'tenant.trialUntil': 'until {date}',
  'tenant.expiredTitle': 'Booth subscription has ended',
  'tenant.suspendedTitle': 'Booth is disabled',
  'tenant.subtitle': 'Contact the admin to reactivate it.',
  'tenant.endedOn': 'Ended on {date}',
  'tenant.pendingTitle': 'Awaiting Approval',
  'tenant.pendingSub': 'Your account is waiting for admin approval. The booth can be used once approved.',
  'tenant.rejectedTitle': 'Registration Rejected',
  'tenant.rejectedSub': 'Contact admin/support for help.',
  'tenant.loadingTitle': 'Loading…',
  'tenant.loadingSub': 'Getting the booth ready. Please wait a moment.',

  // ── UnlockGate ────────────────────────────────────────────────────
  'unlock.invalidFormat': 'Code must be 6 letters/numbers',
  'unlock.invalid': 'Invalid/expired code',
  'unlock.network': 'Failed to reach the server. Check your connection and try again.',
  'unlock.successTitle': 'Success!',
  'unlock.successSub': 'Booth is ready to use.',
  'unlock.title': 'Connect Booth',
  'unlock.subtitle': 'This booth is not linked to a vendor account yet. Enter the code from your dashboard.',
  'unlock.inputLabel': '6-character pairing code',
  'unlock.connecting': '⏳ Connecting...',
  'unlock.submit': 'Connect Booth',
  'unlock.hint': 'Get the 6-character code from the vendor dashboard under Devices.',

  // ── PinGate ───────────────────────────────────────────────────────
  'pin.badTitle': 'Wrong PIN',
  'pin.checkingTitle': 'Checking…',
  'pin.requiredTitle': 'Enter PIN',
  'pin.badSub': 'The PIN you entered does not match.',
  'pin.checkingSub': 'Verifying booth access.',
  'pin.requiredSub': '4-digit PIN for this booth.',
  'pin.retry': 'Try Again',
  'pin.errCheck': 'Failed to check PIN status',
  'pin.errVerify': 'Failed to verify PIN',
  'pin.errNetwork': 'Failed to reach the server',
}

export const STRINGS = { id: ID, en: EN }

export type StringKey = keyof typeof ID

/**
 * Ambil string sesuai bahasa + interpolasi `{key}` dari `vars`.
 * Ke key yang tidak dikenal → kembalikan key apa adanya (biar gampang ketahuan).
 */
export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const table = STRINGS[lang] ?? STRINGS.id
  let out: string = (table as Record<StringKey, string>)[key] ?? STRINGS.id[key] ?? key
  if (vars) {
    for (const name of Object.keys(vars)) {
      out = out.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]))
    }
  }
  return out
}
