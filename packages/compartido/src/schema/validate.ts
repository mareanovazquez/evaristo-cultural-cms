// Única fuente de verdad para validar el cuerpo de un artículo (documento JSON de TipTap).
// TypeScript puro: sin React, DOM ni render.ts. Lo usan el editor, el renderizador y el conversor.
//
// Dos modos:
//  - 'estricto' (por defecto): lo que se escribe en el panel del editor.
//  - 'migracion': lo que sale del conversor. Lo que no es riesgo de seguridad pasa de error a aviso
//    (imagen sin alt y sin decorativa, imagen con ruta relativa).
//
// Imágenes sin texto alternativo (especificación del artículo, 13.2): una imagen migrada sin alt se puede guardar si lleva
// altPendiente: true (queda marcada y el editor muestra un aviso); una imagen nueva sin alt se rechaza.
import { isValidVideoId, isVideoProvider } from '../render/video.ts'

export interface JSONNode {
  type?: string
  text?: string
  marks?: Array<{
    type: string
    attrs?: Record<string, unknown>
  }>
  attrs?: Record<string, unknown>
  content?: JSONNode[]
}

export type ModoValidacion = 'estricto' | 'migracion'

export interface OpcionesValidacion {
  modo?: ModoValidacion
}

export interface ResultadoValidacion {
  errores: string[]
  avisos: string[]
}

export function isAllowedUrl(url: string | unknown): boolean {
  if (typeof url !== 'string') return false
  const trimmed = url.trim().toLowerCase()
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:')
}

// Imágenes: solo http(s) o rutas absolutas del sitio ("/algo.png"). Se descartan javascript:, data:, "//host", etc.
export function isAllowedImageSrc(src: string | unknown): boolean {
  if (typeof src !== 'string') return false
  const trimmed = src.trim()
  if ([...trimmed].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return false
  if (/^https?:\/\/[^/\s]/i.test(trimmed)) return true
  return trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')
}

// Ruta relativa: sin esquema ("http:", "javascript:", "data:"...) y sin "/" inicial. Ej.: "interior/foto.gif".
export function isRelativeImageSrc(src: string | unknown): boolean {
  if (typeof src !== 'string') return false
  const trimmed = src.trim()
  if (!trimmed) return false
  if ([...trimmed].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false
  return !trimmed.startsWith('/') && !trimmed.startsWith('\\')
}

// Qué nodos admite cada nodo como hijos. 'inline' son los textos y lo que va en línea.
const INLINE_PARENTS: Record<string, string[]> = {
  paragraph: ['text', 'footnote', 'hardBreak'],
  heading: ['text', 'footnote'],
}

const BLOCK_PARENTS: Record<string, string[]> = {
  doc: ['paragraph', 'heading', 'bulletList', 'orderedList', 'cita', 'imagen', 'video', 'table'],
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  listItem: ['paragraph', 'bulletList', 'orderedList'],
  cita: ['paragraph'],
  table: ['tableRow'],
  tableRow: ['tableHeader', 'tableCell'],
  tableHeader: ['paragraph'],
  tableCell: ['paragraph'],
  imagen: [],
  video: [],
  hardBreak: [],
  text: [],
  footnote: [],
}

const MUST_NOT_BE_EMPTY = new Set(['listItem', 'bulletList', 'orderedList', 'table', 'tableRow', 'cita'])
const ALLOWED_MARKS = new Set(['bold', 'italic', 'link'])

export function validateArticleBodyDetallado(doc: JSONNode, opts: OpcionesValidacion = {}): ResultadoValidacion {
  const migracion = opts.modo === 'migracion'
  const errores: string[] = []
  const avisos: string[] = []

  function checkNode(node: JSONNode, path: string) {
    if (!node || typeof node !== 'object') {
      errores.push(`Nodo inválido en ${path}`)
      return
    }
    const type = node.type
    if (!type) {
      errores.push(`Nodo sin tipo en ${path}`)
      return
    }
    const allowedChildren = INLINE_PARENTS[type] ?? BLOCK_PARENTS[type]
    if (!allowedChildren) {
      errores.push(`Nodo no permitido: <${type}> en ${path}`)
      return
    }

    if (type === 'text' && !node.text) errores.push(`Texto vacío en ${path}`)

    if (type === 'heading') {
      const level = Number(node.attrs?.level)
      if (![2, 3, 4].includes(level)) {
        errores.push(`Nivel de título no permitido: H${level} en ${path}. Solo se admiten H2, H3 y H4.`)
      }
    }

    for (const mark of node.marks ?? []) {
      if (!ALLOWED_MARKS.has(mark.type)) {
        errores.push(`Marca de formato no permitida: "${mark.type}" en ${path}`)
      }
      if (mark.type === 'link') {
        const href = mark.attrs?.href
        if (!isAllowedUrl(href)) {
          errores.push(`Enlace con protocolo no permitido o inseguro: "${href}" en ${path}`)
        }
      }
    }

    if (type === 'imagen') {
      const src = node.attrs?.src
      if (!isAllowedImageSrc(src)) {
        if (migracion && isRelativeImageSrc(src)) {
          avisos.push(`Imagen con ruta relativa: "${src}" en ${path}`)
        } else {
          errores.push(
            `Imagen con dirección no permitida: "${src ?? ''}" en ${path}. Solo se admiten http://, https:// o rutas que empiecen con "/".`,
          )
        }
      }
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt.trim() : ''
      const decorativa = node.attrs?.decorativa === true
      const pendiente = node.attrs?.altPendiente
      // OJO: este validador no puede saber si la marca altPendiente es legítima (viene de la migración) o la agregó alguien a mano.
      // Esa verificación (que una imagen con altPendiente en un documento guardado ya estuviera marcada en la versión anterior)
      // es del servidor y se hace en la fase 4. El editor nunca activa la marca en imágenes nuevas.
      if (pendiente !== undefined && typeof pendiente !== 'boolean') {
        errores.push(`altPendiente debe ser verdadero o falso (se encontró ${JSON.stringify(pendiente)}) en ${path}`)
      }
      const marcada = pendiente === true
      if (marcada && (alt || decorativa)) {
        const motivo = alt ? 'con texto alternativo completo' : 'en una imagen decorativa'
        const mensaje = `altPendiente ${motivo} en ${path}: la marca sobra, quitala.`
        if (migracion) avisos.push(mensaje)
        else errores.push(mensaje)
      }
      if (!alt && !decorativa && !marcada) {
        if (migracion) {
          avisos.push(`Imagen sin texto alternativo en ${path}`)
        } else {
          errores.push(`Imagen sin texto alternativo en ${path}: completá el texto alternativo o marcala como decorativa.`)
        }
      }
    }

    if (type === 'video') {
      const provider = node.attrs?.provider
      const id = node.attrs?.id
      if (!isVideoProvider(provider)) {
        errores.push(`Video con proveedor no permitido: "${provider ?? ''}" en ${path}. Solo se admiten YouTube y Vimeo.`)
      } else if (!isValidVideoId(provider, id)) {
        errores.push(`Video con identificador inválido: "${id ?? ''}" (${provider}) en ${path}`)
      }
    }

    if (type === 'tableCell' || type === 'tableHeader') {
      if (Number(node.attrs?.colspan ?? 1) > 1 || Number(node.attrs?.rowspan ?? 1) > 1) {
        errores.push(`Celda de tabla combinada no permitida (colspan/rowspan) en ${path}`)
      }
    }

    if (type === 'footnote') {
      const content = node.attrs?.content as JSONNode | undefined
      if (!content || content.type !== 'doc' || !content.content?.length) {
        errores.push(`Nota al pie vacía o sin estructura en ${path}`)
      } else {
        checkNode(content, `${path} > footnote`)
      }
    }

    const kids = node.content ?? []
    if (!kids.length && MUST_NOT_BE_EMPTY.has(type)) errores.push(`<${type}> vacío en ${path}`)
    kids.forEach((child, index) => {
      const childPath = `${path} > ${type}[${index}]`
      if (!child || typeof child !== 'object' || !child.type) {
        checkNode(child, childPath)
        return
      }
      if (!allowedChildren.includes(child.type)) {
        if (type === 'tableCell' || type === 'tableHeader') {
          errores.push(`Celda de tabla con contenido no permitido: <${child.type}> en ${path}. Solo se admiten párrafos.`)
        } else if (INLINE_PARENTS[child.type] || BLOCK_PARENTS[child.type]) {
          errores.push(`Nodo <${child.type}> no permitido dentro de <${type}> en ${childPath}`)
        }
        // Un tipo desconocido se informa una sola vez, al validar al propio hijo.
      }
      checkNode(child, childPath)
    })
  }

  checkNode(doc, 'doc')
  return { errores, avisos }
}

/** Cantidad de imágenes marcadas con altPendiente: true (para mostrar en la vista de validación). */
export function contarImagenesPendientes(doc: JSONNode): number {
  let n = 0
  const recorrer = (node: JSONNode | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'imagen' && node.attrs?.altPendiente === true) n++
    node.content?.forEach(recorrer)
  }
  recorrer(doc)
  return n
}

export function validateArticleBody(doc: JSONNode, opts?: OpcionesValidacion): string[] {
  return validateArticleBodyDetallado(doc, opts).errores
}
