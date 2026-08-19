import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../store/useSession'

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const setStream = useSession((s) => s.setStream)
  const status = useSession((s) => s.status)
  const screen = useSession((s) => s.screen)
  const [error, setError] = useState<string | null>(null)

  // Tempelkan stream ke elemen <video> yang sedang ada di DOM.
  // 'muted' HARUS diset di JS (bukan cuma prop React) agar autoplay lolos
  // autoplay policy browser — kalau tidak, video tidak play padahal stream ada.
  function attach() {
    const v = videoRef.current
    const s = streamRef.current
    if (!v || !s) return
    v.muted = true
    if (v.srcObject !== s) v.srcObject = s
    if (v.paused) v.play().catch(() => {})
  }

  // Saat layar berubah attract -> booth (atau status keluar dari 'done'),
  // elemen <video> di-remount sebagai elemen BARU. Pastikan stream
  // ditempelkan ulang ke elemen tersebut, kalau tidak kamera akan hitam.
  // Hanya attach kalau elemen video memang sedang dirender (screen === 'booth').
  useEffect(() => {
    if (screen === 'booth' && status !== 'done') attach()
  }, [screen, status])

  useEffect(() => {
    let cancelled = false
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Kamera butuh koneksi aman. Jangan buka lewat IP (http://192.168.x.x). ' +
            'Pakai http://localhost:5173 (atau HTTPS).'
        )
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        setStream(stream)
        attach()
      } catch (e) {
        const name = (e as DOMException)?.name
        if (name === 'NotAllowedError') {
          setError('Izin kamera ditolak. Klik ikon 🔒 di address bar → izinkan kamera → refresh.')
        } else if (name === 'NotFoundError') {
          setError('Tidak ada kamera terdeteksi di perangkat ini.')
        } else if (name === 'NotReadableError') {
          setError('Kamera dipakai aplikasi lain (Zoom/Meet?). Tutup dulu, lalu refresh.')
        } else {
          setError('Kamera tidak bisa diakses. Pastikan localhost/HTTPS & izin diberikan.')
        }
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setStream(null)
    }
  }, [setStream])

  return { videoRef, error }
}
