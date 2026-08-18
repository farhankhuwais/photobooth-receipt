import { SerialPort } from 'serialport'

const PATH = process.env.PRINTER_PATH || 'COM3'
const BAUD = Number(process.env.PRINTER_BAUD || 9600)

export async function printBuffer(buf: Buffer): Promise<void> {
  const port = new SerialPort({ path: PATH, baudRate: BAUD })
  await new Promise<void>((resolve, reject) => {
    port.on('open', () => resolve())
    port.on('error', (e) => reject(e))
  })
  await new Promise<void>((resolve, reject) => {
    port.write(buf, (e) => (e ? reject(e) : resolve()))
  })
  await new Promise<void>((resolve) => port.drain(() => port.close(() => resolve())))
}
