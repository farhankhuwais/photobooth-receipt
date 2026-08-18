import { create } from 'zustand'

export type TemplateId = 'strip3' | 'grid2x2' | 'single'

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
  bridgeUrl: string
  digitalUrl: string | null
  setStream: (s: MediaStream | null) => void
  setTemplate: (t: TemplateId) => void
  addShot: (dataUrl: string) => void
  resetShots: () => void
  setBranding: (b: Partial<BrandingConfig>) => void
  setStatus: (s: SessionStatus) => void
  setBridgeUrl: (u: string) => void
  setDigitalUrl: (u: string | null) => void
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
  bridgeUrl: loadBridgeUrl(),
  digitalUrl: null,
  setStream: (stream) => set({ stream }),
  setTemplate: (template) => set({ template, shotCount: countFor(template) }),
  addShot: (dataUrl) => set((s) => ({ shots: [...s.shots, dataUrl] })),
  resetShots: () => set({ shots: [], status: 'idle', digitalUrl: null }),
  setBranding: (b) => set((s) => ({ branding: { ...s.branding, ...b } })),
  setStatus: (status) => set({ status }),
  setBridgeUrl: (u) => set({ bridgeUrl: u }),
  setDigitalUrl: (u) => set({ digitalUrl: u })
}))

useSession.subscribe((s) => {
  try {
    localStorage.setItem('pb_branding', JSON.stringify(s.branding))
    localStorage.setItem('pb_bridge', s.bridgeUrl)
  } catch {
    /* ignore quota */
  }
})
