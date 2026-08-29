import { useRef, useState, useEffect } from 'react'
import { TemplateId, useSession, AppMode } from '../../store/useSession'
import { DesignEditor } from './DesignEditor'
import { btSupported, btSavedName, btConnected, connectBt, disconnectBt, testPrintBt, autoReconnectBt, btManualOff } from '../escpos/bluetoothPrinter'
import { usbSupported, usbSavedName, usbConnected, connectUsb, disconnectUsb, testPrintUsb, autoReconnectUsb, usbManualOff } from '../escpos/usbPrinter'

// ── Panel AI Sketch (Gemini) — operator masukkan API key di sini ──────────
interface AiSettingsView {
  api_key_masked: string
  model: string
  prompt: string
  enabled: boolean
  hasKey: boolean
}

function AiSketchSettings() {
  const [st, setSt] = useState<AiSettingsView | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [promptInput, setPromptInput] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/ai/settings').then((r) => r.json()).then((j: AiSettingsView) => {
      setSt(j)
      setPromptInput(j.prompt || '')
      setEnabled(!!j.enabled)
    }).catch(() => setMsg('Gagal memuat setting AI'))
  }, [])

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true); setMsg('')
    try {
      const body: Record<string, unknown> = { prompt: promptInput, enabled, ...extra }
      if (keyInput.trim()) body.api_key = keyInput.trim()
      const r = await fetch('/api/ai/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'gagal simpan')
      setSt(j as AiSettingsView)
      setKeyInput('')
      setMsg('✅ Tersimpan')
      window.dispatchEvent(new CustomEvent('pb-ai-status-changed'))
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`)
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  return (
    <Panel title="AI Sketch (Gemini)" hint="Filter 'Sketsa AI' di booth pakai Google Gemini. Butuh internet & API key (aistudio.google.com → Get API key, ada free tier).">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-on-surface-variant">Gemini API Key</span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={st?.api_key_masked ? `Tersimpan ${st.api_key_masked} — isi untuk ganti` : 'Tempel API key di sini'}
            autoComplete="off"
            className="w-full border-2 border-black px-2 py-2 text-[12px] bg-surface-container-lowest text-on-surface"
          />
        </label>

        <label className="flex items-center gap-2 text-[11px] uppercase font-bold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 accent-black" />
          Aktifkan filter Sketsa AI di booth
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-on-surface-variant">Gaya Sketsa (prompt ke AI)</span>
          <textarea
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            rows={4}
            className="w-full border-2 border-black px-2 py-2 text-[11px] bg-surface-container-lowest text-on-surface normal-case"
          />
          <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">Bisa diganti sesuai selera, mis. tambah "vintage paper texture" atau "thick ink lines".</span>
        </label>

        <div className="flex items-center gap-2">
          <button onClick={() => save()} disabled={busy} className="px-3 py-2 border-4 border-black bg-secondary-container text-on-secondary-container font-label-bold uppercase text-[11px] neo-button brutal-shadow-sm disabled:opacity-50">
            {busy ? 'Menyimpan…' : 'Simpan Setting AI'}
          </button>
          {st && !st.hasKey && (
            <button onClick={() => save({ enabled: true, api_key: keyInput.trim() })} disabled={busy || !keyInput.trim()} className="px-3 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold uppercase text-[11px] neo-button disabled:opacity-50" title="Isi API key dulu">
              Simpan + Aktifkan
            </button>
          )}
          {msg && <span className="text-[11px] font-bold">{msg}</span>}
        </div>

        {st && (
          <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
            Status: {st.enabled && st.hasKey ? '🟢 AKTIF' : st.hasKey ? '🟡 key ada, filter belum diaktifkan' : '🔴 belum ada API key'} · Model: {st.model}
          </span>
        )}
      </div>
    </Panel>
  )
}

// Panel pembungkus seragam — rapi & konsisten antar grup setting.
function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 border-b-2 border-black pb-1">
        <span className="font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[13px]">{title}</span>
        {hint && <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

// Field input baris penuh.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[11px]">{label}</span>
      {children}
      {hint && <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high'
const btnPrimary = 'px-3 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container disabled:opacity-50'
const btnDanger = 'px-2 py-2 border-4 border-black bg-error-container text-on-error-container font-label-bold uppercase neo-button brutal-shadow-sm'
const btnGhost = 'px-3 py-2 border-4 border-black bg-surface text-on-surface font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-variant'

// ── Printer Bluetooth (BLE, mis. PP583) — konek & test print ──────────────
function BtPrinterPanel() {
  const [connState, setConnState] = useState<'idle' | 'busy' | 'on' | 'off'>(btConnected() ? 'on' : 'off')
  const [name, setName] = useState(btSavedName())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Sinkron dengan event dari modul BT (auto-reconnect / putus mendadak),
  // plus coba reconnect senyap saat panel dibuka.
  useEffect(() => {
    function sync(e: Event) {
      const { connected } = (e as CustomEvent).detail || {}
      setName(btSavedName())
      setConnState(connected ? 'on' : 'off')
    }
    window.addEventListener('pb-bt', sync)
    if (!btConnected() && !btManualOff()) autoReconnectBt() // tanpa dialog; gagal = diam
    return () => window.removeEventListener('pb-bt', sync)
  }, [])

  async function connect() {
    setBusy(true); setMsg('')
    try {
      // Coba reconnect senyap dulu (printer nyala + izin masih ada = tanpa dialog).
      if (await autoReconnectBt()) {
        setMsg(`✅ Tersambung ulang ke ${btSavedName()}`)
        return
      }
      const n = await connectBt()
      setName(n); setConnState('on')
      setMsg(`✅ Tersambung ke ${n}`)
    } catch (e) {
      setConnState('off')
      setMsg(`❌ ${(e as Error).message}`)
    } finally { setBusy(false); setTimeout(() => setMsg(''), 5000) }
  }

  async function testPrint() {
    setBusy(true); setMsg('')
    try {
      const b = useSession.getState().branding
      const m = await testPrintBt(b.paperWidth, b.printDarkness)
      setMsg(`🖨️ ${m}`)
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`)
    } finally { setBusy(false); setTimeout(() => setMsg(''), 6000) }
  }

  if (!btSupported()) {
    return (
      <Panel title="Printer Bluetooth" hint="Browser ini tidak mendukung Web Bluetooth. Pakai Chrome/Edge terbaru (Android/desktop), HTTPS aktif.">
        <span className="text-[11px] text-on-surface-variant normal-case tracking-normal">Tidak tersedia di browser ini.</span>
      </Panel>
    )
  }

  return (
    <Panel
      title={`Printer Bluetooth ${connState === 'on' ? '· 🟢' : ''}`}
      hint="Printer thermal BLE (mis. PP583) langsung dari tablet — tanpa server. Nyalakan printer, pastikan tidak dipakai app lain, lalu klik Sambungkan dan pilih printer di dialog browser."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={connect} disabled={busy} className={btnPrimary}>{busy && connState !== 'on' ? 'Menyambung…' : connState === 'on' ? 'Ganti Printer' : '🔗 Sambungkan'}</button>
        {connState === 'on' && (
          <>
            <button onClick={testPrint} disabled={busy} className={btnGhost}>🧪 Test Cetak</button>
            <button onClick={() => { disconnectBt(true) }} disabled={busy} className={btnDanger}>Putus</button>
          </>
        )}
        {connState !== 'on' && btManualOff() && <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">Diputus manual — auto-reconnect nonaktif</span>}
        {(name || connState === 'on') && <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">{connState === 'on' ? `Terhubung: ${name}` : `Terakhir: ${name}`}</span>}
      </div>
      {msg && <span className="text-[11px] normal-case tracking-normal">{msg}</span>}
    </Panel>
  )
}

// ── Printer USB (WebUSB, mis. VSC Q58M) — konek & test print ──────────────
function UsbPrinterPanel() {
  const [connState, setConnState] = useState<'on' | 'off'>(usbConnected() ? 'on' : 'off')
  const [name, setName] = useState(usbSavedName())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    function sync(e: Event) {
      const { connected } = (e as CustomEvent).detail || {}
      setName(usbSavedName())
      setConnState(connected ? 'on' : 'off')
    }
    window.addEventListener('pb-usb', sync)
    if (!usbConnected() && !usbManualOff()) autoReconnectUsb() // senyap; gagal = diam
    return () => window.removeEventListener('pb-usb', sync)
  }, [])

  async function connect() {
    setBusy(true); setMsg('')
    try {
      if (await autoReconnectUsb()) {
        setMsg(`✅ Tersambung ulang ke ${usbSavedName()}`)
        return
      }
      const n = await connectUsb()
      setName(n); setConnState('on')
      setMsg(`✅ Tersambung ke ${n}`)
    } catch (e) {
      setConnState('off')
      setMsg(`❌ ${(e as Error).message}`)
    } finally { setBusy(false); setTimeout(() => setMsg(''), 5000) }
  }

  async function testPrint() {
    setBusy(true); setMsg('')
    try {
      const m = await testPrintUsb(useSession.getState().branding.paperWidth, useSession.getState().branding.printDarkness)
      setMsg(`🖨️ ${m}`)
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`)
    } finally { setBusy(false); setTimeout(() => setMsg(''), 6000) }
  }

  if (!usbSupported()) {
    return (
      <Panel title="Printer USB" hint="Browser ini tidak mendukung WebUSB. Pakai Chrome/Edge terbaru. Di Android perlu kabel/konektor OTG.">
        <span className="text-[11px] text-on-surface-variant normal-case tracking-normal">Tidak tersedia di browser ini.</span>
      </Panel>
    )
  }

  return (
    <Panel
      title={`Printer USB ${connState === 'on' ? '· 🟢' : ''}`}
      hint="Printer thermal USB (mis. VSC Q58M) langsung dari tablet/laptop — tanpa server. Colok via OTG (Android) atau USB langsung, klik Sambungkan lalu pilih printer di dialog browser."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={connect} disabled={busy} className={btnPrimary}>{connState === 'on' ? 'Ganti Printer' : '🔗 Sambungkan'}</button>
        {connState === 'on' && (
          <>
            <button onClick={testPrint} disabled={busy} className={btnGhost}>🧪 Test Cetak</button>
            <button onClick={() => { disconnectUsb(true) }} disabled={busy} className={btnDanger}>Putus</button>
          </>
        )}
        {connState !== 'on' && usbManualOff() && <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">Diputus manual — auto-reconnect nonaktif</span>}
        {(name || connState === 'on') && <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">{connState === 'on' ? `Terhubung: ${name}` : `Terakhir: ${name}`}</span>}
      </div>
      {msg && <span className="text-[11px] normal-case tracking-normal">{msg}</span>}
    </Panel>
  )
}

export function Settings({ onClose, onAttractChange }: { onClose: () => void; onAttractChange?: () => void }) {
  const { branding, bridgeUrl, frames, mode, price, setBranding, setBridgeUrl, setMode, setPrice, applyConfig } = useSession()
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
  const [presetSnapshot, setPresetSnapshot] = useState<{ mode: string; price: number; branding: any } | null>(null)
  // Tab dashboard settings.
  const [activeTab, setActiveTab] = useState<string>('booth')

  // Saat Settings dibuka: sync dari store (yang di-load dari DB saat refresh)
  // agar preset yang sedang aktif otomatis ter-pilih -> simpan = UPDATE, bukan buat baru.
  useEffect(() => {
    const s = useSession.getState()
    setEditMode(s.mode)
    setDraftPrice(s.mode === 'event' ? 0 : s.price)
    const name = s.activePresetName || ''
    setSelectedPreset(name)
    loadPresets(s.mode)
    // Set snapshot dari preset aktif agar diff perubahan jalan sejak awal.
    if (name) {
      fetch(`/api/presets/${encodeURIComponent(name)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (p?.branding) setPresetSnapshot({ mode: p.mode, price: Number(p.price) || 0, branding: p.branding })
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!name) { setPresetSnapshot(null); return }
    try {
      const p = await (await fetch(`/api/presets/${encodeURIComponent(name)}`)).json()
      if (p?.branding) {
        useSession.getState().setBranding(p.branding)
        setDraftPrice(p.mode === 'event' ? 0 : Number(p.price) || 5000)
        // Simpan snapshot original buat diff (deteksi perubahan).
        setPresetSnapshot({ mode: p.mode, price: Number(p.price) || 0, branding: p.branding })
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
    setPresetSnapshot(null)
    await loadPresets(m)
  }

  // Simpan config: kalau sedang edit preset yg dipilih -> UPDATE (PUT),
  // kalau belum pilih preset (nama kosong) -> buat PRESET BARU (POST).
  async function savePresetNamed() {
    const target = selectedPreset || presetName.trim()
    if (!target) return
    setBusy(true)
    try {
      if (selectedPreset) {
        // Update preset yg sudah ada (hanya ubah field, tidak buat duplikat).
        await fetch(`/api/presets/${encodeURIComponent(selectedPreset)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: editMode,
            price: editMode === 'event' ? 0 : draftPrice,
            branding: useSession.getState().branding,
          }),
        })
        // Refresh snapshot ke state sekarang -> perubahan jadi 0 (tersimpan).
        setPresetSnapshot({
          mode: editMode,
          price: editMode === 'event' ? 0 : draftPrice,
          branding: { ...useSession.getState().branding },
        })
        await loadPresets(editMode)
      } else {
        // Buat preset baru.
        await fetch('/api/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: target,
            mode: editMode,
            price: editMode === 'event' ? 0 : draftPrice,
            branding: useSession.getState().branding,
          }),
        })
        setSelectedPreset(target)
        await loadPresets(editMode)
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  // Hitung perubahan preset (snapshot vs state sekarang) untuk info & validasi.
  function computeChanges(): string[] {
    if (!presetSnapshot) return []
    const changes: string[] = []
    const cur = useSession.getState().branding
    const old = presetSnapshot.branding || {}
    const fields: [string, string, any, any][] = [
      ['Nama Event', 'eventName', cur.eventName, old.eventName],
      ['Logo', 'logoDataUrl', cur.logoDataUrl, old.logoDataUrl],
      ['Tampilkan tanggal', 'showDate', cur.showDate, old.showDate],
      ['Nama event di hasil', 'showEventNameOnPrint', cur.showEventNameOnPrint, old.showEventNameOnPrint],
      ['Kotak Capturing (booth)', 'showCapturingBox', cur.showCapturingBox, old.showCapturingBox],
      ['Watermark', 'watermark', cur.watermark, old.watermark],
      ['QR', 'qrText', cur.qrText, old.qrText],
      ['Jarak atas', 'photoTopPad', cur.photoTopPad, old.photoTopPad],
      ['Jarak bawah', 'photoBottomPad', cur.photoBottomPad, old.photoBottomPad],
      ['Jarak antar foto', 'photoGap', cur.photoGap, old.photoGap],
      ['Jarak 2×2 X', 'photoGap2x2X', cur.photoGap2x2X, old.photoGap2x2X],
      ['Jarak 2×2 Y', 'photoGap2x2Y', cur.photoGap2x2Y, old.photoGap2x2Y],
    ]
    for (const [label, , cv, ov] of fields) {
      const a = cv ?? ''
      const b = ov ?? ''
      if (String(a) !== String(b)) changes.push(label)
    }
    if ((editMode === 'event' ? 0 : draftPrice) !== (presetSnapshot.mode === 'event' ? 0 : presetSnapshot.price)) {
      changes.push('Harga')
    }
    if (editMode !== presetSnapshot.mode) changes.push('Mode')
    return changes
  }

  const pendingChanges = computeChanges()
  const canUpdate = selectedPreset && pendingChanges.length > 0

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
        className="w-full max-w-5xl bg-surface border-4 border-black brutal-shadow flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-4 border-black px-4 py-2 bg-[#FFE600]">
          <h2 className="font-headline-md text-headline-md-mobile uppercase tracking-tight text-on-surface">
            Pengaturan
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-9 h-9 border-2 border-black bg-surface-variant rounded neo-button brutal-shadow-sm hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-on-surface">close</span>
          </button>
        </div>

        {/* Body: sidebar + panel */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="w-44 shrink-0 border-r-4 border-black bg-surface-container-lowest flex flex-col gap-1 p-2 overflow-y-auto">
            {([
              ['booth', 'Booth & Preset'],
              ['branding', 'Branding'],
              ['print', 'Tampilan Cetak'],
              ['frames', 'Bingkai'],
              ['design', 'Desain Mockup'],
              ['attract', 'Layar Awal'],
              ['ai', 'AI Sketch'],
              ['save', 'Simpan'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`text-left px-3 py-2 border-2 border-black font-label-bold uppercase text-[11px] neo-button transition-all ${
                  activeTab === id
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface text-on-surface hover:bg-surface-variant'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Panel kanan */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-5">
            {activeTab === 'booth' && (
              <>
                <Panel title="Mode Booth" hint="Settingan tiap mode tersimpan sendiri di DB.">
                  <div className="flex gap-2">
                    {(['regular', 'event'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => switchMode(m)}
                        className={`flex-1 px-2 py-2 border-4 border-black text-[11px] font-label-bold uppercase neo-button brutal-shadow-sm transition-all duration-75 ${
                          editMode === m ? 'bg-primary-container text-on-primary-container' : 'bg-surface text-on-surface hover:bg-surface-variant'
                        }`}
                      >
                        {m === 'regular' ? 'Regular (bayar)' : 'Event (gratis)'}
                      </button>
                    ))}
                  </div>
                </Panel>

                <Panel title={`Preset ${editMode === 'event' ? 'Event' : 'Regular'}`} hint="Pilih config tersimpan, field auto-isi.">
                  <select value={selectedPreset} onChange={(e) => onPresetChange(e.target.value)} className={inputCls}>
                    <option value="">— Pilih preset / kosong —</option>
                    {presets.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  {presets.length === 0 && (
                    <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
                      Belum ada preset. Isi field lalu Simpan di tab Simpan.
                    </span>
                  )}
                </Panel>

                {editMode === 'regular' && (
                  <Panel title="Harga per Cetak (Rp)">
                    <input type="number" min={0} value={draftPrice} onChange={(e) => setDraftPrice(Number(e.target.value) || 0)} className={inputCls} />
                  </Panel>
                )}
              </>
            )}

            {activeTab === 'branding' && (
              <>
                <Field label="Nama Event">
                  <input value={branding.eventName} onChange={(e) => setBranding({ eventName: e.target.value })} className={inputCls} />
                </Field>
                <Panel title="Logo (PNG/JPG)">
                  <div className="flex items-center gap-2">
                    <button onClick={() => fileRef.current?.click()} className={btnPrimary}>Pilih file</button>
                    {branding.logoDataUrl && (
                      <button onClick={() => setBranding({ logoDataUrl: null })} className={btnDanger}>Hapus</button>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
                  </div>
                </Panel>
                <Panel title="Opsi Cetak">
                  <label className="flex items-center gap-2 font-label-bold text-label-bold text-on-surface text-[12px]">
                    <input type="checkbox" checked={branding.showDate} onChange={(e) => setBranding({ showDate: e.target.checked })} className="w-5 h-5 border-4 border-black accent-primary-container" />
                    Tampilkan tanggal
                  </label>
                  <label className="flex items-center gap-2 font-label-bold text-label-bold text-on-surface text-[12px]">
                    <input type="checkbox" checked={branding.showEventNameOnPrint} onChange={(e) => setBranding({ showEventNameOnPrint: e.target.checked })} className="w-5 h-5 border-4 border-black accent-primary-container" />
                    Nama event di hasil
                  </label>
                  <label className="flex items-center gap-2 font-label-bold text-label-bold text-on-surface text-[12px]">
                    <input type="checkbox" checked={branding.showCapturingBox} onChange={(e) => setBranding({ showCapturingBox: e.target.checked })} className="w-5 h-5 border-4 border-black accent-primary-container" />
                    Kotak Capturing (booth)
                  </label>
                </Panel>
                <Field label="Watermark / Footer" hint="cth: thank you!">
                  <input value={branding.watermark} onChange={(e) => setBranding({ watermark: e.target.value })} placeholder="cth: thank you!" className={inputCls} />
                </Field>
                <Field label="QR Code" hint="Link foto digital / teks.">
                  <input value={branding.qrText} onChange={(e) => setBranding({ qrText: e.target.value })} placeholder="https://..." className={inputCls} />
                </Field>
              </>
            )}

            {activeTab === 'print' && (
              <>
                <BtPrinterPanel />

                <UsbPrinterPanel />

                <Panel title="Lebar Kertas" hint="PP583/mini portable = 58mm. Printer thermal besar = 80mm. Hasil cetak otomatis diskalakan ke lebar head printer.">
                  <div className="flex gap-2">
                    {(['58mm', '80mm'] as const).map((w) => (
                      <button
                        key={w}
                        onClick={() => setBranding({ paperWidth: w })}
                        className={`px-4 py-2 border-4 border-black font-label-bold uppercase neo-button brutal-shadow-sm ${branding.paperWidth === w ? 'bg-primary-container text-on-primary-container' : 'bg-surface text-on-surface hover:bg-surface-variant'}`}
                      >
                        {w}{branding.paperWidth === w ? ' ✓' : ''}
                      </button>
                    ))}
                  </div>
                </Panel>

                <Panel title="Kegelapan Cetak (%)" hint="Hasil samar/tipis → naikkan (130–160). Makin tinggi makin tebal tapi foto bisa kebanyakan titik hitam.">
                  <label className="flex flex-col gap-1 normal-case tracking-normal">
                    <span className="flex items-center justify-between text-[11px]">
                      <span>Kegelapan</span>
                      <span className="font-bold">{branding.printDarkness ?? 100}%</span>
                    </span>
                    <input
                      type="range"
                      min={100}
                      max={200}
                      step={5}
                      value={branding.printDarkness ?? 100}
                      onChange={(e) => setBranding({ printDarkness: Number(e.target.value) })}
                      className="w-full accent-black"
                    />
                  </label>
                </Panel>

                <Panel title="Jarak Dekorasi Foto (px)" hint="Foto dipisah dari logo/QR & antar foto agar bisa dihias.">
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
                      <input type="range" min={0} max={200} step={2} value={val} onChange={(e) => setBranding({ [key]: Number(e.target.value) } as any)} className="w-full accent-black" />
                    </label>
                  ))}
                  <label className="flex flex-col gap-1 normal-case tracking-normal border-t-2 border-dashed border-black/30 pt-2 mt-1">
                    <span className="flex items-center justify-between text-[11px]">
                      <span>2×2 — Kiri/kanan (X)</span>
                      <span className="font-bold">{branding.photoGap2x2X ?? 20}px</span>
                    </span>
                    <input type="range" min={0} max={200} step={2} value={branding.photoGap2x2X ?? 20} onChange={(e) => setBranding({ photoGap2x2X: Number(e.target.value) })} className="w-full accent-black" />
                  </label>
                  <label className="flex flex-col gap-1 normal-case tracking-normal">
                    <span className="flex items-center justify-between text-[11px]">
                      <span>2×2 — Atas/bawah (Y)</span>
                      <span className="font-bold">{branding.photoGap2x2Y ?? 20}px</span>
                    </span>
                    <input type="range" min={0} max={200} step={2} value={branding.photoGap2x2Y ?? 20} onChange={(e) => setBranding({ photoGap2x2Y: Number(e.target.value) })} className="w-full accent-black" />
                  </label>
                  <span className="text-[10px] text-on-surface-variant">Hanya grid 2×2. Template lain pakai "Antar foto" di atas.</span>
                </Panel>

                <Field label="Bridge URL" hint="Node print server (opsional).">
                  <input value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} placeholder="http://192.168.1.10:8787" className={inputCls} />
                </Field>
              </>
            )}

            {activeTab === 'frames' && (
              <Panel title="Gallery Bingkai Custom" hint="Simpan di DB, customer pilih di booth. Bisa upload lebih dari satu.">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={frameTemplate} onChange={(e) => setFrameTemplate(e.target.value)} className="px-2 py-2 border-4 border-black bg-surface text-on-surface font-label-bold text-[11px] uppercase" title="Template tujuan bingkai (kosong = semua template)">
                    <option value="">Semua template</option>
                    <option value="strip3">3 Vertikal</option>
                    <option value="single">1 Foto</option>
                    <option value="grid2x2">2×2</option>
                  </select>
                  <button onClick={() => galleryRef.current?.click()} className={btnPrimary}>+ Upload Bingkai</button>
                  <input ref={galleryRef} type="file" accept="image/png,image/*" multiple hidden onChange={onGallery} />
                </div>
                <a href="/guides/README.html" target="_blank" rel="noreferrer" className="text-[10px] normal-case tracking-normal text-primary underline decoration-2 decoration-black/40 hover:decoration-black w-fit">
                  📐 Panduan ukuran & board Canva (download)
                </a>
                {galleryBusy && <span className="text-[10px] normal-case tracking-normal text-primary">Mengupload…</span>}
                {frames.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {frames.map((f) => (
                      <div key={f.id} className="relative border-2 border-black bg-white">
                        <img src={f.url} alt={f.name} className="h-14 w-11 object-contain" />
                        <button onClick={() => removeFrame(f.id)} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-error-container border-2 border-black text-on-error-container font-label-bold text-[12px]" title="Hapus">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {activeTab === 'design' && (
              <div className="border-2 border-black bg-surface-container-lowest">
                <DesignEditor />
              </div>
            )}

            {activeTab === 'ai' && <AiSketchSettings />}

            {activeTab === 'attract' && (
              <Panel title={`Layar Awal (Attract) — ${mode === 'event' ? 'Event' : 'Regular'}`} hint='Background & ikon untuk layar "Sentuh untuk mulai". Tersimpan di DB, otomatis tiap mode.'>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => attractRef.current?.click()} className={btnPrimary}>+ Background</button>
                    <button onClick={deleteAttractBg} className={btnDanger}>Hapus BG</button>
                    <input ref={attractRef} type="file" accept="image/*,video/*" hidden onChange={onAttractFile} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => attractIconRef.current?.click()} className={btnPrimary}>+ Ganti Ikon</button>
                    <button onClick={deleteAttractIcon} className={btnDanger}>Reset Ikon</button>
                    <input ref={attractIconRef} type="file" accept="image/*" hidden onChange={onAttractIconFile} />
                  </div>
                  {attractBusy && <span className="text-[10px] normal-case tracking-normal text-primary">Mengupload…</span>}
                  <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">Ikon: PNG transparan 120×120. Background: 1920×1080 (video &lt;10MB).</span>
                </div>
              </Panel>
            )}

            {activeTab === 'save' && (
              <Panel title="Simpan & Aktifkan">
                {!selectedPreset && (
                  <Field label="Nama Preset" hint="Untuk menyimpan sebagai preset baru.">
                    <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="cth: Wedding Budi & Siti" className={`${inputCls} normal-case tracking-normal`} />
                  </Field>
                )}
                {selectedPreset && (
                  <span className="text-[11px] normal-case tracking-normal text-on-surface-variant">
                    Mengedit preset <b className="text-on-surface">{selectedPreset}</b>.
                    {pendingChanges.length > 0 ? (
                      <> Perubahan terdeteksi: <b className="text-on-surface">{pendingChanges.join(', ')}</b>.</>
                    ) : (
                      <> Tidak ada perubahan — ubah field dulu untuk bisa update.</>
                    )}
                  </span>
                )}
                <div className="flex gap-2">
                  <button onClick={savePresetNamed} disabled={busy || (selectedPreset ? !canUpdate : !presetName.trim())} className={btnGhost}>
                    {busy ? 'Menyimpan…' : selectedPreset ? 'Update Preset' : 'Simpan Baru'}
                  </button>
                  <button onClick={activateMode} className={btnPrimary}>Aktifkan Sekarang</button>
                </div>
                {mode === editMode && selectedPreset && (
                  <span className="text-[10px] normal-case tracking-normal text-primary">Aktif: {selectedPreset} ({editMode === 'event' ? 'Event' : 'Regular'})</span>
                )}
                <p className="font-label-bold text-label-bold text-on-surface-variant uppercase tracking-wider text-[10px]">
                  Config tersimpan di database & tidak hilang saat refresh.
                </p>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export type { TemplateId }
