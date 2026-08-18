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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface border-4 border-black brutal-shadow p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-4 border-black pb-3">
          <h2 className="font-headline-md text-headline-md-mobile uppercase tracking-tight text-on-surface">
            Pengaturan Event
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 border-2 border-black bg-surface-variant rounded neo-button brutal-shadow-sm hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-on-surface">close</span>
          </button>
        </div>

        {/* Nama Event */}
        <label className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Nama Event
          <input
            value={branding.eventName}
            onChange={(e) => setBranding({ eventName: e.target.value })}
            className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high"
          />
        </label>

        {/* Logo */}
        <label className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Logo (PNG/JPG)
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container"
            >
              Pilih file
            </button>
            {branding.logoDataUrl && (
              <button
                onClick={() => setBranding({ logoDataUrl: null })}
                className="px-2 py-2 border-4 border-black bg-error-container text-on-error-container font-label-bold uppercase neo-button brutal-shadow-sm"
              >
                Hapus
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
          </div>
        </label>

        {/* Tampilkan tanggal */}
        <label className="flex items-center gap-2 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          <input
            type="checkbox"
            checked={branding.showDate}
            onChange={(e) => setBranding({ showDate: e.target.checked })}
            className="w-5 h-5 border-4 border-black accent-primary-container"
          />
          Tampilkan tanggal di struk
        </label>

        {/* Watermark */}
        <label className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Watermark / footer teks
          <input
            value={branding.watermark}
            onChange={(e) => setBranding({ watermark: e.target.value })}
            placeholder="cth: thank you!"
            className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high"
          />
        </label>

        {/* QR */}
        <label className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          QR code (link foto digital / teks)
          <input
            value={branding.qrText}
            onChange={(e) => setBranding({ qrText: e.target.value })}
            placeholder="https://..."
            className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high"
          />
        </label>

        {/* Bridge URL */}
        <label className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Bridge URL (Node print server, opsional)
          <input
            value={bridgeUrl}
            onChange={(e) => setBridgeUrl(e.target.value)}
            placeholder="http://192.168.1.10:8787"
            className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high"
          />
        </label>

        {/* Template default */}
        <div className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Template default
          <div className="mt-1 flex gap-2">
            {(['strip3', 'grid2x2', 'single'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTemplate(t)}
                className={`flex-1 px-2 py-2 border-4 border-black text-xs font-label-bold uppercase neo-button brutal-shadow-sm transition-all duration-75 ${
                  template === t
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface text-on-surface hover:bg-surface-variant'
                }`}
              >
                {t === 'strip3' ? '3 Vertikal' : t === 'grid2x2' ? '2x2' : '1 Foto'}
              </button>
            ))}
          </div>
        </div>

        <p className="font-label-bold text-label-bold text-on-surface-variant uppercase tracking-wider text-[10px]">
          Disimpan otomatis di browser ini.
        </p>
      </div>
    </div>
  )
}

export type { TemplateId }
