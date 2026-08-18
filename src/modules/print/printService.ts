import { buildPrintJob } from '../escpos/encoder'
import { serialSupported, printViaSerial } from '../escpos/serialPrinter'
import { printViaBridge } from '../escpos/bridgePrinter'

export type PrintMethod = 'web-bluetooth' | 'bridge' | 'preview'

export interface PrintResult {
  method: PrintMethod
  ok: boolean
  message: string
}

export interface Printer {
  name: string
  print: (canvas: HTMLCanvasElement) => Promise<PrintResult>
}

function downloadCanvas(canvas: HTMLCanvasElement) {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'photobooth-strip.png'
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

// P1 placeholder printer: download PNG + report ESC/POS byte size.
// Real Web Bluetooth / Node bridge printers wired in P3 / P5.
export const previewPrinter: Printer = {
  name: 'Preview (download)',
  async print(canvas) {
    const job = buildPrintJob(canvas)
    downloadCanvas(canvas)
    return { method: 'preview', ok: true, message: `ESC/POS job ${job.length} bytes — download placeholder` }
  }
}

export function selectPrinter(): Printer {
  return previewPrinter
}

// Smart print: coba Web Serial (Chrome/Edge, BT Classic via COM / USB),
// lalu bridge (Node), lalu download preview sebagai fallback terakhir.
export async function printSmart(canvas: HTMLCanvasElement, bridgeUrl = ''): Promise<PrintResult> {
  if (serialSupported()) {
    try {
      const message = await printViaSerial(canvas)
      return { method: 'web-bluetooth', ok: true, message }
    } catch (e) {
      const msg = `Web Serial gagal: ${(e as Error).message}`
      if (!bridgeUrl) return { method: 'preview', ok: false, message: `${msg}. Cek printer terpasang sebagai COM port.` }
      try {
        const m = await printViaBridge(canvas, bridgeUrl)
        return { method: 'bridge', ok: true, message: m }
      } catch {
        return { method: 'preview', ok: false, message: `${msg}. Bridge juga gagal.` }
      }
    }
  }
  if (bridgeUrl) {
    try {
      const m = await printViaBridge(canvas, bridgeUrl)
      return { method: 'bridge', ok: true, message: m }
    } catch (e) {
      return { method: 'preview', ok: false, message: `Bridge gagal: ${(e as Error).message}` }
    }
  }
  const job = buildPrintJob(canvas)
  downloadCanvas(canvas)
  return { method: 'preview', ok: true, message: `ESC/POS job ${job.length} bytes — download placeholder` }
}
