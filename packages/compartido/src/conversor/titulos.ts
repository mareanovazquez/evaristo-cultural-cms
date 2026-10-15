/**
 * Normalización de títulos del corpus de WordPress. Funciones puras, sin acceso a disco ni a la base.
 *
 *  - construirLexico: nombres propios, siglas y palabras comunes derivados del cuerpo de los artículos (y de títulos y autores).
 *  - dividirTitulo: "TÍTULO | subtítulo" → título + bajada, sin dividir cuando el lado de la barra es el autor.
 *  - aFormatoOracion: pasa a formato oración los textos que están en mayúsculas.
 */

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const ROMANO = /^(?=[MDCLXVI])M*(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/
const RE_PALABRA = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu
/** Letras de verdad: las marcas ordinales (4ª, 2º) no cuentan. */
const esLetra = (c: string) => /\p{L}/u.test(c) && c !== 'ª' && c !== 'º'

const letras = (s: string) => [...s].filter(esLetra)
const esMayus = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase()
const mayuscula = (c: string) => c.toUpperCase()

/** Minúsculas, sin acentos, sin puntuación y con espacios colapsados. Para comparar. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const tokensNorm = (s: string) => normalizar(s).split(' ').filter(Boolean)
const colapsar = (s: string) => s.replace(/\s+/g, ' ').trim()
const capitalizar = (s: string) => (s ? mayuscula(s[0]!) + s.slice(1) : s)
/** Tiene tilde, diéresis o ñ. */
const tieneDiacritico = (s: string) => /\p{M}/u.test(s.normalize('NFD'))

/** Más del 80 % de las letras en mayúscula (y al menos 2 letras). */
export function estaEnMayusculas(texto: string): boolean {
  const ls = letras(texto)
  return ls.length >= 2 && ls.filter(esMayus).length / ls.length > 0.8
}

interface Pieza {
  palabra: string
  inicio: number
  /** Texto anterior sin espacios finales ni signos de apertura (¿ ¡ comillas, paréntesis). */
  antes: string
  /** Justo antes hay un signo de apertura de segmento: ¿ ¡ “ « ". */
  apertura: boolean
}

/** Palabras del texto, con el contexto previo. */
function piezas(texto: string): Pieza[] {
  const out: Pieza[] = []
  for (const m of texto.matchAll(RE_PALABRA)) {
    const inicio = m.index!
    out.push({
      palabra: m[0],
      inicio,
      antes: texto.slice(0, inicio).replace(/[\s"“«‘¿¡([]+$/u, ''),
      apertura: /[¿¡“«"]\s*$/u.test(texto.slice(0, inicio)),
    })
  }
  return out
}
/** Estadística sobre títulos: ¿la palabra abre un segmento? Inicio de texto o tras . ? ! : | (y guiones largos). */
const abreSegmento = (antes: string) => antes === '' || /[.?!:|–—]$/u.test(antes)

/** Segmentos de un título para el análisis estadístico: lo que va a cada lado de la barra. */
const segmentos = (titulo: string) => titulo.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean)

/** Partículas que van en minúscula entre palabras de un nombre propio ("John e Yves Berger", "Ludwig van Beethoven"). */
const PARTICULAS = new Set(['e', 'y', 'de', 'del', 'van', 'von', 'di', 'da', 'le', 'la'])

/** Pares que cambian de sentido con la tilde: no se restaura. */
const TILDE_AMBIGUA = new Set(['si', 'mas', 'el', 'esta', 'solo', 'aun', 'este', 'ese', 'aquel', 'aquella'])

/* ------------------------------------------------------------------ */
/* Texto plano del cuerpo                                              */
/* ------------------------------------------------------------------ */

const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', apos: "'", laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
}

/** Texto plano de un cuerpo de WordPress: sin HTML ni shortcodes ([embed], [caption]). Las etiquetas de bloque y <br> separan párrafos. */
export function textoPlano(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '\n')
    .replace(/\[\/?(?:embed|caption|gallery|audio|video|playlist|youtube|vimeo)\b[^\]]*\]/gi, '\n')
    .replace(/<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th|table|hr|pre|figure|figcaption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
      }
      return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? m
    })
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/ /g, ' ')
}

/** Fin de oración: . ? ! … o salto de línea. No cuenta un punto pegado a la palabra siguiente ("sitio.com"), ni el de una inicial ("J. L. Borges") ni el de abreviaturas ("Dr. Fulano"). */
const FIN_ORACION = /(?<!(?<!\p{L})\p{L}|(?<!\p{L})(?:Sr|Sra|Dr|Dra|Lic|Prof|Ing|Mr|Mrs|Ms|St|Av|Gral|Cnel|Pte|vol|pág|ed|trad))\.(?=[\s"”»')\]]|$)|[?!…\n]+/gu

/* ------------------------------------------------------------------ */
/* Léxico                                                              */
/* ------------------------------------------------------------------ */

/** Siglas de 5 o 6 letras que sí lo son aunque se puedan pronunciar (las que figuraban en el léxico, revisadas a mano). */
const SIGLAS_CONOCIDAS = new Set(['UNESCO', 'COVID', 'MALBA', 'INCAA', 'UNTREF', 'ASEAN', 'BAFICI', 'FLACSO', 'GLAAD', 'ALADAA', 'EEUU', 'URSS'])

/** Forma de palabra pronunciable: al menos 2 vocales y sin 3 consonantes ni 3 vocales seguidas (la Y cuenta como vocal solo después de una consonante). */
export function esPronunciable(w: string): boolean {
  const u = w.toUpperCase()
  let v = ''
  for (const c of u) v += /[AEIOU]/.test(c) || (c === 'Y' && v.endsWith('C')) ? 'V' : 'C'
  return (v.match(/V/g) ?? []).length >= 2 && !/CCC|VVV/.test(v)
}

/** Sigla del léxico: no es un numeral romano y, si tiene 5 o 6 letras, no parece una palabra pronunciable (salvo las conocidas). */
export function esSiglaPlausible(mayusculas: string): boolean {
  if (ROMANO.test(mayusculas)) return false
  return mayusculas.length <= 4 || SIGLAS_CONOCIDAS.has(mayusculas) || !esPronunciable(mayusculas)
}

export type TipoLexico = 'nombre' | 'sigla' | 'común'

export interface EntradaLexico {
  /** Clave: minúsculas y sin tildes ("jose"). */
  palabra: string
  /** Nombre → capitalizado, sigla → mayúsculas, común → minúscula; con la tilde más frecuente en el corpus. */
  forma: string
  tipo: TipoLexico
  /** Apariciones en medio de frase: en minúscula, Capitalizada y TODO MAYÚSCULAS. */
  min: number
  cap: number
  may: number
  origen: 'cuerpo' | 'titulo' | 'autor'
}

export interface Lexico {
  entradas: Map<string, EntradaLexico>
  /** clave sin tilde → forma minúscula con tilde, para palabras que casi siempre la llevan en el corpus. */
  tildes: Map<string, string>
  /** Claves de los nombres de pila: primera palabra de un nombre de autor (que el corpus no clasifica como común ni sigla). */
  nombresDePila: Set<string>
  /** Claves que aparecen en el cuerpo de los artículos, estén o no clasificadas. */
  vistas: Set<string>
  /** Apariciones en medio de frase de cada clave del cuerpo (para analizar las que quedaron sin clasificar). */
  conteos: Map<string, { min: number; cap: number; may: number }>
}

interface Conteo {
  min: number
  cap: number
  may: number
  /** Todas las apariciones (fuera de oraciones en mayúsculas y de palabras TODO MAYÚSCULAS): forma en minúscula → cantidad. */
  formas: Map<string, number>
}
const conteoVacio = (): Conteo => ({ min: 0, cap: 0, may: 0, formas: new Map() })

const esMinuscula = (w: string) => w[0] === w[0]!.toLowerCase() && w[0] !== w[0]!.toUpperCase()
const esTodoMayusculas = (w: string) => w.length >= 2 && w === w.toUpperCase() && w !== w.toLowerCase()
const sumar = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** Cuenta, por clave normalizada, cómo aparece cada palabra en los textos, en medio de frase. */
function contarCuerpos(textos: Iterable<string>): Map<string, Conteo> {
  const cuenta = new Map<string, Conteo>()
  const claves = new Map<string, string>()
  const clave = (w: string) => claves.get(w) ?? (claves.set(w, normalizar(w)), claves.get(w)!)
  for (const t of textos) {
    for (const oracion of textoPlano(t).split(FIN_ORACION)) {
      if (!/\p{L}/u.test(oracion) || estaEnMayusculas(oracion)) continue // las oraciones enteras en mayúsculas no dicen nada
      for (const m of oracion.matchAll(/\p{L}+/gu)) {
        const w = m[0]
        if (/[ªº]/.test(w)) continue
        const pre = oracion.slice(0, m.index!)
        const previo = pre.replace(/[\s"“«‘'¿¡(]+$/u, '')
        const medio = previo !== '' && !/[:—–]$/.test(previo) && !/[¿¡“«‘]\s*$/u.test(pre) && !/(?:^|\s)["']\s*$/u.test(pre)
        const k = clave(w)
        const c = cuenta.get(k) ?? conteoVacio()
        if (esTodoMayusculas(w)) {
          if (medio && w.length <= 6) c.may++
        } else {
          sumar(c.formas, w.toLowerCase())
          if (medio) {
            if (esMinuscula(w)) c.min++
            else if (w.length >= 2) c.cap++
          }
        }
        cuenta.set(k, c)
      }
    }
  }
  return cuenta
}

/** Forma más frecuente de la entrada (con tilde si hay empate): "José" y "Jose" son una sola entrada, gana la que más se usa. */
function mejorForma(formas: Map<string, number>): string {
  const orden = [...formas].sort((a, b) => b[1] - a[1] || Number(tieneDiacritico(b[0])) - Number(tieneDiacritico(a[0])))
  return orden[0]?.[0] ?? ''
}

/**
 * Léxico del corpus. Se construye desde el cuerpo de los artículos (en medio de frase, sin oraciones enteras en mayúsculas):
 *  - nombre: capitalizada al menos 3 veces y en ≥80 % de sus apariciones;
 *  - sigla: 2 a 6 letras, en mayúsculas al menos 3 veces y en más del 60 % de sus apariciones;
 *  - común: en minúscula en la mayoría de sus apariciones.
 * Se suman nombres detectados en títulos que no están en mayúsculas (si el cuerpo no las clasificó) y las palabras de los nombres de autor.
 */
export function construirLexico(titulos: string[], autores: string[], textos: Iterable<string> = []): Lexico {
  const entradas = new Map<string, EntradaLexico>()
  const cuerpo = contarCuerpos(textos)
  const tildes = new Map<string, string>()

  for (const [k, c] of cuerpo) {
    const total = c.min + c.cap + c.may
    const forma = mejorForma(c.formas)
    if (total > 0) {
      let tipo: TipoLexico | null = null
      if (c.may >= 3 && c.may / total > 0.6 && esSiglaPlausible(k.toUpperCase())) tipo = 'sigla'
      else if (c.cap >= 3 && c.cap / total >= 0.8) tipo = 'nombre'
      else if (c.min / total > 0.5) tipo = 'común'
      if (tipo) {
        const f = tipo === 'sigla' ? k.toUpperCase() : tipo === 'nombre' ? capitalizar(forma || k) : forma || k
        entradas.set(k, { palabra: k, forma: f, tipo, min: c.min, cap: c.cap, may: c.may, origen: 'cuerpo' })
      }
    }
    // Tilde casi siempre presente: se podrá restaurar en títulos en mayúsculas sin tilde.
    const apariciones = [...c.formas.values()].reduce((a, b) => a + b, 0)
    const conTilde = [...c.formas].filter(([f]) => tieneDiacritico(f)).reduce((a, [, n]) => a + n, 0)
    if (apariciones >= 5 && conTilde / apariciones >= 0.95) tildes.set(k, mejorForma(c.formas))
  }

  // Títulos que no están en mayúsculas: nombres propios y palabras comunes que el cuerpo no cubre.
  const deTitulos = new Map<string, { cap: number; min: number; formas: Map<string, number> }>()
  for (const titulo of titulos) {
    for (const seg of segmentos(titulo)) {
      if (estaEnMayusculas(seg)) continue
      for (const p of piezas(seg)) {
        const w = p.palabra
        if (/\d/.test(w) || abreSegmento(p.antes) || esTodoMayusculas(w)) continue
        const k = normalizar(w)
        const e = deTitulos.get(k) ?? { cap: 0, min: 0, formas: new Map() }
        if (esMinuscula(w)) e.min++
        else if (w.length >= 2) {
          e.cap++
          sumar(e.formas, w)
        }
        deTitulos.set(k, e)
      }
    }
  }
  for (const [k, e] of deTitulos) {
    if (entradas.has(k) || k.includes(' ')) continue
    if (e.cap >= 3 && e.cap / (e.cap + e.min) > 0.8) {
      const forma = [...e.formas].sort((a, b) => b[1] - a[1])[0]![0]
      entradas.set(k, { palabra: k, forma, tipo: 'nombre', min: e.min, cap: e.cap, may: 0, origen: 'titulo' })
    } else if (e.min > 0 && e.min >= e.cap) {
      entradas.set(k, { palabra: k, forma: k, tipo: 'común', min: e.min, cap: e.cap, may: 0, origen: 'titulo' })
    }
  }

  // Autores (display_name): sus palabras son nombres propios, salvo que el corpus las clasifique como comunes o siglas.
  const nombresDePila = new Set<string>()
  for (const autor of autores) {
    const palabras = autor.match(/\p{L}+/gu) ?? []
    const primera = normalizar(palabras[0] ?? '')
    const tipoPrimera = entradas.get(primera)?.tipo
    if (palabras.length >= 2 && !esMinuscula(palabras[0]!) && tipoPrimera !== 'común' && tipoPrimera !== 'sigla') nombresDePila.add(primera)
    for (const w of palabras) {
      const k = normalizar(w)
      if (w.length < 2 || esMinuscula(w) || (w === w.toUpperCase() && ROMANO.test(w)) || entradas.get(k)?.tipo === 'común' || entradas.get(k)?.tipo === 'sigla') continue
      if (!entradas.has(k)) {
        const forma = capitalizar(w === w.toUpperCase() ? w.toLowerCase() : w)
        entradas.set(k, { palabra: k, forma, tipo: 'nombre', min: 0, cap: 0, may: 0, origen: 'autor' })
      }
    }
  }
  return { entradas, tildes, nombresDePila, vistas: new Set(cuerpo.keys()), conteos: cuerpo }
}

/**
 * El léxico se guarda en CSV (data/lexico-titulos.csv) con todo lo que hace falta para reconstruirlo sin el corpus:
 * una fila por palabra del cuerpo, también las sin clasificar (tipo "ambigua"), con la tilde restaurable y si es nombre de pila.
 */
/** Palabras (letras) de un texto, normalizadas: las claves con las que se consulta el léxico. */
const clavesDeTexto = (texto: string) => (texto.match(/\p{L}+/gu) ?? []).map(normalizar)

/**
 * Versión recortada del léxico para normalizar un corpus conocido de títulos: solo las palabras que aparecen en esos títulos
 * (la clave ya junta las formas con y sin tilde), las de los nombres de autor, los nombres de pila, las partículas y las siglas.
 * normalizarTitulo da el mismo resultado con este léxico que con el completo para esos títulos.
 */
export function recortarLexico(lexico: Lexico, titulos: string[], autores: string[]): Lexico {
  const claves = new Set<string>([...PARTICULAS, ...lexico.nombresDePila])
  for (const t of titulos) for (const k of clavesDeTexto(t)) claves.add(k)
  for (const a of autores) for (const k of clavesDeTexto(a)) claves.add(k)
  for (const [k, e] of lexico.entradas) if (e.tipo === 'sigla') claves.add(k)
  const filtrar = <V>(m: Map<string, V>) => new Map([...m].filter(([k]) => claves.has(k)))
  return {
    entradas: filtrar(lexico.entradas),
    tildes: filtrar(lexico.tildes),
    nombresDePila: new Set(lexico.nombresDePila),
    vistas: new Set([...lexico.vistas].filter((k) => claves.has(k))),
    conteos: filtrar(lexico.conteos),
  }
}

export const COLUMNAS_LEXICO = ['palabra', 'forma', 'tipo', 'en_minuscula', 'capitalizada', 'mayusculas', 'origen', 'en_cuerpo', 'tilde', 'nombre_de_pila']
/** Filas del CSV, de más a menos frecuentes (orden determinista: no depende del idioma del sistema). */
export function filasLexico(lexico: Lexico): Array<Array<string | number>> {
  const claves = new Set([...lexico.entradas.keys(), ...lexico.vistas])
  const filas = [...claves].map((k) => {
    const e = lexico.entradas.get(k)
    const c = lexico.conteos.get(k) ?? e!
    return {
      f: (c.min ?? 0) + (c.cap ?? 0) + (c.may ?? 0),
      fila: [k, e?.forma ?? lexico.tildes.get(k) ?? k, e?.tipo ?? 'ambigua', c.min, c.cap, c.may, e?.origen ?? 'cuerpo', lexico.vistas.has(k) ? 'sí' : 'no', lexico.tildes.get(k) ?? '', lexico.nombresDePila.has(k) ? 'sí' : ''] as Array<string | number>,
    }
  })
  return filas.sort((a, b) => b.f - a.f || (a.fila[0]! < b.fila[0]! ? -1 : 1)).map((x) => x.fila)
}

/** Reconstruye el léxico desde el texto de data/lexico-titulos.csv (el que escribe aCsv con COLUMNAS_LEXICO). */
export function lexicoDesdeCsv(texto: string): Lexico {
  const lexico: Lexico = { entradas: new Map(), tildes: new Map(), nombresDePila: new Set(), vistas: new Set(), conteos: new Map() }
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
  const encabezado = lineas.shift()!.split(';').map((c) => c.slice(1, -1))
  if (encabezado.join(';') !== COLUMNAS_LEXICO.join(';')) throw new Error(`Léxico con columnas inesperadas: ${encabezado.join(';')}. Regeneralo con scripts/proponer-titulos.ts`)
  for (const linea of lineas) {
    const [palabra, forma, tipo, min, cap, may, origen, enCuerpo, tilde, pila] = linea.split(';').map((c) => c.slice(1, -1).replace(/""/g, '"')) as [string, string, string, string, string, string, EntradaLexico['origen'], string, string, string]
    const conteo = { min: Number(min), cap: Number(cap), may: Number(may) }
    if (tipo !== 'ambigua') lexico.entradas.set(palabra, { palabra, forma, tipo: tipo as TipoLexico, ...conteo, origen })
    if (enCuerpo === 'sí') {
      lexico.vistas.add(palabra)
      lexico.conteos.set(palabra, conteo)
    }
    if (tilde) lexico.tildes.set(palabra, tilde)
    if (pila === 'sí') lexico.nombresDePila.add(palabra)
  }
  return lexico
}

const tipoDe = (lexico: Lexico, w: string) => lexico.entradas.get(normalizar(w))?.tipo

/* ------------------------------------------------------------------ */
/* dividirTitulo                                                       */
/* ------------------------------------------------------------------ */

export type AccionTitulo = 'sin_barra' | 'dividido' | 'autor_en_titulo' | 'posible_autor'

export interface TituloDividido {
  titulo: string
  bajada: string
  accion: AccionTitulo
  avisos: string[]
  /** Solo en autor_en_titulo y posible_autor: la lectura invertida, para resolver rápido a mano. */
  alt_titulo?: string
  alt_bajada?: string
}

/** Todos los tokens de uno incluidos en los del otro (o igualdad). */
function coincideConAutor(lado: string, autor: string | null | undefined): boolean {
  if (!autor) return false
  const a = tokensNorm(lado)
  const b = tokensNorm(autor)
  if (!a.length || !b.length) return false
  if (a.join(' ') === b.join(' ')) return true
  const sa = new Set(a)
  const sb = new Set(b)
  return a.every((t) => sb.has(t)) || b.every((t) => sa.has(t))
}

/**
 * Un lado "parece persona" si tiene 2 a 4 palabras (sin contar partículas), al menos el 70 % son nombres propios del léxico
 * y al menos una es un nombre de pila conocido (primera palabra de un nombre de autor).
 */
export function pareceNombreDePersona(lado: string, lexico: Lexico): boolean {
  if (/\d/.test(lado)) return false
  const palabras = (lado.match(/\p{L}+/gu) ?? []).filter((w) => !PARTICULAS.has(normalizar(w)))
  if (palabras.length < 2 || palabras.length > 4) return false
  const esNombre = (w: string) => tipoDe(lexico, w) === 'nombre' || lexico.nombresDePila.has(normalizar(w))
  return palabras.filter(esNombre).length / palabras.length >= 0.7 && palabras.some((w) => lexico.nombresDePila.has(normalizar(w)))
}

/** La bajada, normalizada, es igual al nombre del autor de WordPress o lo contiene (palabras completas). */
export function bajadaCoincideConAutor(bajada: string, autor: string | null | undefined): boolean {
  const b = normalizar(bajada)
  const a = normalizar(autor ?? '')
  return a !== '' && b !== '' && ` ${b} `.includes(` ${a} `)
}

export function dividirTitulo(titulo: string, autor: string | null | undefined, lexico: Lexico): TituloDividido {
  const avisos: string[] = []
  const barra = /\s*\|+\s*/.exec(titulo)
  if (!barra) return { titulo: colapsar(titulo), bajada: '', accion: 'sin_barra', avisos }
  if (!/^\s+\|+\s+$/.test(barra[0])) avisos.push('barra_sin_espacios') // falta el espacio de algún lado (varios espacios no cuentan)
  const izq = colapsar(titulo.slice(0, barra.index))
  const der = colapsar(titulo.slice(barra.index + barra[0].length))
  if (der.includes('|')) avisos.push('varias_barras')
  if (!izq || !der) {
    avisos.push('barra_vacia')
    return { titulo: izq || der, bajada: '', accion: 'sin_barra', avisos }
  }
  const completo = `${izq} | ${der}`
  const invertida = { alt_titulo: der, alt_bajada: izq }
  if (coincideConAutor(izq, autor) || coincideConAutor(der, autor)) {
    return { titulo: completo, bajada: '', accion: 'autor_en_titulo', avisos, ...invertida }
  }
  if (pareceNombreDePersona(izq, lexico)) {
    if (pareceNombreDePersona(der, lexico)) {
      avisos.push('ambos_lados_persona')
      return { titulo: izq, bajada: der, accion: 'dividido', avisos }
    }
    return { titulo: completo, bajada: '', accion: 'posible_autor', avisos, ...invertida }
  }
  return { titulo: izq, bajada: der, accion: 'dividido', avisos }
}

/* ------------------------------------------------------------------ */
/* aFormatoOracion                                                     */
/* ------------------------------------------------------------------ */

/** Palabras sin tilde que en español la llevarían (o llevarían ñ). Solo sirve para marcar. */
const CON_TILDE_ESPERADA = new Set(
  `musica musico poesia poetica dia dias tambien asi aqui alli ahi quien quienes ultimo ultima unico unica facil dificil util
   pagina paginas publico publica politica politico economia filosofia teoria critica critico mexico peru paris ingles frances
   epoca epocas ademas despues segun atras detras jamas todavia travesia melodia armonia fantasia biografia geografia
   anos senor senora espana espanol espanola nino nina ninos ninas montana campana sueno suenos dueno ensenanza otono`
    .split(/\s+/)
    .filter(Boolean),
)
const TERMINACION_CON_TILDE = /(?:cion|sion)$/

const tieneTilde = (s: string) => /[áéíóúÁÉÍÓÚüÜ]/.test(s)

export interface ResultadoOracion {
  texto: string
  avisos: string[]
}

type Clase = 'sigla' | 'romano' | 'inicial' | 'nombre' | 'común' | 'desconocida' | 'ambigua' | 'otra'

const esRomanoPlausible = (w: string, lexico: Lexico) => {
  const up = w.toUpperCase()
  if (!ROMANO.test(up)) return false
  if (up.length === 1) return up === 'I' || up === 'V' || up === 'X'
  const t = tipoDe(lexico, w)
  return t !== 'común' && t !== 'nombre'
}

function claseDe(parte: string, siguiente: string, lexico: Lexico, anterior = ''): Clase {
  if (/\d/.test(parte)) return 'otra'
  if (parte.length === 1 && (siguiente === '.' || anterior === '.') && esLetra(parte)) return 'inicial' // "J. L. Borges", "F.R.I.E.N.D.S"
  const t = tipoDe(lexico, parte)
  if (t === 'sigla') return 'sigla'
  if (esRomanoPlausible(parte, lexico)) return 'romano'
  if (t === 'nombre') return 'nombre'
  if (t === 'común') return 'común'
  if (parte.length === 1) return 'común'
  const k = normalizar(parte)
  if (!lexico.vistas.has(k)) return 'desconocida' // fuera del corpus
  // En el corpus pero sin clasificar: gana la forma que más se usa en medio de frase.
  const c = lexico.conteos.get(k)
  return c && c.min > c.cap ? 'común' : 'ambigua' // más en minúscula: común sin aviso; más capitalizadas o empate: Capitalizada con aviso
}

export function aFormatoOracion(texto: string, lexico: Lexico): ResultadoOracion {
  if (!estaEnMayusculas(texto)) return { texto, avisos: [] }
  const original = colapsar(texto)
  const avisos: string[] = []
  const restauradas = new Set<string>()
  const desconocidas = new Set<string>()
  const ambiguas = new Set<string>()

  const ps = piezas(original)
  const partesDe = (palabra: string) => palabra.split(/(['’-])/)
  const clases = ps.map((p) => {
    const partes = partesDe(p.palabra)
    return partes.length === 1 ? claseDe(p.palabra, original[p.inicio + p.palabra.length] ?? '', lexico, original[p.inicio - 1] ?? '') : 'otra'
  })

  // Palabra desconocida pegada a un nombre propio: en una secuencia de 2 a 4 palabras de nombre o desconocida, se capitaliza.
  const capitalizarDesconocida = new Set<number>()
  const nombreODesc = (i: number) => clases[i] === 'nombre' || clases[i] === 'desconocida'
  for (let i = 0; i < ps.length; ) {
    if (!nombreODesc(i)) { i++; continue }
    let j = i
    while (j + 1 < ps.length && nombreODesc(j + 1) && /^\s+$/.test(original.slice(ps[j]!.inicio + ps[j]!.palabra.length, ps[j + 1]!.inicio))) j++
    const idx = Array.from({ length: j - i + 1 }, (_, n) => i + n)
    const largo = idx.length
    if (largo >= 2 && largo <= 4 && idx.some((n) => clases[n] === 'nombre') && idx.some((n) => clases[n] === 'desconocida')) {
      for (const n of idx) if (clases[n] === 'desconocida') capitalizarDesconocida.add(n)
    }
    i = j + 1
  }

  let out = ''
  let cursor = 0
  ps.forEach((p, i) => {
    out += original.slice(cursor, p.inicio)
    // Se capitaliza tras . ? ! | o un signo de apertura; tras ":" sigue en minúscula.
    // Un punto pegado a la palabra (".com", "S.A") no inicia oración.
    const abre = p.antes === '' || (/[.?!|]$/u.test(p.antes) && original[p.inicio - 1] !== '.') || p.apertura
    const finPalabra = p.inicio + p.palabra.length
    // Partícula entre dos palabras de un nombre propio: siempre en minúscula.
    const esNombre = (c: Clase | undefined) => c === 'nombre' || c === 'inicial'
    const particula =
      PARTICULAS.has(normalizar(p.palabra)) &&
      i > 0 && i < ps.length - 1 &&
      esNombre(clases[i - 1]) && esNombre(clases[i + 1]) &&
      /^\s+$/.test(original.slice(ps[i - 1]!.inicio + ps[i - 1]!.palabra.length, p.inicio)) &&
      /^\s+$/.test(original.slice(finPalabra, ps[i + 1]!.inicio))

    let resultado = ''
    let primera = true
    for (const parte of partesDe(p.palabra)) {
      if (parte === "'" || parte === '’' || parte === '-') {
        resultado += parte
        continue
      }
      const clase = particula ? 'común' : claseDe(parte, original[finPalabra] ?? '', lexico, primera ? original[p.inicio - 1] ?? '' : '')
      const k = normalizar(parte)
      let forma = parte.toLowerCase()
      if (clase === 'sigla' || clase === 'romano' || clase === 'inicial') forma = parte.toUpperCase()
      else if (clase === 'desconocida') {
        if (!desconocidas.has(k)) avisos.push(`palabra_desconocida:${parte}`)
        desconocidas.add(k)
      } else {
        if (clase === 'ambigua' && !ambiguas.has(k)) avisos.push(`palabra_ambigua:${parte}`)
        if (clase === 'ambigua') ambiguas.add(k)
      }
      if (clase !== 'sigla' && clase !== 'romano' && clase !== 'inicial' && clase !== 'desconocida' && clase !== 'otra' && parte.length > 3 && !tieneDiacritico(parte) && !TILDE_AMBIGUA.has(k) && lexico.tildes.has(k)) {
        forma = lexico.tildes.get(k)!
        if (!restauradas.has(k)) avisos.push(`tilde_restaurada:${parte}`)
        restauradas.add(k)
      }
      if ((clase === 'nombre' || clase === 'ambigua' || (clase === 'desconocida' && capitalizarDesconocida.has(i))) && !particula) forma = capitalizar(forma)
      resultado += abre && primera && !particula ? capitalizar(forma) : forma
      primera = false
    }
    out += resultado
    cursor = finPalabra
  })
  out += original.slice(cursor)
  // Inicio del texto: si arranca con símbolos, la primera letra igual va en mayúscula.
  const primeraLetra = out.search(/\p{L}/u)
  if (primeraLetra >= 0 && out.slice(0, primeraLetra).replace(/[\s"“«‘¿¡([]/gu, '') === '') {
    out = out.slice(0, primeraLetra) + mayuscula(out[primeraLetra]!) + out.slice(primeraLetra + 1)
  }

  // Aviso sobre el original en mayúsculas: sigue sin tildes pese a la restauración.
  if (!tieneTilde(original)) {
    const llevaria = (original.match(RE_PALABRA) ?? []).some((w) => {
      if (/\d/.test(w) || tieneDiacritico(w)) return false
      const k = normalizar(w)
      if (restauradas.has(k)) return false
      return CON_TILDE_ESPERADA.has(k) || (k.length >= 6 && TERMINACION_CON_TILDE.test(k))
    })
    if (llevaria) avisos.push('sin_tildes')
  }
  return { texto: out, avisos }
}

/** Aplica aFormatoOracion a cada lado de " | " por separado (para títulos que se dejan enteros pero con un lado en mayúsculas). */
export function aFormatoOracionPorSegmentos(texto: string, lexico: Lexico): ResultadoOracion {
  const partes = texto.split(' | ').map((parte) => aFormatoOracion(parte, lexico))
  return { texto: partes.map((r) => r.texto).join(' | '), avisos: partes.flatMap((r) => r.avisos) }
}

/* ------------------------------------------------------------------ */
/* normalizarTitulo: lo que usan el script de revisión y el conversor   */
/* ------------------------------------------------------------------ */

export interface TituloNormalizado {
  /** Título normalizado (con " | " conservado si no se divide). */
  titulo: string
  /** Bajada normalizada; vacía si no hay. */
  bajada: string
  accion: AccionTitulo
  /** Códigos de aviso del título: palabra_desconocida:X, palabra_ambigua:X, tilde_restaurada:X, sin_tildes, barra_sin_espacios, varias_barras, barra_vacia, ambos_lados_persona, titulo_vacio, revisar_autor_en_titulo. */
  avisos: string[]
  /** Solo en posible_autor y autor_en_titulo: la lectura invertida. */
  alt_titulo: string
  alt_bajada: string
  /** Solo para análisis (solo tienen sentido en dividido). */
  bajadaEsPersona: boolean
  bajadaCoincideAutor: boolean
  /** El texto propuesto difiere del original. */
  cambio: boolean
}

/**
 * Normaliza un título de WordPress: divide "TÍTULO | bajada" (salvo que el lado sea el autor) y pasa a formato oración lo que está en mayúsculas.
 *  - sin_barra / dividido: título y bajada normalizados.
 *  - posible_autor / autor_en_titulo: no se divide; título entero normalizado, bajada vacía y aviso revisar_autor_en_titulo.
 *  - título vacío: "" con aviso titulo_vacio (no se inventa nada).
 *  - barra_vacia ("| Texto"): se saca la barra, el texto se normaliza como cualquier título y se conservan los avisos barra_vacia y barra_sin_espacios.
 */
export function normalizarTitulo(original: string, autor: string | null | undefined, lexico: Lexico): TituloNormalizado {
  const base = { alt_titulo: '', alt_bajada: '', bajadaEsPersona: false, bajadaCoincideAutor: false, cambio: false }
  if (!original.trim()) return { ...base, titulo: '', bajada: '', accion: 'sin_barra', avisos: ['titulo_vacio'] }
  const d = dividirTitulo(original, autor, lexico)
  // Si no se divide, el título queda entero pero cada lado de " | " se normaliza por separado.
  const entero = d.accion === 'autor_en_titulo' || d.accion === 'posible_autor'
  const t = entero ? aFormatoOracionPorSegmentos(d.titulo, lexico) : aFormatoOracion(d.titulo, lexico)
  const b = aFormatoOracion(d.bajada, lexico)
  return {
    titulo: t.texto,
    bajada: b.texto,
    accion: d.accion,
    avisos: [...d.avisos, ...t.avisos, ...b.avisos, ...(entero ? ['revisar_autor_en_titulo'] : [])],
    alt_titulo: d.alt_titulo ?? '',
    alt_bajada: d.alt_bajada ?? '',
    bajadaEsPersona: d.accion === 'dividido' && pareceNombreDePersona(d.bajada, lexico),
    bajadaCoincideAutor: d.accion === 'dividido' && bajadaCoincideConAutor(d.bajada, autor),
    cambio: t.texto !== d.titulo || b.texto !== d.bajada,
  }
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** UTF-8 con BOM, separador ";" y todo entre comillas. */
export function aCsv(columnas: string[], filas: Array<Array<string | number>>): string {
  const celda = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  return '﻿' + [columnas, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n'
}
