import { useRef, useState } from 'react'
import { TemplateId, useSession } from '../../store/useSession'

export function Settings({ onClose }: { onClose: () => void }) {
  const { branding, template, bridgeUrl, frames, setBranding, setTemplate, setBridgeUrl } = useSession()
  const fileRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [galleryBusy, setGalleryBusy] = useState(false)

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setBranding({ logoDataUrl: reader.result as string })
    reader.readAsDataURL(f)
  }

  async function onGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setGalleryBusy(true)
    try {
      const uploaded: { id: string; name: string }[] = []
      for (const f of files) {
        const fd = new FormData()
        fd.append('image', f)
        fd.append('name', f.name.replace(/\.[^.]+$/, ''))
        const res = await fetch('/api/frames', { method: 'POST', body: fd })
        if (res.ok) uploaded.push(await res.json())
      }
      // Refresh gallery dari server.
      const list = await (await fetch('/api/frames')).json()
      useSession.getState().setFrames(
        (list as { id: string; name: string }[]).map((x) => ({
          id: x.id,
          name: x.name,
          url: `/api/frames/${x.id}`,
        }))
      )
    } catch {
      /* ignore */
    } finally {
      setGalleryBusy(false)
      if (galleryRef.current) galleryRef.current.value = ''
    }
  }

  async function removeFrame(id: string) {
    try {
      await fetch(`/api/frames/${id}`, { method: 'DELETE' })
      if (useSession.getState().selectedFrameId === id) {
        useSession.getState().setSelectedFrameId(null)
      }
      const list = await (await fetch('/api/frames')).json()
      useSession.getState().setFrames(
        (list as { id: string; name: string }[]).map((x) => ({
          id: x.id,
          name: x.name,
          url: `/api/frames/${x.id}`,
        }))
      )
    } catch {
      /* ignore */
    }
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

        {/* Gallery Bingkai Custom (simpan di DB, customer pilih di booth) */}
        <div className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Gallery Bingkai Custom
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => galleryRef.current?.click()}
              className="px-3 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container"
            >
              + Upload Bingkai
            </button>
            <input
              ref={galleryRef}
              type="file"
              accept="image/png,image/*"
              multiple
              hidden
              onChange={onGallery}
            />
          </div>
          <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
            Bisa upload lebih dari satu. Tersimpan di database & bisa dipilih customer di layar booth.
          </span>
          {galleryBusy && (
            <span className="text-[10px] normal-case tracking-normal text-primary">Mengupload…</span>
          )}
          {frames.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {frames.map((f) => (
                <div key={f.id} className="relative border-2 border-black bg-white">
                  <img src={f.url} alt={f.name} className="h-14 w-11 object-contain" />
                  <button
                    onClick={() => removeFrame(f.id)}
                    className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-error-container border-2 border-black text-on-error-container font-label-bold text-[12px]"
                    title="Hapus"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

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
