import { usePinGate } from './usePinGate'

export default function PinGate() {
  const { state, inputId, pin, setPin, submit } = usePinGate()

  if (state.status === 'ok') return null

  const message = (state as any).message || null
  const isChecking = state.status === 'idle'
  const isRequired = state.status === 'required'
  const isError = state.status === 'error'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <form onSubmit={submit} className="bg-white border-4 border-black p-6 w-[min(92vw,360px)]">
        <h2 className="font-headline-lg font-black uppercase tracking-tight mb-2">
          {isError ? 'PIN Salah' : isChecking ? 'Memeriksa…' : 'Masukkan PIN'}
        </h2>
        <p className="font-body-sm mb-4 opacity-80">
          {isError ? 'PIN yang dimasukkan tidak cocok.' : isChecking ? 'Sedang verifikasi akses booth.' : 'PIN 4 digit untuk akses booth ini.'}
        </p>
        {(isRequired || isError) && (
          <>
            <input
              id={inputId}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full border-4 border-black p-3 text-center text-2xl font-black tracking-widest mb-3"
              placeholder="0000"
            />
            {message && (
              <p className="text-red-600 font-bold text-sm mb-2">{message}</p>
            )}
            <button type="submit" className="w-full border-4 border-black bg-black text-white font-black uppercase py-3">
              Coba Lagi
            </button>
          </>
        )}
      </form>
    </div>
  )
}
