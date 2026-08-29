// ── Printer USB (WebUSB) ──────────────────────────────────────────────────
// Untuk thermal USB seperti VSC Q58M (USB printer-class, ESC/POS).
// Alur: requestDevice (wajib klik manual) → open → pilih interface printer
// (kelas 7) → claimInterface → tulis job per-chunk ke endpoint OUT.
// Catatan: lib.dom TS ini belum punya tipe WebUSB → deklarasi minimal inline.
// Android: butuh Chrome + dukungan OTG; desktop Chrome/Edge langsung jalan.
// PENTING: di Linux, kernel bisa klaim device sebagai usblp → pakai
// filter.classCode agar chooser hanya menampilkan kandidat printer.

import { buildPrintJob, buildTestJob } from './encoder'

// Hindari import melingkar dengan printService — tipe lokal saja.
export type PaperWidth = '58mm' | '80mm'

// ── Deklarasi tipe minimal WebUSB (subset yang dipakai) ───────────────────
interface UsbEndpoint {
  direction: 'in' | 'out'
  type: string
  endpointNumber: number
}
interface UsbAlternate {
  alternateSetting: number
  interfaceClass: number
  endpoints: UsbEndpoint[]
}
interface UsbInterface_ {
  interfaceNumber: number
  alternates: UsbAlternate[]
}
interface UsbConfiguration {
  configurationValue: number
  interfaces: UsbInterface_[]
}
interface UsbDeviceLike {
  productName?: string
  vendorId: number
  productId: number
  serialNumber?: string
  opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(n: number): Promise<void>
  claimInterface(n: number): Promise<void>
  transferOut(endpoint: number, data: BufferSource): Promise<UsbOutResult>
}
interface UsbOutResult {
  bytesWritten: number
  status: string
}
interface UsbNavigator {
  usb?: {
    requestDevice(opts: { filters: unknown[] }): Promise<UsbDeviceLike>
    getDevices(): Promise<UsbDeviceLike[]>
  }
}

const USB_KEY = 'pb_usb_printer'

let dev: UsbDeviceLike | null = null
let claimedNum: number | null = null
let outEp: number | null = null

export function usbSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as UsbNavigator).usb
}

export function usbSavedName(): string {
  try { return localStorage.getItem(USB_KEY) || '' } catch { return '' }
}

export function usbConnected(): boolean {
  return !!(dev?.opened && claimedNum !== null && outEp !== null)
}

function notify(connected: boolean) {
  try { window.dispatchEvent(new CustomEvent('pb-usb', { detail: { connected, name: usbSavedName() } })) } catch { /* ignore */ }
}

// Manual-off: sama polanya dengan BT — Putus manual mengunci auto-reconnect.
export function usbManualOff(): boolean {
  try { return localStorage.getItem('pb_usb_manual_off') === '1' } catch { return false }
}
function setManualOff(v: boolean) {
  try {
    if (v) localStorage.setItem('pb_usb_manual_off', '1')
    else localStorage.removeItem('pb_usb_manual_off')
  } catch { /* ignore */ }
}

async function reset() {
  dev = null
  claimedNum = null
  outEp = null
}

export async function disconnectUsb(manual = true) {
  try { await dev?.close() } catch { /* ignore */ }
  await reset()
  if (manual) setManualOff(true)
  notify(false)
}

// Pilih konfigurasi + interface printer (USB class 7 = printer), fallback:
// interface dengan endpoint bulk OUT apa pun. Return [iface, endpointOUT].
function pickPrinterIface(cfg: UsbConfiguration): [UsbInterface_, UsbAlternate, number] | null {
  for (const itf of cfg.interfaces) {
    for (const alt of itf.alternates) {
      const outBulk = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
      if (!outBulk) continue
      if (alt.interfaceClass === 7) return [itf, alt, outBulk.endpointNumber]
    }
  }
  for (const itf of cfg.interfaces) {
    for (const alt of itf.alternates) {
      const outBulk = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
      if (outBulk) return [itf, alt, outBulk.endpointNumber]
    }
  }
  return null
}

async function setup(d: UsbDeviceLike): Promise<void> {
  await d.open()
  const cfg = (d as unknown as { configuration?: UsbConfiguration; configurations?: UsbConfiguration[] })
  let conf: UsbConfiguration | undefined = cfg.configuration ?? cfg.configurations?.[0]
  if (!conf) throw new Error('Printer USB tidak punya konfigurasi')
  await d.selectConfiguration(conf.configurationValue)
  const picked = pickPrinterIface(conf)
  if (!picked) throw new Error('Tidak ketemu interface printer (coba cabut-pasang kabel)')
  const [itf] = picked
  await d.claimInterface(itf.interfaceNumber)
  // Simpan state setelah semua sukses.
  dev = d
  claimedNum = picked[0].interfaceNumber
  outEp = picked[2]
  try { localStorage.setItem(USB_KEY, d.productName || `USB ${d.vendorId.toString(16)}:${d.productId.toString(16)}`) } catch { /* ignore */ }
  notify(true)
}

// Konek manual: selalu lewat requestDevice (butuh gesture klik user).
// filter classCode 7 = hanya device kelas printer yang nongol di chooser.
export async function connectUsb(): Promise<string> {
  const usb = (navigator as unknown as UsbNavigator).usb
  if (!usb) throw new Error('WebUSB tidak didukung (pakai Chrome/Edge terbaru)')
  await disconnectUsb(false)
  const d = await usb.requestDevice({ filters: [{ classCode: 7 }] })
  await setup(d)
  return usbSavedName()
}

// Reconnect senyap pakai izin lama (getDevices tanpa dialog).
export async function autoReconnectUsb(): Promise<boolean> {
  if (usbConnected()) return true
  if (usbManualOff()) return false
  const usb = (navigator as unknown as UsbNavigator).usb
  if (!usb?.getDevices) return false
  try {
    const all = await usb.getDevices()
    if (!all.length) return false
    // Coba satu-satu sampai ada yang punya interface printer.
    for (const d of all) {
      try {
        await setup(d)
        return true
      } catch { /* bukan printer / gagal claim — lanjut */ }
    }
    return false
  } catch {
    return false
  }
}

export async function ensureUsb(): Promise<void> {
  if (usbManualOff()) throw new Error('Printer USB diputus manual — sambungkan dulu lewat tombol Sambungkan')
  if (!(await autoReconnectUsb())) await connectUsb()
}

// Skala canvas ke lebar head sebelum encode (sama seperti jalur BT).
function scaleCanvas(canvas: HTMLCanvasElement, targetW: number): HTMLCanvasElement {
  if (canvas.width === targetW) return canvas
  const c = document.createElement('canvas')
  c.width = targetW
  c.height = Math.round(canvas.height * (targetW / canvas.width))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(canvas, 0, 0, c.width, c.height)
  return c
}

async function writeChunks(job: Uint8Array) {
  if (!dev || outEp === null || !dev.opened) throw new Error('Printer USB belum dikonek')
  const CHUNK = 1024 // full-speed USB aman; transferOut gak sempit seperti BLE MTU
  for (let o = 0; o < job.length; o += CHUNK) {
    const end = Math.min(o + CHUNK, job.length)
    const res = await dev.transferOut(outEp, job.slice(o, end))
    if (res.status !== 'ok') throw new Error(`USB transfer gagal (${res.status})`)
  }
}

export async function printViaUsb(canvas: HTMLCanvasElement, paperWidth: PaperWidth = '58mm', darkness = 100): Promise<string> {
  if (!usbConnected()) await ensureUsb()
  const targetW = paperWidth === '58mm' ? 384 : 512
  const job = buildPrintJob(scaleCanvas(canvas, targetW), darkness)
  await writeChunks(job)
  return `Terkirim ${job.length} bytes ke ${usbSavedName()} (USB)`
}

export async function testPrintUsb(paperWidth: PaperWidth = '58mm', darkness = 100): Promise<string> {
  if (!usbConnected()) await ensureUsb()
  const job = buildTestJob(paperWidth, darkness)
  await writeChunks(job)
  return `Test cetak terkirim ke ${usbSavedName()}`
}
