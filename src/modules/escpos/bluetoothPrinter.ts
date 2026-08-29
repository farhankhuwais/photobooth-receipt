// ── Printer Bluetooth (Web Bluetooth / BLE) ────────────────────────────────
// Untuk portable thermal BLE seperti PP583 (kertas 58mm, head 384 dot).
// Alur: requestDevice (wajib klik manual) → GATT → cari karakteristik write
// → tulis job ESC/POS per-chunk (BLE MTU kecil).
// Catatan: lib.dom TS ini belum punya tipe Web Bluetooth → deklarasi minimal di bawah.

import { buildPrintJob, buildTestJob } from './encoder'

// Tipe lokal (hindari import melingkar dengan printService).
export type PaperWidth = '58mm' | '80mm'

// ── Deklarasi tipe minimal Web Bluetooth (subset yang dipakai) ────────────
interface BtCharacteristic {
  uuid: string
  properties: { write: boolean; writeWithoutResponse: boolean; read: boolean; notify: boolean }
  writeValue(value: BufferSource): Promise<void>
}
interface BtService {
  uuid: string
  getCharacteristics(): Promise<BtCharacteristic[]>
}
interface BtServer {
  connect(): Promise<BtServer>
  disconnect(): void
  connected: boolean
  getPrimaryServices(): Promise<BtService[]>
}
interface BtDevice {
  id: string
  name?: string
  gatt?: BtServer
  addEventListener(type: string, listener: () => void): void
}
interface BtNavigator {
  bluetooth?: {
    requestDevice(opts: { acceptAllDevices?: boolean; filters?: unknown[]; optionalServices?: (string | number)[] }): Promise<BtDevice>
    // Chrome 118+: daftar device yang sudah pernah diberi izin ke origin ini —
    // dipakai buat reconnect SENYAP setelah refresh tanpa dialog lagi.
    getDevices?(): Promise<BtDevice[]>
    getAvailability?(): Promise<boolean>
  }
}

const BT_KEY = 'pb_bt_printer'
const BT_KEY_ID = 'pb_bt_printer_id'
// Flag "sengaja diputus manual" (tombol Putus): menahan auto-reconnect
// sampai user konek lagi eksplisit. Beda dengan putus karena refresh/mati
// printer — yang itu boleh di-reconnect senyap.
const BT_KEY_MANUAL_OFF = 'pb_bt_manual_off'

let device: BtDevice | null = null
let writeChar: BtCharacteristic | null = null

function loadId(): string {
  try { return localStorage.getItem(BT_KEY_ID) || '' } catch { return '' }
}
function saveId(id: string) {
  try { localStorage.setItem(BT_KEY_ID, id) } catch { /* ignore */ }
}
export function btManualOff(): boolean {
  try { return localStorage.getItem(BT_KEY_MANUAL_OFF) === '1' } catch { return false }
}
function setManualOff(v: boolean) {
  try {
    if (v) localStorage.setItem(BT_KEY_MANUAL_OFF, '1')
    else localStorage.removeItem(BT_KEY_MANUAL_OFF)
  } catch { /* ignore */ }
}
// Broadcast perubahan status konek biar UI (panel Settings) bisa sinkron.
function notify(connected: boolean) {
  try { window.dispatchEvent(new CustomEvent('pb-bt', { detail: { connected, name: btSavedName() } })) } catch { /* ignore */ }
}

export function btSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as BtNavigator).bluetooth
}

export function btSavedName(): string {
  try { return localStorage.getItem(BT_KEY) || '' } catch { return '' }
}

function saveName(name: string) {
  try { localStorage.setItem(BT_KEY, name) } catch { /* ignore */ }
}

export function btConnected(): boolean {
  return !!(device?.gatt?.connected && writeChar)
}

export function onBtDisconnected(cb: () => void) {
  device?.addEventListener('gattserverdisconnected', cb)
}

export async function disconnectBt(manual = true) {
  try { device?.gatt?.disconnect() } catch { /* ignore */ }
  device = null
  writeChar = null
  // Putus manual (tombol Putus) = kunci auto-reconnect sampai konek lagi.
  if (manual) setManualOff(true)
  notify(false)
}

// Reconnect SENYAP pakai izin lama (tanpa dialog): cari device pernah-dipilih
// berdasarkan id tersimpan, lalu buka GATT lagi.
// Gagal karena printer mati/jauh = diam saja (boleh dicoba lagi nanti).
// DITAHAN kalau sebelumnya user sengaja menekan tombol Putus.
export async function autoReconnectBt(): Promise<boolean> {
  if (btManualOff()) return false
  if (!btConnected()) {
    const bt = (navigator as unknown as BtNavigator).bluetooth
    const id = loadId()
    if (!bt?.getDevices || !id) return false
    try {
      const all = await bt.getDevices()
      const found = all.find((d) => d.id === id)
      if (!found) return false
      device = found
      device.addEventListener('gattserverdisconnected', () => { writeChar = null; notify(false) })
      writeChar = await findWriteChar(await device.gatt!.connect())
    } catch {
      device = null
      writeChar = null
      return false
    }
  }
  notify(true)
  return true
}

export async function ensureBt(): Promise<void> {
  // Manual-off = jangan kejut user dengan dialog di tengah proses.
  if (btManualOff()) throw new Error('Printer diputus manual — sambungkan dulu lewat tombol Sambungkan')
  if (!(await autoReconnectBt())) await connectBt()
}

// Cari karakteristik yang bisa ditulisi di semua service yang diizinkan.
async function findWriteChar(server: BtServer): Promise<BtCharacteristic> {
  const services = await server.getPrimaryServices()
  const candidates: BtCharacteristic[] = []
  for (const svc of services) {
    let chars: BtCharacteristic[] = []
    try { chars = await svc.getCharacteristics() } catch { continue }
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) candidates.push(c)
    }
  }
  // Prioritaskan yang punya write (with-response) biar gak hilang byte.
  const picked = candidates.find((c) => c.properties.write) || candidates[0]
  if (!picked) throw new Error('Printer tidak punya karakteristik write (bukan printer thermal BLE?)')
  return picked
}

// Konek: selalu lewat requestDevice (butuh gesture klik user).
// acceptAllDevices biar PP583 dengan nama apa pun tetap nongol di pilihan.
export async function connectBt(): Promise<string> {
  const bt = (navigator as unknown as BtNavigator).bluetooth
  if (!bt) throw new Error('Web Bluetooth tidak didukung (pakai Chrome/Edge terbaru)')
  await disconnectBt()
  // Service umum printer thermal BLE Tiongkok + beberapa varian lain.
  const optionalServices = [
    0xff00, 0xffe0, 0xfff0, 0xae00, 0x18f0,
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '0000fff0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  ]
  device = await bt.requestDevice({ acceptAllDevices: true, optionalServices })
  const server = await device.gatt!.connect()
  writeChar = await findWriteChar(server)
  const name = device.name || '(tanpa nama)'
  saveName(name)
  if (device.id) saveId(device.id)
  setManualOff(false) // konek eksplisit = buka kunci manual-off
  device.addEventListener('gattserverdisconnected', () => { writeChar = null; notify(false) })
  notify(true)
  return name
}

// Tulis job dalam chunk kecil (BLE MTU aman) + jeda antar chunk.
async function writeChunks(job: Uint8Array) {
  if (!writeChar) throw new Error('Printer belum dikonek')
  const CHUNK = 180
  for (let o = 0; o < job.length; o += CHUNK) {
    const end = Math.min(o + CHUNK, job.length)
    await writeChar.writeValue(job.slice(o, end))
    await new Promise((r) => setTimeout(r, 20))
  }
}

// Skala canvas ke lebar head printer sebelum encode (58mm=384 dot, 80mm=512 dot).
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

export async function printViaBluetooth(
  canvas: HTMLCanvasElement,
  paperWidth: PaperWidth = '58mm',
  darkness = 100
): Promise<string> {
  if (!btConnected()) await ensureBt()
  const targetW = paperWidth === '58mm' ? 384 : 512
  const job = buildPrintJob(scaleCanvas(canvas, targetW), darkness ?? 100)
  await writeChunks(job)
  return `Terkirim ${job.length} bytes ke ${btSavedName()} (Bluetooth)`
}

// Struk test pendek buat verifikasi koneksinya tanpa buang foto.
// Struk test: teks + bar gradien yang ikut knob kegelapan (kalibrasi visual).
export async function testPrintBt(paperWidth: PaperWidth = '58mm', darkness = 100): Promise<string> {
  if (!btConnected()) await ensureBt()
  const job = buildTestJob(paperWidth, darkness)
  await writeChunks(job)
  return `Test cetak terkirim ke ${btSavedName()}`
}
