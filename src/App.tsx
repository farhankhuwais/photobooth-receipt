import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession, type TemplateId } from './store/useSession'
import { useCamera } from './modules/camera/useCamera'
import { composeStrip } from './modules/templates/TemplateEngine'
import { qrDataUrl } from './modules/qr/qr'
import { printSmart } from './modules/print/printService'
import { uploadStripLocal } from './modules/share/upload'
import { buildPrintJob } from './modules/escpos/encoder'
import { Settings } from './modules/branding/Settings'
import { applyFilter, FILTER_LABELS } from './modules/camera/comicFilter'
import type { PhotoFilter } from './modules/camera/comicFilter'
import { queueStrip, syncOutbox, outboxCount } from './modules/offline/outbox'
import { fetchAiStatus } from './modules/camera/aiSketch'
import PinGate from './modules/pin/PinGate'
import LicenseGate from './components/LicenseGate'

// ── License data shape (must match LicenseGate.tsx) ────────────────────────
interface LicenseData {
  vendorId: string
  expiry: number   // Unix timestamp in MILLISECONDS
  deviceFingerprint: string
  activatedAt: number
}

const LICENSE_KEY = 'pb_license_v1'

function hasValidLicense(): LicenseData | null {
  try {
    const raw = localStorage.getItem(LICENSE_KEY)
    if (!raw) return null
    const lic: LicenseData = JSON.parse(raw)
    if (lic.expiry > Date.now()) return lic
    return null
  } catch { return null }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function App() {
  // ── License gate: only enforced when VITE_LICENSE_ENFORCE=1 at build time ──
  // Default OFF: keeps live tenants (booth/hallo/testing) working without a
  // license. Turn ON only for dedicated vendor builds (kiosk at events):
  //   VITE_LICENSE_ENFORCE=1 VITE_LICENSE_SECRET=<same-as-server> npm run build
  const enforceLicense = import.meta.env.VITE_LICENSE_ENFORCE === '1'
  const [license, setLicense] = useState<LicenseData | null>(() => (enforceLicense ? hasValidLicense() : ({ vendorId: 'unrestricted', expiry: Infinity, deviceFingerprint: '', activatedAt: Date.now() } as LicenseData)))

  if (enforceLicense && !license) {
    return (
      <LicenseGate
        onActivated={setLicense}
        // HMAC secret must match LICENSE_SECRET_KEY env var on server.
        // In production, prefer: keep secret server-side, call /api/admin/license/redeem
        // to validate, then receive an opaque token. Demo below shows local verify.
        hmacSecret={import.meta.env.VITE_LICENSE_SECRET || 'default-secret-change-me'}
      />
    )
  }

  const { videoRef, error } = useCamera()
  const { shots, template, shotCount, branding, frames, selectedFrameId, designs, selectedDesignId, designChosen, design, mode, price, status, digitalUrl, screen, paid, payStage, cashConfirm, addShot, setBranding, setSelectedFrameId, resetShots, enterBooth, goAttract, openPay, closePay, chooseCash, confirmCashPaid, payQrisSim, resetPay } = useSession()
  const [countdown, setCountdown] = useState<number | null>(null)
  const [stripUrl, setStripUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)  // live preview hasil saat capturing (mockup + slot)
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null)  // slot yg lagi di-retake (null = tidak ada)
  const [confirmRetake, setConfirmRetake] = useState<number | null>(null)  // slot yg mau dikonfirmasi retake (null = tidak ada)
  const [qrData, setQrData] = useState<string | null>(null)    // QR hasil (cache, persist walau overlay ditutup)
  const [qrOpen, setQrOpen] = useState(false)                  // overlay QR visible?
  const [qrPos, setQrPos] = useState<{ x: number; y: number } | null>(null)  // posisi bubble (null = default pojok)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [showSettings, setShowSettings] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)     // 1=pilih grid, 2=pilih desain
  const [grid, setGrid] = useState<number | null>(null) // jumlah foto terpilih (1/2/3/4)
  const [armed, setArmed] = useState(false)      // kamera sudah "siap" (tombol Mulai Jepret ditekan)
  const [filter, setFilter] = useState<PhotoFilter>('none')  // filter foto aktif
  // Toggle kotak Capturing dari Settings (branding.showCapturingBox) — gak perlu state lokal.
  const [attractMedia, setAttractMedia] = useState<{ type: 'image' | 'video'; url: string } | null>(null)
  const [attractIcon, setAttractIcon] = useState<string | null>(null)
  const stripCanvas = useRef<HTMLCanvasElement | null>(null)
  const running = useRef(false)
  // Raw shots (tanpa filter): sumber truth buat re-filter saat ganti filter setelah preview.
  const rawShotsRef = useRef<string[]>([])
  const [online, setOnline] = useState<boolean>(navigator.onLine)
  const [outboxN, setOutboxN] = useState<number>(0)
  const [aiEnabled, setAiEnabled] = useState<boolean>(false)

  // Cek status AI sketch (aktif kalau operator isi API key + enable di Settings).
  useEffect(() => {
    fetchAiStatus().then((s) => setAiEnabled(!!s.enabled))
    const onAiStatus = () => fetchAiStatus().then((s) => setAiEnabled(!!s.enabled))
    window.addEventListener('pb-ai-status-changed', onAiStatus)
    return () => window.removeEventListener('pb-ai-status-changed', onAiStatus)
  }, [])

  // AI gagal -> sudah otomatis fallback ke sketsa lokal; tampilkan pesannya.
  useEffect(() => {
    const onFallback = (e: Event) => {
      const detail = (e as CustomEvent).detail || ''
      setMsg(`⚠️ Sketsa AI gagal (${detail}) — pakai sketsa lokal`)
      setTimeout(() => setMsg(''), 6000)
    }
    window.addEventListener('pb-ai-fallback', onFallback)
    return () => window.removeEventListener('pb-ai-fallback', onFallback)
  }, [])

  // Status online/offline + auto-sync outbox pas balik online.
  useEffect(() => {
    let stop = false
    const refresh = async () => {
      if (stop) return
      setOnline(navigator.onLine)
      setOutboxN(await outboxCount())
    }
    const goOnline = async () => {
      setOnline(true)
      const sent = await syncOutbox()
      await refresh()
      if (sent > 0) setMsg(`📶 Balik online — ${sent} foto tersinkron ke server`)
    }
    refresh()
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', refresh)
    const iv = setInterval(refresh, 30000)
    return () => {
      stop = true
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', refresh)
      clearInterval(iv)
    }
  }, [])


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
    useSession.getState().setSelectedDesignId(null)
    useSession.getState().setDesign(null)
    useSession.getState().setDesignChosen(false)
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
      // Template polos bawaan menyesuaikan jumlah foto:
      // 1=single, 2=dual(atbawah), 3=strip3, 4=grid2x2.
      const tpl: TemplateId = grid === 1 ? 'single' : grid === 2 ? 'dual' : grid === 4 ? 'grid2x2' : 'strip3'
      st.setTemplate(tpl)
      st.setDesignChosen(true)
      useSession.setState({ shotCount: grid ?? 1 })
      st.setStatus('capturing')
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
    st.setDesignChosen(true)
    // Jumlah foto = jumlah slot design (override template).
    useSession.setState({ shotCount: slots.length })
    st.setStatus('capturing')
  }

  // Load active config dari DB saat boot (survive refresh).
  useEffect(() => {
    let active = true
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (cfg) => {
        if (!active || !cfg) return
        const st = useSession.getState()
        st.setMode(cfg.mode === 'event' ? 'event' : 'regular')
        st.setPrice(Number(cfg.price) || 5000)
        st.setActivePreset(cfg.preset_name || null)
        // Prioritaskan branding dari preset aktif (termasuk jarak dekorasi),
        // fallback ke branding app_config kalau preset gak ada.
        let branding = cfg.branding
        if (cfg.preset_name) {
          try {
            const p = await (await fetch(`/api/presets/${encodeURIComponent(cfg.preset_name)}`)).json()
            if (p?.branding) branding = p.branding
          } catch { /* ignore */ }
        }
        if (branding) {
          // Server jadi source of truth utk branding preset, TAPI setting device-lokal
          // (toggle kotak Capturing) dipertahankan biar gak ke-reset tiap refresh.
          const localShowCapturingBox = useSession.getState().branding.showCapturingBox
          st.setBranding({ ...branding, showCapturingBox: localShowCapturingBox })
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // Ambil 1 frame dari video → dataURL (mirror horizontal, crop 4:3).
  // Dipakai captureFrame() (append) DAN retakeSlot() (override index tertentu).
  function grabFrame(): string | null {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return null
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
    if (!ctx) return null
    // Mirror horizontal biar sama dengan preview (CSS -scale-x-100)
    ctx.translate(c.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.9)
  }

  // Ganti filter: simpan pilihan + re-apply ke semua slot dari raw (kalau sudah ada jepretan).
  function changeFilter(f: PhotoFilter) {
    setFilter(f)
    const raw = rawShotsRef.current
    if (raw.length === 0) return
    Promise.all(raw.map((d) => (f !== 'none' ? applyFilter(d, f) : Promise.resolve(d))))
      .then((filtered) => {
        useSession.setState({ shots: filtered })
      })
  }

  // Sinkron rawShots tiap addShot dari luar (captureFrame pakai path sendiri).
  useEffect(() => {
    if (shots.length === 0) rawShotsRef.current = []
  }, [shots.length])

  function captureFrame() {
    const d = grabFrame()
    if (!d) return
    rawShotsRef.current.push(d)
    if (filter !== 'none') {
      applyFilter(d, filter).then((filtered) => addShot(filtered))
    } else {
      addShot(d)
    }
  }

  // RETAKE SLOT: klik slot di preview → jepret ulang slot itu saja (override shots[i]).
  // Tanpa tombol mirror. Langsung countdown, gak pakai modal.
  async function retakeSlot(i: number) {
    if (running.current) return
    running.current = true
    setRetakeIndex(i)
    setCountdown(null)
    try {
      for (let c = 3; c > 0; c--) {
        setCountdown(c)
        await sleep(1000)
      }
      setCountdown(0)
      await sleep(250)
      const d = grabFrame()
      if (d) {
        if (rawShotsRef.current.length > i) rawShotsRef.current[i] = d
        else rawShotsRef.current.push(d)
        const filtered = filter !== 'none' ? await applyFilter(d, filter) : d
        const s = useSession.getState()
        const shots = s.shots.slice()
        shots[i] = filtered
        useSession.setState({ shots })
      }
      setCountdown(null)
    } catch (e) {
      setMsg(`Retake gagal: ${(e as Error).message}`)
    } finally {
      running.current = false
      setRetakeIndex(null)
    }
  }

  // Hitung posisi % tiap slot di preview box, buat overlay klik retake.
  function slotRects(): { left: number; top: number; width: number; height: number; rot?: number }[] {
    const s = useSession.getState()
    if (s.design && s.design.slots && s.design.slots.length) {
      const cw = s.design.canvasW || 576
      const ch = s.design.canvasH || 849
      return s.design.slots.map((sl) => ({
        left: (sl.x / cw) * 100,
        top: (sl.y / ch) * 100,
        width: (sl.w / cw) * 100,
        height: (sl.h / ch) * 100,
        rot: sl.rot,
      }))
    }
    // Template Biasa: grid merata (full-width stacked).
    const n = s.shotCount
    if (n === 1) return [{ left: 0, top: 0, width: 100, height: 100 }]
    if (n === 2) return [0, 1].map((i) => ({ left: 0, top: i * 50, width: 100, height: 50 }))
    if (n === 4) return [0, 1, 2, 3].map((i) => ({ left: (i % 2) * 50, top: Math.floor(i / 2) * 50, width: 50, height: 50 }))
    // strip3 (3 foto vertikal)
    return [0, 1, 2].map((i) => ({ left: 0, top: (i * 100) / 3, width: 100, height: 100 / 3 }))
  }

  async function finishCompose() {
    const s = useSession.getState()
    if (!s.shots.length) return
    // Hasil kertas BERSIH — tidak ada QR & tidak auto-upload ke DB.
    // QR + upload ke DB hanya terjadi saat user klik tombol "QR HASIL".
    const canvas = await composeStrip(s.shots, s.branding, s.template, null, s.frames, s.selectedFrameId, s.design)
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
      // JANGAN langsung 'done' — biarkan preview hasil tampil dulu,
      // user klik "Lanjut ke Hasil" untuk lanjut ke layar hasil.
      await finishCompose()
    } catch (e) {
      setMsg(`Capture gagal: ${(e as Error).message}`)
    } finally {
      running.current = false
    }
  }

  // Saat customer ganti bingkai custom (gallery), compose ulang preview hasil.
  // Re-compose hasil saat frame custom (selectedFrameId) atau template dekoratif
  // (branding.frame) berubah — biar preview strip ikut update (fix tombol template
  // terlihat "tidak bisa dipilih").
  useEffect(() => {
    if (status !== 'done') return
    const s = useSession.getState()
    if (!s.shots.length) return
    let cancelled = false
    ;(async () => {
      const canvas = await composeStrip(s.shots, s.branding, s.template, null, s.frames, s.selectedFrameId, s.design)
      if (cancelled) return
      stripCanvas.current = canvas
      setStripUrl(canvas.toDataURL('image/png'))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFrameId, branding.frame, frames])

  // PREVIEW HASIL LIVE: saat capturing && armed, tiap shot masuk langsung di-compose
  // (mockup desain + slot) biar user lihat progres sebelum layar hasil. Tanpa fitur mirror.
  useEffect(() => {
    if (status !== 'capturing' || !armed) { setPreviewUrl(null); return }
    const s = useSession.getState()
    if (!s.shots.length) { setPreviewUrl(null); return }
    let cancelled = false
    ;(async () => {
      const canvas = await composeStrip(s.shots, s.branding, s.template, null, s.frames, s.selectedFrameId, s.design)
      if (cancelled) return
      setPreviewUrl(canvas.toDataURL('image/png'))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, armed, shots, selectedFrameId, branding.frame, frames])

  // Reset QR tiap keluar dari layar hasil (akhiri sesi / foto ulang / idle baru)
  // biar sesi berikutnya mulai dari bersih (gak bawa QR hasil sebelumnya).
  useEffect(() => {
    if (status !== 'done') {
      setQrData(null)
      setQrOpen(false)
    }
  }, [status])

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
      const b = useSession.getState().branding
      const res = await printSmart(stripCanvas.current!, useSession.getState().bridgeUrl, { paperWidth: b.paperWidth, darkness: b.printDarkness })
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

  async function onGenerateQr() {
    if (!stripUrl && !stripCanvas.current) return
    // Sudah pernah generate untuk hasil ini -> cuma buka lagi, JANGAN upload ulang.
    if (qrData) { setQrOpen(true); return }
    // Offline: jangan error — simpan foto ke outbox device, nanti auto-sync pas online.
    if (!online || !navigator.onLine) {
      const dataUrl = stripCanvas.current ? stripCanvas.current.toDataURL('image/png') : stripUrl!
      try {
        await queueStrip(dataUrl)
        setOutboxN(await outboxCount())
        setMsg('📴 Lagi offline — foto disimpan di device & otomatis ke-sync pas online')
      } catch {
        setMsg('Offline & gagal simpan lokal — coba lagi')
      }
      return
    }
    setMsg('Membuat QR…')
    try {
      // Hasil sudah fix -> upload ke server, dapat URL, generate QR dari URL.
      const dataUrl = stripCanvas.current ? stripCanvas.current.toDataURL('image/png') : stripUrl!
      const url = await uploadStripLocal(dataUrl)
      const qr = await qrDataUrl(url, 320)
      setQrData(qr)
      setQrOpen(true)
      setMsg('')
    } catch {
      // Server tak terjangkau walau device "online" (tunnel mati, server down, dll)
      // -> jangan buang foto: simpan ke outbox, auto-sync pas server bisa lagi.
      const dataUrl = stripCanvas.current ? stripCanvas.current.toDataURL('image/png') : stripUrl!
      try {
        await queueStrip(dataUrl)
        setOutboxN(await outboxCount())
        setMsg('📴 Server tak terjangkau — foto disimpan di device & otomatis ke-sync pas online')
      } catch {
        setMsg('Gagal membuat QR')
      }
    }
  }

  function onReset() {
    resetShots()
    setStripUrl(null)
    setCountdown(null)
    setQrData(null)
    setQrOpen(false)
    setMsg('')
    setFilter('none')  // sesi baru mulai bersih: filter kembali ke default
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
      <PinGate />
      {screen === 'attract' ? (
        /* Layar attract — kiosk idle, customer tap untuk mulai */
        <main key="attract" className="relative flex-grow flex flex-col items-center justify-center bg-[#FFE600] px-margin-mobile select-none overflow-hidden animate-[screenIn_.35s_ease-out]">
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
          {/* Header — disembunyikan di layar hasil (done) karena sudah ada tombol AKHIRI SESI */}
          {status !== 'done' && (
          <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-margin-mobile py-sm bg-[#FFE600] border-b-4 border-black brutal-shadow-sm">
            <button
                            onClick={() => (screen === 'booth' && status === 'idle' ? (step === 1 ? goAttract() : setStep(1)) : onReset())}
                            title={screen === 'booth' && status === 'idle' ? 'Kembali' : 'Mulai ulang sesi'}
                            className="flex items-center justify-center w-10 h-10 border-2 border-black bg-surface rounded hover:bg-surface-variant neo-button neo-btn-hover brutal-shadow-sm"
            >
              <span className="material-symbols-outlined text-on-surface">{screen === 'booth' && status === 'idle' ? 'arrow_back' : (status === 'capturing' ? 'arrow_back' : 'restart_alt')}</span>
            </button>
            <div className="flex flex-col items-center">
              <h1 className="font-headline-md text-headline-md-mobile md:text-headline-md font-black text-on-surface uppercase tracking-tight">Photobooth 📸</h1>
              <span className="font-label-bold text-label-bold text-on-surface-variant uppercase tracking-wider text-[10px]">{branding.eventName}</span>
            </div>
            <div className="w-10 h-10" />
          </header>
          )}

          {error && (
            <div className="w-full max-w-md mx-auto mt-[80px] bg-error-container border-4 border-black text-on-error-container font-label-bold p-3 brutal-shadow-sm">
              {error}
            </div>
          )}

          {/* Main Layout */}
          <main key={status} className={`flex-grow pt-[64px] pb-xl flex flex-col relative ${status === 'done' ? 'md:grid md:grid-cols-12 md:gap-gutter md:items-start bg-[#FFE600] px-margin-mobile animate-[screenIn_.35s_ease-out]' : 'bg-[#FFE600] px-margin-mobile animate-[screenIn_.35s_ease-out]'}`}>

            {status !== 'done' && screen === 'booth' && (
              <>
            <div
              className={`w-full max-w-[1600px] mx-auto mt-2 ${status === 'capturing' && armed ? '' : (status === 'capturing' ? 'flex flex-col items-center justify-center' : 'flex flex-col items-center justify-center')} ${status === 'capturing' ? 'flex-grow' : 'flex-none'}`}
              style={status === 'capturing' && armed ? { display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' } : undefined}
            >
              {/* Kamera HANYA tampil saat capturing (setelah user pilih mockup & next).
                  Di tahap pilih (idle) kamera disembunyikan. */}
              {status === 'capturing' && (
              <div
                className={`relative w-full ${status === 'capturing' && armed ? '' : 'max-w-2xl'} aspect-[4/3] border-4 border-black brutal-shadow bg-surface-container overflow-hidden`}
                style={status === 'capturing' && armed ? { width: '100%', maxWidth: '1100px', flexShrink: 0 } : undefined}
              >
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
                <div className="mt-4 w-full max-w-2xl flex gap-sm items-stretch">
                  <button
                    onClick={() => { setArmed(true); runCapture() }}
                    className="flex-1 py-lg border-4 border-black bg-secondary-container text-on-secondary-container brutal-shadow neo-button flex items-center justify-center gap-sm relative overflow-hidden group"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 ease-in-out"></div>
                    <span className="font-headline-lg-mobile md:text-headline-lg font-black uppercase tracking-wider relative z-10">Mulai Jepret</span>
                    <span className="material-symbols-outlined text-[32px] md:text-[48px] relative z-10" style={{fontVariationSettings: "'FILL' 1"}}>photo_camera</span>
                  </button>
                  {/* Dropdown pilih filter: Tanpa / Komik / Vintage / Sepia / Mono / Sketsa / Sketsa AI */}
                  <select
                    value={filter}
                    onChange={(e) => changeFilter(e.target.value as PhotoFilter)}
                    className="px-2 py-2 border-4 border-black brutal-shadow-sm bg-surface text-on-surface text-[12px] font-bold uppercase tracking-wide"
                    title="Pilih filter"
                  >
                    {(Object.keys(FILTER_LABELS) as PhotoFilter[]).filter((f) => f !== 'ai-sketch' || aiEnabled).map((f) => (
                      <option key={f} value={f}>{FILTER_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* PREVIEW HASIL LIVE — muncul setelah "Mulai Jepret" (armed).
                  Mockup desain + slot di-compose real-time tiap shot masuk. Tanpa tombol mirror. */}
              {status === 'capturing' && armed && (
                <div className="mt-2 flex flex-row gap-4 w-full" style={{ maxWidth: '820px' }}>
                  {/* KOLOM KIRI: preview hasil (mockup + slot) */}
                  <div className="flex-1 flex flex-col items-center min-w-0">
                  <div className="flex items-center justify-between mb-1 w-full">
                    <span className="font-label-bold text-label-bold text-black uppercase text-[12px] tracking-wider">
                      Preview Hasil
                    </span>
                    <span className="font-label-bold text-label-bold text-black bg-primary-container border-2 border-black px-2 text-[12px]">
                      {shots.length} / {shotCount}
                    </span>
                  </div>
                  {/* Box preview: aspect mengikuti design (mockup) atau 576/849 (template biasa).
                      Tinggi dibatasi (max-h) biar muat 1 layar di tablet portrait tanpa scroll.
                      Overlay slot transparan di atas img → klik = retake slot itu. Tanpa mirror. */}
                  <div
                    className="relative w-full border-4 border-black brutal-shadow bg-white overflow-hidden"
                    style={{ maxHeight: '360px', aspectRatio: design && design.canvasW ? `${design.canvasW} / ${design.canvasH}` : '576 / 849' }}
                  >
                    {previewUrl ? (
                      <img src={previewUrl} alt="preview hasil" className="absolute inset-0 w-full h-full object-contain z-0 animate-[popIn_.25s_ease-out]" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant z-0">
                        <span className="material-symbols-outlined text-[64px] opacity-30">photo_camera</span>
                      </div>
                    )}

                    {/* Overlay slot — tiap slot jadi div klik (retake). Sembunyi saat sedang retake. */}
                    {retakeIndex === null && shots.length > 0 && (
                      <div className="absolute inset-0 z-20">
                        {slotRects().map((r, i) => (
                          <button
                            key={i}
                            onClick={() => setConfirmRetake(i)}
                            className="absolute overflow-hidden border-2 border-dashed border-transparent hover:border-black hover:bg-black/10 transition-colors group"
                            style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`, transform: r.rot ? `rotate(${r.rot}deg)` : undefined }}
                            title={`Ulangi foto ke-${i + 1}`}
                          >
                            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="flex items-center gap-1 text-white font-black text-[14px] bg-black/60 border-2 border-white px-2 py-1">
                                <span className="material-symbols-outlined text-[18px]">refresh</span> Ulangi
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Countdown retake — menimpa preview saat sedang jepret ulang slot. */}
                    {retakeIndex !== null && countdown !== null && (
                      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none bg-white/70">
                        <span className="font-label-bold text-label-bold text-black uppercase text-[14px] mb-1">Ulangi foto ke-{retakeIndex + 1}</span>
                        <span className={`font-display text-display font-black text-primary-container select-none text-[150px] leading-none ${countdown > 0 ? 'pulse-text' : ''}`} style={{ textShadow: '6px 6px 0px #000, 0 0 20px #ffff00' }}>
                          {countdown === 0 ? '📸' : countdown}
                        </span>
                      </div>
                    )}
                  </div>
                  </div>
                  {/* KOLOM KANAN: pilih efek + Lanjut ke Hasil (stack vertikal) */}
                  <div className="w-[240px] flex flex-col gap-2 justify-center shrink-0">
                    <select
                      value={filter}
                      onChange={(e) => changeFilter(e.target.value as PhotoFilter)}
                      className="w-full px-2 py-2 border-4 border-black brutal-shadow-sm bg-surface text-on-surface text-[12px] font-bold uppercase tracking-wide"
                      title="Ganti filter (semua foto ikut berubah)"
                    >
                      {(Object.keys(FILTER_LABELS) as PhotoFilter[]).filter((f) => f !== 'ai-sketch' || aiEnabled).map((f) => (
                        <option key={f} value={f}>{FILTER_LABELS[f]}</option>
                      ))}
                    </select>
                    {shots.length === shotCount && shots.length > 0 && retakeIndex === null && (
                      <button
                        onClick={() => { useSession.getState().setStatus('done') }}
                        className="w-full py-lg border-4 border-black bg-primary-container text-on-primary-container brutal-shadow neo-button flex items-center justify-center gap-sm relative overflow-hidden group"
                      >
                        <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 ease-in-out"></div>
                        <span className="material-symbols-outlined text-[28px] md:text-[36px] relative z-10">arrow_forward</span>
                        <span className="font-headline-md-mobile md:text-headline-md font-black uppercase tracking-wider relative z-10">Lanjut ke Hasil</span>
                      </button>
                    )}
                  </div>
                </div>
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
                            className={`relative border-4 ${selectedDesignId === d.id ? 'border-[#ba1a1a] bg-[#ba1a1a]/20' : 'border-black bg-surface hover:bg-[#ff8a80]'} neo-button overflow-hidden flex flex-col items-stretch`}
                          >
                            <div className="relative w-full bg-white" style={{ aspectRatio: `${d.canvasW || 308} / ${d.canvasH || 454}` }}>
                              {d.hasFrame ? (
                                <img src={`/api/designs/${d.id}/frame`} alt={d.name} className="w-full h-full object-fill" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                                  <span className="material-symbols-outlined text-[48px]">photo_frame</span>
                                </div>
                              )}
                              {/* angka urut tiap slot, diposisikan di letak foto beneran */}
                              {(d.slots && d.slots.length ? d.slots : Array.from({ length: d.slotsCount || 0 }, () => ({ x: 0, y: 0, w: d.canvasW || 308, h: d.canvasH || 454 }))).map((s: any, i: number) => {
                                const cw = d.canvasW || 308
                                const ch = d.canvasH || 454
                                const left = (s.x / cw) * 100
                                const top = (s.y / ch) * 100
                                const width = (s.w / cw) * 100
                                const height = (s.h / ch) * 100
                                return (
                                  <span
                                    key={i}
                                    className="absolute flex items-center justify-center bg-black/80 text-white text-[10px] font-black leading-none rounded-sm border border-white/60 pointer-events-none"
                                    style={{
                                      left: `${left}%`,
                                      top: `${top}%`,
                                      width: `${width}%`,
                                      height: `${height}%`,
                                      transform: s.rot ? `rotate(${s.rot}deg)` : undefined,
                                    }}
                                  >
                                    {i + 1}
                                  </span>
                                )
                              })}
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
                      className={`flex-none border-4 ${!selectedDesignId ? 'border-[#ba1a1a] bg-[#ba1a1a]/20' : 'border-black bg-surface hover:bg-[#ff8a80]'} neo-button overflow-hidden flex flex-col items-stretch self-start w-[140px]`}
                    >
                      <div className="relative w-full bg-white" style={{ aspectRatio: '308 / 454' }}>
                        {/* Logo di atas (kalau ada) */}
                        {branding.logoDataUrl ? (
                          <img src={branding.logoDataUrl} alt="" className="absolute top-1 left-1/2 -translate-x-1/2 w-[70%] h-[80px] object-contain pointer-events-none" />
                        ) : null}
                        {/* Layout polos bawaan sesuai jumlah foto:
                            1/3 = vertikal (1 kolom), 2 = atas-bawah (1 kolom), 4 = 2x2 grid */}
                        <div className={`absolute inset-x-2 bottom-2 top-[88px] gap-1 ${grid === 4 ? 'grid grid-cols-2 grid-rows-2' : 'flex flex-col justify-center'}`}>
                          {Array.from({ length: grid ?? 1 }).map((_, i) => (
                            <div key={i} className="w-full h-full bg-[#e6e6e6] border-2 border-dashed border-black/40" />
                          ))}
                        </div>
                        {selectedDesignId === null && designChosen && (
                          <span className="absolute top-1 right-1 bg-primary-container text-on-primary-container border-2 border-black px-1 text-[10px] font-black">PILIH</span>
                        )}
                      </div>
                      <span className="px-2 py-1 font-label-bold text-label-bold text-on-surface uppercase text-left text-[11px] truncate">Template Biasa</span>
                    </button>

                  </>
                )}
              </div>
            ) : (
              <div className="mt-auto z-20 pb-sm w-full pt-4" style={branding.showCapturingBox ? undefined : { display: 'none' }}>
                <div className="bg-surface border-4 border-black p-sm brutal-shadow mx-auto max-w-3xl">
                  <div className="flex justify-between items-center mb-sm px-xs">
                    {branding.showCapturingBox && <span className="font-label-bold text-label-bold text-on-surface uppercase tracking-wider">Capturing</span>}
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
              {/* Pilihan template/frame dekoratif — HANYA saat Template Biasa (Polos) dipilih.
                  Kalau pakai mockup custom (desain) ATAU sudah generate QR (hasil fix), disembunyikan. */}
              {selectedDesignId === null && !qrData && (
              <>
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
              </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-md w-full">
                <button onClick={runCapture} disabled={!!qrData} className={`w-full py-4 px-6 bg-surface-variant border-4 border-black flex flex-col items-center justify-center gap-2 brutal-shadow brutal-button-active transition-all duration-75 group relative overflow-hidden ${qrData ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  <div className="absolute inset-0 bg-black/5 -translate-x-full group-hover:translate-x-0 transition-transform duration-300"></div>
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant group-hover:-rotate-90 transition-transform duration-300">refresh</span>
                  <span className="font-headline-md text-headline-md-mobile uppercase text-on-surface">↺ ULANGI</span>
                </button>
                <button onClick={onGenerateQr} className={`w-full py-4 px-6 border-4 border-black flex flex-col items-center justify-center gap-2 brutal-shadow brutal-button-active transition-all duration-75 group relative overflow-hidden ${online ? 'bg-tertiary' : 'bg-surface-container-high'}`}>
                  <div className="absolute inset-0 bg-white/20 -translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                  <span className="material-symbols-outlined text-4xl text-on-tertiary group-hover:scale-110 transition-transform duration-300" style={{fontVariationSettings: "'FILL' 1"}}>{online ? 'qr_code_2' : 'save'}</span>
                  <span className="font-headline-md text-headline-md-mobile uppercase text-on-tertiary">{online ? '⬡ QR HASIL' : `⬇ SIMPAN (${outboxN})`}</span>
                </button>
                <button onClick={onPrint} className="w-full py-4 px-6 bg-primary-container border-4 border-black flex flex-col items-center justify-center gap-2 brutal-shadow brutal-button-active transition-all duration-75 group relative overflow-hidden">
                  <div className="absolute inset-0 bg-black/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                  <span className="material-symbols-outlined text-4xl text-on-primary-container group-hover:-translate-y-2 transition-transform duration-300" style={{fontVariationSettings: "'FILL' 1"}}>print</span>
                  <span className="font-headline-md text-headline-md-mobile uppercase text-on-primary-container">🖨 CETAK</span>
                </button>
              </div>
              
              {/* Akhiri sesi -> balik ke layar awal "Sentuh untuk mulai" + filter reset ke default */}
              <button
                onClick={() => { setFilter('none'); goAttract() }}
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

      {/* Bubble QR hasil (draggable, pojok kanan bawah default) — gak nutup layar */}
      {qrOpen && qrData && (
        <div
          className={`fixed z-[60] bg-surface border-4 border-black brutal-shadow p-3 flex flex-col items-center gap-2 animate-[popIn_.25s_ease-out] max-w-[44vw] ${qrPos ? '' : 'bottom-4 right-4'}`}
          style={qrPos ? { left: qrPos.x, top: qrPos.y, touchAction: 'none' } : { touchAction: 'none' }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return  // jangan drag kalau klik tombol ×
            const el = e.currentTarget
            const rect = el.getBoundingClientRect()
            dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
            el.setPointerCapture(e.pointerId)
            const move = (ev: PointerEvent) => {
              if (!dragRef.current) return
              const w = el.offsetWidth, h = el.offsetHeight
              const x = Math.max(4, Math.min(window.innerWidth - w - 4, ev.clientX - dragRef.current.dx))
              const y = Math.max(4, Math.min(window.innerHeight - h - 4, ev.clientY - dragRef.current.dy))
              setQrPos({ x, y })
            }
            const up = () => {
              dragRef.current = null
              el.removeEventListener('pointermove', move)
              el.removeEventListener('pointerup', up)
            }
            el.addEventListener('pointermove', move)
            el.addEventListener('pointerup', up)
          }}
        >
          <div
            className="flex items-center justify-between w-full gap-2 cursor-move active:cursor-grabbing select-none"
          >
            <span className="font-label-bold text-label-bold text-on-surface uppercase text-[11px] tracking-wider">⬡ Scan Download</span>
            <button
              onClick={() => setQrOpen(false)}
              className="w-7 h-7 flex items-center justify-center bg-surface-variant border-2 border-black font-bold brutal-button-active"
              title="Tutup"
            >×</button>
          </div>
          <img src={qrData} alt="QR hasil" className="w-40 h-40 border-2 border-black sm:w-48 sm:h-48 pointer-events-none" draggable={false} />
          <span className="font-label-bold text-label-bold text-on-surface-variant text-[10px] uppercase text-center">
            Scan dari HP untuk simpan hasil
          </span>
        </div>
      )}
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

      {/* Badge versi bundle — buat verifikasi live tanpa devtools (cek SW cache).
          Pakai __BUILD_HASH__ (di-inject vite.config dari BUILD_HASH/Date.now tiap build),
          jadi nilainya SELALU beda tiap build -> gampang cocokkan dgn nama bundle di server
          (assets/index-<HASH>.js). */}
      <div className="fixed bottom-1 right-1 z-[60] bg-black/70 text-white text-[10px] px-2 py-0.5 rounded font-mono select-none pointer-events-none">
        v={__BUILD_HASH__}
      </div>

      {/* Modal konfirmasi retake slot — klik slot → confirm dulu, baru jepret ulang. */}
      {confirmRetake !== null && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface border-4 border-black brutal-shadow-sm w-full max-w-md p-5 flex flex-col items-center gap-4 animate-[popIn_.2s_ease-out]">
            <span className="material-symbols-outlined text-[48px] text-on-surface">help</span>
            <p className="font-headline-md text-headline-md-mobile md:text-headline-md font-black text-on-surface text-center uppercase">
              Ulangi foto ke-{confirmRetake + 1}?
            </p>
            <p className="font-label-bold text-label-bold text-on-surface-variant text-center text-[13px]">
              Foto di slot ini akan diambil ulang. Foto lain tetap tersimpan.
            </p>
            <div className="flex gap-3 w-full mt-1">
              <button
                onClick={() => setConfirmRetake(null)}
                className="flex-1 py-3 border-2 border-black bg-surface-variant font-label-bold text-label-bold uppercase brutal-shadow-sm hover:bg-surface"
              >
                Batal
              </button>
              <button
                onClick={() => { const i = confirmRetake; setConfirmRetake(null); retakeSlot(i) }}
                className="flex-1 py-3 border-4 border-black bg-primary-container text-on-primary-container font-label-bold text-label-bold uppercase brutal-shadow hover:bg-primary"
              >
                Ya, Ulangi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Banner status offline — muncul cuma saat offline, biar operator langsung tau kondisi */}
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-[120] bg-tertiary border-b-4 border-black px-3 py-1.5 flex items-center justify-center gap-2 pointer-events-none">
          <span className="material-symbols-outlined text-lg text-on-tertiary">cloud_off</span>
          <span className="font-label-bold text-label-bold uppercase text-on-tertiary text-[11px] tracking-wider">
            Mode offline{outboxN > 0 ? ` — ${outboxN} foto nunggu sinkron` : ''} · print tetap jalan
          </span>
        </div>
      )}
    </div>
  )
}

