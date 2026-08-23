// Filter komik: posterize warna + outline hitam (Sobel edge detection).
// Input dataURL JPEG, output dataURL JPEG bergaya komik/kartun.

export function applyComicFilter(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // Skala kerja dibatasi biar cepat (Sobel O(n) per pixel tapi tetap di-cap).
      const MAXW = 1200
      const scale = Math.min(1, MAXW / img.width)
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))

      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      const idata = ctx.getImageData(0, 0, w, h)
      const px = idata.data

      // --- Pass 1: grayscale + blur ringan (3x3 box) untuk stabilkan edges ---
      const gray = new Float32Array(w * h)
      for (let i = 0; i < w * h; i++) {
        const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b
      }
      const blurred = new Float32Array(w * h)
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let s = 0
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              s += gray[(y + dy) * w + (x + dx)]
          blurred[y * w + x] = s / 9
        }
      }

      // --- Pass 2: Sobel magnitude → mask garis tepi ---
      const edge = new Uint8Array(w * h)
      const EDGE_TH = 32 // threshold magnitude; makin kecil makin tebal garis
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          const tl = blurred[i - w - 1], t = blurred[i - w], tr = blurred[i - w + 1]
          const l = blurred[i - 1], r = blurred[i + 1]
          const bl = blurred[i + w - 1], btm = blurred[i + w], br = blurred[i + w + 1]
          const gx = (tr + 2 * r + br) - (tl + 2 * l + bl)
          const gy = (bl + 2 * btm + br) - (tl + 2 * t + tr)
          if (Math.sqrt(gx * gx + gy * gy) > EDGE_TH) edge[i] = 1
        }
      }

      // --- Pass 3: posterize warna (6 level/channel) + terapkan outline ---
      const LEVELS = 6
      const step = 255 / (LEVELS - 1)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const p = i * 4
          if (edge[i]) {
            px[p] = px[p + 1] = px[p + 2] = 16 // outline hitam pekat
          } else {
            px[p] = Math.round(Math.round(px[p] / step) * step)
            px[p + 1] = Math.round(Math.round(px[p + 1] / step) * step)
            px[p + 2] = Math.round(Math.round(px[p + 2] / step) * step)
          }
        }
      }

      ctx.putImageData(idata, 0, 0)
      resolve(c.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = () => resolve(dataUrl) // gagal → balikin foto asli
    img.src = dataUrl
  })
}
