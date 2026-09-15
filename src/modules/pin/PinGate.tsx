import { usePinGate } from './usePinGate'
import { useLang } from '../i18n/useLang'

export default function PinGate() {
  const { t } = useLang()
  const { state, inputId, pin, setPin, submit } = usePinGate()

  if (state.status === 'ok') return null

  const isChecking = state.status === 'idle'
  const isRequired = state.status === 'required'
  const isError = state.status === 'error'

  const title = isError ? t('pin.badTitle') : isChecking ? t('pin.checkingTitle') : t('pin.requiredTitle')
  const subtitle = isError ? t('pin.badSub') : isChecking ? t('pin.checkingSub') : t('pin.requiredSub')
  // Pesan server diprioritaskan; kalau tidak ada, pakai string i18n sesuai kode error.
  const errorText = state.status === 'error'
    ? (state.message || t(state.code === 'network' ? 'pin.errNetwork' : state.code === 'check' ? 'pin.errCheck' : 'pin.errVerify'))
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <form onSubmit={submit} className="bg-white border-4 border-black p-6 w-[min(92vw,360px)]">
        <h2 className="font-headline-lg font-black uppercase tracking-tight mb-2">
          {title}
        </h2>
        <p className="font-body-sm mb-4 opacity-80">
          {subtitle}
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
            {errorText && (
              <p className="text-red-600 font-bold text-sm mb-2">{errorText}</p>
            )}
            <button type="submit" className="w-full border-4 border-black bg-black text-white font-black uppercase py-3">
              {t('pin.retry')}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
