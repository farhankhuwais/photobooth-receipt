import { useRef, useState, useEffect, useCallback } from 'react'
import { useSession } from '../../store/useSession'

// Satu slot foto dalam koordinat canvas asli (mis. 308x454).
export interface Slot {
  x: number
  y: number
  w: number
  h: number
  rot: number
}

const CANVAS_W = 308
const CANVAS_H = 454
// Ruang editor & penyimpanan = koordinat hasil cetak (PRINT_WIDTH=576 di TemplateEngine).
// Semua slot disimpan di ruang ini (OUT_W x OUT_H) sehingga WYSIWYG 1:1 dengan hasil compose.
const OUT_W = 576
const OUT_H = Math.round(CANVAS_H * (OUT_W / CANVAS_W)) // 849
const DISP_W = 248 // lebar preview di panel (CSS scale = DISP_W / OUT_W)
const SCALE = DISP_W / OUT_W

type DragMode = 'move' | 'resize' | null

// ===== Deteksi zona warna di bingkai (mis. kotak hijau muda buatan Canva) =====
// Piksel yang mirip warna target (dalam toleransi) dikelompokkan jadi zona,
// lalu tiap zona bisa dipakai langsung sebagai slot foto.
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '')
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) }
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = rej
    im.src = src
  })
}

interface ZoneBox { x: number; y: number; w: number; h: number }

// Gabungkan dua bbox yang saling tumpang-tindih (hasil scan yang "pecah"
// karena antialias/gradien) biar satu zona fisik = satu slot.
function mergeBoxes(bs: ZoneBox[]): ZoneBox[] {
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j]
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        const inter = ix * iy
        const small = Math.min(a.w * a.h, b.w * b.h)
        if (inter > 0.5 * small) {
          const nx = Math.min(a.x, b.x), ny = Math.min(a.y, b.y)
          const nw = Math.max(a.x + a.w, b.x + b.w) - nx
          const nh = Math.max(a.y + a.h, b.y + b.h) - ny
          bs[i] = { x: nx, y: ny, w: nw, h: nh }
          bs.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return bs
}

// Scan piksel gambar -> daftar bbox zona warna (di ruang koordinat gambar asli).
async function scanColorZones(src: string, colorHex: string, tol: number): Promise<ZoneBox[]> {
  const img = await loadImageEl(src)
  const W = img.naturalWidth, H = img.naturalHeight
  if (!W || !H) return []
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, W, H).data
  const t = hexToRgb(colorHex)
  const tol2 = tol * tol * 3
  const mask = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const dr = data[i] - t.r, dg = data[i + 1] - t.g, db = data[i + 2] - t.b
    if (dr * dr + dg * dg + db * db <= tol2) mask[p] = 1
  }
  // Connected components (flood fill iteratif).
  const visited = new Uint8Array(W * H)
  const raw: ZoneBox[] = []
  const stack: number[] = []
  for (let p0 = 0; p0 < mask.length; p0++) {
    if (!mask[p0] || visited[p0]) continue
    let minX = W, minY = H, maxX = 0, maxY = 0, n = 0
    stack.length = 0; stack.push(p0); visited[p0] = 1
    while (stack.length) {
      const q = stack.pop()!
      const x = q % W, y = (q / W) | 0
      n++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && mask[q - 1] && !visited[q - 1]) { visited[q - 1] = 1; stack.push(q - 1) }
      if (x < W - 1 && mask[q + 1] && !visited[q + 1]) { visited[q + 1] = 1; stack.push(q + 1) }
      if (y > 0 && mask[q - W] && !visited[q - W]) { visited[q - W] = 1; stack.push(q - W) }
      if (y < H - 1 && mask[q + W] && !visited[q + W]) { visited[q + W] = 1; stack.push(q + W) }
    }
    // Buang noise: zona minimal 24px per sisi & isi >=35% bbox.
    if (maxX - minX + 1 >= 24 && maxY - minY + 1 >= 24 && n >= 0.35 * (maxX - minX + 1) * (maxY - minY + 1)) {
      raw.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
    }
  }
  return mergeBoxes(raw)
}


// Editor slot drag-drop untuk design/mockup photobooth.
// Operator lihat preview (skala mockup), drag/resize/rotate tiap slot foto,
// lalu simpan. Posisi persis mengikuti mockup yang diupload.
export function DesignEditor() {
  const [designs, setDesigns] = useState<{ id: string; name: string }[]>([])
  const [selId, setSelId] = useState<string>('') // '' = design baru
  const [name, setName] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [framePending, setFramePending] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: DragMode; i: number; sx: number; sy: number; orig: Slot } | null>(null)

  // ===== Deteksi zona warna =====
  const [zoneColor, setZoneColor] = useState<string>('#a5d6a7') // default hijau muda
  const [zoneTol, setZoneTol] = useState<number>(60)            // toleransi kemiripan warna
  const [zoneBoxes, setZoneBoxes] = useState<ZoneBox[] | null>(null) // null = belum scan
  const [scanning, setScanning] = useState(false)
  const [stripZones, setStripZones] = useState<boolean>(true)   // hapus zona dr bingkai saat simpan

  // Proses file bingkai: piksel yang mirip warna zona dibikin transparan (alpha 0),
  // biar foto keliatan lewatnya. Dipanggil saat simpan kalau stripZones aktif.
  async function stripFrameZones(file: File): Promise<File> {
    const url = URL.createObjectURL(file)
    try {
      const im = await loadImageEl(url)
      const W = im.naturalWidth, H = im.naturalHeight
      if (!W || !H) return file
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return file
      ctx.drawImage(im, 0, 0)
      const idata = ctx.getImageData(0, 0, W, H)
      const px = idata.data
      const t = hexToRgb(zoneColor)
      const tol2 = zoneTol * zoneTol * 3
      let hit = 0
      for (let i = 0; i < px.length; i += 4) {
        const dr = px[i] - t.r, dg = px[i + 1] - t.g, db = px[i + 2] - t.b
        if (dr * dr + dg * dg + db * db <= tol2) { px[i + 3] = 0; hit++ }
      }
      if (!hit) return file // tidak ada piksel yg cocok -> biarkan file asli
      ctx.putImageData(idata, 0, 0)
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
      if (!blob) return file
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-transparent.png', { type: 'image/png' })
    } catch {
      return file
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function detectZones() {
    if (!frameUrl || scanning) return
    setScanning(true)
    try {
      const raw = await scanColorZones(frameUrl, zoneColor, zoneTol)
      // Scale hasil scan (koordinat piksel gambar asli) -> ruang hasil 576x849,
      // sekaligus dipakai untuk overlay preview.
      const im = await loadImageEl(frameUrl)
      const kx = OUT_W / (im.naturalWidth || OUT_W)
      const ky = OUT_H / (im.naturalHeight || OUT_H)
      setZoneBoxes(raw.map((z) => ({
        x: Math.round(z.x * kx), y: Math.round(z.y * ky),
        w: Math.round(z.w * kx), h: Math.round(z.h * ky),
      })))
    } catch {
      setZoneBoxes([])
    } finally {
      setScanning(false)
    }
  }

  // Pakai zona ke-i sebagai slot baru (zona sudah di ruang hasil 576x849).
  function applyZone(i: number) {
    if (!zoneBoxes) return
    const z = zoneBoxes[i]
    if (!z) return
    setSlots((prev) => [...prev, { ...z, rot: 0 }])
  }


  // Load daftar design existing.
  const loadList = useCallback(async () => {
    try {
      const list = await (await fetch('/api/designs')).json()
      if (Array.isArray(list)) setDesigns(list)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  // Muat design yg dipilih ke editor.
  async function loadDesign(id: string) {
    if (!id) {
      setSelId('')
      setName('')
      setSlots([])
      setFrameUrl(null)
      setFramePending(null)
      return
    }
    setSelId(id)
    try {
      const d = await (await fetch(`/api/designs/${id}`)).json()
      if (!d) return
      setName(d.name || '')
      // Slot disimpan di ruang hasil (OUT_W). Kalau design lama/rusak masih di ruang
      // native 308, upscale ke 576. Deteksi: koordinat slot > canvas_w berarti
      // sudah di ruang hasil -> jangan upscale (hindari double-scale).
      const cw = d.canvas_w || CANVAS_W
      const maxCoord = Array.isArray(d.slots)
        ? Math.max(0, ...d.slots.flatMap((s: Slot) => [s.x + s.w, s.y + s.h]))
        : 0
      const k = cw !== OUT_W && maxCoord <= cw * 1.5 ? OUT_W / cw : 1
      setSlots(Array.isArray(d.slots) ? d.slots.map((s: Slot) => ({
        x: Math.round(s.x * k), y: Math.round(s.y * k),
        w: Math.round(s.w * k), h: Math.round(s.h * k), rot: s.rot || 0,
      })) : [])
      setFrameUrl(d.hasFrame ? `/api/designs/${id}/frame?t=${Date.now()}` : null)
      setFramePending(null)
    } catch { /* ignore */ }
  }

  // Template dasar dihapus dari UI — slot dibuat manual (+ Slot) atau via deteksi zona.

  // Pointer events: drag move / resize (skala balik ke koordinat canvas).
  function onDown(e: React.PointerEvent, mode: DragMode, i: number) {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setActive(i)
    const s = slots[i]
    drag.current = { mode, i, sx: e.clientX, sy: e.clientY, orig: { ...s } }
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / SCALE
    const dy = (e.clientY - d.sy) / SCALE
    setSlots((prev) => {
      const next = prev.slice()
      const s = { ...next[d.i] }
      if (d.mode === 'move') {
        s.x = Math.max(0, Math.min(OUT_W - s.w, d.orig.x + dx))
        s.y = Math.max(0, Math.min(OUT_H - s.h, d.orig.y + dy))
      } else if (d.mode === 'resize') {
        s.w = Math.max(20, Math.min(OUT_W - s.x, d.orig.w + dx))
        s.h = Math.max(20, Math.min(OUT_H - s.y, d.orig.h + dy))
      }
      next[d.i] = s
      return next
    })
  }

  function onUp(e: React.PointerEvent) {
    if (drag.current) {
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    drag.current = null
  }

  function updateSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function addSlot() {
    setSlots((prev) => [...prev, { x: 40, y: 40, w: 120, h: 160, rot: 0 }])
  }

  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i))
    setActive((a) => (a === i ? null : a))
  }

  async function save() {
    setBusy(true)
    let newId: string | null = null
    const wasNew = !selId
    try {
      const fd = new FormData()
      fd.append('name', name.trim() || `design-${Date.now()}`)
      fd.append('canvas_w', String(OUT_W))
      fd.append('canvas_h', String(OUT_H))
      fd.append('slots', JSON.stringify(slots))
      // Bingkai: kalau "hapus zona" aktif, piksel zona warna dibikin transparan
      // dulu sebelum diupload, dan preview di-update ke versi transparannya.
      let frameFile = framePending
      if (frameFile && stripZones) {
        frameFile = await stripFrameZones(frameFile)
        setFrameUrl(URL.createObjectURL(frameFile))
        setFramePending(frameFile)
      }
      if (frameFile) fd.append('image', frameFile)
      if (selId) {
        await fetch(`/api/designs/${selId}`, { method: 'PUT', body: fd })
      } else {
        const res = await fetch('/api/designs', { method: 'POST', body: fd })
        if (res.ok) { const j = await res.json(); newId = j.id; setSelId(j.id) }
      }
      await loadList()
      // Push daftar terbaru ke session agar picker booth langsung update,
      // dan auto-pilih design baru biar langsung muncul di layar booth.
      try {
        const list = await (await fetch('/api/designs')).json()
        if (Array.isArray(list)) {
          useSession.getState().setDesigns(
            list.map((d: any) => ({ id: d.id, name: d.name, canvasW: d.canvas_w, canvasH: d.canvas_h }))
          )
          if (wasNew && newId) useSession.getState().setSelectedDesignId(newId)
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    finally { setBusy(false) }
  }

  async function removeDesign() {
    if (!selId) return
    if (!confirm('Hapus design mockup ini?')) return
    try {
      const res = await fetch(`/api/designs/${selId}`, { method: 'DELETE' })
      if (res.ok) {
        setSelId('')
        setName(''); setSlots([]); setFrameUrl(null); setFramePending(null)
        await loadList()
        // Sinkron ke session agar picker booth langsung update.
        const list = await (await fetch('/api/designs')).json()
        if (Array.isArray(list)) {
          useSession.getState().setDesigns(
            list.map((d: any) => ({ id: d.id, name: d.name, canvasW: d.canvas_w, canvasH: d.canvas_h }))
          )
        }
        if (useSession.getState().selectedDesignId === selId) {
          useSession.getState().setSelectedDesignId(null)
        }
      }
    } catch { /* ignore */ }
  }

  function onFrameFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFramePending(f)
    setFrameUrl(URL.createObjectURL(f))
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  const frameInput = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col gap-2 border-t-4 border-black pt-3">
      <span className="font-label-bold text-label-bold text-on-surface uppercase tracking-wider text-[12px]">Editor Design Mockup</span>
      <span className="text-[10px] normal-case tracking-normal text-on-surface-variant">
        Pilih design untuk diedit, atau buat baru. Drag kotak foto di preview, tarik pojok kanan-bawah untuk resize, atur rotasi. Posisi mengikuti mockup.
      </span>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selId}
          onChange={(e) => loadDesign(e.target.value)}
          className="px-2 py-2 border-4 border-black bg-surface text-on-surface font-label-bold text-[11px] uppercase"
        >
          <option value="">+ Design Baru</option>
          {designs.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button onClick={() => loadDesign('')} className="px-2 py-2 border-4 border-black bg-surface text-on-surface font-label-bold text-[11px] uppercase">Reset Baru</button>
        <button
          onClick={removeDesign}
          disabled={!selId}
          className="px-2 py-2 border-4 border-black bg-error-container text-on-error-container font-label-bold text-[11px] uppercase disabled:opacity-40"
        >Hapus</button>
      </div>

      {/* Preview canvas — wrapper display, inner di-scale ke koordinat hasil (WYSIWYG) */}
      <div
        className="relative mx-auto border-4 border-black bg-white overflow-hidden touch-none select-none"
        style={{ width: DISP_W, height: DISP_W * (CANVAS_H / CANVAS_W) }}
      >
        <div
          ref={canvasRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: OUT_W, height: OUT_H, transform: `scale(${SCALE})` }}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {frameUrl && (
            <img src={frameUrl} alt="" className="absolute inset-0 w-full h-full object-fill pointer-events-none" />
          )}
          {/* Overlay zona hasil scan (hijau transparan) — klik +N = jadi slot */}
          {zoneBoxes?.map((z, i) => (
            <div
              key={`z${i}`}
              style={{ left: z.x, top: z.y, width: z.w, height: z.h }}
              className="absolute border-2 border-dashed border-green-600 bg-green-400/30 pointer-events-none flex items-start justify-end"
            >
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => applyZone(i)}
                title="Pakai zona ini sebagai slot"
                className="m-1 w-6 h-6 bg-green-600 text-white text-[10px] font-bold border-2 border-black pointer-events-auto"
              >+{i + 1}</button>
            </div>
          ))}
          {slots.map((s, i) => (
            <div
              key={i}
              onPointerDown={(e) => onDown(e, 'move', i)}
              className={`absolute border-2 ${active === i ? 'border-primary-container' : 'border-black'} bg-black/20 cursor-move`}
              style={{
                left: s.x, top: s.y, width: s.w, height: s.h,
                transform: `rotate(${s.rot}deg)`,
              }}
            >
              <span className="absolute top-0 left-0 bg-black text-white text-[9px] px-1 leading-tight">{i + 1}</span>
              {/* resize handle */}
              <div
                onPointerDown={(e) => onDown(e, 'resize', i)}
                className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary-container border-2 border-black cursor-nwse-resize"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Controls per slot */}
      <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
        {slots.map((s, i) => (
          <div key={i} className="flex flex-col gap-1 border-2 border-black p-2 bg-surface-container-lowest">
            <div className="flex items-center justify-between">
              <span className="font-label-bold text-label-bold text-[11px] uppercase">Foto {i + 1}</span>
              <button onClick={() => removeSlot(i)} className="w-5 h-5 flex items-center justify-center bg-error-container border-2 border-black text-on-error-container text-[12px]">×</button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <label key={k} className="flex flex-col text-[9px] text-on-surface-variant">
                  <span className="uppercase">{k}</span>
                  <input
                    type="number"
                    value={Math.round(s[k])}
                    onChange={(e) => updateSlot(i, { [k]: Number(e.target.value) } as any)}
                    className="w-full border-2 border-black px-1 py-0.5 text-[11px] text-on-surface bg-surface-container-lowest"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] w-10">Rotasi</span>
              <input
                type="range" min={-45} max={45} step={1} value={s.rot}
                onChange={(e) => updateSlot(i, { rot: Number(e.target.value) })}
                className="flex-1 accent-black"
              />
              <input
                type="number" min={-45} max={45} value={s.rot}
                onChange={(e) => updateSlot(i, { rot: Number(e.target.value) })}
                className="w-12 border-2 border-black px-1 py-0.5 text-[11px] text-on-surface bg-surface-container-lowest"
              />
              <span className="text-[10px]">°</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={addSlot} className="px-2 py-2 border-4 border-black bg-surface text-on-surface font-label-bold text-[11px] uppercase">+ Slot</button>
        <button onClick={() => frameInput.current?.click()} className="px-2 py-2 border-4 border-black bg-primary-container text-on-primary-container font-label-bold text-[11px] uppercase">Bingkai PNG</button>
        <input ref={frameInput} type="file" accept="image/png,image/*" hidden onChange={onFrameFile} />
      </div>

      {/* Deteksi zona warna: scan bingkai -> zona jadi kandidat slot 1-klik */}
      {frameUrl && (
        <div className="flex flex-col gap-1 border-2 border-dashed border-black p-2 bg-surface-container-low">
          <span className="font-label-bold text-label-bold text-[11px] uppercase tracking-wider">Deteksi Zona (kotak warna di bingkai)</span>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-[10px] uppercase text-on-surface-variant">
              Warna
              <input
                type="color"
                value={zoneColor}
                onChange={(e) => setZoneColor(e.target.value)}
                className="w-8 h-8 border-2 border-black bg-white cursor-pointer"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] uppercase text-on-surface-variant">
              Toleransi
              <input
                type="range" min={10} max={120} step={5} value={zoneTol}
                onChange={(e) => setZoneTol(Number(e.target.value))}
                className="w-24 accent-black"
              />
              <span className="text-[10px] w-6">{zoneTol}</span>
            </label>
            <button
              onClick={detectZones}
              disabled={scanning}
              className="px-2 py-2 border-4 border-black bg-green-600 text-white font-label-bold text-[11px] uppercase disabled:opacity-50"
            >
              {scanning ? 'Memindai…' : '🔍 Scan Zona'}
            </button>
            {zoneBoxes && (
              <>
                <span className="text-[10px] uppercase text-on-surface-variant">{zoneBoxes.length} zona ketemu — klik +N di preview untuk pakai</span>
                <button onClick={() => setZoneBoxes(null)} className="px-2 py-1 border-2 border-black bg-surface text-on-surface font-label-bold text-[10px] uppercase">×</button>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-[10px] uppercase text-on-surface-variant">
            <input
              type="checkbox"
              checked={stripZones}
              onChange={(e) => setStripZones(e.target.checked)}
              className="w-4 h-4 accent-black"
            />
            Hapus warna zona dari bingkai saat disimpan (jadi transparan, foto keliatan)
          </label>
        </div>
      )}


      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nama design (cth: Klasik Cinta)"
        className="mt-1 w-full border-4 border-black bg-surface-container-lowest px-3 py-2 text-on-surface font-body-md outline-none focus:bg-surface-container-high"
      />
      <button
        onClick={save}
        disabled={busy}
        className="px-3 py-2 border-4 border-black bg-secondary-container text-on-secondary-container font-label-bold uppercase neo-button brutal-shadow-sm hover:bg-surface-container"
      >
        {busy ? 'Menyimpan…' : selId ? 'Update Design' : 'Simpan Design'}
      </button>
    </div>
  )
}
