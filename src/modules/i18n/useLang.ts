// src/modules/i18n/useLang.ts
// Bahasa aktif dibaca dari field `lang` di GET /api/config (di-set App lewat setLang).
// Store kecil berbasis listener — tanpa dependency, biar gate ikut ganti bahasa
// tanpa reload saat config polling berikutnya mengubah `lang`.

import { useEffect, useState } from 'react'
import { translate, type Lang, type StringKey } from './strings'

let currentLang: Lang = 'id'
const listeners = new Set<(lang: Lang) => void>()

/** Dipanggil App saat config termuat: 'en' → EN, selain itu fallback 'id'. */
export function setLang(lang: unknown): void {
  const next: Lang = lang === 'en' ? 'en' : 'id'
  if (next === currentLang) return
  currentLang = next
  listeners.forEach((fn) => fn(next))
}

export interface LangApi {
  lang: Lang
  t: (key: StringKey, vars?: Record<string, string | number>) => string
}

export function useLang(): LangApi {
  const [lang, setLocal] = useState<Lang>(currentLang)

  useEffect(() => {
    const onChange = (next: Lang) => setLocal(next)
    listeners.add(onChange)
    // Sinkron kalau bahasa berubah antara render pertama & subscribe.
    setLocal(currentLang)
    return () => { listeners.delete(onChange) }
  }, [])

  return {
    lang,
    t: (key, vars) => translate(lang, key, vars),
  }
}
