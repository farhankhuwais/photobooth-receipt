// Filter kartun anime (cel-shading):
// 1) Smoothing edge-preserving-ish (box blur 2x) -> kulit/warna jadi halus & flat
// 2) Cel shading: luminance diquantize jadi 3 band (shadow / mid / highlight)
// 3) Saturation boost dikit biar warna cerah khas anime
// 4) Outline tipis: Sobel threshold tinggi -> cuma kontur kuat, ink gelap keunguan
// Input dataURL, output dataURL JPEG.

const INK_R = 38, INK_G = 32, INK_B = 48   // warna garis outline (gelap keunguan, bukan hitam pekat)
const EDGE_THRESHOLD = 62                   // makin tinggi = makin sedikit garis (tipis & rapi)
const T_SHADOW = 0.42                       // batas bawah mid-tone (0..1 luminance)
const T_HIGH = 0.74                         // batas atas mid-tone
const F_SHADOW = 0.78                       // pengali gelap utk area shadow
const F_HIGH = 1.14                         // pengali terang utk area highlight
const SAT = 1.28                            // saturasi boost

export function applyComicFilter(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)

        const imageData = ctx.getImageData(0, 0, c.width, c.height)
        const d = imageData.data

        // -- 1) Smoothing: dua pass box blur separable radius 2 --
        let buf = boxBlur(d, c.width, c.height, 2)
        buf = boxBlur(buf, c.width, c.height, 2)

        // -- 2+3) Cel shading + saturasi (per pixel, in place) --
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

          nr = Math.min(255, nr * f)
          ng = Math.min(255, ng * f)
          nb = Math.min(255, nb * f)

          buf[p] = nr; buf[p + 1] = ng; buf[p + 2] = nb
        }

        // -- 4) Outline: Sobel di grayscale, threshold tinggi --
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
        resolve(c.toDataURL('image/jpeg', 0.92))
      } catch (e) { reject(e) }
    }
    img.onerror = () => reject(new Error('comic filter: image load failed'))
    img.src = dataUrl
  })
}

// Box blur separable dengan sliding window (in-place pada copy baru).
function boxBlur(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)
  const win = r * 2 + 1

  // horizontal
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
    // alpha salin langsung
    for (let x = 0; x < w; x++) tmp[row + x * 4 + 3] = src[row + x * 4 + 3]
  }

  // vertical
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
