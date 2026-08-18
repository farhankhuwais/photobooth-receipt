export function canvasToRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  const { data } = ctx.getImageData(0, 0, w, h)

  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }

  const bytesPerRow = Math.ceil(w / 8)
  const out = new Uint8Array(bytesPerRow * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      const old = lum[idx]
      const newv = old < 128 ? 0 : 255
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

export function buildPrintJob(canvas: HTMLCanvasElement): Uint8Array {
  const init = new Uint8Array([0x1b, 0x40])
  const raster = canvasToRaster(canvas)
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
