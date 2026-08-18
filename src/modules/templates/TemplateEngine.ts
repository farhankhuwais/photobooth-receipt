import { BrandingConfig } from '../../store/useSession'
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

export async function composeStrip(
  shots: string[],
  branding: BrandingConfig,
  template: string = 'strip3',
  qrOverride?: string | null
): Promise<HTMLCanvasElement> {
  const imgs = await Promise.all(shots.map(loadImage))
  const logo = branding.logoDataUrl ? await loadImage(branding.logoDataUrl) : null
  const qrText = qrOverride ?? branding.qrText
  const qr = qrText ? await loadImage(await qrDataUrl(qrText)) : null

  const headerH = branding.logoDataUrl ? 104 : 64
  const footerH = qr ? 200 : 72
  const gap = 10
  const sidePad = 12

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
    const lh = 48
    const lw = Math.round((lh * logo.width) / logo.height)
    const lx = (PRINT_WIDTH - lw) / 2
    ctx.drawImage(logo, lx, 8, lw, lh)
    if (branding.eventName) {
      ctx.font = 'bold 26px sans-serif'
      ctx.fillText(branding.eventName, PRINT_WIDTH / 2, 8 + lh + 22)
    }
  } else {
    ctx.font = 'bold 30px sans-serif'
    if (branding.eventName) ctx.fillText(branding.eventName, PRINT_WIDTH / 2, headerH / 2)
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
  if (qr) {
    const qz = 180
    ctx.drawImage(qr, (PRINT_WIDTH - qz) / 2, fy, qz, qz)
    if (branding.qrText) {
      ctx.font = '13px sans-serif'
      ctx.fillText('scan untuk foto digital', PRINT_WIDTH / 2, fy + qz + 18)
    }
  } else if (branding.showDate) {
    ctx.font = '18px sans-serif'
    ctx.fillText(new Date().toLocaleString('id-ID'), PRINT_WIDTH / 2, fy + 26)
  } else {
    ctx.textBaseline = 'middle'
  }
  if (branding.watermark) {
    ctx.font = '15px sans-serif'
    ctx.fillText(branding.watermark, PRINT_WIDTH / 2, canvas.height - 14)
  }

  return canvas
}
