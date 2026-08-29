import { buildPrintJob } from '../escpos/encoder'
import { serialSupported, printViaSerial } from '../escpos/serialPrinter'
import { printViaBridge } from '../escpos/bridgePrinter'
import { btSupported, btConnected, printViaBluetooth } from '../escpos/bluetoothPrinter'
import { autoReconnectUsb, printViaUsb } from '../escpos/usbPrinter'
export type PrintMethod = 'web-bluetooth' | 'usb' | 'web-serial' | 'bridge' | 'preview'

export type PaperWidth = '58mm' | '80mm'

// Opsi kegelapan (diteruskan ke encoder ESC/POS).
export interface PrintOpts {
  paperWidth: PaperWidth
  darkness?: number
}

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

// Smart print, urutan coba:
// 1. Web Bluetooth (printer BLE langsung, mis. PP583 — kalau sudah pernah dikonek)
// 2. WebUSB (printer USB langsung, mis. VSC Q58M — reconnect senyap via izin lama)
// 3. Web Serial (printer USB/BT-Classic sebagai COM port, Chrome/Edge)
// 4. Bridge Node (opsional)
// 5. Download PNG preview sebagai fallback terakhir.
export async function printSmart(
  canvas: HTMLCanvasElement,
  bridgeUrl = '',
  opts: PrintOpts = { paperWidth: '80mm' }
): Promise<PrintResult> {
  const { paperWidth, darkness } = opts
  if (btSupported() && btConnected()) {
    try {
      const message = await printViaBluetooth(canvas, paperWidth, darkness)
      return { method: 'web-bluetooth', ok: true, message }
    } catch { /* lanjut jalur lain */ }
  }
  // USB: coba reconnect senyap dulu (izin pernah diberi + printer nyala).
  if (await autoReconnectUsb()) {
    try {
      const message = await printViaUsb(canvas, paperWidth, darkness)
      return { method: 'usb', ok: true, message }
    } catch { /* lanjut jalur lain */ }
  }
  if (serialSupported()) {
    try {
      const message = await printViaSerial(canvas)
      return { method: 'web-serial', ok: true, message }
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
