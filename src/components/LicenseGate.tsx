// src/components/LicenseGate.tsx
// License activation gate for photobooth app
// Handles offline-first license validation with device fingerprint binding
//
// SECURITY TRADE-OFFS:
// 1. HMAC key is in frontend bundle — determined attacker can extract it.
//    Mitigation: HMAC prevents casual tampering. Real security relies on
//    server-side revocation check (online) and short expiry windows.
// 2. Device fingerprint is in localStorage — cleared if user wipes browser data.
//    Mitigation: Acceptable trade-off for tablet kiosk deployment.
// 3. No certificate pinning — MITM can intercept and replay codes.
//    Mitigation: Codes expire quickly (30-90 days); HTTPS transport assumed.
// 4. Revocation is best-effort — offline device can't know if code was revoked.
//    Mitigation: Periodic online sync when connected; short expiry limits exposure.
// 5. Device binding is fingerprint-based — not cryptographic hardware attestation.
//    Mitigation: Adequate for consumer tablets; enterprise can add hardware binding.

import { useState, useEffect } from 'react';
import './LicenseGate.css';

const LICENSE_STORAGE_KEY = 'pb_license_v1';
const DEVICE_FP_KEY = 'pb_device_fp';

interface LicenseData {
  vendorId: string;
  expiry: number; // Unix timestamp in MILLISECONDS
  deviceFingerprint: string;
  activatedAt: number;
}

// ── HMAC verification via Web Crypto API (browser) ──────────────────────────
async function hmacHex(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Parse license code: vendorId-timestampMs-64hexHmac
// vendorId may contain dashes; we read hmac from the right (last 64 hex chars)
function parseLicenseCode(code: string): { vendorId: string; expiryMs: number; providedHmac: string } | null {
  const raw = String(code || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(raw.slice(-64))) return null;
  const providedHmac = raw.slice(-64);
  const remainder = raw.slice(0, -64); // "vendorId-timestamp-"
  const m = remainder.match(/-(\d+)-$/);
  if (!m) return null;
  const expiryMs = parseInt(m[1], 10);
  if (isNaN(expiryMs)) return null;
  const vendorId = remainder.slice(0, -(m[1].length + 2));
  return { vendorId, expiryMs, providedHmac };
}

function generateDeviceFingerprint(): string {
  let fp = localStorage.getItem(DEVICE_FP_KEY);
  if (fp) return fp;

  // Build fingerprint from browser characteristics
  const components = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}`,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    crypto.randomUUID(),
  ];
  let hash = 0;
  const str = components.join('|');
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  fp = Math.abs(hash).toString(36) + '-' + crypto.randomUUID().slice(0, 8);
  localStorage.setItem(DEVICE_FP_KEY, fp);
  return fp;
}

function getStoredLicense(): LicenseData | null {
  try {
    const raw = localStorage.getItem(LICENSE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicenseData;
  } catch {
    return null;
  }
}

function isLicenseActive(license: LicenseData): boolean {
  return license.expiry > Date.now();
}

function isLicenseForThisDevice(license: LicenseData, fp: string): boolean {
  return license.deviceFingerprint === fp;
}

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  onActivated: (license: LicenseData) => void;
  /** HMAC secret — must match LICENSE_SECRET_KEY env var on server.
   *  WARNING: Visible in JS bundle. For higher security, do HMAC verification
   *  server-side only and cache the result. */
  hmacSecret?: string;
  /** Whether to attempt online revocation check (only works if booth app is
   *  on a network that can reach admin subdomain). */
  enableOnlineRevocationCheck?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function LicenseGate({
  onActivated,
  hmacSecret = 'default-secret-change-me',
  enableOnlineRevocationCheck = true,
}: Props) {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [active, setActive] = useState<LicenseData | null>(null);
  const fp = generateDeviceFingerprint();

  // Check stored license on mount
  useEffect(() => {
    const stored = getStoredLicense();
    if (stored && isLicenseForThisDevice(stored, fp) && isLicenseActive(stored)) {
      setActive(stored);
      onActivated(stored);
    }
  }, [fp, onActivated]);

  const handleActivate = async () => {
    if (!code.trim()) {
      setMessage({ type: 'error', text: 'Kode tidak boleh kosong' });
      return;
    }
    setLoading(true);
    setMessage(null);

    try {
      // 1. Parse + HMAC verify locally
      const parsed = parseLicenseCode(code.trim());
      if (!parsed) {
        setMessage({ type: 'error', text: 'Format kode tidak valid. Contoh: vendor-budi-1234567890-abcd...' });
        setLoading(false);
        return;
      }

      const { vendorId, expiryMs, providedHmac } = parsed;

      // Expiry check
      if (expiryMs <= Date.now()) {
        setMessage({ type: 'error', text: 'Kode sudah expired' });
        setLoading(false);
        return;
      }

      // HMAC check
      const data = `${vendorId}-${expiryMs}-${hmacSecret}`;
      const calcHmac = await hmacHex(data, hmacSecret);
      if (calcHmac !== providedHmac) {
        setMessage({ type: 'error', text: 'Signature tidak valid — kode tidak asli' });
        setLoading(false);
        return;
      }

      // Build initial license object (will be updated by server if online)
      const license: LicenseData = {
        vendorId,
        expiry: expiryMs,
        deviceFingerprint: fp,
        activatedAt: Date.now(),
      };

      // 2. Online redeem: server verifies HMAC + checks revocation + auto-provisions
      //    tenant + user. This is the authoritative step. If offline, local HMAC
      //    validation is trusted as fallback (offline-first design).
      let serverResult: { valid: boolean; error?: string; vendorId?: string; expiry?: number } | null = null;
      if (enableOnlineRevocationCheck) {
        try {
          const resp = await fetch('/api/admin/license/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code.trim(), deviceFingerprint: fp }),
          });
          const result = await resp.json();
          serverResult = result;
          if (!result.valid) {
            setMessage({ type: 'error', text: result.error || 'Server menolak kode ini' });
            setLoading(false);
            return;
          }
          // Server confirmed valid — update license data with server-returned values
          if (result.expiry !== undefined) {
            license.vendorId = result.vendorId || parsed.vendorId;
            license.expiry = result.expiry;
          }
        } catch {
          // Offline — proceed with locally validated code (offline-first)
          console.log('[LicenseGate] Offline: local HMAC validation trusted');
        }
      }

      if (serverResult && !serverResult.valid) {
        setLoading(false);
        return;
      }

      // 3. Save locally and notify
      localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(license));
      setActive(license);
      setMessage({ type: 'success', text: '✓ Aktivasi berhasil! Memuat aplikasi...' });
      setTimeout(() => onActivated(license), 800);

    } catch (err) {
      setMessage({ type: 'error', text: `Error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    localStorage.removeItem(LICENSE_STORAGE_KEY);
    setActive(null);
    setCode('');
    setMessage({ type: 'info', text: 'Lisensi direset. Masukkan kode baru.' });
  };

  const formatExpiry = (ts: number) =>
    new Date(ts).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

  const daysLeft = active
    ? Math.max(0, Math.ceil((active.expiry - Date.now()) / 86400000))
    : 0;

  // ── Active license screen ─────────────────────────────────────────────────
  if (active) {
    return (
      <div className="license-gate">
        <div className="license-card license-card--active">
          <div className="license-icon license-icon--active">✓</div>
          <h2 className="license-title">Lisensi Aktif</h2>
          <div className="license-info">
            <div className="license-row">
              <span className="license-label">Vendor</span>
              <span className="license-value">{active.vendorId}</span>
            </div>
            <div className="license-row">
              <span className="license-label">Berlaku sampai</span>
              <span className="license-value">{formatExpiry(active.expiry)}</span>
            </div>
            <div className="license-row">
              <span className="license-label">Sisa hari</span>
              <span className={`license-value ${daysLeft <= 7 ? 'license-value--warn' : ''}`}>
                {daysLeft} hari
              </span>
            </div>
            <div className="license-row">
              <span className="license-label">Device ID</span>
              <span className="license-value license-value--mono">{active.deviceFingerprint}</span>
            </div>
            <div className="license-row">
              <span className="license-label">Diaktifkan</span>
              <span className="license-value">
                {new Date(active.activatedAt).toLocaleString('id-ID')}
              </span>
            </div>
          </div>
          <button className="license-btn license-btn--danger" onClick={handleReset}>
            Reset Lisensi
          </button>
        </div>
      </div>
    );
  }

  // ── Activation screen ────────────────────────────────────────────────────
  return (
    <div className="license-gate">
      <div className="license-card">
        <div className="license-icon">🔒</div>
        <h2 className="license-title">Aktivasi Lisensi</h2>
        <p className="license-desc">
          Masukkan kode akses yang diberikan oleh admin untuk mengaktifkan aplikasi photobooth.
        </p>

        <div className="license-divider" />

        <div className="license-field">
          <label className="license-field-label">Device ID (terikat otomatis ke device ini)</label>
          <div className="license-fp">
            <span className="license-fp-value">{fp}</span>
            <button
              className="license-fp-copy"
              onClick={() => navigator.clipboard.writeText(fp)}
              title="Copy"
            >
              📋
            </button>
          </div>
        </div>

        <div className="license-field">
          <label className="license-field-label" htmlFor="license-code-input">
            Kode Akses
          </label>
          <input
            id="license-code-input"
            className="license-input"
            type={showCode ? 'text' : 'password'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="vendorId-timestampMs-64hexHmac"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="license-toggle-vis"
            onClick={() => setShowCode((v) => !v)}
            type="button"
            aria-label={showCode ? 'Sembunyikan' : 'Tampilkan'}
          >
            {showCode ? '🙈' : '👁️'}
          </button>
        </div>

        {message && (
          <div className={`license-msg license-msg--${message.type}`}>
            {message.type === 'success' && '✓ '}
            {message.type === 'error' && '✗ '}
            {message.text}
          </div>
        )}

        <button
          className="license-btn license-btn--primary"
          onClick={handleActivate}
          disabled={loading || !code.trim()}
        >
          {loading ? '⏳ Memverifikasi...' : '🔓 Aktivasi'}
        </button>

        <p className="license-hint">
          Validasi offline didukung — tidak perlu internet setelah aktivasi pertama.<br />
          Kode: <code>vendorId-timestampMs-hmacSha256</code> · HMAC-SHA256
        </p>
      </div>
    </div>
  );
}
