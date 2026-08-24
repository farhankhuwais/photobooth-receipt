// Filter "Sketsa AI": kirim foto ke server -> server panggil Gemini (Nano Banana)
// -> balik ilustrasi sketsa. Kalau gagal/timeout, caller fallback ke sketsa lokal.
export const AI_SKETCH_ID = 'ai-sketch'

export interface AiStatus {
  enabled: boolean
  hasKey: boolean
  model?: string
}

export async function fetchAiStatus(): Promise<AiStatus> {
  try {
    const r = await fetch('/api/ai/status')
    if (!r.ok) return { enabled: false, hasKey: false }
    return (await r.json()) as AiStatus
  } catch {
    return { enabled: false, hasKey: false }
  }
}

// dataUrl foto asli -> dataUrl sketsa hasil Gemini. Error dibuang ke caller.
export async function aiSketch(dataUrl: string): Promise<string> {
  const r = await fetch('/api/ai/sketch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  })
  const j = await r.json().catch(() => ({})) as { image?: string; error?: string }
  if (!r.ok || !j.image) throw new Error(j.error || `AI gagal (${r.status})`)
  return j.image
}
