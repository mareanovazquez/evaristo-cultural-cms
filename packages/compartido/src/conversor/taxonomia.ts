// Taxonomía del sitio nuevo: resuelve sección y categorías de un artículo a partir de las categorías de WordPress.
// Todas las reglas (normalizaciones, prioridad, descartes, excepciones por id) viven en data/mapeo-taxonomias.json.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface ItemCatalogo { slug: string; nombre: string }
export interface TaxonomiaWp {
  nombre: string
  /** seccion: candidata a sección (más las `categorias` fijas); categoria: solo suma `categorias`; descartar: se ignora. */
  accion: 'seccion' | 'categoria' | 'descartar'
  seccion?: string
  categorias?: string[]
  /** Otras secciones que también son candidatas (Reseñas Seda: Asia; Reseñas Rastros: Rastros). Las que no ganan pasan a categorías. */
  tambienSecciones?: string[]
  /** Si está, los ids de los artículos con esta taxonomía se registran en out/<valor>.csv. */
  registrarIdsEn?: string
}
export interface ExcepcionPorId { seccion: string; categorias: string[]; motivo: string }
/** Entrevista se detecta por el título: algún tramo (separado por "|") empieza con el patrón. Los ids de `porId` mandan sobre el patrón. */
export interface ReglaEntrevista {
  seccion: string
  patronTitulo: string
  banderas: string
  /** Cuántos tramos del título se revisan (el primero y el que sigue a la barra). */
  tramosRevisados: number
  porId: Record<string, { es: boolean; motivo: string }>
}
export interface MapeoTaxonomias {
  version: number
  urlViejaPlantilla: string
  seccionSinAsignar: ItemCatalogo
  secciones: ItemCatalogo[]
  prioridadSecciones: string[]
  entrevista: ReglaEntrevista
  categorias: ItemCatalogo[]
  taxonomiasWp: Record<string, TaxonomiaWp>
  excepcionesPorId: Record<string, ExcepcionPorId>
}

export interface TaxonomiaResuelta {
  /** Slug de la sección elegida, o la de sin-asignar. */
  seccion: string
  sinAsignar: boolean
  categorias: string[]
  /** Categoría principal (volanta): null si no hay categorías; si no, una de `categorias` (ver categoriaPrincipal). */
  categoriaPrincipal: string | null
  /** Secciones candidatas (distintas) antes de elegir. */
  candidatas: string[]
  /** El título o el mapeo por id marcan al artículo como entrevista (candidata a sección; puede perder por prioridad). */
  esEntrevista: boolean
  /** Más de una candidata: se resolvió por prioridad. */
  variasCandidatas: boolean
  descartadas: string[]
  /** Slugs de WordPress que no figuran en el mapeo. */
  sinMapear: string[]
  /** Archivos de registro de ids (`registrarIdsEn`) que corresponden a este artículo. */
  registrarEn: string[]
  excepcion: boolean
}

export function validarMapeo(m: MapeoTaxonomias): void {
  const errores: string[] = []
  const secciones = new Set(m.secciones.map((s) => s.slug))
  const categorias = new Set(m.categorias.map((c) => c.slug))
  if (secciones.has(m.seccionSinAsignar.slug)) errores.push('sin-asignar no puede ser una sección normal')
  if (!secciones.has(m.entrevista.seccion)) errores.push(`entrevista: sección desconocida "${m.entrevista.seccion}"`)
  if (!m.prioridadSecciones.includes(m.entrevista.seccion)) errores.push('entrevista: la sección no figura en la prioridad')
  try { new RegExp(m.entrevista.patronTitulo, m.entrevista.banderas) } catch { errores.push('entrevista: patronTitulo inválido') }
  for (const s of m.prioridadSecciones) if (!secciones.has(s)) errores.push(`prioridad: sección desconocida "${s}"`)
  if (new Set(m.prioridadSecciones).size !== m.prioridadSecciones.length) errores.push('prioridad: sección repetida')
  for (const [slug, t] of Object.entries(m.taxonomiasWp)) {
    if (t.accion === 'seccion') {
      if (!t.seccion || !m.prioridadSecciones.includes(t.seccion)) errores.push(`${slug}: sección "${t.seccion}" ausente de la prioridad`)
      if (!categorias.has(t.seccion ?? '')) errores.push(`${slug}: la sección "${t.seccion}" no existe como categoría (hace falta si pierde la prioridad)`)
    }
    for (const c of t.categorias ?? []) if (!categorias.has(c)) errores.push(`${slug}: categoría desconocida "${c}"`)
    for (const c of t.tambienSecciones ?? []) if (!m.prioridadSecciones.includes(c) || !categorias.has(c)) errores.push(`${slug}: tambienSecciones desconocida "${c}"`)
  }
  for (const [id, e] of Object.entries(m.excepcionesPorId)) {
    if (!secciones.has(e.seccion)) errores.push(`excepción ${id}: sección desconocida "${e.seccion}"`)
    for (const c of e.categorias) if (!categorias.has(c)) errores.push(`excepción ${id}: categoría desconocida "${c}"`)
  }
  if (errores.length) throw new Error(`mapeo-taxonomias.json inválido:\n- ${errores.join('\n- ')}`)
}

export function cargarMapeo(ruta = fileURLToPath(new URL('../../datos/conversor/mapeo-taxonomias.json', import.meta.url))): MapeoTaxonomias {
  const m = JSON.parse(readFileSync(ruta, 'utf8')) as MapeoTaxonomias
  validarMapeo(m)
  return m
}

export function urlVieja(m: MapeoTaxonomias, id: number): string {
  return m.urlViejaPlantilla.replace('{id}', String(id))
}

/** ¿Es una entrevista? Manda el mapeo por id; si no, el patrón sobre los primeros tramos del título. */
export function esEntrevista(id: number, titulo: string, m: MapeoTaxonomias): boolean {
  const porId = m.entrevista.porId[String(id)]
  if (porId) return porId.es
  const re = new RegExp(m.entrevista.patronTitulo, m.entrevista.banderas)
  return titulo.split('|').slice(0, m.entrevista.tramosRevisados).some((tramo) => re.test(tramo.trim()))
}

/** `titulo` es el título crudo de WordPress (antes de normalizarlo): sin él no se detectan entrevistas. */
/**
 * Categoría principal (volanta) de un artículo, entre sus categorías finales: null si no tiene; si tiene una, esa;
 * si tiene varias, la primera según `prioridadSecciones`. Las que no figuran en esa lista van después, en orden
 * alfabético (sin distinguir tildes ni mayúsculas; desempata el slug), así el resultado no depende del orden de entrada.
 */
export function categoriaPrincipal(categorias: string[], m: MapeoTaxonomias): string | null {
  const pos = new Map(m.prioridadSecciones.map((s, i) => [s, i]))
  const nombre = new Map(m.categorias.map((c) => [c.slug, c.nombre]))
  const orden = (a: string, b: string): number => {
    const pa = pos.get(a), pb = pos.get(b)
    if (pa !== undefined && pb !== undefined) return pa - pb
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return (nombre.get(a) ?? a).localeCompare(nombre.get(b) ?? b, 'es', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0)
  }
  return [...categorias].sort(orden)[0] ?? null
}

/** La categoría principal es null solo si no hay categorías, y si no, está entre las categorías finales. */
export function validarCategoriaPrincipal(categorias: string[], principal: string | null): void {
  if (principal === null ? categorias.length > 0 : !categorias.includes(principal)) {
    throw new Error(`categoría principal inválida: ${principal === null ? 'null' : `"${principal}"`} con categorías [${categorias.join(', ')}]`)
  }
}

export function resolverTaxonomia(id: number, slugsWp: string[], m: MapeoTaxonomias, titulo = ''): TaxonomiaResuelta {
  const candidatas = new Set<string>(), fijas = new Set<string>(), descartadas: string[] = [], sinMapear: string[] = [], registrarEn = new Set<string>()
  for (const slug of slugsWp) {
    const t = m.taxonomiasWp[slug]
    if (!t) { sinMapear.push(slug); continue }
    if (t.registrarIdsEn) registrarEn.add(t.registrarIdsEn)
    if (t.accion === 'descartar') { descartadas.push(slug); continue }
    if (t.accion === 'seccion') { candidatas.add(t.seccion!); for (const c of t.tambienSecciones ?? []) candidatas.add(c) }
    for (const c of t.categorias ?? []) fijas.add(c)
  }
  const entrevista = esEntrevista(id, titulo, m)
  if (entrevista) candidatas.add(m.entrevista.seccion)
  const orden = new Map(m.categorias.map((c, i) => [c.slug, i]))
  const ordenar = (s: Iterable<string>) => [...s].sort((a, b) => orden.get(a)! - orden.get(b)!)
  const base = { esEntrevista: entrevista, candidatas: m.prioridadSecciones.filter((s) => candidatas.has(s)), variasCandidatas: candidatas.size > 1, descartadas, sinMapear, registrarEn: [...registrarEn] }

  const ex = m.excepcionesPorId[String(id)]
  const armar = (seccion: string, sinAsignar: boolean, categorias: string[], excepcion: boolean): TaxonomiaResuelta => {
    const principal = categoriaPrincipal(categorias, m)
    validarCategoriaPrincipal(categorias, principal)
    return { ...base, seccion, sinAsignar, categorias, categoriaPrincipal: principal, excepcion }
  }
  if (ex) return armar(ex.seccion, false, ordenar(ex.categorias), true)
  if (!candidatas.size) return armar(m.seccionSinAsignar.slug, true, ordenar(fijas), false)
  const ganadora = m.prioridadSecciones.find((s) => candidatas.has(s))!
  const categorias = ordenar(new Set([...fijas, ...candidatas].filter((c) => c !== ganadora)))
  return armar(ganadora, false, categorias, false)
}
