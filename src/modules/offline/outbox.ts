// Outbox foto offline: kalau server tak terjangkau (internet mati / server mati),
// hasil foto disimpan dulu di device (IndexedDB) supaya tidak hilang.
// Begitu online lagi, outbox dikirim otomatis ke server (galeri/dashboard).
import { uploadStripLocal } from '../share/upload'

const DB_NAME = 'pb-offline'
const STORE = 'pending'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  })
}

export async function outboxCount(): Promise<number> {
  try {
    const n = await tx<number>('readonly', (s) => s.count())
    return n ?? 0
  } catch {
    return 0
  }
}

// Simpan satu hasil strip (dataURL PNG) ke outbox lokal.
export async function queueStrip(dataUrl: string): Promise<void> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await tx('readwrite', (s) => s.put({ id, ts: Date.now(), dataUrl }))
}

// Coba kirim semua item outbox ke server. Balik jumlah yang berhasil terkirim.
// Item yang gagal dibiarkan di outbox (dicoba lagi lain waktu).
export async function syncOutbox(): Promise<number> {
  let all: { id: string; ts: number; dataUrl: string }[] = []
  try {
    all = ((await tx<any[]>('readonly', (s) => s.getAll())) || []) as { id: string; ts: number; dataUrl: string }[]
  } catch {
    return 0
  }
  let sent = 0
  for (const item of all) {
    try {
      await uploadStripLocal(item.dataUrl)
      await tx('readwrite', (s) => s.delete(item.id))
      sent++
    } catch {
      break // server masih gak bisa — stop, sisanya nanti lagi
    }
  }
  return sent
}
