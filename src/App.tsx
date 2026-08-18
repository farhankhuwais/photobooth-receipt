import { useEffect, useRef, useState } from 'react'
import { useSession } from './store/useSession'
import { useCamera } from './modules/camera/useCamera'
import { composeStrip } from './modules/templates/TemplateEngine'
import { printSmart } from './modules/print/printService'
import { shareImage } from './modules/share/share'
import { uploadStrip } from './modules/share/upload'
import { buildPrintJob } from './modules/escpos/encoder'
import { Settings } from './modules/branding/Settings'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const TEMPLATES = [
  { id: 'strip3', label: '3 Vertikal' },
  { id: 'grid2x2', label: '2x2' },
  { id: 'single', label: '1 Foto' }
] as const

export default function App() {
  const { videoRef, error } = useCamera()
  const { shots, template, shotCount, branding, status, digitalUrl, addShot, setTemplate } = useSession()
  const [countdown, setCountdown] = useState<number | null>(null)
  const [stripUrl, setStripUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [showSettings, setShowSettings] = useState(false)
  const stripCanvas = useRef<HTMLCanvasElement | null>(null)
  const running = useRef(false)

  function captureFrame() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const c = document.createElement('canvas')
    c.width = video.videoWidth
    c.height = video.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, c.width, c.height)
    addShot(c.toDataURL('image/jpeg', 0.9))
  }

  async function finishCompose() {
    const s = useSession.getState()
    if (!s.shots.length) return
    let qrUrl: string | null = s.digitalUrl
    if (s.bridgeUrl) {
      const first = await composeStrip(s.shots, s.branding, s.template, '')
      try {
        qrUrl = await uploadStrip(first.toDataURL('image/png'), s.bridgeUrl)
        useSession.getState().setDigitalUrl(qrUrl)
      } catch {
        qrUrl = s.branding.qrText || null
      }
    }
    const canvas = await composeStrip(s.shots, s.branding, s.template, qrUrl)
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

  async function onPrint() {
    if (!stripCanvas.current) return
    const res = await printSmart(stripCanvas.current, useSession.getState().bridgeUrl)
    setMsg(res.message)
  }

  async function onShare() {
    if (!stripUrl) return
    const r = await shareImage(stripUrl)
    setMsg(r)
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
    composeStrip(useSession.getState().shots, branding, useSession.getState().template, digitalUrl).then((c) => {
      stripCanvas.current = c
      setStripUrl(c.toDataURL('image/png'))
    })
  }, [branding, digitalUrl, status])

  return (
    <div className="min-h-full flex flex-col items-center p-4 gap-4 max-w-md mx-auto">
      <header className="w-full flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📸</span>
          <div className="leading-tight">
            <div className="font-bold text-lg tracking-tight">Photobooth</div>
            <div className="text-xs text-slate-400 truncate max-w-[180px]">{branding.eventName}</div>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm"
        >
          ⚙ Event
        </button>
      </header>

      {error && (
        <div className="w-full rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm p-3">
          {error}
        </div>
      )}

      <div className="flex-1 w-full flex flex-col items-center justify-center gap-4">
        <div className="relative w-full aspect-[3/4] bg-black rounded-3xl overflow-hidden ring-1 ring-slate-700 shadow-2xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover -scale-x-100 ${status === 'done' ? 'invisible' : ''}`}
          />
          {status !== 'done' && countdown !== null && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-white text-8xl font-black drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)] animate-pulse">
                {countdown === 0 ? '📷' : countdown}
              </div>
            </div>
          )}
          {status === 'done' && stripUrl && (
            <img
              src={stripUrl}
              alt="strip"
              className="absolute inset-0 w-full h-full object-contain bg-white"
            />
          )}
          {status === 'idle' && !error && (
            <div className="absolute bottom-0 inset-x-0 p-3 text-center text-slate-300 text-sm bg-gradient-to-t from-black/60 to-transparent">
              Siap? Pencet MULAI
            </div>
          )}
        </div>

        {status !== 'done' ? (
          <div className="w-full flex flex-col items-center gap-4">
            <div className="flex gap-2 w-full">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  disabled={status === 'capturing'}
                  onClick={() => setTemplate(t.id)}
                  className={`flex-1 px-2 py-2 rounded-xl text-sm font-medium border transition ${
                    template === t.id
                      ? 'bg-pink-500 text-white border-pink-500'
                      : 'bg-slate-800/60 border-slate-700 text-slate-200'
                  } disabled:opacity-40`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {status === 'idle' && (
              <button
                onClick={runCapture}
                className="w-full py-5 rounded-2xl bg-gradient-to-r from-pink-500 to-fuchsia-500 hover:from-pink-400 hover:to-fuchsia-400 text-white text-xl font-extrabold shadow-lg active:scale-95 transition"
              >
                MULAI 📸
              </button>
            )}
            {status === 'capturing' && (
              <div className="flex flex-col items-center gap-2">
                {shots.length > 0 && (
                  <div className="flex gap-1">
                    {shots.map((s, idx) => (
                      <img
                        key={idx}
                        src={s}
                        className="w-10 h-14 object-cover rounded-md border border-slate-600"
                      />
                    ))}
                  </div>
                )}
                <div className="text-slate-300 text-sm">
                  Ambil {Math.min(shots.length + 1, shotCount)}/{shotCount}...
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full flex flex-col items-center gap-3">
            <div className="flex w-full gap-2">
              <button
                onClick={onPrint}
                className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold active:scale-95 transition"
              >
                🖨 Cetak
              </button>
              <button
                onClick={onShare}
                className="flex-1 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold active:scale-95 transition"
              >
                ↗ Share
              </button>
              <button
                onClick={runCapture}
                className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold active:scale-95 transition"
              >
                ↺ Ulangi
              </button>
            </div>
            {msg && <div className="text-emerald-300 text-sm text-center">{msg}</div>}
            <button
              onClick={onSaveBin}
              className="text-xs text-slate-400 underline hover:text-slate-200"
            >
              Simpan ESC/POS (.bin)
            </button>
          </div>
        )}
      </div>

      <footer className="text-[11px] text-slate-500 text-center pb-2">
        Template: {template} · {shots.length} shot
      </footer>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}
