// Kumpulan filter foto untuk photobooth.
// Semua filter input dataURL -> output dataURL JPEG.
//
// - 'comic'   : anime cel-shading (blur halus + 3 band shading + outline tipis)
// - 'vintage' : sepia hangat + vignette ringan (nuansa foto lama)
// - 'sepia'   : sepia klasik polos tanpa vignette
// - 'mono'    : hitam-putih kontras (film B&W)

export type PhotoFilter = 'none' | 'comic' | 'vintage' | 'sepia' | 'mono' | 'lineart' | 'ai-sketch'

export const FILTER_LABELS: Record<PhotoFilter, string> = {
  none: 'Tanpa',
  comic: 'Komik',
  vintage: 'Vintage',
  sepia: 'Sepia',
  mono: 'Mono',
  lineart: 'Sketsa',
  'ai-sketch': 'Sketsa AI ✨',
}

export function applyFilter(dataUrl: string, f: PhotoFilter): Promise<string> {
  if (f === 'none') return Promise.resolve(dataUrl)
  if (f === 'comic') return applyComic(dataUrl)
  if (f === 'lineart') return applyLineArt(dataUrl)
  if (f === 'ai-sketch') return applyAiSketch(dataUrl)
  return applySimple(dataUrl, f)
}

// ---------- ai-sketch (Gemini via server, fallback lineart lokal) ----------
// AI butuh internet + API key; kalau gagal -> jatuh ke sketsa lokal biar tamu
// tetap dilayani (pesan error ditampilkan lewat window event).
async function applyAiSketch(dataUrl: string): Promise<string> {
  try {
    const { aiSketch } = await import('./aiSketch')
    return await aiSketch(dataUrl)
  } catch (e) {
    window.dispatchEvent(new CustomEvent('pb-ai-fallback', { detail: String((e as Error).message || e) }))
    return applyLineArt(dataUrl)
  }
}


// ---------- comic (anime cel-shading) ----------

const INK_R = 38, INK_G = 32, INK_B = 48   // warna garis outline (gelap keunguan)
const EDGE_THRESHOLD = 62                   // makin tinggi = garis makin sedikit/tipis
const T_SHADOW = 0.42                       // batas bawah mid-tone (0..1 luminance)
const T_HIGH = 0.74                         // batas atas mid-tone
const F_SHADOW = 0.78                       // pengali gelap utk area shadow
const F_HIGH = 1.14                         // pengali terang utk area highlight
const SAT = 1.28                            // saturasi boost

function applyComic(dataUrl: string): Promise<string> {
  return load(dataUrl).then((c) => {
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const imageData = ctx.getImageData(0, 0, c.width, c.height)
    const d = imageData.data

    // -- 1) Smoothing: dua pass box blur separable radius 2 --
    let buf = boxBlur(d, c.width, c.height, 2)
    buf = boxBlur(buf, c.width, c.height, 2)

    // -- 2+3) Cel shading + saturasi --
    const n = c.width * c.height
    const gray = new Float32Array(n)
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = buf[p], g = buf[p + 1], b = buf[p + 2]
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      gray[i] = lum * 255

      let f = 1
      if (lum < T_SHADOW) f = F_SHADOW
      else if (lum >= T_HIGH) f = F_HIGH

      const avg = (r + g + b) / 3
      let nr = avg + (r - avg) * SAT
      let ng = avg + (g - avg) * SAT
      let nb = avg + (b - avg) * SAT

      buf[p] = Math.min(255, nr * f)
      buf[p + 1] = Math.min(255, ng * f)
      buf[p + 2] = Math.min(255, nb * f)
    }

    // -- 4) Outline: Sobel threshold tinggi --
    const w = c.width, h = c.height
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1]
        const l = gray[i - 1], r = gray[i + 1]
        const bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1]
        const gx = (tr + 2 * r + br) - (tl + 2 * l + bl)
        const gy = (bl + 2 * b + br) - (tl + 2 * t + tr)
        if (Math.abs(gx) + Math.abs(gy) > EDGE_THRESHOLD) {
          const p = i * 4
          buf[p] = INK_R; buf[p + 1] = INK_G; buf[p + 2] = INK_B
        }
      }
    }

    imageData.data.set(buf)
    ctx.putImageData(imageData, 0, 0)
    return c.toDataURL('image/jpeg', 0.92)
  })
}

// ---------- simple filters (vintage / sepia / mono) ----------

function applySimple(dataUrl: string, f: Exclude<PhotoFilter, 'none' | 'comic'>): Promise<string> {
  return load(dataUrl).then((c) => {
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(ctx.canvas, 0, 0)
    const imageData = ctx.getImageData(0, 0, c.width, c.height)
    const d = imageData.data

    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2]
      if (f === 'mono') {
        // B&W film: luminance + kontras S-curve ringan
        let l = 0.299 * r + 0.587 * g + 0.114 * b
        l = clamp255((l - 128) * 1.18 + 128 + 6)
        d[p] = d[p + 1] = d[p + 2] = l
      } else {
        // sepia dasar (matrix klasik)
        let sr = 0.393 * r + 0.769 * g + 0.189 * b
        let sg = 0.349 * r + 0.686 * g + 0.168 * b
        let sb = 0.272 * r + 0.534 * g + 0.131 * b
        if (f === 'vintage') {
          // hangat dikit + fade highlight + vignette nanti di akhir
          sr = sr * 1.06 + 10
          sg = sg * 1.0 + 4
          sb = sb * 0.92
        }
        d[p] = clamp255(sr); d[p + 1] = clamp255(sg); d[p + 2] = clamp255(sb)
      }
    }

    if (f === 'vintage') {
      // vignette radial ringan
      const w = c.width, h = c.height
      const cx = w / 2, cy = h / 2
      const maxR = Math.sqrt(cx * cx + cy * cy)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy
          const dist = Math.sqrt(dx * dx + dy * dy) / maxR
          const vig = 1 - 0.28 * Math.max(0, dist - 0.55) / 0.45
          if (vig < 1) {
            const p = (y * w + x) * 4
            d[p] *= vig; d[p + 1] *= vig; d[p + 2] *= vig
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
    return c.toDataURL('image/jpeg', 0.92)
  })
}

// ---------- helpers ----------

function load(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0)
        resolve(c)
      } catch (e) { reject(e) }
    }
    img.onerror = () => reject(new Error('filter: image load failed'))
    img.src = dataUrl
  })
}

function clamp255(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v }

// Box blur separable dengan sliding window.
function boxBlur(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)
  const win = r * 2 + 1

  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0
      for (let x = -r; x <= r; x++) sum += src[row + clampX(x, w) * 4 + ch]
      for (let x = 0; x < w; x++) {
        tmp[row + x * 4 + ch] = sum / win
        sum += src[row + clampX(x + r + 1, w) * 4 + ch] - src[row + clampX(x - r, w) * 4 + ch]
      }
    }
    for (let x = 0; x < w; x++) tmp[row + x * 4 + 3] = src[row + x * 4 + 3]
  }

  for (let x = 0; x < w; x++) {
    const col = x * 4
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += tmp[clampY(y, h) * w * 4 + col + ch]
      for (let y = 0; y < h; y++) {
        out[y * w * 4 + col + ch] = sum / win
        sum += tmp[clampY(y + r + 1, h) * w * 4 + col + ch] - tmp[clampY(y - r, h) * w * 4 + col + ch]
      }
    }
    for (let y = 0; y < h; y++) out[y * w * 4 + col + 3] = tmp[y * w * 4 + col + 3]
  }

  return out
}

function clampX(x: number, w: number): number { return x < 0 ? 0 : x >= w ? w - 1 : x }
function clampY(y: number, h: number): number { return y < 0 ? 0 : y >= h ? h - 1 : y }

// ---------- lineart (B&W minimalist cartoon line art) ----------
// Flat white fill + clean bold ink outlines. No shading, no gradients, no texture.
// Pipeline: grayscale -> blur -> Sobel edge -> threshold ketat -> dilate 1px (garis tebal).

const LA_EDGE = 34        // threshold Sobel utk jadi garis tinta (makin kecil = makin tebal/ banyak)
const LA_INK = 20         // warna tinta (hampir hitam)

function applyLineArt(dataUrl: string): Promise<string> {
  return load(dataUrl).then((c) => {
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const w = c.width, h = c.height
    const img = ctx.getImageData(0, 0, w, h)
    const src = img.data

    // Grayscale
    const gray = new Float32Array(w * h)
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2]
    }
    // Blur ringan biar noise/skin texture gak jadi garis
    const blurred = boxBlurGray(gray, w, h, 2)

    // Sobel magnitude
    const mag = sobelMag(blurred, w, h)

    // Output: putih flat; edge di atas threshold = tinta
    const out = ctx.createImageData(w, h)
    const o = out.data
    // Dilate: pixel edge atau tetangga edge -> tinta (garis bold)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        let ink = mag[i] > LA_EDGE
        if (!ink && x > 0 && x < w - 1 && y > 0 && y < h - 1) {
          ink =
            mag[i - 1] > LA_EDGE || mag[i + 1] > LA_EDGE ||
            mag[i - w] > LA_EDGE || mag[i + w] > LA_EDGE
        }
        const p = i * 4
        if (ink) {
          o[p] = LA_INK; o[p + 1] = LA_INK; o[p + 2] = LA_INK
        } else {
          o[p] = 255; o[p + 1] = 255; o[p + 2] = 255
        }
        o[p + 3] = 255
      }
    }
    ctx.putImageData(out, 0, 0)
    return c.toDataURL('image/jpeg', 0.92)
  })
}

// Grayscale box blur separable (radius r)
function boxBlurGray(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -r; x <= r; x++) sum += src[y * w + clampX(x, w)]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (2 * r + 1)
      sum += src[y * w + clampX(x + r + 1, w)] - src[y * w + clampX(x - r, w)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[clampY(y, h) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1)
      sum += tmp[clampY(y + r + 1, h) * w + x] - tmp[clampY(y - r, h) * w + x]
    }
  }
  return out
}

// Sobel gradient magnitude dari grayscale
function sobelMag(g: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] +
         g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]
      const gy =
        -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] +
         g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]
      out[i] = Math.sqrt(gx * gx + gy * gy)
    }
  }
  return out
}
