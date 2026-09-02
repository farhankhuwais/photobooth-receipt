import { useEffect, useId, useState } from 'react'

type PinGateState =
  | { status: 'idle' }
  | { status: 'required' }
  | { status: 'ok' }
  | { status: 'error'; message: string }

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
        setState({ status: 'error', message: 'Gagal memeriksa status PIN' })
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
      if (!r.ok) throw new Error(j.error || 'Gagal verifikasi PIN')
      localStorage.setItem('pb_tenant_pin', pin)
      setState({ status: 'ok' })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'PIN salah' })
    }
  }

  return { state, inputId, pin, setPin, submit }
}
