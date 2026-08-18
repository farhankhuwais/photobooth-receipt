import { buildPrintJob } from '../escpos/encoder'

export async function printViaBridge(canvas: HTMLCanvasElement, baseUrl: string): Promise<string> {
  const job = buildPrintJob(canvas)
  let binary = ''
  for (let i = 0; i < job.length; i++) binary += String.fromCharCode(job[i])
  const data = btoa(binary)
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  })
  const json = (await res.json().catch(() => ({}))) as { bytes?: number; error?: string }
  if (!res.ok) throw new Error(json.error || 'bridge error')
  return `Bridge: ${json.bytes ?? job.length} bytes terkirim ke printer`
}
