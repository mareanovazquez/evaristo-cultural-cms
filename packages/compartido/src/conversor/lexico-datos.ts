import { readFileSync } from 'node:fs'
import { lexicoDesdeCsv, type Lexico } from './titulos.ts'

/** Léxico de títulos versionado en data/lexico-titulos.csv (se regenera con scripts/proponer-titulos.ts). */
export const RUTA_LEXICO = new URL('../../datos/conversor/lexico-titulos.csv', import.meta.url)

export function cargarLexico(ruta: URL | string = RUTA_LEXICO): Lexico {
  try {
    return lexicoDesdeCsv(readFileSync(ruta, 'utf8'))
  } catch (e: any) {
    throw new Error(`No se pudo cargar el léxico de títulos (${String(ruta)}): ${e.message}\nRegeneralo con: npx tsx scripts/proponer-titulos.ts`)
  }
}

let porDefecto: Lexico | undefined
/** El léxico versionado, cargado una sola vez. */
export const lexicoPorDefecto = (): Lexico => (porDefecto ??= cargarLexico())
