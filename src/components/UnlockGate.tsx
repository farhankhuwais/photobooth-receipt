// src/components/UnlockGate.tsx
// Gate pairing device ↔ tenant: booth harus di-unlock pakai kode 6 karakter
// (A-Z + 2-9) dari dashboard vendor sebelum bisa dipakai. Status `device_paired`
// datang dari GET /api/config (di-refresh lewat polling config di App.tsx).
//
// Arti nilai `paired`:
//   true        → device sudah ter-pair → booth jalan normal.
//   null/undef  → fitur pairing belum aktif untuk tenant ini → booth jalan normal.
//   false       → device ini belum ter-pair → tampilkan layar pairing.
//
// Revoke gratis dari polling: kalau owner memutus device, /api/config berikutnya
// balikin device_paired:false → App set state → layar pairing muncul lagi.
//
// Error dari server (mis. limit 1 device) ditampilkan APA ADANYA.

import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useLang } from '../modules/i18n/useLang'
import { getOrCreateDeviceFp } from '../modules/device/fingerprint'
import './UnlockGate.css'

const UNLOCK_KEY = 'pb_booth_unlock_v1'

// Kode pairing: 6 karakter alfanumerik uppercase, tanpa 0/1/I/O biar tidak ambigu.
const CODE_RE = /^[A-Z2-9]{6}$/

interface UnlockGateProps {
  paired: boolean | null | undefined
  /** Dipanggil setelah unlock sukses — parent re-poll /api/config. */
  onUnlocked?: () => void
  children: ReactNode
}

export default function UnlockGate({ paired, onUnlocked, children }: UnlockGateProps) {
  const { t } = useLang()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // true / null / undefined → fitur pairing tidak menghalangi booth.
  if (paired !== false) return <>{children}</>

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!CODE_RE.test(trimmed)) {
      setError(t('unlock.invalidFormat'))
      return
    }
    setLoading(true)
    setError(null)

    const deviceFp = getOrCreateDeviceFp()
    try {
      const resp = await fetch('/api/access-code/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, deviceFp }),
      })
      const result = await resp.json().catch(() => null)
      if (!result || !result.valid) {
        // Tampilkan pesan server apa adanya (mis. limit 1 device).
        setError(String(result?.error || t('unlock.invalid')))
        setLoading(false)
        return
      }

      const tenantSlug = String(result.tenant?.slug || '')
      localStorage.setItem(
        UNLOCK_KEY,
        JSON.stringify({ tenantSlug, deviceFp, pairedAt: new Date().toISOString() })
      )
      setSuccess(true)
      // Kasih jeda singkat biar layar sukses kebaca, baru minta parent re-poll.
      setTimeout(() => onUnlocked?.(), 900)
    } catch {
      setError(t('unlock.network'))
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="unlock-gate" role="alertdialog" aria-modal="true">
        <div className="unlock-gate__card">
          <div className="unlock-gate__icon" aria-hidden="true">✓</div>
          <h1 className="unlock-gate__title">{t('unlock.successTitle')}</h1>
          <p className="unlock-gate__subtitle">{t('unlock.successSub')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="unlock-gate" role="alertdialog" aria-modal="true">
      <div className="unlock-gate__card">
        <div className="unlock-gate__icon" aria-hidden="true">🔗</div>
        <h1 className="unlock-gate__title">{t('unlock.title')}</h1>
        <p className="unlock-gate__subtitle">
          {t('unlock.subtitle')}
        </p>

        <form className="unlock-gate__form" onSubmit={handleSubmit}>
          <input
            className="unlock-gate__input"
            type="text"
            inputMode="text"
            pattern="[A-Z2-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))}
            placeholder="KX4M2P"
            aria-label={t('unlock.inputLabel')}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={loading}
          />

          {error && (
            <div className="unlock-gate__error" role="alert">✗ {error}</div>
          )}

          <button
            className="unlock-gate__btn"
            type="submit"
            disabled={loading || !CODE_RE.test(code)}
          >
            {loading ? t('unlock.connecting') : t('unlock.submit')}
          </button>
        </form>

        <p className="unlock-gate__hint">
          {t('unlock.hint')}
        </p>
      </div>
    </div>
  )
}
