import { useEffect, useId, useState } from 'react'

// Jenis error gate PIN — dipetakan ke string i18n di PinGate.tsx.
// `message` opsional = pesan dinamis dari server (ditampilkan apa adanya).
export type PinGateError = 'check' | 'verify' | 'network'

type PinGateState =
  | { status: 'idle' }
  | { status: 'required' }
  | { status: 'ok' }
  | { status: 'error'; code: PinGateError; message?: string }

export function usePinGate() {
  const [state, setState] = useState<PinGateState>({ status: 'idle' })
  const [pin, setPin] = useState('')
  const inputId = useId()

  useEffect(() => {
    let cancelled = false
    setState({ status: 'idle' })
    fetch('/api/tenant/pin-status', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (cancelled) return
        if (j.required) setState({ status: 'required' })
        else setState({ status: 'ok' })
      })
      .catch(() => {
        if (cancelled) return
        setState({ status: 'error', code: 'check' })
      })
    return () => { cancelled = true }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r = await fetch('/api/tenant/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        const message = typeof j?.error === 'string' && j.error ? j.error : undefined
        setState({ status: 'error', code: 'verify', message })
        return
      }
      localStorage.setItem('pb_tenant_pin', pin)
      setState({ status: 'ok' })
    } catch {
      setState({ status: 'error', code: 'network' })
    }
  }

  return { state, inputId, pin, setPin, submit }
}
