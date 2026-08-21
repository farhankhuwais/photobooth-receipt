import { useRef, useState } from 'react'
import { TemplateId, useSession, AppMode } from '../../store/useSession'
import { DesignEditor } from './DesignEditor'

export function Settings({ onClose, onAttractChange }: { onClose: () => void; onAttractChange?: () => void }) {
  const { branding, template, bridgeUrl, frames, mode, price, setBranding, setTemplate, setBridgeUrl, setMode, setPrice, applyConfig } = useSession()
  const fileRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const attractRef = useRef<HTMLInputElement>(null)
  const attractIconRef = useRef<HTMLInputElement>(null)
  const [galleryBusy, setGalleryBusy] = useState(false)
  const [frameTemplate, setFrameTemplate] = useState<string>('')  // '' = universal
  const [attractBusy, setAttractBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  // Mode yang lagi diedit di panel + preset yang dipilih (dropdown per-mode).
  const [editMode, setEditMode] = useState<AppMode>(mode)
  const [draftPrice, setDraftPrice] = useState<number>(price)
  const [presets, setPresets] = useState<{ name: string; mode: string }[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [presetName, setPresetName] = useState('')

  // Load daftar preset (filter per mode yang lagi diedit).
  async function loadPresets(m: AppMode) {
    try {
      const rows = await (await fetch(`/api/presets?mode=${m}`)).json()
      setPresets(Array.isArray(rows) ? rows : [])
    } catch {
      setPresets([])
    }
  }

  // Pilih preset dari dropdown -> auto-isi field (branding + harga) + set sebagai aktif.
  async function onPresetChange(name: string) {
    setSelectedPreset(name)
    if (!name) return
    try {
      const p = await (await fetch(`/api/presets/${encodeURIComponent(name)}`)).json()
      if (p?.branding) {
        useSession.getState().setBranding(p.branding)
        setDraftPrice(p.mode === 'event' ? 0 : Number(p.price) || 5000)
      }
    } catch {
      /* ignore */
    }
  }

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
        if (frameTemplate) fd.append('template', frameTemplate)
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

  // Upload background / ikon attract (per mode aktif) -> notify parent reload.
  async function onAttractFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setAttractBusy(true)
    try {
      const fd = new FormData()
      fd.append('media', f)
      const res = await fetch(`/api/attract/${useSession.getState().mode}`, { method: 'POST', body: fd })
      if (res.ok) onAttractChange?.()
    } catch {
      /* ignore */
    } finally {
      setAttractBusy(false)
      if (attractRef.current) attractRef.current.value = ''
    }
  }

  async function onAttractIconFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setAttractBusy(true)
    try {
      const fd = new FormData()
      fd.append('image', f)
      const res = await fetch(`/api/attract/${useSession.getState().mode}/icon`, { method: 'POST', body: fd })
      if (res.ok) onAttractChange?.()
    } catch {
      /* ignore */
    } finally {
      setAttractBusy(false)
      if (attractIconRef.current) attractIconRef.current.value = ''
    }
  }

  async function deleteAttractBg() {
    setAttractBusy(true)
    try {
      await fetch(`/api/attract/${useSession.getState().mode}`, { method: 'DELETE' })
      onAttractChange?.()
    } catch {
      /* ignore */
    } finally {
      setAttractBusy(false)
    }
  }

  async function deleteAttractIcon() {
    setAttractBusy(true)
    try {
      await fetch(`/api/attract/${useSession.getState().mode}/icon`, { method: 'DELETE' })
      onAttractChange?.()
    } catch {
      /* ignore */
    } finally {
      setAttractBusy(false)
    }
  }

  // Ganti tab mode -> load dropdown preset mode itu + reset pilihan.
  async function switchMode(m: AppMode) {
    setEditMode(m)
    setSelectedPreset('')
    await loadPresets(m)
  }

  // Simpan config sekarang sebagai preset bernama (mode ikut editMode).
  async function savePresetNamed() {
    const nm = presetName.trim()
    if (!nm) return
    setBusy(true)
    try {
      await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nm,
          mode: editMode,
          price: editMode === 'event' ? 0 : draftPrice,
          branding: useSession.getState().branding,
        }),
      })
      setSelectedPreset(nm)
      await loadPresets(editMode)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  // Aktifkan config sekarang (mode/price/branding) + preset terpilih + persist.
  function activateMode() {
    setMode(editMode)
    setPrice(editMode === 'event' ? 0 : draftPrice)
    useSession.getState().setActivePreset(selectedPreset || null)
    applyConfig({
      mode: editMode,
      price: editMode === 'event' ? 0 : draftPrice,
      branding: useSession.getState().branding,
      presetName: selectedPreset || null,
    })
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
            Pengaturan
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 border-2 border-black bg-surface-variant rounded neo-button brutal-shadow-sm hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-on-surface">close</span>
          </button>
        </div>

        {/* Mode Booth: Regular vs Event — tab, masing-masing config terpisah */}
        <div className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Mode Booth
          <div className="mt-1 flex gap-2">
            {(['regular', 'event'] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 px-2 py-2 border-4 border-black text-xs font-label-bold uppercase neo-button brutal-shadow-sm transition-all duration-75 ${
                  editMode === m
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface text-on-surface hover:bg-surface-variant'
                }`}
              >
                {m === 'regular' ? 'Regular (bayar/cetak)' : 'Event (jasa, gratis)'}
              </button>
            ))}
          </div>
          <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
            {editMode === 'event'
              ? 'Booth branded acara, CETAK tanpa paywall (host bayar di awal).'
              : 'Booth reguler, CETAK bayar per lembar.'}
            {' '}Settingan tiap mode tersimpan sendiri di database.
          </span>
        </div>

        {/* Dropdown preset per-mode — pilih config tersimpan, field auto-isi */}
        <div className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Preset {editMode === 'event' ? 'Event' : 'Regular'}
          <select
            value={selectedPreset}
            onChange={(e) => onPresetChange(e.target.value)}
            className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high"
          >
            <option value="">— Pilih preset / kosong —</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          {presets.length === 0 && (
            <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
              Belum ada preset {editMode === 'event' ? 'Event' : 'Regular'}. Isi field lalu Simpan di bawah.
            </span>
          )}
        </div>

        {/* Harga per cetak (regular) — HIDE di mode event */}
        {editMode === 'regular' && (
          <label className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
            Harga per cetak (Rp)
            <input
              type="number"
              min={0}
              value={draftPrice}
              onChange={(e) => setDraftPrice(Number(e.target.value) || 0)}
              className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high"
            />
          </label>
        )}

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

        {/* Tampilkan nama event di hasil cetak */}
        <label className="flex items-center gap-2 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          <input
            type="checkbox"
            checked={branding.showEventNameOnPrint}
            onChange={(e) => setBranding({ showEventNameOnPrint: e.target.checked })}
            className="w-5 h-5 border-4 border-black accent-primary-container"
          />
          Tampilkan nama event di hasil cetak
          <span className="text-[10px] normal-case tracking-normal text-on-surface-variant font-body-md">
            (matikan agar nama event tidak muncul di foto/struk)
          </span>
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

        {/* Jarak dekorasi foto */}
        <div className="flex flex-col gap-2 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px] border-t-4 border-black pt-3 mt-1">
          <span>Jarak Dekorasi Foto (px)</span>
          {([
            ['photoTopPad', 'Atas (vs logo)', branding.photoTopPad ?? 24],
            ['photoBottomPad', 'Bawah (vs QR)', branding.photoBottomPad ?? 24],
            ['photoGap', 'Antar foto', branding.photoGap ?? 20],
          ] as const).map(([key, label, val]) => (
            <label key={key} className="flex flex-col gap-1 normal-case tracking-normal">
              <span className="flex items-center justify-between text-[11px]">
                <span>{label}</span>
                <span className="font-bold">{val}px</span>
              </span>
              <input
                type="range"
                min={0}
                max={200}
                step={2}
                value={val}
                onChange={(e) => setBranding({ [key]: Number(e.target.value) } as any)}
                className="w-full accent-black"
              />
            </label>
          ))}
          {/* Jarak antar foto KHUSUS template 2x2 — horizontal (kiri-kanan) & vertikal (atas-bawah). */}
          <label className="flex flex-col gap-1 normal-case tracking-normal border-t-2 border-dashed border-black/30 pt-2 mt-1">
            <span className="flex items-center justify-between text-[11px]">
              <span>2×2 — Kiri/kanan (X)</span>
              <span className="font-bold">{branding.photoGap2x2X ?? 20}px</span>
            </span>
            <input
              type="range"
              min={0}
              max={200}
              step={2}
              value={branding.photoGap2x2X ?? 20}
              onChange={(e) => setBranding({ photoGap2x2X: Number(e.target.value) })}
              className="w-full accent-black"
            />
          </label>
          <label className="flex flex-col gap-1 normal-case tracking-normal">
            <span className="flex items-center justify-between text-[11px]">
              <span>2×2 — Atas/bawah (Y)</span>
              <span className="font-bold">{branding.photoGap2x2Y ?? 20}px</span>
            </span>
            <input
              type="range"
              min={0}
              max={200}
              step={2}
              value={branding.photoGap2x2Y ?? 20}
              onChange={(e) => setBranding({ photoGap2x2Y: Number(e.target.value) })}
              className="w-full accent-black"
            />
            <span className="text-[10px] text-on-surface-variant">
              Hanya berlaku grid 2×2. Template lain pakai "Antar foto" di atas (sama utk keduanya).
            </span>
          </label>
          <span className="text-[10px] normal-case break-words text-on-surface-variant">
            Foto dipisah dari logo/QR & antar foto agar bisa dihias. Board panduan Canva akurat di default (atas 24 / bawah 24 / antar 20).
          </span>
        </div>

        {/* Gallery Bingkai Custom (simpan di DB, customer pilih di booth) */}
        <div className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">
          Gallery Bingkai Custom
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              value={frameTemplate}
              onChange={(e) => setFrameTemplate(e.target.value)}
              className="px-2 py-2 border-4 border-black bg-surface text-on-surface font-label-bold text-[11px] uppercase"
              title="Template tujuan bingkai (kosong = semua template)"
            >
              <option value="">Semua template</option>
              <option value="strip3">3 Vertikal</option>
              <option value="single">1 Foto</option>
              <option value="grid2x2">2×2</option>
            </select>
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
          <span className="text-[10px] normal-case break-words text-on-surface-variant">
            Pilih template tujuan di dropdown (kosong = semua template). Saat customer ganti template di booth, bingkai otomatis ikut template tersebut. Bisa upload lebih dari satu.
          </span>
          <a
            href="/guides/README.html"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] normal-case tracking-normal text-primary underline decoration-2 decoration-black/40 hover:decoration-black"
          >
            📐 Panduan ukuran & board Canva (download)
          </a>
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

        {/* Editor Design Mockup — drag-drop slot foto */}
        <DesignEditor />

        {/* Layar Awal (Attract) — background + ikon sentuh per mode */}
        <div className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px] border-t-4 border-black pt-3">
          Layar Awal (Attract) — mode {mode === 'event' ? 'Event' : 'Regular'}
          <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
            Background & ikon untuk layar "Sentuh untuk mulai". Tersimpan di DB, otomatis tiap mode.
          </span>
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => attractRef.current?.click()}
                className="px-3 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container"
              >
                + Background (Gambar/Video)
              </button>
              <button
                onClick={deleteAttractBg}
                className="px-2 py-2 border-4 border-black bg-error-container text-on-error-container font-label-bold uppercase neo-button brutal-shadow-sm"
              >
                Hapus BG
              </button>
              <input ref={attractRef} type="file" accept="image/*,video/*" hidden onChange={onAttractFile} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => attractIconRef.current?.click()}
                className="px-3 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container"
              >
                + Ganti Ikon Sentuh
              </button>
              <button
                onClick={deleteAttractIcon}
                className="px-2 py-2 border-4 border-black bg-error-container text-on-error-container font-label-bold uppercase neo-button brutal-shadow-sm"
              >
                Reset Ikon
              </button>
              <input ref={attractIconRef} type="file" accept="image/*" hidden onChange={onAttractIconFile} />
            </div>
            {attractBusy && (
              <span className="text-[10px] normal-case tracking-normal text-primary">Mengupload…</span>
            )}
            <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
              Ikon: PNG transparan 120×120. Background: 1920×1080 (video &lt;10MB).
            </span>
          </div>
        </div>

        {/* Simpan preset bernama + Aktifkan */}
        <div className="flex flex-col gap-1 font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px] border-t-4 border-black pt-3">
          <label className="flex flex-col gap-1">
            Nama Preset (untuk disimpan)
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="cth: Wedding Budi & Siti"
              className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high normal-case tracking-normal"
            />
          </label>
          <div className="mt-1 flex gap-2">
            <button
              onClick={savePresetNamed}
              disabled={busy || !presetName.trim()}
              className="flex-1 px-3 py-2 border-4 border-black bg-surface-variant text-on-surface font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container-high disabled:opacity-50"
            >
              {busy ? 'Menyimpan…' : 'Simpan Preset'}
            </button>
            <button
              onClick={activateMode}
              className="flex-1 px-3 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container"
            >
              Aktifkan Sekarang
            </button>
          </div>
          {mode === editMode && selectedPreset && (
            <span className="text-[10px] normal-case tracking-normal text-primary">
              Aktif: {selectedPreset} ({editMode === 'event' ? 'Event' : 'Regular'})
            </span>
          )}
        </div>

        <p className="font-label-bold text-label-bold text-on-surface-variant uppercase tracking-wider text-[10px]">
          Config tersimpan di database & tidak hilang saat refresh.
        </p>
      </div>
    </div>
  )
}

export type { TemplateId }
