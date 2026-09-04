import { BrandingConfig, FrameId, FrameDef } from '../../store/useSession'

export const PRINT_WIDTH = 576

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const ar = img.width / img.height
  const tar = w / h
  let sw = img.width
  let sh = img.height
  let sx = 0
  let sy = 0
  if (ar > tar) {
    sw = img.height * tar
    sx = (img.width - sw) / 2
  } else {
    sh = img.width / tar
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

// Dekorasi frame bawaan, digambar di atas hasil compose.
function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: FrameId,
  w: number,
  h: number,
  eventName: string
) {
  if (frame === 'none') return
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (frame === 'love') {
    ctx.strokeStyle = '#ff3e6c'
    ctx.lineWidth = 14
    ctx.strokeRect(7, 7, w - 14, h - 14)
    ctx.fillStyle = '#ff3e6c'
    ctx.font = '40px sans-serif'
    ctx.fillText('♥', 36, 36)
    ctx.fillText('♥', w - 36, h - 36)
  } else if (frame === 'party') {
    ctx.fillStyle = '#7c3aed'
    ctx.fillRect(0, 0, w, 18)
    ctx.fillRect(0, h - 18, w, 18)
    const cols = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899']
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = cols[i % cols.length]
      const x = (i * 53) % w
      const y = (i * 89) % h
      ctx.fillRect(x, y, 10, 10)
    }
  } else if (frame === 'vintage') {
    ctx.strokeStyle = '#8b5e34'
    ctx.lineWidth = 22
    ctx.strokeRect(11, 11, w - 22, h - 22)
    ctx.strokeStyle = '#d9b38c'
    ctx.lineWidth = 4
    ctx.strokeRect(26, 26, w - 52, h - 52)
    ctx.fillStyle = '#8b5e34'
    ctx.font = 'italic bold 22px serif'
    ctx.fillText(eventName || 'Vintage', w / 2, 44)
  } else if (frame === 'neon') {
    ctx.shadowColor = '#00e5ff'
    ctx.shadowBlur = 18
    ctx.strokeStyle = '#00e5ff'
    ctx.lineWidth = 10
    ctx.strokeRect(8, 8, w - 16, h - 16)
    ctx.shadowColor = '#ff00e5'
    ctx.strokeStyle = '#ff00e5'
    ctx.strokeRect(20, 20, w - 40, h - 40)
  } else if (frame === 'floral') {
    ctx.fillStyle = '#16a34a'
    for (let i = 0; i < w; i += 40) {
      ctx.beginPath(); ctx.arc(i, 0, 14, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(i, h, 14, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < h; i += 40) {
      ctx.beginPath(); ctx.arc(0, i, 14, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(w, i, 14, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = '#f472b6'
    for (let i = 0; i < w; i += 40) {
      ctx.beginPath(); ctx.arc(i, 0, 6, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(i, h, 6, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.restore()
}

// Satu "design" = mockup kustom: bingkai PNG (opsional) + slot foto bebas.
export interface DesignSlot {
  x: number; y: number; w: number; h: number; rot?: number  // derajat, CW
}
export interface DesignDef {
  id: string
  name: string
  frameUrl: string | null   // endpoint SVG/PNG bingkai
  canvasW: number
  canvasH: number
  slots: DesignSlot[]       // dalam koordinat PRINT_WIDTH (576 lebar)
}

// Gambar satu foto ke slot (cover-fit, tanpa rotasi — slot selalu lurus).
function drawSlot(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s: DesignSlot
) {
  ctx.save()
  ctx.translate(s.x + s.w / 2, s.y + s.h / 2)
  // Rotasi slot di-nonaktifkan supaya hasil cetak selalu lurus & centered.
  // Jika nanti butuh efek miring lagi, kembalikan baris bawah.
  // if (s.rot) ctx.rotate((s.rot * Math.PI) / 180)
  ctx.beginPath()
  ctx.rect(-s.w / 2, -s.h / 2, s.w, s.h)
  ctx.clip()
  drawCover(ctx, img, -s.w / 2, -s.h / 2, s.w, s.h)
  ctx.restore()
}

export async function composeDesign(
  shots: string[],
  branding: BrandingConfig,
  design: DesignDef
): Promise<HTMLCanvasElement> {
  const imgs = await Promise.all(shots.map(loadImage))
  // Footer (tanggal / watermark) — QR sudah tidak dicetak di struk.

  let footerH = 12 // padding bawah
  if (branding.showDate) footerH += 34
  if (branding.watermark) footerH += 44
  footerH += 10 // padding atas
  if (footerH < (branding.watermark ? 56 : 48)) footerH = branding.watermark ? 56 : 48

  // Canvas = PRINT_WIDTH lebar; tinggi = tinggi design (diskala dari canvasW) + footer.
  const scale = PRINT_WIDTH / design.canvasW
  const designH = Math.round(design.canvasH * scale)
  const canvas = document.createElement('canvas')
  canvas.width = PRINT_WIDTH
  canvas.height = designH + footerH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // NOTE: di mode design, logo/eventName TIDAK digambar di sini (biarkan murni
  // sesuai editor & bingkai). Header di composeStrip sengaja di-skip agar
  // posisi slot foto WYSIWYG dengan editor.

  // Foto ke slot bebas (miring boleh). Sisa slot diisi pola abu kalau foto kurang.
  for (let i = 0; i < design.slots.length; i++) {
    const s = design.slots[i]
    if (imgs[i]) drawSlot(ctx, imgs[i], s)
    else { ctx.fillStyle = '#dddddd'; ctx.fillRect(s.x, s.y, s.w, s.h) }
  }

  // Bingkai design (PNG/SVG) menimpa hasil, diskala ke canvas penuh.
  if (design.frameUrl) {
    try {
      const g = await loadImage(design.frameUrl)
      ctx.drawImage(g, 0, 0, canvas.width, designH)
    } catch { /* ignore frame gagal */ }
  }

  // Footer: tanggal → watermark. (QR sudah tidak dicetak di struk.)
  const fy = designH
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000000'
  let cursorY = fy + 10
  if (branding.showDate) {
    ctx.font = '18px sans-serif'
    ctx.fillText(new Date().toLocaleString('id-ID'), PRINT_WIDTH / 2, cursorY + 18)
    cursorY += 34
  }
  if (branding.watermark) {
    ctx.font = '15px sans-serif'
    ctx.fillStyle = '#000000'
    ctx.fillText(branding.watermark, PRINT_WIDTH / 2, canvas.height - 22)
  }

  return canvas
}

export async function composeStrip(
  shots: string[],
  branding: BrandingConfig,
  template: string = 'strip3',
  frames: FrameDef[] = [],
  selectedFrameId: string | null = null,
  design: DesignDef | null = null
): Promise<HTMLCanvasElement> {
  // Mode design (mockup bebas) — delegasikan.
  if (design) return composeDesign(shots, branding, design)
  const imgs = await Promise.all(shots.map(loadImage))
  const logo = branding.logoDataUrl ? await loadImage(branding.logoDataUrl) : null
  // QR tidak lagi dicetak di struk — hanya tersedia via tombol QR di app.

  // Header H: kalau ada eventName (below-logo) + logo → butuh space ekstra +42px
  // supaya event name tidak menumpuk dengan logo. Rumus dipakai admin Settings.tsx
  // (renderStrukPreview) — JAGA KONSISTENSI.
  const hasBelowLogoEventName = !!(branding.eventName && branding.showEventNameOnPrint)
  const baseH = branding.logoDataUrl ? 266 : 64
  const headerH = baseH + (branding.logoDataUrl && hasBelowLogoEventName ? 42 : 0)
  // Footer: tanggal → watermark. (QR sudah tidak dicetak di struk.)
  let footerH = 12 // padding bawah
  if (branding.showDate) footerH += 34
  if (branding.watermark) footerH += 44 // jalur khusus watermark
  footerH += 10 // padding atas
  if (footerH < (branding.watermark ? 56 : 48)) footerH = branding.watermark ? 56 : 48
  // Jarak dekorasi foto (px) dari Settings. Fallback default biar DB lama aman.
  const topPad = branding.photoTopPad ?? 24
  const bottomPad = branding.photoBottomPad ?? 24
  // Grid 2x2 pakai jarak antar foto KHUSUS (X = kiri-kanan, Y = atas-bawah);
  // template lain pakai photoGap (sama utk vertikal & horizontal).
  const gapX = template === 'grid2x2' ? (branding.photoGap2x2X ?? 20) : (branding.photoGap ?? 20)
  const gapY = template === 'grid2x2' ? (branding.photoGap2x2Y ?? 20) : (branding.photoGap ?? 20)
  const sidePad = 20

  const innerW = PRINT_WIDTH - sidePad * 2
  let shotW = innerW
  let shotH = Math.round(shotW * 0.75)
  let cols = 1

  if (template === 'grid2x2') {
    cols = 2
    shotW = (innerW - gapX) / 2
    shotH = Math.round(shotW * 0.75)
  } else if (template === 'dual') {
    cols = 1
    shotW = innerW
    shotH = Math.round(shotW * 0.75)
  } else if (template === 'single') {
    shotW = innerW
    shotH = Math.round(shotW * 0.75)
  }

  const rows = Math.ceil(imgs.length / cols)
  const contentH = rows * shotH + (rows - 1) * gapY

  const canvas = document.createElement('canvas')
  canvas.width = PRINT_WIDTH
  canvas.height = headerH + topPad + contentH + bottomPad + footerH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (logo) {
      // Logo ukuran FIX persegi (kotak) BESAR di kertas, terlepas dari aspek asli file.
            const pad = 4
            const box = Math.min(headerH - pad * 2, 250) // kotak hingga 250px
    const lx = (PRINT_WIDTH - box) / 2
    const ly = (headerH - box) / 2
    // Latar putih supaya logo transparan/berwarna tetap rapi di kotak.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(lx, ly, box, box)
    // Gambar logo "contain" di dalam kotak (tanpa distorsi).
    const ar = logo.width / logo.height
    let dw = box
    let dh = box
    if (ar > 1) dh = box / ar
    else dw = box * ar
    ctx.drawImage(logo, lx + (box - dw) / 2, ly + (box - dh) / 2, dw, dh)
    // Skip render kalau eventNamePosition='footer' (akan di-render di footer section)
    if (branding.eventName && branding.showEventNameOnPrint && branding.eventNamePosition !== 'footer') {
      ctx.fillStyle = '#000000'
      ctx.font = 'bold 24px sans-serif'
      ctx.textBaseline = 'alphabetic'
      // Event name Y = logoBottom + gap (visual, default 14) + fontSize (24)
      // supaya text tidak menumpuk dengan logo. Field `eventNameGapBelowLogo`
      // admin-controlled, default 14px.
      const gap = branding.eventNameGapBelowLogo ?? 14
      const eventY = ly + dh + gap + 24
      ctx.fillText(branding.eventName, PRINT_WIDTH / 2, eventY)
    }
  } else {
    // TANPA LOGO: render event name di tengah header (hanya kalau posisi below-logo)
    if (branding.eventName && branding.showEventNameOnPrint && branding.eventNamePosition !== 'footer') {
      ctx.font = 'bold 30px sans-serif'
      ctx.fillText(branding.eventName, PRINT_WIDTH / 2, headerH / 2)
    }
  }

  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (i >= imgs.length) break
      const x = sidePad + c * (shotW + gapX)
      const y = headerH + topPad + r * (shotH + gapY)
      drawCover(ctx, imgs[i], x, y, shotW, shotH)
      i++
    }
  }

  const fy = headerH + topPad + contentH + bottomPad
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000000' // pastikan teks footer hitam, gak ikut fillStyle putih dari kotak logo.
  let cursorY = fy + 10
  if (branding.showDate) {
    ctx.font = '18px sans-serif'
    ctx.fillText(new Date().toLocaleString('id-ID'), PRINT_WIDTH / 2, cursorY + 18)
    cursorY += 34
  }
  if (branding.watermark) {
    ctx.font = '15px sans-serif'
    ctx.fillStyle = '#000000'
    ctx.fillText(branding.watermark, PRINT_WIDTH / 2, canvas.height - 22)
  }
  // Event name di footer (jika eventNamePosition='footer'). Taruh di atas watermark.
  if (branding.eventName && branding.showEventNameOnPrint && branding.eventNamePosition === 'footer') {
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 18px sans-serif'
    ctx.textBaseline = 'alphabetic'
    const evtY = canvas.height - (branding.watermark ? 64 : 20)
    ctx.fillText(branding.eventName, PRINT_WIDTH / 2, evtY)
  }

  // Frame bawaan digambar (kecuali 'none'). Nama event di frame mengikuti toggle cetak.
  const frameEventName = branding.showEventNameOnPrint ? branding.eventName : ''
  drawFrame(ctx, branding.frame, canvas.width, canvas.height, frameEventName)
  // Frame gallery custom (dari DB) — customer pilih 1 di layar booth.
  const sel = selectedFrameId ? frames.find((f) => f.id === selectedFrameId) : null
  if (sel) {
    const gImg = await loadImage(sel.url)
    ctx.drawImage(gImg, 0, 0, canvas.width, canvas.height)
  }

  return canvas
}
