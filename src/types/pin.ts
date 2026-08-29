export type PinGateState =
  | { status: 'idle' }
  | { status: 'required'; slug: string }
  | { status: 'ok'; slug: string }
  | { status: 'error'; slug: string; message: string }

export type PinGateCtx = {
  state: PinGateState
  setPin: (pin: string) => Promise<void>
  clearPin: () => void
}
