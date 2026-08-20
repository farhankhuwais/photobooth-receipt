import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession } from './store/useSession'
import { useCamera } from './modules/camera/useCamera'
import { composeStrip } from './modules/templates/TemplateEngine'
import { printSmart } from './modules/print/printService'
import { shareImage } from './modules/share/share'
import { uploadStrip } from './modules/share/upload'
import { buildPrintJob } from './modules/escpos/encoder'
import { Settings } from './modules/branding/Settings'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function App() {
  const { videoRef, error } = useCamera()
  const { shots, template, shotCount, branding, frames, selectedFrameId, designs, selectedDesignId, mode, price, status, digitalUrl, screen, paid, payStage, cashConfirm, addShot, setBranding, setSelectedFrameId, resetShots, enterBooth, goAttract, openPay, closePay, chooseCash, confirmCashPaid, payQrisSim, resetPay } = useSession()
  const [countdown, setCountdown] = useState<number | null>(null)
  const [stripUrl, setStripUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [showSettings, setShowSettings] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)     // 1=pilih grid, 2=pilih desain
  const [grid, setGrid] = useState<number | null>(null) // jumlah foto terpilih (1/2/3/4)
  const [armed, setArmed] = useState(false)      // kamera sudah "siap" (tombol Mulai Jepret ditekan)
  const [attractMedia, setAttractMedia] = useState<{ type: 'image' | 'video'; url: string } | null>(null)
  const [attractIcon, setAttractIcon] = useState<string | null>(null)
  const stripCanvas = useRef<HTMLCanvasElement | null>(null)
  const running = useRef(false)

  // Load background attract untuk mode saat ini (regular/event) dari DB.
  function loadAttract(m: 'regular' | 'event') {
    fetch(`/api/attract/${m}`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b) {
          if (useSession.getState().mode === m) setAttractMedia(null)
          return
        }
        const url = URL.createObjectURL(b)
        const isVideo = b.type.startsWith('video/')
        if (useSession.getState().mode === m) {
          setAttractMedia({ type: isVideo ? 'video' : 'image', url })
        }
      })
      .catch(() => {})
  }

  // Load ikon tap custom per mode dari DB.
  function loadAttractIcon(m: 'regular' | 'event') {
    fetch(`/api/attract/${m}/icon`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        const url = b ? URL.createObjectURL(b) : null
        if (useSession.getState().mode === m) setAttractIcon(url)
      })
      .catch(() => {})
  }

  // Reload background + ikon attract setelah diubah di panel Settings.
  function reloadAttract() {
    const m = useSession.getState().mode
    loadAttract(m)
    loadAttractIcon(m)
  }

  // Load attract background + ikon saat mode berubah / boot.
  useEffect(() => {
    loadAttract(mode)
    loadAttractIcon(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Load gallery frame custom dari DB. Filter per template (?template=) + universal (NULL).
  // Saat template berubah, list di-refresh & frame pertama otomatis dipilih (kalau ada).
  const loadFrames = useCallback(async (tpl: string) => {
    try {
      const list = await fetch(`/api/frames?template=${tpl}`).then((r) => (r.ok ? r.json() : []))
      const frames = list.map((f: { id: string; name: string; template?: string | null }) => ({ id: f.id, name: f.name, template: f.template ?? null, url: `/api/frames/${f.id}` }))
      const st = useSession.getState()
      st.setFrames(frames)
      // Auto-pilih: prioritas frame yg template-nya PERSIS cocok; kalau gak ada,
      // pilih universal (template NULL) pertama; kalau kosong -> null.
      const exact = frames.find((f: { id: string; name: string; template?: string | null; url: string }) => f.template === tpl)
      const universal = frames.find((f: { id: string; name: string; template?: string | null; url: string }) => !f.template)
      st.setSelectedFrameId((exact || universal)?.id ?? null)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    let active = true
    loadFrames(template).then(() => { if (!active) return })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, loadFrames])

  // Load daftar design/mockup dari DB.
  async function loadDesigns() {
    try {
      const list = await (await fetch('/api/designs')).json()
      if (!Array.isArray(list)) return
      useSession.getState().setDesigns(list)
    } catch { /* ignore */ }
  }

  // Load design saat boot + tiap masuk booth (biar design baru langsung muncul).
  useEffect(() => {
    loadDesigns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Saat masuk booth, refresh daftar design & reset alur pilih (grid -> desain).
  useEffect(() => {
    if (screen !== 'booth') return
    setStep(1); setGrid(null); setArmed(false)
    loadDesigns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  // Pilih design: fetch detail (slot + bingkai) lalu resolve koordinat ke PRINT_WIDTH.
  // id=null = Template Biasa (tanpa mockup), jumlah foto ikut grid terpilih.
  async function pickDesign(id: string | null) {
    const st = useSession.getState()
    if (!id) {
      st.setSelectedDesignId(null)
      st.setDesign(null)
      useSession.setState({ shotCount: grid ?? 1 })
      return
    }
    const d = await fetch(`/api/designs/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!d) return
    const scale = 576 / (d.canvas_w || 308)
    const slots = (d.slots || []).map((s: any) => ({
      x: Math.round(s.x * scale),
      y: Math.round(s.y * scale),
      w: Math.round(s.w * scale),
      h: Math.round(s.h * scale),
      rot: s.rot || 0,
    }))
    st.setDesign({
      id: d.id,
      name: d.name,
      frameUrl: d.hasFrame ? `/api/designs/${d.id}/frame` : null,
      canvasW: d.canvas_w,
      canvasH: d.canvas_h,
      slots,
    })
    st.setSelectedDesignId(id)
    // Jumlah foto = jumlah slot design (override template).
    useSession.setState({ shotCount: slots.length })
  }

  // Load active config dari DB saat boot (survive refresh).
  useEffect(() => {
    let active = true
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (!active || !cfg) return
        const st = useSession.getState()
        st.setMode(cfg.mode === 'event' ? 'event' : 'regular')
        st.setPrice(Number(cfg.price) || 5000)
        st.setActivePreset(cfg.preset_name || null)
        if (cfg.branding) st.setBranding(cfg.branding)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  function captureFrame() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    // Crop center ke aspect 4:3 (sama dengan layout template cetak: shotH = shotW*0.75)
    const tar = 4 / 3
    const vAr = video.videoWidth / video.videoHeight
    let sx = 0
    let sy = 0
    let sw = video.videoWidth
    let sh = video.videoHeight
    if (vAr > tar) {
      sw = video.videoHeight * tar
      sx = (video.videoWidth - sw) / 2
    } else {
      sh = video.videoWidth / tar
      sy = (video.videoHeight - sh) / 2
    }
    const c = document.createElement('canvas')
    c.width = Math.round(sw)
    c.height = Math.round(sh)
    const ctx = c.getContext('2d')
    if (!ctx) return
    // Mirror horizontal biar sama dengan preview (CSS -scale-x-100)
    ctx.translate(c.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height)
    addShot(c.toDataURL('image/jpeg', 0.9))
  }

  async function finishCompose() {
    const s = useSession.getState()
    if (!s.shots.length) return
    let qrUrl: string | null = s.digitalUrl
    if (s.bridgeUrl) {
      const first = await composeStrip(s.shots, s.branding, s.template, '', s.frames, s.selectedFrameId, s.design)
      try {
        qrUrl = await uploadStrip(first.toDataURL('image/png'), s.bridgeUrl)
        useSession.getState().setDigitalUrl(qrUrl)
      } catch {
        qrUrl = s.branding.qrText || null
      }
    }
    const canvas = await composeStrip(s.shots, s.branding, s.template, qrUrl, s.frames, s.selectedFrameId, s.design)
    stripCanvas.current = canvas
    setStripUrl(canvas.toDataURL('image/png'))
  }

  async function runCapture() {
    if (running.current) return
    running.current = true
    const store = useSession.getState()
    store.resetShots()
    setStripUrl(null)
    setMsg('')
    store.setStatus('capturing')
    const count = store.shotCount
    try {
      for (let i = 0; i < count; i++) {
        for (let c = 3; c > 0; c--) {
          setCountdown(c)
          await sleep(1000)
        }
        setCountdown(0)
        await sleep(250)
        captureFrame()
        await sleep(600)
      }
      setCountdown(null)
      useSession.getState().setStatus('done')
      await finishCompose()
    } catch (e) {
      setMsg(`Capture gagal: ${(e as Error).message}`)
    } finally {
      running.current = false
    }
  }

  // Saat customer ganti bingkai custom (gallery), compose ulang preview hasil.
  useEffect(() => {
    if (status === 'done') finishCompose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFrameId, frames])

  // CETAK = gerbang pembayaran. Di mode event (jasa) skip paywall -> langsung cetak.
  // Di mode regular, buka layar BAYAR (QRIS / CASH).
  function onPrint() {
    if (!stripCanvas.current) return
    const s = useSession.getState()
    if (s.mode === 'event') {
      // Event: langsung lunas (gratis), trigger efek cetak di bawah.
      s.setPaid(true)
    } else {
      openPay()
    }
  }

  // Saat lunas (QRIS simulasi ATAU cash dikonfirmasi operator), cetak otomatis
  // + log transaksi ke server (untuk dashboard admin).
  useEffect(() => {
    if (!paid || !stripCanvas.current) return
    let active = true
    ;(async () => {
      const res = await printSmart(stripCanvas.current!, useSession.getState().bridgeUrl)
      if (active) setMsg(res.message)
      // Log transaksi: method diambil dari paymentMethod store (sudah di-set
      // saat lunas: payQrisSim -> 'qris', confirmCashPaid -> 'cash').
      const s = useSession.getState()
      const method = s.paymentMethod || 'unknown'
      const amount = s.mode === 'event' ? 0 : s.price
      try {
        await fetch('/portal/api/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method,
            amount,
            template: s.template,
            note: method === 'cash' ? 'operator confirm' : 'qris sim',
            preset: s.activePresetName || null,
            mode: s.mode,
          })
        })
      } catch {
        /* log gagal tidak menggagalkan print */
      }
      resetPay()
    })()
    return () => {
      active = false
    }
  }, [paid, resetPay])

  async function onShare() {
    if (!stripUrl) return
    const r = await shareImage(stripUrl)
    setMsg(r)
  }

  function onReset() {
    resetShots()
    setStripUrl(null)
    setCountdown(null)
    setMsg('')
  }

  function onSaveBin() {
    if (!stripCanvas.current) return
    const job = buildPrintJob(stripCanvas.current)
    const blob = new Blob([job.buffer as ArrayBuffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'escpos-job.bin'
    a.click()
    URL.revokeObjectURL(url)
    setMsg(`ESC/POS ${job.length} bytes disimpan → escpos-job.bin`)
  }

  useEffect(() => {
    if (status !== 'done' || !stripCanvas.current || !useSession.getState().shots.length) return
    const s = useSession.getState()
    composeStrip(s.shots, s.branding, s.template, s.digitalUrl, s.frames, s.selectedFrameId, s.design).then((c) => {
      stripCanvas.current = c
      setStripUrl(c.toDataURL('image/png'))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding, digitalUrl, status, selectedFrameId, frames])

  // Layar hasil TIDAK auto-reset; customer balik ke attract via tombol "AKHIRI SESI"
  // (atau ULANGI untuk foto ulang). Biar tidak tiba-tiba hilang saat lagi lihat foto.
  // Auto-reset dihapus — ganti tombol manual di bawah.
  useEffect(() => {
    if (status !== 'done') return
    // no auto-timeout; sesi diakhiri manual
  }, [status, goAttract])

  // Saat kembali ke layar attract, bersihkan preview lokal (foto customer ilang).
  useEffect(() => {
    if (screen === 'attract') {
      setStripUrl(null)
      setCountdown(null)
      setMsg('')
    }
  }, [screen])

  return (
    <div className="bg-[#FFE600] text-black min-h-screen flex flex-col font-body-md overflow-x-hidden selection:bg-primary-container selection:text-on-primary-container">
      {screen === 'attract' ? (
        /* Layar attract — kiosk idle, customer tap untuk mulai */
        <main className="relative flex-grow flex flex-col items-center justify-center bg-[#FFE600] px-margin-mobile select-none overflow-hidden">
          {/* Background image/video (per mode, dari DB) */}
          {attractMedia && (
            attractMedia.type === 'video' ? (
              <video
                src={attractMedia.url}
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover z-0"
              />
            ) : (
              <img
                src={attractMedia.url}
                alt=""
                className="absolute inset-0 w-full h-full object-cover z-0"
              />
            )
          )}
          {/* Overlay tipis biar teks tetap kebaca tanpa menutupi background */}
          <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/25 via-black/10 to-black/35 pointer-events-none"></div>

          {/* Tombol Pengaturan pojok kanan atas (satu pintu semua setting) */}
          <div className="absolute top-sm right-sm z-30">
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-12 h-12 border-4 border-black bg-surface text-on-surface brutal-shadow-sm hover:bg-surface-variant"
              title="Pengaturan"
            >
              <span className="material-symbols-outlined text-[24px]">settings</span>
            </button>
          </div>

          <button
            onClick={enterBooth}
            className="relative z-10 group mt-16 flex flex-col items-center justify-center gap-md w-[min(90vw,720px)] aspect-[4/3] bg-transparent border-0 transition-transform duration-300 hover:scale-[1.02]"
          >
            {attractIcon ? (
              <img
                src={attractIcon}
                alt=""
                className="w-[120px] h-[120px] object-contain drop-shadow-[4px_4px_0px_rgba(0,0,0,0.8)] attract-beat"
              />
            ) : (
              <span className="material-symbols-outlined text-[120px] text-white drop-shadow-[4px_4px_0px_rgba(0,0,0,0.8)] group-hover:scale-110 transition-transform duration-300 attract-beat">touch_app</span>
            )}
            <span className="font-headline-lg-mobile md:text-headline-lg font-black uppercase tracking-wider text-white drop-shadow-[3px_3px_0px_rgba(0,0,0,0.8)] attract-beat">Sentuh untuk mulai</span>
            <span className="font-label-bold text-label-bold text-white/90 uppercase tracking-widest text-[12px] drop-shadow-[2px_2px_0px_rgba(0,0,0,0.8)]">
              {mode === 'event' ? `Event • ${branding.eventName || 'Acara'}` : `Photobooth • Rp ${price.toLocaleString('id-ID')} / cetak`}
            </span>
            <span className="material-symbols-outlined text-[40px] text-white/90 drop-shadow-[2px_2px_0px_rgba(0,0,0,0.8)] attract-hint">arrow_downward</span>
          </button>
        </main>
      ) : (
        <>
          {/* Header */}
          <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-margin-mobile py-sm bg-[#FFE600] border-b-4 border-black brutal-shadow-sm">
            <button
                            onClick={() => (screen === 'booth' && status === 'idle' ? (step === 1 ? goAttract() : setStep(1)) : onReset())}
                            title={screen === 'booth' && status === 'idle' ? 'Kembali' : 'Mulai ulang sesi'}
                            className="flex items-center justify-center w-10 h-10 border-2 border-black bg-surface rounded hover:bg-surface-variant neo-button neo-btn-hover brutal-shadow-sm"
            >
              <span className="material-symbols-outlined text-on-surface">{screen === 'booth' && status === 'idle' ? 'arrow_back' : 'restart_alt'}</span>
            </button>
            <div className="flex flex-col items-center">
              <h1 className="font-headline-md text-headline-md-mobile md:text-headline-md font-black text-on-surface uppercase tracking-tight">Photobooth 📸</h1>
              <span className="font-label-bold text-label-bold text-on-surface-variant uppercase tracking-wider text-[10px]">{branding.eventName}</span>
            </div>
            <div className="w-10 h-10" />
          </header>

          {error && (
            <div className="w-full max-w-md mx-auto mt-[80px] bg-error-container border-4 border-black text-on-error-container font-label-bold p-3 brutal-shadow-sm">
              {error}
            </div>
          )}

          {/* Main Layout */}
          <main className={`flex-grow pt-[80px] pb-xl flex flex-col relative ${status === 'done' ? 'md:grid md:grid-cols-12 md:gap-gutter md:items-start bg-[#FFE600] px-margin-mobile' : 'bg-[#FFE600] px-margin-mobile'}`}>

            {status !== 'done' && screen === 'booth' && (
              <>
            <div className={`w-full max-w-3xl mx-auto flex flex-col items-center justify-center mt-2 ${status === 'capturing' ? 'flex-grow' : 'flex-none'}`}>
              {/* Kamera HANYA tampil saat capturing (setelah user pilih mockup & next).
                  Di tahap pilih (idle) kamera disembunyikan. */}
              {status === 'capturing' && (
              <div className="relative w-full max-w-2xl aspect-[4/3] border-4 border-black brutal-shadow bg-surface-container overflow-hidden">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover z-0 -scale-x-100"
                />

                {/* Guide grid sesuai template (biar user tahu framing foto) */}
                <div className="absolute inset-0 z-10 pointer-events-none">
                  {template === 'grid2x2' && (
                    <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="border border-dashed border-white/70" />
                      ))}
                    </div>
                  )}
                  {template === 'strip3' && (
                    <div className="flex flex-col w-full h-full">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="flex-1 border border-dashed border-white/70" />
                      ))}
                    </div>
                  )}
                  {/* single: seluruh frame = 1 foto, tanpa guide dalam */}
                </div>

                <div className="absolute top-sm right-sm z-20 bg-primary-container border-2 border-black px-sm py-xs text-on-primary-container font-label-bold text-label-bold flex items-center gap-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  <span className="w-2 h-2 rounded-full bg-error animate-pulse border border-black"></span> LIVE
                </div>

                {/* Countdown transparan — TIDAK menutupi kamera */}
                {status === 'capturing' && countdown !== null && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none">
                    <span className={`font-display text-display font-black text-primary-container select-none text-[150px] leading-none ${countdown > 0 ? 'pulse-text' : ''}`} style={{ textShadow: '6px 6px 0px #000, 0 0 20px #ffff00' }}>
                      {countdown === 0 ? '📸' : countdown}
                    </span>
                  </div>
                )}
              </div>
              )}
              {status === 'capturing' && !armed && (
                <button
                  onClick={() => { setArmed(true); runCapture() }}
                  className="mt-4 w-full max-w-2xl py-lg border-4 border-black bg-secondary-container text-on-secondary-container brutal-shadow neo-button flex items-center justify-center gap-sm relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 ease-in-out"></div>
                  <span className="font-headline-lg-mobile md:text-headline-lg font-black uppercase tracking-wider relative z-10">Mulai Jepret</span>
                  <span className="material-symbols-outlined text-[32px] md:text-[48px] relative z-10" style={{fontVariationSettings: "'FILL' 1"}}>photo_camera</span>
                </button>
              )}
            </div>

            {status === 'idle' ? (
              <div className="w-full max-w-4xl mx-auto flex flex-col gap-md mt-4 pb-sm pt-2">
                {step === 1 ? (
                  <>
                    <span className="self-start font-headline-md-mobile md:text-headline-md font-black uppercase tracking-wider text-black bg-[#FF4D9D] border-4 border-black px-3 py-1 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -rotate-1">Pilih Jumlah Foto</span>
                    <span className="text-[12px] text-black font-label-bold uppercase bg-white border-2 border-black px-2 py-0.5 self-start">Tentukan berapa foto yang akan diambil ✨</span>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-md mb-10 pb-4">
                      {[1, 2, 3, 4].map((n, idx) => {
                        const palette = [
                          'bg-[#FFE600]', 'bg-[#00E5FF]', 'bg-[#FF4D9D]', 'bg-[#7CFF4D]',
                        ]
                        const rot = ['-rotate-2', 'rotate-1', 'rotate-2', '-rotate-1'][idx]
                        return (
                          <button
                            key={n}
                            onClick={() => { setGrid(n); setStep(2) }}
                            className={`relative py-8 border-4 border-black ${palette[idx]} text-black neo-button flex flex-col items-center gap-2 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[4px] hover:translate-y-[4px] transition-all duration-150 ${rot} card-bob`}
                          >
                            <span className="material-symbols-outlined text-[40px] md:text-[56px] leading-none">{n === 1 ? 'looks_one' : n === 2 ? 'looks_two' : n === 3 ? 'looks_3' : 'looks_4'}</span>
                            <span className="font-display text-[40px] md:text-[56px] font-black leading-none">{n}×</span>
                            <span className="font-label-bold text-label-bold uppercase text-[12px] bg-white border-2 border-black px-2 py-0.5">{n} Foto</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-headline-md-mobile md:text-headline-md font-black uppercase tracking-wider text-on-surface">Pilih Desain ({grid} Foto)</span>
                      <button onClick={() => setStep(1)} className="px-3 py-2 border-4 border-black bg-surface text-on-surface font-label-bold uppercase text-[12px] neo-button">Kembali</button>
                    </div>

                    {designs.filter((d) => (d.slotsCount || 0) === grid).length === 0 ? (
                      <div className="border-4 border-black bg-surface-container-lowest p-4 flex flex-col gap-2">
                        <span className="font-label-bold text-label-bold text-on-surface uppercase text-[12px]">Belum ada desain {grid} foto</span>
                        <span className="text-[11px] text-on-surface-variant">Buat di editor pengaturan (⚙), atau lanjut dengan Template Biasa tanpa bingkai.</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-sm">
                        {designs.filter((d) => (d.slotsCount || 0) === grid).map((d) => (
                          <button
                            key={d.id}
                            onClick={() => pickDesign(d.id)}
                            className={`relative border-4 ${selectedDesignId === d.id ? 'border-primary-container bg-primary-container/20' : 'border-black bg-surface hover:bg-surface-variant'} neo-button overflow-hidden flex flex-col items-stretch`}
                          >
                            <div className="relative w-full bg-white" style={{ aspectRatio: `${d.canvasW || 308} / ${d.canvasH || 454}` }}>
                              {d.hasFrame ? (
                                <img src={`/api/designs/${d.id}/frame`} alt={d.name} className="w-full h-full object-fill" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                                  <span className="material-symbols-outlined text-[48px]">photo_frame</span>
                                </div>
                              )}
                              {/* angka urut tiap slot = info letak foto */}
                              {Array.from({ length: d.slotsCount || 0 }).map((_, i) => (
                                <span key={i} className="absolute bg-black/70 text-white text-[10px] font-black px-1 leading-tight rounded-sm">{i + 1}</span>
                              ))}
                              {selectedDesignId === d.id && (
                                <span className="absolute top-1 right-1 bg-primary-container text-on-primary-container border-2 border-black px-1 text-[10px] font-black">PILIH</span>
                              )}
                            </div>
                            <span className="px-2 py-1 font-label-bold text-label-bold text-on-surface uppercase text-left text-[11px] truncate">{d.name}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => pickDesign(null)}
                      className={`flex-none px-3 py-2 border-4 border-black neo-button font-label-bold text-label-bold uppercase text-[12px] self-start ${!selectedDesignId ? 'bg-primary-container text-on-primary-container' : 'bg-surface text-on-surface hover:bg-surface-variant'}`}
                    >Template Biasa</button>

                    <button
                                    onClick={() => useSession.getState().setStatus('capturing')}
                                    className="w-full py-lg border-4 border-black bg-secondary-container text-on-secondary-container brutal-shadow neo-button neo-btn-hover flex items-center justify-center gap-sm relative overflow-hidden group"
                    >
                      <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 ease-in-out"></div>
                      <span className="font-headline-lg-mobile md:text-headline-lg font-black uppercase tracking-wider relative z-10">Lanjutkan ke Kamera</span>
                      <span className="material-symbols-outlined text-[32px] md:text-[48px] relative z-10" style={{fontVariationSettings: "'FILL' 1"}}>arrow_forward</span>
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-auto z-20 pb-sm w-full pt-4">
                <div className="bg-surface border-4 border-black p-sm brutal-shadow mx-auto max-w-3xl">
                  <div className="flex justify-between items-center mb-sm px-xs">
                    <span className="font-label-bold text-label-bold text-on-surface uppercase tracking-wider">Capturing</span>
                    <span className="font-label-bold text-label-bold text-on-surface bg-primary-container px-2 border-2 border-black">{shots.length} / {shotCount}</span>
                  </div>
                  
                  <div className="flex gap-sm justify-between overflow-x-auto pb-2">
                     {Array.from({length: shotCount}).map((_, i) => (
                       <div key={i} className={`flex-1 min-w-[60px] aspect-[4/3] border-4 border-black ${shots[i] ? 'bg-white' : (i === shots.length ? 'bg-surface-container-high border-dashed animate-pulse' : 'bg-surface-container-highest')} flex items-center justify-center relative overflow-hidden`}>
                          {shots[i] ? (
                            <img src={shots[i]} className="w-full h-full object-cover -scale-x-100" />
                          ) : (
                            <span className="material-symbols-outlined text-on-surface-variant opacity-20">photo_camera</span>
                          )}
                       </div>
                     ))}
                  </div>
                  
                  <div className="h-4 border-4 border-black bg-white mt-sm w-full relative overflow-hidden">
                    <div className="absolute top-0 left-0 h-full bg-primary-container border-r-4 border-black transition-all duration-300 ease-linear" style={{ width: `${(shots.length / shotCount) * 100}%` }}></div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {status === 'done' && (
          <>
            <section className="w-full max-w-sm mx-auto md:col-span-6 md:col-start-4 flex flex-col items-center gap-md relative mt-4">
              <div className="absolute -top-10 -left-10 w-20 h-20 bg-primary-container border-4 border-black rounded-full shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-0 animate-[bounce_3s_infinite]"></div>
              <div className="absolute top-1/2 -right-8 w-16 h-16 bg-secondary-container border-4 border-black rotate-12 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-0"></div>
              <div className="w-full bg-surface-container-lowest border-4 border-black p-4 brutal-shadow flex flex-col gap-unit relative z-10 transform -rotate-1 hover:rotate-0 transition-transform duration-300">
                {stripUrl && <img src={stripUrl} alt="strip" className="w-full h-auto" />}
              </div>
              <p className="font-headline-md text-headline-md-mobile text-on-surface bg-primary-container px-4 py-2 border-4 border-black brutal-shadow-sm rotate-2 mt-4 uppercase">
                LOOKIN' GOOD! ✨
              </p>
            </section>

            <section className="w-full md:col-span-12 flex flex-col gap-md mt-lg md:max-w-2xl md:mx-auto relative z-20">
              {/* Pilihan template/frame dekoratif — setelah foto, sebelum cetak */}
              <div className="w-full bg-surface border-4 border-black p-sm brutal-shadow flex flex-col gap-xs">
                <span className="font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">Pilih Template ✨</span>
                <div className="flex gap-xs overflow-x-auto pb-1">
                  {(['none','love','party','vintage','neon','floral'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setBranding({ frame: f })}
                      className={`flex-none px-3 py-2 border-4 border-black neo-button font-label-bold text-label-bold uppercase text-[12px] whitespace-nowrap ${branding.frame === f ? 'bg-primary-container text-on-primary-container' : 'bg-surface text-on-surface hover:bg-surface-variant'}`}
                    >
                      {f === 'none' ? 'Polos' : f === 'love' ? 'Love' : f === 'party' ? 'Party' : f === 'vintage' ? 'Vintage' : f === 'neon' ? 'Neon' : 'Floral'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gallery frame custom dari DB — customer pilih 1 (bisa lebih dari satu) */}
              {frames.length > 0 && (
                <div className="w-full bg-surface border-4 border-black p-sm brutal-shadow flex flex-col gap-xs">
                  <span className="font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">Bingkai Custom ✨</span>
                  <div className="flex gap-xs overflow-x-auto pb-1">
                    {frames.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setSelectedFrameId(selectedFrameId === f.id ? null : f.id)}
                        className={`flex-none border-4 border-black bg-white neo-button transition-all duration-75 ${selectedFrameId === f.id ? 'bg-primary-container' : 'hover:bg-surface-variant'}`}
                        title={f.name}
                      >
                        <img src={f.url} alt={f.name} className={`h-12 w-9 object-contain ${selectedFrameId === f.id ? 'ring-2 ring-black' : ''}`} />
                      </button>
                    ))}
                  </div>
                  {selectedFrameId && (
                    <span className="font-label-bold text-label-bold text-on-surface-variant text-[10px] uppercase">Bingkai dipilih — hasil cetak otomatis update</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-md w-full">
                <button onClick={runCapture} className="w-full py-4 px-6 bg-surface-variant border-4 border-black flex flex-col items-center justify-center gap-2 brutal-shadow brutal-button-active transition-all duration-75 group relative overflow-hidden">
                  <div className="absolute inset-0 bg-black/5 -translate-x-full group-hover:translate-x-0 transition-transform duration-300"></div>
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant group-hover:-rotate-90 transition-transform duration-300">refresh</span>
                  <span className="font-headline-md text-headline-md-mobile uppercase text-on-surface">↺ ULANGI</span>
                </button>
                <button onClick={onShare} className="w-full py-4 px-6 bg-tertiary border-4 border-black flex flex-col items-center justify-center gap-2 brutal-shadow brutal-button-active transition-all duration-75 group relative overflow-hidden sm:-translate-y-4">
                  <div className="absolute inset-0 bg-white/20 -translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                  <span className="material-symbols-outlined text-4xl text-on-tertiary group-hover:scale-110 transition-transform duration-300" style={{fontVariationSettings: "'FILL' 1"}}>share</span>
                  <span className="font-headline-md text-headline-md-mobile uppercase text-on-tertiary">↗ SHARE</span>
                </button>
                <button onClick={onPrint} className="w-full py-4 px-6 bg-primary-container border-4 border-black flex flex-col items-center justify-center gap-2 brutal-shadow brutal-button-active transition-all duration-75 group relative overflow-hidden">
                  <div className="absolute inset-0 bg-black/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                  <span className="material-symbols-outlined text-4xl text-on-primary-container group-hover:-translate-y-2 transition-transform duration-300" style={{fontVariationSettings: "'FILL' 1"}}>print</span>
                  <span className="font-headline-md text-headline-md-mobile uppercase text-on-primary-container">🖨 CETAK</span>
                </button>
              </div>
              
              {/* Akhiri sesi -> balik ke layar awal "Sentuh untuk mulai" */}
              <button
                onClick={goAttract}
                className="w-full py-3 px-6 bg-surface border-4 border-black flex items-center justify-center gap-2 brutal-shadow brutal-button-active transition-all duration-75 group relative overflow-hidden"
              >
                <span className="material-symbols-outlined text-3xl text-on-surface group-hover:scale-110 transition-transform">exit_to_app</span>
                <span className="font-headline-md text-headline-md-mobile uppercase text-on-surface">AKHIRI SESI</span>
              </button>

              {msg && <div className="text-on-surface font-label-bold text-center mt-2 bg-surface-container-high border-2 border-black px-2 py-1 mx-auto brutal-shadow-sm">{msg}</div>}

              <div className="w-full flex justify-center mt-md">
                <button onClick={onSaveBin} className="font-label-bold text-label-bold text-on-surface-variant underline decoration-2 decoration-black/50 hover:decoration-black hover:text-on-surface transition-colors flex items-center gap-1 bg-surface-container-high px-4 py-2 border-2 border-black brutal-shadow-sm brutal-button-active">
                  <span className="material-symbols-outlined text-sm">terminal</span>
                  Simpan ESC/POS (.bin)
                </button>
              </div>
            </section>
          </>
        )}
      </main>
      </>
      )}

      {/* Layar BAYAR — gerbang CETAK. QRIS (simulasi) ATAU Cash (manual operator). */}
      {payStage === 'paying' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-on-background/95 backdrop-blur px-margin-mobile">
          <div className="w-full max-w-2xl bg-surface-container border-4 border-black brutal-shadow p-lg flex flex-col gap-md">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md-mobile md:text-headline-md font-black uppercase text-on-surface">Bayar</h2>
              <span className="font-headline-md text-headline-md-mobile md:text-headline-md font-black text-on-surface bg-primary-container border-2 border-black px-3 py-1">Rp {price.toLocaleString('id-ID')}</span>
              <button onClick={closePay} className="w-10 h-10 border-2 border-black bg-surface rounded hover:bg-surface-variant neo-button" title="Batal">
                <span className="material-symbols-outlined text-on-surface">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
              {/* QRIS */}
              <button
                onClick={payQrisSim}
                className="flex flex-col items-center justify-center gap-2 py-8 border-4 border-black bg-surface brutal-shadow hover:bg-surface-variant transition-colors relative overflow-hidden group"
              >
                <span className="material-symbols-outlined text-[64px] text-on-surface group-hover:scale-110 transition-transform">qr_code_2</span>
                <span className="font-headline-md text-headline-md-mobile uppercase text-on-surface">📱 QRIS</span>
                <span className="font-label-bold text-label-bold text-on-surface-variant text-[11px] uppercase tracking-widest">(simulasi lunas)</span>
              </button>

              {/* CASH */}
              <button
                onClick={chooseCash}
                disabled={cashConfirm}
                className="flex flex-col items-center justify-center gap-2 py-8 border-4 border-black bg-surface brutal-shadow hover:bg-surface-variant transition-colors relative overflow-hidden group disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[64px] text-on-surface group-hover:scale-110 transition-transform">paid</span>
                <span className="font-headline-md text-headline-md-mobile uppercase text-on-surface">💵 Cash</span>
                <span className="font-label-bold text-label-bold text-on-surface-variant text-[11px] uppercase tracking-widest">terima tunai</span>
              </button>
            </div>

            {/* Konfirmasi 2-tap cash (anti salah tekan) */}
            {cashConfirm && (
              <div className="flex flex-col gap-sm bg-error-container border-4 border-black p-sm">
                <p className="font-label-bold text-label-bold text-on-error-container uppercase text-center">Operator: sudah terima uang Rp {price.toLocaleString('id-ID')}?</p>
                <div className="flex gap-sm">
                  <button onClick={closePay} className="flex-1 py-3 border-2 border-black bg-surface font-label-bold text-label-bold uppercase">Batal</button>
                  <button onClick={confirmCashPaid} className="flex-1 py-3 border-4 border-black bg-primary-container text-on-primary-container font-label-bold text-label-bold uppercase brutal-shadow hover:bg-primary">Ya, sudah bayar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} onAttractChange={reloadAttract} />}
    </div>
  )
}
