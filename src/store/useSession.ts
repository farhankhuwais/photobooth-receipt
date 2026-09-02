import { create } from 'zustand'
import type { DesignDef } from '../modules/templates/TemplateEngine'

export type TemplateId = 'strip3' | 'grid2x2' | 'single' | 'dual'
export type FrameId = 'none' | 'love' | 'party' | 'vintage' | 'neon' | 'floral'
export type Screen = 'attract' | 'booth'
export type PaymentMethod = 'qris' | 'cash'
export type AppMode = 'regular' | 'event'

// Satu frame custom yang tersimpan di DB (gallery). `url` = endpoint blob PNG.
export interface FrameDef {
  id: string
  name: string
  url: string
  template?: string | null  // strip3 | single | grid2x2 | null(universal)
}

export interface BrandingConfig {
  eventName: string
  logoDataUrl: string | null
  showDate: boolean
  watermark: string
  qrText: string
  frame: FrameId
  // Tampilkan nama event di HASIL CETAK (header + frame vintage). Attract tetap pakai eventName.
  showEventNameOnPrint: boolean
  // Toggle tampil/sembunyi kotak "Capturing" di bawah tombol Mulai Jepret (booth screen).
  showCapturingBox: boolean
  // Jarak dekorasi foto (px): atas (vs header/logo), bawah (vs footer QR), antar foto.
  photoTopPad: number
  photoBottomPad: number
  photoGap: number
  // Jarak antar foto KHUSUS grid 2x2 (px): X = kiri-kanan, Y = atas-bawah.
  photoGap2x2X: number
  photoGap2x2Y: number
  // Lebar kertas printer: '58mm' (head 384 dot, mis. PP583) | '80mm' (512 dot).
  // Dipakai buat skala hasil strip sebelum encode ESC/POS.
  paperWidth: '58mm' | '80mm'
  // Kegelapan cetak %: 100 = netral, makin besar makin tebal (kontras+ambang
  // dithering dinaikkan sebelum rasterisasi). Naikin kalau hasil cetak samar.
  printDarkness: number
}

export type SessionStatus = 'idle' | 'capturing' | 'done'

interface SessionState {
  stream: MediaStream | null
  shots: string[]
  template: TemplateId
  shotCount: number
  branding: BrandingConfig
  // Gallery frame custom (dari DB) + pilihan customer.
  frames: FrameDef[]
  selectedFrameId: string | null
  // Gallery design/mockup kustom (dari DB) + pilihan customer.
  designs: { id: string; name: string; canvasW: number; canvasH: number; slotsCount?: number; slots?: { x: number; y: number; w: number; h: number; rot?: number }[]; hasFrame?: boolean }[]
  selectedDesignId: string | null
  design: DesignDef | null
  // True setelah user memilih desain (termasuk Template Biasa). Wajib true
  // sebelum bisa lanjut ke kamera.
  designChosen: boolean
  // Mode booth: 'regular' (bayar per cetak) atau 'event' (jasa, gratis/tanpa paywall).
  mode: AppMode
  price: number
  activePresetName: string | null
  status: SessionStatus
  screen: Screen
  paid: boolean
  paymentMethod: PaymentMethod | null
  payStage: 'idle' | 'paying'
  cashConfirm: boolean
  bridgeUrl: string
  digitalUrl: string | null
  setStream: (s: MediaStream | null) => void
  setTemplate: (t: TemplateId) => void
  addShot: (dataUrl: string) => void
  resetShots: () => void
  setBranding: (b: Partial<BrandingConfig>) => void
  setFrames: (f: FrameDef[]) => void
  setSelectedFrameId: (id: string | null) => void
  setDesigns: (d: { id: string; name: string; canvasW: number; canvasH: number }[]) => void
  setSelectedDesignId: (id: string | null) => void
  setDesignChosen: (v: boolean) => void
  setDesign: (d: DesignDef | null) => void
  setMode: (m: AppMode) => void
  setPrice: (p: number) => void
  setActivePreset: (name: string | null) => void
  // Terapkan + simpan config (mode/price/branding/preset) ke DB.
  applyConfig: (cfg: { mode: AppMode; price: number; branding: Partial<BrandingConfig>; presetName: string | null }) => void
  setStatus: (s: SessionStatus) => void
  setScreen: (s: Screen) => void
  setPaid: (p: boolean) => void
  setBridgeUrl: (u: string) => void
  setDigitalUrl: (u: string | null) => void
  enterBooth: () => void
  goAttract: () => void
  openPay: () => void
  closePay: () => void
  chooseCash: () => void
  confirmCashPaid: () => void
  payQrisSim: () => void
  resetPay: () => void
}

const countFor = (t: TemplateId) => (t === 'grid2x2' ? 4 : t === 'single' ? 1 : t === 'dual' ? 2 : 3)

export const DEFAULT_BRANDING: BrandingConfig = {
  eventName: 'My Event',
  logoDataUrl: null,
  showDate: true,
  watermark: '',
  qrText: '',
  frame: 'none',
  showEventNameOnPrint: true,
  showCapturingBox: true,
  // Jarak dekorasi foto default (px): atas 24, bawah 24, antar foto 20.
  photoTopPad: 24,
  photoBottomPad: 24,
  photoGap: 20,
  photoGap2x2X: 20,
  photoGap2x2Y: 20,
  paperWidth: '58mm',
  printDarkness: 100,
}

function loadBridgeUrl(): string {
  try {
    return localStorage.getItem('pb_bridge') || ''
  } catch {
    return ''
  }
}

export const useSession = create<SessionState>((set) => ({
  stream: null,
  shots: [],
  template: 'strip3',
  shotCount: 3,
  branding: DEFAULT_BRANDING,
  frames: [],
  selectedFrameId: null,
  designs: [],
  selectedDesignId: null,
  design: null,
  designChosen: false,
  mode: 'regular',
  price: 5000,
  activePresetName: null,
  status: 'idle',
  screen: 'attract',
  paid: false,
  paymentMethod: null,
  payStage: 'idle',
  cashConfirm: false,
  bridgeUrl: loadBridgeUrl(),
  digitalUrl: null,
  setStream: (stream) => set({ stream }),
  setTemplate: (template) => set({ template, shotCount: countFor(template), selectedFrameId: null }),
  addShot: (dataUrl) => set((s) => ({ shots: [...s.shots, dataUrl] })),
  resetShots: () => set({ shots: [], status: 'idle', digitalUrl: null }),
  setBranding: (b) => set((s) => ({ branding: { ...s.branding, ...b } })),
  setFrames: (frames) => set({ frames }),
  setSelectedFrameId: (id) => set({ selectedFrameId: id }),
  setDesigns: (designs) => set({ designs }),
  setSelectedDesignId: (id) => set({ selectedDesignId: id }),
  setDesignChosen: (v: boolean) => set({ designChosen: v }),
  setDesign: (design) => set({ design }),
  setMode: (mode) => set({ mode }),
  setPrice: (price) => set({ price }),
  setActivePreset: (name) => set({ activePresetName: name }),
  // Terapkan config ke store + persist ke DB (survive refresh).
  applyConfig: ({ mode, price, branding, presetName }) => {
    set((s) => ({
      mode,
      price,
      activePresetName: presetName,
      branding: { ...s.branding, ...branding },
    }))
    // Simpan ke app_config (row id=1). Fire-and-forget; error di-log di console.
    try {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          price,
          preset_name: presetName,
          branding: { ...useSession.getState().branding },
        }),
      }).catch(() => {})
    } catch {
      /* ignore */
    }
  },
  setStatus: (status) => set({ status }),
  setScreen: (screen) => set({ screen }),
  setPaid: (paid) => set({ paid }),
  setBridgeUrl: (u) => set({ bridgeUrl: u }),
  setDigitalUrl: (u) => set({ digitalUrl: u }),
  enterBooth: () => set({ screen: 'booth', status: 'idle', shots: [], digitalUrl: null, paid: false, paymentMethod: null, payStage: 'idle', cashConfirm: false, designChosen: false }),
  goAttract: () =>
    set({ screen: 'attract', status: 'idle', shots: [], digitalUrl: null, paid: false, paymentMethod: null, payStage: 'idle', cashConfirm: false, designChosen: false }),
  // Buka layar bayar (gerbang CETAK). Belum lunas.
  openPay: () => set({ payStage: 'paying', paymentMethod: null, cashConfirm: false }),
  // Batal bayar, kembali ke layar hasil.
  closePay: () => set({ payStage: 'idle', cashConfirm: false }),
  // Pilih cash -> butuh konfirmasi 2-tap (anti salah tekan).
  chooseCash: () => set({ paymentMethod: 'cash', cashConfirm: true }),
  // Operator konfirmasi sudah terima uang -> lunas (off-system, tanpa gateway).
  confirmCashPaid: () => set({ paid: true, cashConfirm: false }),
  // Simulasi lunas QRIS (nanti diganti polling ke gateway).
  payQrisSim: () => set({ paymentMethod: 'qris', paid: true }),
  // Bersihkan state pembayaran setelah print selesai (dipanggil dari App).
  resetPay: () => set({ paid: false, paymentMethod: null, payStage: 'idle', cashConfirm: false })
}))
