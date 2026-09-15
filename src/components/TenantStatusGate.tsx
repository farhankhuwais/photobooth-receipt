// src/components/TenantStatusGate.tsx
// Gate status tenant: blokir booth full-screen kalau akun belum/tidak aktif
// (pending/rejected/expired/suspended). Status datang dari GET /api/config
// (field `tenant_status`), di-refresh lewat polling config di App.tsx.
// Trial cuma nempil badge kecil di corner. Teks mengikuti bahasa aktif dari
// /api/config field `lang`.

import type { ReactNode } from 'react'
import { useLang } from '../modules/i18n/useLang'
import type { Lang } from '../modules/i18n/strings'
import './TenantStatusGate.css'

export type TenantStatus = 'trial' | 'active' | 'expired' | 'suspended' | 'pending' | 'rejected'

/** Normalisasi nilai mentah dari server → status yang dikenal, atau null. */
export function normalizeTenantStatus(v: unknown): TenantStatus | null {
  return v === 'trial' || v === 'active' || v === 'expired' || v === 'suspended' || v === 'pending' || v === 'rejected'
    ? v
    : null
}

interface TenantStatusGateProps {
  /** null/undefined = status belum diketahui (config pertama belum tiba / 403). */
  status: TenantStatus | null | undefined
  trialEndsAt?: string | null
  subscriptionEndsAt?: string | null
  /** Pesan mentah dari server (mis. saat /api/config 403) — diprioritaskan kalau ada. */
  message?: string | null
  children: ReactNode
}

function formatDate(iso: string | null | undefined, lang: Lang): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function TenantStatusGate({
  status,
  trialEndsAt,
  subscriptionEndsAt,
  message,
  children,
}: TenantStatusGateProps) {
  const { t, lang } = useLang()

  // Status belum diketahui → jangan render booth sampai config pertama tiba.
  // Kalau ada pesan dari server (403), tampilkan APA ADANYA sebagai keterangan.
  if (!status) {
    return (
      <div className="tenant-gate" role="alertdialog" aria-modal="true" aria-busy="true">
        <div className="tenant-gate__card">
          <div className="tenant-gate__icon" aria-hidden="true">⏳</div>
          <h1 className="tenant-gate__title">{t('tenant.loadingTitle')}</h1>
          <p className="tenant-gate__subtitle">{message || t('tenant.loadingSub')}</p>
        </div>
      </div>
    )
  }

  // Status aktif / trial → booth jalan normal (trial cuma dapat badge).
  if (status === 'active' || status === 'trial') {
    const trialDate = formatDate(trialEndsAt, lang)
    return (
      <>
        {children}
        {status === 'trial' && (
          <div className="tenant-trial-badge" aria-hidden="true">
            {t('tenant.trialBadge')}
            {trialDate ? <span className="tenant-trial-badge__date">· {t('tenant.trialUntil', { date: trialDate })}</span> : null}
          </div>
        )}
      </>
    )
  }

  // expired / suspended / pending / rejected → blokir booth.
  const title =
    status === 'suspended' ? t('tenant.suspendedTitle')
    : status === 'pending' ? t('tenant.pendingTitle')
    : status === 'rejected' ? t('tenant.rejectedTitle')
    : t('tenant.expiredTitle')
  const subtitle = message
    ? message
    : status === 'pending' ? t('tenant.pendingSub')
    : status === 'rejected' ? t('tenant.rejectedSub')
    : t('tenant.subtitle')
  const icon = status === 'suspended' ? '⛔' : status === 'rejected' ? '🚫' : '⏳'
  const endedOn = status === 'expired' ? formatDate(subscriptionEndsAt || trialEndsAt, lang) : null

  return (
    <div className="tenant-gate" role="alertdialog" aria-modal="true">
      <div className="tenant-gate__card">
        <div className="tenant-gate__icon" aria-hidden="true">{icon}</div>
        <h1 className="tenant-gate__title">{title}</h1>
        <p className="tenant-gate__subtitle">{subtitle}</p>
        {endedOn && (
          <p className="tenant-gate__meta">{t('tenant.endedOn', { date: endedOn })}</p>
        )}
      </div>
    </div>
  )
}
