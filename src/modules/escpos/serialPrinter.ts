import { buildPrintJob } from './encoder'

let port: SerialPort | null = null
let baudRate = 9600

export function serialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export async function connectSerial(baud = 9600) {
  if (!serialSupported()) throw new Error('Web Serial tidak didukung (pakai Chrome/Edge)')
  baudRate = baud
  port = await navigator.serial.requestPort()
  await port.open({ baudRate })
}

export async function disconnectSerial() {
  await port?.close()
  port = null
}

export async function printViaSerial(canvas: HTMLCanvasElement): Promise<string> {
  if (!port) await connectSerial()
  if (!port || !port.writable) throw new Error('Port serial tidak terbuka')
  const job = buildPrintJob(canvas)
  const writer = port.writable.getWriter()
  try {
    await writer.write(job)
  } finally {
    writer.releaseLock()
  }
  return `Terkirim ${job.length} bytes ke printer (Web Serial @${baudRate})`
}
