export function canvasToRaster(canvas: HTMLCanvasElement, darkness = 100): Uint8Array {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  const { data } = ctx.getImageData(0, 0, w, h)

  // Knob kegelapan: 100% = netral. >100% = kontras dinaikkan + ambang hitam
  // digeser naik -> lebih banyak dot terbakar -> hasil lebih tebal/gelap.
  const cf = 1 + Math.max(0, darkness - 100) / 100 * 0.9      // faktor kontras
  const thr = Math.min(220, 128 + Math.max(0, darkness - 100) / 100 * 72) // ambang

  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    let v = 0.299 * r + 0.587 * g + 0.114 * b
    if (cf !== 1) {
      v = (v - 128) * cf + 128
      v = v < 0 ? 0 : v > 255 ? 255 : v
    }
    lum[i] = v
  }

  const bytesPerRow = Math.ceil(w / 8)
  const out = new Uint8Array(bytesPerRow * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      const old = lum[idx]
      const newv = old < thr ? 0 : 255
      const err = old - newv
      lum[idx] = newv
      if (x + 1 < w) lum[idx + 1] += err * 0.4375
      if (y + 1 < h) {
        if (x - 1 >= 0) lum[idx + w - 1] += err * 0.1875
        lum[idx + w] += err * 0.3125
        if (x + 1 < w) lum[idx + w + 1] += err * 0.0625
      }
      if (newv === 0) {
        out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
  }

  const header = [0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]
  const result = new Uint8Array(header.length + out.length)
  result.set(header, 0)
  result.set(out, header.length)
  return result
}

export function buildPrintJob(canvas: HTMLCanvasElement, darkness = 100): Uint8Array {
  const init = new Uint8Array([0x1b, 0x40])
  const raster = canvasToRaster(canvas, darkness)
  const feed = new Uint8Array([0x0a, 0x0a])
  const cut = new Uint8Array([0x1d, 0x56, 0x00])
  const job = new Uint8Array(init.length + raster.length + feed.length + cut.length)
  let o = 0
  job.set(init, o); o += init.length
  job.set(raster, o); o += raster.length
  job.set(feed, o); o += feed.length
  job.set(cut, o)
  return job
}

// Job struk test: teks + BAR GRADIEN hitam→putih yang ikut terpengaruh knob
// kegelapan — buat kalibrasi visual ambang dithering tiap printer.
export function buildTestJob(paperWidth: '58mm' | '80mm' = '58mm', darkness = 100): Uint8Array {
  const W = paperWidth === '58mm' ? 384 : 512
  const parts: Uint8Array[] = []

  const textLines: number[][] = [
    [0x1b, 0x40], // init
    ...Array.from('ACHIPIX TEST\n').map((ch) => [0x1b, 0x21, 0x38, ch.charCodeAt(0)]),
    ...Array.from(`Gelap ${darkness}% (${paperWidth})\n`).map((ch) => [ch.charCodeAt(0)]),
    ...Array.from('makin kanan makin pudar\n\n').map((ch) => [ch.charCodeAt(0)]),
  ]
  const textArr = new Uint8Array(textLines.reduce((n, l) => n + l.length, 0))
  let to = 0
  for (const l of textLines) { textArr.set(l, to); to += l.length }
  parts.push(textArr)

  // Gradien: kiri hitam penuh → kanan putih; ambang naik = batas hitam bergeser kanan.
  const grad = document.createElement('canvas')
  grad.width = W
  grad.height = 56
  const g = grad.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, W, 0)
  grd.addColorStop(0, '#000000')
  grd.addColorStop(1, '#ffffff')
  g.fillStyle = grd
  g.fillRect(0, 0, W, 56)
  parts.push(canvasToRaster(grad, darkness))

  parts.push(new Uint8Array([0x0a, 0x0a]))

  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
