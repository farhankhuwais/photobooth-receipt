import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../store/useSession'

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const setStream = useSession((s) => s.setStream)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Kamera butuh koneksi aman. Jangan buka lewat IP (http://192.168.x.x). ' +
            'Pakai http://localhost:5173 (atau HTTPS).'
        )
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        })
        if (videoRef.current) videoRef.current.srcObject = stream
        setStream(stream)
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
      stream?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [setStream])

  return { videoRef, error }
}
