export async function uploadStrip(dataUrl: string, baseUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const fd = new FormData()
  fd.append('image', blob, 'strip.png')
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/upload`, {
    method: 'POST',
    body: fd
  })
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok) throw new Error(json.error || 'upload gagal')
  if (!json.url) throw new Error('no url')
  return json.url
}

// Upload hasil strip ke server photobooth sendiri (origin saat ini),
// tanpa butuh bridge/Node eksternal. Balik URL yang bisa di-scan QR untuk download.
export async function uploadStripLocal(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const fd = new FormData()
  fd.append('image', blob, 'strip.png')
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok) throw new Error(json.error || 'upload gagal')
  if (!json.url) throw new Error('no url')
  return json.url
}
