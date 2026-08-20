import { BrandingConfig, FrameId, FrameDef } from '../../store/useSession'
import { qrDataUrl } from '../qr/qr'

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

export async function composeStrip(
  shots: string[],
  branding: BrandingConfig,
  template: string = 'strip3',
  qrOverride?: string | null,
  frames: FrameDef[] = [],
  selectedFrameId: string | null = null
): Promise<HTMLCanvasElement> {
  const imgs = await Promise.all(shots.map(loadImage))
  const logo = branding.logoDataUrl ? await loadImage(branding.logoDataUrl) : null
  const qrText = qrOverride ?? branding.qrText
  const qr = qrText ? await loadImage(await qrDataUrl(qrText)) : null

  const headerH = branding.logoDataUrl ? 266 : 64
  // Footer dibikin lebih panjang & di-stack dari atas: QR → scan text → tanggal
  // → (jalur khusus paling bawah buat watermark) biar gak tenggelam di bawah logo/QR.
  let footerH = 12 // padding bawah
  if (qr) footerH += 180 + (branding.qrText ? 28 : 8)
  if (branding.showDate) footerH += 34
  if (branding.watermark) footerH += 44 // jalur khusus watermark
  footerH += 10 // padding atas
  if (footerH < (branding.watermark ? 56 : 48)) footerH = branding.watermark ? 56 : 48
  const gap = 10
  const sidePad = 20

  const innerW = PRINT_WIDTH - sidePad * 2
  let shotW = innerW
  let shotH = Math.round(shotW * 0.75)
  let cols = 1

  if (template === 'grid2x2') {
    cols = 2
    shotW = (innerW - gap) / 2
    shotH = Math.round(shotW * 0.75)
  } else if (template === 'single') {
    shotW = innerW
    shotH = Math.round(shotW * 0.75)
  }

  const rows = Math.ceil(imgs.length / cols)
  const contentH = rows * shotH + (rows - 1) * gap

  const canvas = document.createElement('canvas')
  canvas.width = PRINT_WIDTH
  canvas.height = headerH + contentH + footerH
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
    if (branding.eventName && branding.showEventNameOnPrint) {
      ctx.fillStyle = '#000000'
      ctx.font = 'bold 24px sans-serif'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(branding.eventName, PRINT_WIDTH / 2, headerH - 12)
    }
  } else {
    ctx.font = 'bold 30px sans-serif'
    if (branding.eventName && branding.showEventNameOnPrint) ctx.fillText(branding.eventName, PRINT_WIDTH / 2, headerH / 2)
  }

  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (i >= imgs.length) break
      const x = sidePad + c * (shotW + gap)
      const y = headerH + r * (shotH + gap)
      drawCover(ctx, imgs[i], x, y, shotW, shotH)
      i++
    }
  }

  const fy = headerH + contentH
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000000' // pastikan teks footer (scan/date/watermark) hitam,
  // gak ikut fillStyle putih dari kotak logo di atas.
  // Stack konten footer dari atas, sisakan jalur terbawah buat watermark
  // (gak pernah tabrakan sama QR / tanggal).
  let cursorY = fy + 10
  if (qr) {
    const qz = 180
    ctx.drawImage(qr, (PRINT_WIDTH - qz) / 2, cursorY, qz, qz)
    cursorY += qz + 6
    if (branding.qrText) {
      ctx.font = '13px sans-serif'
      ctx.fillText('scan untuk foto digital', PRINT_WIDTH / 2, cursorY + 16)
      cursorY += 30
    }
    if (branding.showDate) {
      ctx.font = '18px sans-serif'
      ctx.fillText(new Date().toLocaleString('id-ID'), PRINT_WIDTH / 2, cursorY + 18)
      cursorY += 34
    }
  } else if (branding.showDate) {
    ctx.font = '18px sans-serif'
    ctx.fillText(new Date().toLocaleString('id-ID'), PRINT_WIDTH / 2, cursorY + 18)
    cursorY += 34
  }
  if (branding.watermark) {
    ctx.font = '15px sans-serif'
    ctx.fillStyle = '#000000' // eksplisit hitam — gak ikut fillStyle putih dari kotak logo
    // Selalu di jalur terbawah (44px) → gak tenggelam di bawah logo/QR/tanggal.
    ctx.fillText(branding.watermark, PRINT_WIDTH / 2, canvas.height - 22)
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
