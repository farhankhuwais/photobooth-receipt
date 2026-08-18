import { useRef } from 'react'
import { TemplateId, useSession } from '../../store/useSession'

export function Settings({ onClose }: { onClose: () => void }) {
  const { branding, template, bridgeUrl, setBranding, setTemplate, setBridgeUrl } = useSession()
  const fileRef = useRef<HTMLInputElement>(null)

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setBranding({ logoDataUrl: reader.result as string })
    reader.readAsDataURL(f)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-800 rounded-2xl p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Pengaturan Event</h2>
          <button onClick={onClose} className="text-slate-300 hover:text-white">
            ✕
          </button>
        </div>

        <label className="text-sm text-slate-300">
          Nama Event
          <input
            value={branding.eventName}
            onChange={(e) => setBranding({ eventName: e.target.value })}
            className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-white outline-none"
          />
        </label>

        <label className="text-sm text-slate-300">
          Logo (PNG/JPG)
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm"
            >
              Pilih file
            </button>
            {branding.logoDataUrl && (
              <button
                onClick={() => setBranding({ logoDataUrl: null })}
                className="text-xs text-red-400"
              >
                hapus
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
          </div>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={branding.showDate}
            onChange={(e) => setBranding({ showDate: e.target.checked })}
          />
          Tampilkan tanggal di struk
        </label>

        <label className="text-sm text-slate-300">
          Watermark / footer teks
          <input
            value={branding.watermark}
            onChange={(e) => setBranding({ watermark: e.target.value })}
            placeholder="cth: thank you!"
            className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-white outline-none"
          />
        </label>

        <label className="text-sm text-slate-300">
          QR code (link foto digital / teks)
          <input
            value={branding.qrText}
            onChange={(e) => setBranding({ qrText: e.target.value })}
            placeholder="https://..."
            className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-white outline-none"
          />
        </label>

        <label className="text-sm text-slate-300">
          Bridge URL (Node print server, opsional)
          <input
            value={bridgeUrl}
            onChange={(e) => setBridgeUrl(e.target.value)}
            placeholder="http://192.168.1.10:8787"
            className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-white outline-none"
          />
        </label>

        <div className="text-sm text-slate-300">
          Template default
          <div className="mt-1 flex gap-2">
            {(['strip3', 'grid2x2', 'single'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTemplate(t)}
                className={`flex-1 px-2 py-2 rounded-lg text-xs border ${
                  template === t ? 'bg-white text-slate-900 border-white' : 'border-slate-600'
                }`}
              >
                {t === 'strip3' ? '3 Vertikal' : t === 'grid2x2' ? '2x2' : '1 Foto'}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-500">Disimpan otomatis di browser ini.</p>
      </div>
    </div>
  )
}

export type { TemplateId }
