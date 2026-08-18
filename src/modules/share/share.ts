export async function shareImage(dataUrl: string, filename = 'photobooth.png'): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare && nav.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Photobooth' })
    return 'Tershare'
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return 'Didownload'
}
