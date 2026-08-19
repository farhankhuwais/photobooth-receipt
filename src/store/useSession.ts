import { create } from 'zustand'

export type TemplateId = 'strip3' | 'grid2x2' | 'single'
export type Screen = 'attract' | 'booth'
export type PaymentMethod = 'qris' | 'cash'

export interface BrandingConfig {
  eventName: string
  logoDataUrl: string | null
  showDate: boolean
  watermark: string
  qrText: string
}

export type SessionStatus = 'idle' | 'capturing' | 'done'

interface SessionState {
  stream: MediaStream | null
  shots: string[]
  template: TemplateId
  shotCount: number
  branding: BrandingConfig
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

const countFor = (t: TemplateId) => (t === 'grid2x2' ? 4 : t === 'single' ? 1 : 3)

const DEFAULT_BRANDING: BrandingConfig = {
  eventName: 'My Event',
  logoDataUrl: null,
  showDate: true,
  watermark: '',
  qrText: ''
}

function loadBranding(): BrandingConfig {
  try {
    const raw = localStorage.getItem('pb_branding')
    if (raw) return { ...DEFAULT_BRANDING, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_BRANDING
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
  branding: loadBranding(),
  status: 'idle',
  screen: 'attract',
  paid: false,
  paymentMethod: null,
  payStage: 'idle',
  cashConfirm: false,
  bridgeUrl: loadBridgeUrl(),
  digitalUrl: null,
  setStream: (stream) => set({ stream }),
  setTemplate: (template) => set({ template, shotCount: countFor(template) }),
  addShot: (dataUrl) => set((s) => ({ shots: [...s.shots, dataUrl] })),
  resetShots: () => set({ shots: [], status: 'idle', digitalUrl: null }),
  setBranding: (b) => set((s) => ({ branding: { ...s.branding, ...b } })),
  setStatus: (status) => set({ status }),
  setScreen: (screen) => set({ screen }),
  setPaid: (paid) => set({ paid }),
  setBridgeUrl: (u) => set({ bridgeUrl: u }),
  setDigitalUrl: (u) => set({ digitalUrl: u }),
  enterBooth: () => set({ screen: 'booth', status: 'idle', shots: [], digitalUrl: null, paid: false, paymentMethod: null, payStage: 'idle', cashConfirm: false }),
  goAttract: () =>
    set({ screen: 'attract', status: 'idle', shots: [], digitalUrl: null, paid: false, paymentMethod: null, payStage: 'idle', cashConfirm: false }),
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
