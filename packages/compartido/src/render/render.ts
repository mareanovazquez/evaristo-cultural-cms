// Renderizador del cuerpo de los artículos: documento JSON de TipTap -> HTML.
// TypeScript puro: sin DOM ni dependencias. Valida con schema/validate.ts (las funciones se re-exportan).
// No emite estilos en línea ni el sprite de íconos: de eso se ocupa el layout (SPRITE_ICONO_VOLVER).
import { isValidVideoId, isVideoProvider, videoEmbedUrl, videoProviderLabel } from './video.ts'
import { isAllowedUrl, isAllowedImageSrc, validateArticleBody, contarImagenesPendientes, type JSONNode } from '../schema/validate.ts'

export { isAllowedUrl, isAllowedImageSrc, validateArticleBody, contarImagenesPendientes }
export type { JSONNode }
export * from './video.ts'

export interface OpcionesRender {
  /** Marca el primer párrafo con "con-capital" si empieza con una letra. Por defecto, false. */
  conCapital?: boolean
  /** Prefijo de los ids de las notas ("ref-N", "nota-N", "notas-titulo"), para varias notas en una misma página. */
  prefijoIds?: string
  /** Medidas de las imágenes de la biblioteca, por imagenId. Sin medida, la imagen sale sin width ni height. */
  dimensionesImagenes?: Map<number, { ancho: number; alto: number }>
}

export interface RenderResult {
  html: string
  notesHtml: string
  footnoteCount: number
}

// Ícono "corner-up-left" de Lucide. El layout lo incluye una vez por página, dentro de un <svg> oculto.
export const SPRITE_ICONO_VOLVER =
  '<symbol id="i-corner-up-left" viewBox="0 0 24 24"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></symbol>'

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderInlineMarks(text: string, marks?: JSONNode['marks']): string {
  let output = escapeHtml(text)
  if (!marks || marks.length === 0) return output

  for (const mark of marks) {
    if (mark.type === 'bold') {
      output = `<strong>${output}</strong>`
    } else if (mark.type === 'italic') {
      output = `<em>${output}</em>`
    } else if (mark.type === 'link') {
      const href = mark.attrs?.href
      if (isAllowedUrl(href)) {
        output = `<a href="${escapeHtml(String(href))}">${output}</a>`
      }
    }
  }
  return output
}

// Contenido en línea de una nota (una nota dentro de una nota no emite nada).
function renderInlineNota(node: JSONNode): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ? renderInlineMarks(node.text, node.marks) : ''
  if (node.type === 'hardBreak') return '<br>'
  if (node.type === 'footnote') return ''
  return (node.content || []).map(renderInlineNota).join('')
}

// Texto visible de un nodo, para decidir el punto final de una nota.
function textoVisible(node: JSONNode): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'footnote') return ''
  return (node.content || []).map(textoVisible).join('')
}

// Termina en . ! ? … con o sin comillas o paréntesis de cierre después.
const TERMINA_EN_PUNTUACION = /[.!?…][\s"'”’»)\]]*$/u

function renderNota(contentDoc: JSONNode, id: number, p: string): string {
  const volver =
    `<a class="nota-volver" href="#${p}ref-${id}" role="doc-backlink" aria-label="Volver al texto (nota ${id})">` +
    `<svg class="icon" aria-hidden="true"><use href="#i-corner-up-left"/></svg></a>`
  const parrafos = (contentDoc?.content ?? []).filter((n) => n.type === 'paragraph')
  // Una nota sin párrafos (no debería pasar: el validador la rechaza) se trata como un único párrafo vacío.
  const bloques: JSONNode[] = parrafos.length ? parrafos : [contentDoc ?? {}]
  const ultimo = bloques[bloques.length - 1] as JSONNode
  const punto = TERMINA_EN_PUNTUACION.test(textoVisible(ultimo)) ? '' : '.'
  const marca = `<span class="nw">${punto}${volver}</span>`

  let cuerpo: string
  if (bloques.length === 1) {
    cuerpo = renderInlineNota(ultimo) + marca
  } else {
    cuerpo = bloques
      .map((b, i) => `<p>${renderInlineNota(b)}${i === bloques.length - 1 ? marca : ''}</p>`)
      .join('')
  }
  return `<li id="${p}nota-${id}">${cuerpo}</li>`
}

function claseDeAlineacion(attrs: Record<string, unknown> | undefined): string {
  const textAlign = attrs?.textAlign
  if (textAlign === 'center') return 'alin-centro'
  if (textAlign === 'justify') return 'alin-justificado'
  return ''
}

function atributoClase(...clases: string[]): string {
  const usadas = clases.filter(Boolean)
  return usadas.length ? ` class="${usadas.join(' ')}"` : ''
}

// El primer carácter visible del párrafo tiene que ser una letra: no vale una llamada a nota, un salto de línea,
// comillas, un número ni un signo.
function empiezaConLetra(parrafo: JSONNode): boolean {
  for (const hijo of parrafo.content ?? []) {
    if (hijo.type !== 'text') return false
    const texto = (hijo.text ?? '').trimStart()
    if (!texto) continue
    return /^\p{L}/u.test(texto)
  }
  return false
}

function nivelDeTitulo(attrs: Record<string, unknown> | undefined): number {
  const nivel = Math.trunc(Number(attrs?.level))
  return Number.isFinite(nivel) ? Math.min(6, Math.max(2, nivel)) : 2
}

function medidaValida(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}

export function renderArticleBody(doc: JSONNode, opciones: OpcionesRender = {}): RenderResult {
  const { conCapital = false, prefijoIds: p = '', dimensionesImagenes } = opciones
  const footnotes: Array<{ id: number; contentDoc: JSONNode }> = []
  let footnoteCounter = 0
  const primerBloque = doc?.type === 'doc' ? doc.content?.[0] : undefined

  function renderNode(node: JSONNode): string {
    if (!node) return ''

    if (node.type === 'text' && node.text) {
      return renderInlineMarks(node.text, node.marks)
    }

    if (node.type === 'footnote') {
      footnoteCounter += 1
      const id = footnoteCounter
      const content = (node.attrs?.content || {}) as JSONNode
      footnotes.push({ id, contentDoc: content })
      return `<sup class="nota-ref" id="${p}ref-${id}"><a href="#${p}nota-${id}" role="doc-noteref" aria-label="Nota ${id}">${id}</a></sup>`
    }

    const childrenHtml = (node.content || []).map(renderNode).join('')

    switch (node.type) {
      case 'doc':
        return childrenHtml
      case 'paragraph': {
        const capital = conCapital && node === primerBloque && empiezaConLetra(node) ? 'con-capital' : ''
        return `<p${atributoClase(claseDeAlineacion(node.attrs), capital)}>${childrenHtml}</p>`
      }
      case 'heading': {
        const level = nivelDeTitulo(node.attrs)
        return `<h${level}${atributoClase(claseDeAlineacion(node.attrs))}>${childrenHtml}</h${level}>`
      }
      case 'hardBreak':
        return '<br>'
      case 'bulletList':
        return `<ul>${childrenHtml}</ul>`
      case 'orderedList':
        return `<ol>${childrenHtml}</ol>`
      case 'listItem':
        return `<li>${childrenHtml}</li>`
      case 'cita': {
        const variante = node.attrs?.variante || 'textual'
        const autor = node.attrs?.autor ? String(node.attrs.autor).trim() : ''
        const fuente = node.attrs?.fuente ? String(node.attrs.fuente).trim() : ''
        const atribucion = [autor, fuente].filter(Boolean).map(escapeHtml).join(', ')

        if (variante === 'destacada') {
          const cite = atribucion ? `<cite>${atribucion}</cite>` : ''
          return `<blockquote class="cita">${childrenHtml}${cite}</blockquote>`
        }

        const caption = atribucion ? `<figcaption>${atribucion}</figcaption>` : ''
        return `<figure class="cita-textual"><blockquote>${childrenHtml}</blockquote>${caption}</figure>`
      }
      case 'imagen': {
        const src = node.attrs?.src
        if (!isAllowedImageSrc(src)) return ''
        const decorativa = node.attrs?.decorativa === true
        // Una imagen con altPendiente sale con alt="" y la marca no aparece en el HTML.
        const alt = decorativa || node.attrs?.altPendiente === true ? '' : String(node.attrs?.alt ?? '')
        const epigrafe = node.attrs?.epigrafe ? String(node.attrs.epigrafe).trim() : ''
        const caption = epigrafe ? `<figcaption>${escapeHtml(epigrafe)}</figcaption>` : ''
        const imagenId = node.attrs?.imagenId
        const medida = typeof imagenId === 'number' ? dimensionesImagenes?.get(imagenId) : undefined
        const dimensiones = medida && medidaValida(medida.ancho) && medidaValida(medida.alto)
          ? ` width="${medida.ancho}" height="${medida.alto}"`
          : ''
        return `<figure><img class="cuerpo-img" src="${escapeHtml(String(src).trim())}" alt="${escapeHtml(alt)}"${dimensiones} loading="lazy">${caption}</figure>`
      }
      case 'video': {
        const provider = node.attrs?.provider
        const id = node.attrs?.id
        if (!isVideoProvider(provider) || !isValidVideoId(provider, id)) return ''
        const title = `Video de ${videoProviderLabel(provider)}`
        return `<figure class="video"><iframe src="${videoEmbedUrl(provider, String(id))}" title="${title}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></figure>`
      }
      case 'table': {
        const rows = node.content || []
        const isHeaderRow = (row: JSONNode) =>
          !!row.content?.length && row.content.every((cell) => cell.type === 'tableHeader')
        const hasHead = rows.length > 0 && isHeaderRow(rows[0] as JSONNode)
        const head = hasHead ? `<thead>${renderNode(rows[0] as JSONNode)}</thead>` : ''
        const bodyRows = (hasHead ? rows.slice(1) : rows).map(renderNode).join('')
        const body = bodyRows ? `<tbody>${bodyRows}</tbody>` : ''
        return `<div class="tabla-scroll"><table>${head}${body}</table></div>`
      }
      case 'tableRow':
        return `<tr>${childrenHtml}</tr>`
      case 'tableHeader':
        return `<th>${childrenHtml}</th>`
      case 'tableCell':
        return `<td>${childrenHtml}</td>`
      default:
        return childrenHtml
    }
  }

  const html = renderNode(doc)

  let notesHtml = ''
  if (footnotes.length > 0) {
    const items = footnotes.map(({ id, contentDoc }) => renderNota(contentDoc, id, p)).join('')
    notesHtml =
      `<section class="notas-al-pie" role="doc-endnotes" aria-labelledby="${p}notas-titulo">` +
      `<h2 id="${p}notas-titulo">Notas</h2><ol>${items}</ol></section>`
  }

  return { html, notesHtml, footnoteCount: footnotes.length }
}
