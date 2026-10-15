/**
 * Conversor de contenido de WordPress (HTML + shortcodes) al documento JSON del editor.
 *
 * Entrada: `post_content` crudo, tal como está en la base.
 * Salida: documento TipTap + avisos de todo lo que no se pudo convertir con seguridad.
 *
 * Pasos:
 *  1. Shortcodes ([caption], [embed], [gallery]) y URLs de video sueltas → marcas HTML.
 *  2. wpautop: los saltos de línea pasan a párrafos, igual que en el sitio viejo.
 *  3. Se interpreta el HTML (parse5) y se emparejan las notas al pie de Word y LibreOffice.
 *  4. HTML → nodos del editor, descartando todo lo que el editor no admite.
 *  5. Notas al pie en texto plano ([1], [2]) y bio tras <hr>.
 */
import { parseFragment } from 'parse5'
import { wpautop } from './wpautop.ts'
import { parseVideoUrl, videoUrl } from './video.ts'
import { isRelativeImageSrc } from '../schema/validate.ts'
import { normalizarTitulo, type Lexico } from './titulos.ts'
import { lexicoPorDefecto } from './lexico-datos.ts'
import { resolverTaxonomia, type MapeoTaxonomias } from './taxonomia.ts'
import type { ConvertOptions, ConvertPostResult, ConvertResult, DocNode, ImageAsset, Mark, Warning } from './types.ts'

/* ------------------------------------------------------------------ */
/* Utilidades de DOM (parse5 se usa con un tipo mínimo propio)         */
/* ------------------------------------------------------------------ */

interface HNode {
  nodeName: string
  tagName?: string
  attrs?: { name: string; value: string }[]
  childNodes?: HNode[]
  parentNode?: HNode | null
  value?: string
}

const tag = (n: HNode) => n.tagName ?? ''
const isEl = (n: HNode) => n.tagName !== undefined
const attr = (n: HNode, name: string) => n.attrs?.find((a) => a.name === name)?.value

function walk(n: HNode, fn: (n: HNode) => void) {
  fn(n)
  for (const c of [...(n.childNodes ?? [])]) walk(c, fn)
}

function textOf(n: HNode): string {
  if (n.nodeName === '#text') return n.value ?? ''
  return (n.childNodes ?? []).map(textOf).join('')
}

function findAll(n: HNode, t: string, out: HNode[] = []): HNode[] {
  for (const c of n.childNodes ?? []) {
    if (tag(c) === t) out.push(c)
    findAll(c, t, out)
  }
  return out
}

function replaceNode(node: HNode, replacement: HNode[]) {
  const parent = node.parentNode
  if (!parent?.childNodes) return
  const i = parent.childNodes.indexOf(node)
  if (i < 0) return
  for (const r of replacement) r.parentNode = parent
  parent.childNodes.splice(i, 1, ...replacement)
}

const unwrap = (node: HNode) => replaceNode(node, [...(node.childNodes ?? [])])

function makeEl(name: string, attrs: Record<string, string> = {}, children: HNode[] = []): HNode {
  return {
    nodeName: name,
    tagName: name,
    attrs: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    childNodes: children,
    parentNode: null,
  }
}

/* ------------------------------------------------------------------ */
/* Contexto y avisos                                                   */
/* ------------------------------------------------------------------ */

interface Ctx {
  warnings: Map<string, Warning>
  stats: Record<string, number>
  images: ImageAsset[]
  internalLinks: string[]
  noteDocs: Map<string, DocNode>
  siteHosts: string[]
}

function warn(ctx: Ctx, code: string, ejemplo?: string) {
  let w = ctx.warnings.get(code)
  if (!w) ctx.warnings.set(code, (w = { code, count: 0, ejemplos: [] }))
  w.count++
  if (ejemplo && w.ejemplos.length < 3) w.ejemplos.push(ejemplo.slice(0, 120))
}
const stat = (ctx: Ctx, key: string, n = 1) => {
  ctx.stats[key] = (ctx.stats[key] ?? 0) + n
}

/* ------------------------------------------------------------------ */
/* 1. Shortcodes → marcas HTML                                         */
/* ------------------------------------------------------------------ */

const decodeAmp = (s: string) => s.replace(/&amp;|&#0?38;|&#x26;/gi, '&')
const embedDiv = (url: string) =>
  `\n\n<div class="wpembed" data-url="${encodeURIComponent(decodeAmp(url))}"></div>\n\n`

function preprocess(raw: string, ctx: Ctx): string {
  let s = raw.replace(/\r\n?/g, '\n')

  // [embed]URL[/embed]
  s = s.replace(/\[embed[^\]]*\]\s*(https?:\/\/[^\s[\]]+)\s*\[\/embed\]/gi, (_m, url: string) => embedDiv(url))

  // URL de YouTube o Vimeo sola en su línea (WordPress la convertía en reproductor).
  s = s.replace(
    /^[ \t]*(https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\/\S+?)[ \t]*$/gim,
    (_m, url: string) => embedDiv(url),
  )

  // [caption ...]<a?><img/></a?> Texto[/caption]
  s = s.replace(/\[caption([^\]]*)\]([\s\S]*?)\[\/caption\]/gi, (_m, attrs: string, inner: string) => {
    const capAttr = /caption="([^"]*)"/i.exec(attrs)?.[1] ?? ''
    const mm = /^\s*((?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*<\/a>)?)\s*([\s\S]*)$/i.exec(inner)
    if (!mm) {
      warn(ctx, 'caption_sin_imagen', inner)
      return `\n\n${inner}\n\n`
    }
    const caption = (mm[2] ?? '').trim() || capAttr
    return `\n\n<figure class="wpcap">${mm[1]}<figcaption>${caption}</figcaption></figure>\n\n`
  })

  // [gallery ...]: no hay galería en el cuerpo del nuevo CMS.
  s = s.replace(/\[gallery[^\]]*\]/gi, () => {
    warn(ctx, 'gallery_shortcode')
    return ''
  })
  return s
}

/* ------------------------------------------------------------------ */
/* 2. Notas al pie ancladas (Word, notas finales de Word, LibreOffice) */
/* ------------------------------------------------------------------ */

interface AnchorInfo {
  el: HNode
  role: 'ref' | 'note'
  key: string
}

function classifyAnchor(n: HNode): AnchorInfo | null {
  const name = attr(n, 'name') ?? attr(n, 'id') ?? ''
  const href = attr(n, 'href') ?? ''
  let m: RegExpExecArray | null
  if ((m = /^#_(ftn|edn)(\d+)$/.exec(href))) return { el: n, role: 'ref', key: `${m[1]}:${m[2]}` }
  if ((m = /^#_(ftn|edn)ref(\d+)$/.exec(href))) return { el: n, role: 'note', key: `${m[1]}:${m[2]}` }
  if ((m = /^_(ftn|edn)ref(\d+)$/.exec(name))) return { el: n, role: 'ref', key: `${m[1]}:${m[2]}` }
  if ((m = /^_(ftn|edn)(\d+)$/.exec(name))) return { el: n, role: 'note', key: `${m[1]}:${m[2]}` }
  if ((m = /^#sdfootnote(\d+)sym$/.exec(href))) return { el: n, role: 'ref', key: `sd:${m[1]}` }
  if ((m = /^#sdfootnote(\d+)anc$/.exec(href))) return { el: n, role: 'note', key: `sd:${m[1]}` }
  if ((m = /^sdfootnote(\d+)anc$/.exec(name))) return { el: n, role: 'ref', key: `sd:${m[1]}` }
  if ((m = /^sdfootnote(\d+)sym$/.exec(name))) return { el: n, role: 'note', key: `sd:${m[1]}` }
  return null
}

const BLOCKISH = new Set(['p', 'div', 'li', 'td', 'th', 'blockquote', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const WRAPPERS = new Set(['sup', 'strong', 'b', 'span', 'em', 'i', 'font', 'small'])

const hasMeaning = (n: HNode): boolean =>
  (n.nodeName === '#text' && (n.value ?? '').replace(/[\s ]/g, '') !== '') ||
  tag(n) === 'img' ||
  (n.childNodes ?? []).some(hasMeaning)

function pruneEmpty(block: HNode | null | undefined) {
  while (block && isEl(block) && ['p', 'div', 'li', 'span', 'sup', 'strong', 'em'].includes(tag(block)) && !hasMeaning(block)) {
    const parent: HNode | null | undefined = block.parentNode
    if (!parent?.childNodes) return
    parent.childNodes.splice(parent.childNodes.indexOf(block), 1)
    block = parent
  }
}

function footnotePass(root: HNode, ctx: Ctx) {
  const anchors: AnchorInfo[] = []
  walk(root, (n) => {
    if (tag(n) === 'a') {
      const info = classifyAnchor(n)
      if (info) anchors.push(info)
    }
  })
  if (anchors.length === 0) return

  const group = (role: 'ref' | 'note') => {
    const m = new Map<string, AnchorInfo[]>()
    for (const a of anchors.filter((x) => x.role === role)) m.set(a.key, [...(m.get(a.key) ?? []), a])
    return m
  }
  const refs = group('ref')
  const notes = group('note')
  const keys = [...new Set([...refs.keys(), ...notes.keys()])]

  const paired = new Set<string>()
  for (const k of keys) {
    const r = refs.get(k) ?? []
    const n = notes.get(k) ?? []
    if (r.length >= 1 && n.length === 1) paired.add(k)
    else if (r.length >= 1 && n.length === 0) warn(ctx, 'marca_sin_nota', k)
    else if (r.length === 0 && n.length >= 1) warn(ctx, 'nota_sin_marca', k)
    else warn(ctx, 'nota_duplicada', k)
  }

  const noteAnchorSet = new Set(anchors.filter((a) => a.role === 'note').map((a) => a.el))
  const containsNoteAnchor = (n: HNode): boolean => {
    let found = false
    walk(n, (x) => {
      if (noteAnchorSet.has(x)) found = true
    })
    return found
  }

  // Notas: se sacan del cuerpo, en orden de aparición.
  const noteOrder = anchors.filter((a) => a.role === 'note' && paired.has(a.key))
  for (const a of noteOrder) {
    // Se recorre desde el ancla hacia arriba, hasta el bloque que la contiene,
    // juntando en cada nivel lo que sigue (el texto de la nota suele quedar
    // dentro del mismo <span>, o en hermanos de un contenedor).
    const content: HNode[] = []
    let cur: HNode = a.el
    let block: HNode | null | undefined = cur.parentNode
    while (block?.childNodes) {
      const idx = block.childNodes.indexOf(cur)
      let i = idx + 1
      const taken: HNode[] = []
      while (i < block.childNodes.length && !containsNoteAnchor(block.childNodes[i]!)) {
        taken.push(block.childNodes[i]!)
        i++
      }
      block.childNodes.splice(idx + 1, taken.length)
      content.push(...taken)
      if (BLOCKISH.has(tag(block)) || block.nodeName === '#document-fragment' || !block.parentNode) break
      cur = block
      block = block.parentNode
    }
    const anchorParent = a.el.parentNode
    if (anchorParent?.childNodes) anchorParent.childNodes.splice(anchorParent.childNodes.indexOf(a.el), 1)
    pruneEmpty(anchorParent)

    const pieces = collectPieces(content, [], ctx)
    const inline = pieces.flatMap((p) => ('inline' in p ? [p.inline] : []))
    if (pieces.some((p) => 'block' in p)) warn(ctx, 'nota_con_bloques', a.key)
    const nodes = finalizeInline(inline)
    if (nodes.length === 0) {
      warn(ctx, 'nota_vacia', a.key)
      paired.delete(a.key)
      continue
    }
    ctx.noteDocs.set(a.key, { type: 'doc', content: [{ type: 'paragraph', content: nodes }] })
  }

  // Marcas: la primera de cada clave pasa a ser la nota; las repetidas quedan como texto.
  for (const [k, list] of refs) {
    list.forEach((a, i) => {
      if (paired.has(k) && ctx.noteDocs.has(k) && i === 0) {
        let target = a.el
        for (let depth = 0; depth < 3; depth++) {
          const p = target.parentNode
          if (p && WRAPPERS.has(tag(p)) && (p.childNodes ?? []).filter(hasMeaning).length === 1) target = p
          else break
        }
        replaceNode(target, [makeEl('fnref', { 'data-key': k })])
      } else {
        unwrap(a.el)
      }
    })
  }
  // Notas sin pareja: el ancla se descarta y queda el texto "[1]".
  for (const a of anchors) {
    if (a.role === 'note' && !(paired.has(a.key) && ctx.noteDocs.has(a.key))) unwrap(a.el)
  }
}

/* ------------------------------------------------------------------ */
/* 3. HTML → nodos del editor                                          */
/* ------------------------------------------------------------------ */

type Piece = { inline: DocNode } | { block: DocNode }

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'hr', 'figure', 'figcaption', 'div', 'pre', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'center', 'dl', 'dd', 'dt',
  'form', 'fieldset', 'details', 'summary', 'address', 'caption', 'main',
])

const normText = (s: string) =>
  s
    .replace(/[­​‌‍⁠﻿]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[ \t\r\n\f]+/g, ' ')

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"«»]+/gi
function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0]
    // Los signos de cierre pegados al final no son parte del enlace.
    while (/[.,;:!?)\]}'”’]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1)
    const start = m.index ?? 0
    if (start > last) out.push({ text: text.slice(last, start) })
    out.push({ text: url, href: url.toLowerCase().startsWith('www.') ? `https://${url}` : url })
    last = start + url.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.length ? out : [{ text }]
}

function normalizeHref(href: string | undefined, ctx: Ctx): string | null {
  if (!href) return null
  const h = href.trim()
  if (!h || h.startsWith('#')) return null
  if (/^(javascript|data|vbscript):/i.test(h)) return null
  let abs: string | null = null
  if (/^(https?:|mailto:)/i.test(h)) abs = h
  else if (h.startsWith('//')) abs = `https:${h}`
  else if (/^www\./i.test(h)) abs = `https://${h}`
  else if (h.startsWith('/')) abs = `https://${ctx.siteHosts[0]}${h}`
  if (!abs) return null
  if (/^https?:/i.test(abs)) {
    try {
      const host = new URL(abs).hostname.toLowerCase().replace(/^www\./, '')
      if (ctx.siteHosts.includes(host) && !/\/wp-content\//.test(abs)) ctx.internalLinks.push(abs)
    } catch {
      return null
    }
  }
  return abs
}

const styleOf = (n: HNode, prop: string): string | undefined => {
  const st = attr(n, 'style')
  if (!st) return undefined
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(st)
  return m?.[1]?.trim().toLowerCase()
}

function alignOf(n: HNode, inherited: string | null, ctx: Ctx): string | null {
  const raw = (styleOf(n, 'text-align') ?? attr(n, 'align') ?? '').toLowerCase()
  if (!raw) return inherited
  if (raw === 'center' || raw === 'justify') return raw
  if (raw === 'right' || raw === 'end') {
    stat(ctx, 'alineacion_derecha_descartada')
    return null
  }
  return null
}

function marksFor(n: HNode, marks: Mark[], ctx: Ctx): Mark[] {
  const t = tag(n)
  const add: Mark['type'][] = []
  if (t === 'strong' || t === 'b') add.push('bold')
  if (t === 'em' || t === 'i' || t === 'cite' || t === 'dfn') add.push('italic')
  if (t === 'u' || t === 'ins') stat(ctx, 'subrayado_descartado')
  const weight = styleOf(n, 'font-weight')
  if (weight && (/^(bold|bolder)$/.test(weight) || Number(weight) >= 600)) add.push('bold')
  const fstyle = styleOf(n, 'font-style')
  if (fstyle && /^(italic|oblique)$/.test(fstyle)) add.push('italic')
  if (/underline/.test(styleOf(n, 'text-decoration') ?? '')) stat(ctx, 'subrayado_descartado')
  if (styleOf(n, 'color')) stat(ctx, 'color_descartado')
  let out = marks
  for (const a of add) if (!out.some((m) => m.type === a)) out = [...out, { type: a }]
  return out
}

function imageNode(img: HNode, ctx: Ctx, linkedHref?: string | null, caption?: string): Piece[] {
  const cls = attr(img, 'class') ?? ''
  const alt = (attr(img, 'alt') ?? '').trim()
  if (/wp-smiley|emoji/.test(cls)) return alt ? [{ inline: { type: 'text', text: alt } }] : []
  const src = (attr(img, 'src') ?? attr(img, 'data-src') ?? '').trim()
  if (!src) {
    warn(ctx, 'imagen_sin_src')
    return []
  }
  if (/^data:/i.test(src)) {
    warn(ctx, 'imagen_data_uri')
    return []
  }
  const linkedIsImage = linkedHref && /\.(jpe?g|png|gif|webp|bmp)(\?.*)?$/i.test(linkedHref)
  const url = linkedIsImage ? (linkedHref as string) : src
  ctx.images.push({ url, ...(url !== src ? { miniatura: src } : {}) })
  if (!alt) warn(ctx, 'imagen_sin_alt', src.split('/').pop()) // la imagen sale con altPendiente: true
  if (isRelativeImageSrc(url)) warn(ctx, 'imagen_ruta_relativa', url)
  stat(ctx, 'imagenes')
  return [{ block: { type: 'imagen', attrs: { src: url, alt, decorativa: false, epigrafe: caption ?? '', ...(alt ? {} : { altPendiente: true }) } } }]
}

function videoOrLink(url: string, ctx: Ctx, code: string): DocNode {
  const v = parseVideoUrl(url)
  if (v) {
    stat(ctx, 'videos')
    return { type: 'video', attrs: { provider: v.provider, id: v.id } }
  }
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    /* se deja la URL tal cual */
  }
  warn(ctx, code, host)
  stat(ctx, 'embeds_a_enlace')
  const href = normalizeHref(url, ctx)
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: url, ...(href ? { marks: [{ type: 'link', attrs: { href } } as Mark] } : {}) }],
  }
}

function collectPieces(children: HNode[], marks: Mark[], ctx: Ctx): Piece[] {
  const out: Piece[] = []
  for (const c of children) {
    if (c.nodeName === '#text') {
      const text = normText(c.value ?? '')
      if (!text) continue
      const inLink = marks.some((m) => m.type === 'link')
      const parts = inLink ? [{ text }] : splitLinks(text)
      for (const p of parts) {
        const href = 'href' in p ? normalizeHref(p.href, ctx) : null
        out.push({
          inline: {
            type: 'text',
            text: p.text,
            ...(href ? { marks: [...marks, { type: 'link', attrs: { href } } as Mark] } : marks.length ? { marks } : {}),
          },
        })
      }
      continue
    }
    if (!isEl(c)) continue
    const t = tag(c)

    if (t === 'br') {
      out.push({ inline: { type: 'hardBreak' } })
    } else if (t === 'fnref') {
      const key = attr(c, 'data-key') ?? ''
      const doc = ctx.noteDocs.get(key)
      if (doc) {
        stat(ctx, 'notas_al_pie')
        out.push({ inline: { type: 'footnote', attrs: { content: doc } } })
      }
    } else if (t === 'img') {
      out.push(...imageNode(c, ctx))
    } else if (t === 'iframe') {
      const src = attr(c, 'src') ?? ''
      out.push({ block: videoOrLink(src.startsWith('//') ? `https:${src}` : src, ctx, 'iframe_a_enlace') })
    } else if (t === 'a') {
      const imgs = findAll(c, 'img')
      const textInside = normText(textOf(c)).trim()
      const href = attr(c, 'href')
      if (imgs.length && !textInside) {
        for (const img of imgs) out.push(...imageNode(img, ctx, href))
        if (href && !/\.(jpe?g|png|gif|webp|bmp)(\?.*)?$/i.test(href) && !href.startsWith('#')) warn(ctx, 'enlace_en_imagen_descartado', href)
      } else {
        const abs = normalizeHref(href, ctx)
        if (!abs && href?.startsWith('#')) warn(ctx, 'ancla_interna', href)
        const m = abs && !marks.some((x) => x.type === 'link') ? [...marks, { type: 'link', attrs: { href: abs } } as Mark] : marks
        out.push(...collectPieces(c.childNodes ?? [], m, ctx))
      }
    } else if (t === 'script' || t === 'style' || t === 'noscript') {
      /* se ignora */
    } else if (BLOCK_TAGS.has(t)) {
      for (const b of blockElement(c, ctx, null)) out.push({ block: b })
    } else {
      out.push(...collectPieces(c.childNodes ?? [], marksFor(c, marks, ctx), ctx))
    }
  }
  return out
}

/** Une textos contiguos con las mismas marcas, ordena espacios y recorta los bordes. */
function finalizeInline(nodes: DocNode[]): DocNode[] {
  const sameMarks = (a?: Mark[], b?: Mark[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  const merged: DocNode[] = []
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!n.text) continue
      const last = merged[merged.length - 1]
      if (last?.type === 'text' && sameMarks(last.marks, n.marks)) last.text += n.text
      else merged.push({ ...n })
    } else if (n.type === 'hardBreak' && merged[merged.length - 1]?.type === 'hardBreak') {
      continue
    } else merged.push(n)
  }
  let prevSpace = true
  for (const n of merged) {
    if (n.type === 'text') {
      let t = (n.text ?? '').replace(/ {2,}/g, ' ')
      if (prevSpace) t = t.replace(/^ /, '')
      n.text = t
      prevSpace = t.endsWith(' ')
    } else prevSpace = n.type === 'hardBreak'
  }
  const out = merged.filter((n) => n.type !== 'text' || n.text !== '')
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!
    if (n.type === 'text' && out[i + 1]?.type === 'hardBreak') n.text = n.text!.replace(/ +$/, '')
  }
  while (out[0]?.type === 'hardBreak') out.shift()
  while (out[out.length - 1]?.type === 'hardBreak') out.pop()
  const last = out[out.length - 1]
  if (last?.type === 'text') last.text = last.text!.replace(/ +$/, '')
  return out.filter((n) => n.type !== 'text' || n.text !== '')
}

function paragraphsFrom(pieces: Piece[], align: string | null): DocNode[] {
  const out: DocNode[] = []
  let run: DocNode[] = []
  const flush = () => {
    const inline = finalizeInline(run)
    run = []
    if (inline.length) out.push({ type: 'paragraph', ...(align ? { attrs: { textAlign: align } } : {}), content: inline })
  }
  for (const p of pieces) {
    if ('inline' in p) run.push(p.inline)
    else {
      flush()
      out.push(p.block)
    }
  }
  flush()
  return out
}

function blocksFromChildren(children: HNode[], ctx: Ctx, align: string | null): DocNode[] {
  const out: DocNode[] = []
  let pending: Piece[] = []
  const flush = () => {
    if (pending.length) out.push(...paragraphsFrom(pending, align))
    pending = []
  }
  for (const c of children) {
    if (isEl(c) && BLOCK_TAGS.has(tag(c))) {
      flush()
      out.push(...blockElement(c, ctx, align))
    } else pending.push(...collectPieces([c], [], ctx))
  }
  flush()
  return out
}

function tableNode(el: HNode, ctx: Ctx): DocNode[] {
  const rows: HNode[] = []
  const caption: DocNode[] = []
  const collect = (n: HNode) => {
    for (const c of n.childNodes ?? []) {
      if (tag(c) === 'tr') rows.push(c)
      else if (['thead', 'tbody', 'tfoot'].includes(tag(c))) collect(c)
      else if (tag(c) === 'caption') caption.push(...blocksFromChildren(c.childNodes ?? [], ctx, null))
    }
  }
  collect(el)
  const matrix: DocNode[][] = []
  for (const tr of rows) {
    const cells: DocNode[] = []
    for (const td of tr.childNodes ?? []) {
      if (tag(td) !== 'td' && tag(td) !== 'th') continue
      if (Number(attr(td, 'colspan') ?? 1) > 1 || Number(attr(td, 'rowspan') ?? 1) > 1) warn(ctx, 'tabla_celdas_combinadas')
      let content = blocksFromChildren(td.childNodes ?? [], ctx, null)
      if (rows.length === 1 && Array.from(tr.childNodes ?? []).filter((x) => tag(x) === 'td' || tag(x) === 'th').length === 1) {
        // Tabla de una sola celda: es maquetación, no una tabla de datos.
        stat(ctx, 'tablas_de_maquetacion_desenvueltas')
        return [...caption, ...content]
      }
      const flat: DocNode[] = []
      const addFlat = (b: DocNode) => {
        if (b.type === 'paragraph') flat.push(b)
        else if (b.type === 'heading') flat.push({ type: 'paragraph', content: b.content })
        else if (b.type === 'cita') for (const q of b.content ?? []) flat.push(q)
        else if (b.type === 'table') { warn(ctx, 'tabla_anidada_aplanada'); for (const r of b.content ?? []) for (const c of r.content ?? []) for (const q of c.content ?? []) flat.push(q) }
        else return false
        return true
      }
      for (const b of content) {
        if (addFlat(b)) continue
        if (false as boolean) flat.push(b)
        else if (b.type === 'bulletList' || b.type === 'orderedList') {
          warn(ctx, 'tabla_con_lista')
          for (const li of b.content ?? []) for (const p of li.content ?? []) if (p.type === 'paragraph') flat.push(p)
        } else warn(ctx, 'tabla_con_bloque_descartado', b.type)
      }
      content = flat.length ? flat : [{ type: 'paragraph' }]
      cells.push({ type: tag(td) === 'th' ? 'tableHeader' : 'tableCell', content })
    }
    if (cells.length) matrix.push(cells)
  }
  if (!matrix.length) return caption
  const width = Math.max(...matrix.map((r) => r.length))
  const tableRows = matrix.map((cells) => ({
    type: 'tableRow',
    content: [...cells, ...Array.from({ length: width - cells.length }, () => ({ type: 'tableCell', content: [{ type: 'paragraph' }] }))],
  }))
  stat(ctx, 'tablas')
  return [...caption, { type: 'table', content: tableRows }]
}

function blockElement(el: HNode, ctx: Ctx, inheritedAlign: string | null): DocNode[] {
  const t = tag(el)
  const align = alignOf(el, inheritedAlign, ctx)
  const kids = el.childNodes ?? []

  switch (t) {
    case 'p':
    case 'figcaption':
    case 'caption':
    case 'summary':
    case 'address':
      return paragraphsFrom(collectPieces(kids, [], ctx), align)

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const n = Number(t[1])
      if (n === 1) stat(ctx, 'h1_bajado_a_h2')
      const level = n <= 2 ? 2 : n === 3 ? 3 : 4
      const pieces = collectPieces(kids, [], ctx)
      let inline = finalizeInline(pieces.flatMap((p) => ('inline' in p ? [p.inline] : [])))
      // hardBreak no se admite en títulos: se reemplaza por un espacio.
      if (inline.some((n) => n.type === 'hardBreak')) {
        warn(ctx, 'salto_en_titulo', inlineText(inline))
        inline = finalizeInline(inline.map((n): DocNode => (n.type === 'hardBreak' ? { type: 'text', text: ' ' } : n)))
      }
      const blocks = pieces.flatMap((p) => ('block' in p ? [p.block] : []))
      stat(ctx, 'titulos_internos')
      return [
        ...(inline.length ? [{ type: 'heading', attrs: { level, ...(align ? { textAlign: align } : {}) }, content: inline }] : []),
        ...blocks,
      ]
    }

    case 'ul':
    case 'ol': {
      const items: DocNode[] = []
      for (const li of kids) {
        if (tag(li) !== 'li') continue
        const raw = blocksFromChildren(li.childNodes ?? [], ctx, align)
        const content = raw.filter((b) => ['paragraph', 'bulletList', 'orderedList'].includes(b.type))
        for (const b of raw) if (!content.includes(b)) { warn(ctx, 'bloque_en_lista_descartado', b.type); stat(ctx, 'bloques_en_lista_descartados') }
        const first = content[0]
        if (!first) continue
        if (first.type !== 'paragraph') content.unshift({ type: 'paragraph' })
        items.push({ type: 'listItem', content })
      }
      if (!items.length) return []
      stat(ctx, 'listas')
      return [{ type: t === 'ul' ? 'bulletList' : 'orderedList', content: items }]
    }

    case 'blockquote': {
      const inner = blocksFromChildren(kids, ctx, align)
      const paras = inner.filter((b) => b.type === 'paragraph')
      const others = inner.filter((b) => b.type !== 'paragraph')
      if (!paras.length) return others
      stat(ctx, 'citas')
      return [{ type: 'cita', attrs: { variante: 'textual', autor: '', fuente: '' }, content: paras }, ...others]
    }

    case 'table':
      return tableNode(el, ctx)

    case 'hr':
      return [{ type: '__hr' }]

    case 'figure': {
      if ((attr(el, 'class') ?? '').includes('wpcap')) {
        const img = findAll(el, 'img')[0]
        const figcaption = findAll(el, 'figcaption')[0]
        if (!img) return paragraphsFrom(collectPieces(kids, [], ctx), align)
        const a = findAll(el, 'a').find((x) => findAll(x, 'img').length > 0)
        let caption = ''
        if (figcaption) {
          caption = normText(textOf(figcaption)).trim()
          if (findAll(figcaption, 'a').length || findAll(figcaption, 'em').length || findAll(figcaption, 'strong').length || findAll(figcaption, 'i').length || findAll(figcaption, 'b').length)
            warn(ctx, 'epigrafe_con_formato_perdido', caption)
        }
        const pieces = imageNode(img, ctx, a ? attr(a, 'href') : null, caption)
        if (caption) stat(ctx, 'imagenes_con_epigrafe')
        return pieces.flatMap((p) => ('block' in p ? [p.block] : []))
      }
      return blocksFromChildren(kids, ctx, align)
    }

    case 'div': {
      if ((attr(el, 'class') ?? '').includes('wpembed')) {
        const url = decodeURIComponent(attr(el, 'data-url') ?? '')
        return [videoOrLink(url, ctx, 'embed_a_enlace')]
      }
      return blocksFromChildren(kids, ctx, align)
    }

    case 'center':
      return blocksFromChildren(kids, ctx, 'center')

    case 'pre': {
      warn(ctx, 'pre_a_parrafos')
      return textOf(el)
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l.trim() }] }))
    }

    default:
      return blocksFromChildren(kids, ctx, align)
  }
}

/* ------------------------------------------------------------------ */
/* 4. Posproceso: notas en texto plano, bio y limpieza                 */
/* ------------------------------------------------------------------ */

const inlineText = (nodes: DocNode[] = []): string =>
  nodes.map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? ' ' : '')).join('')

/**
 * Notas al pie escritas como texto plano: marcas "[1]" en el cuerpo y párrafos
 * "[1] texto" más abajo. Solo se convierten si la numeración es consecutiva y cada
 * marca aparece una única vez y antes de su nota. Si no, no se toca nada.
 */
function plainTextFootnotes(blocks: DocNode[], ctx: Ctx) {
  const labelRe = /^\s*\[(\d{1,3})\]\s*/
  const noteIdx: number[] = []
  let expected = 1
  blocks.forEach((b, i) => {
    if (b.type !== 'paragraph') return
    const first = b.content?.[0]
    if (first?.type !== 'text') return
    const m = labelRe.exec(first.text ?? '')
    if (m && Number(m[1]) === expected) {
      noteIdx.push(i)
      expected++
    }
  })
  const k = noteIdx.length
  if (k === 0) return
  const noteSet = new Set(noteIdx)

  type Occ = { block: number; node: number; offset: number; len: number }
  const occ = new Map<number, Occ[]>()
  blocks.forEach((b, bi) => {
    if (noteSet.has(bi) || b.type !== 'paragraph') return
    b.content?.forEach((n, ni) => {
      if (n.type !== 'text') return
      for (const m of (n.text ?? '').matchAll(/\[(\d{1,3})\]/g)) {
        const num = Number(m[1])
        if (num >= 1 && num <= k) occ.set(num, [...(occ.get(num) ?? []), { block: bi, node: ni, offset: m.index ?? 0, len: m[0].length }])
      }
    })
  })
  let ok = true
  let prev: Occ | null = null
  for (let n = 1; n <= k && ok; n++) {
    const list = occ.get(n) ?? []
    const o = list[0]
    if (list.length !== 1 || !o || o.block >= noteIdx[n - 1]!) ok = false
    else if (prev && (o.block < prev.block || (o.block === prev.block && (o.node < prev.node || (o.node === prev.node && o.offset < prev.offset))))) ok = false
    else prev = o
  }
  if (!ok) {
    warn(ctx, 'notas_texto_plano_ambiguas', `${k} notas`)
    return
  }

  const noteDocs = noteIdx.map((bi) => {
    const content = structuredClone(blocks[bi]!.content ?? [])
    const first = content[0]!
    first.text = (first.text ?? '').replace(labelRe, '')
    return { type: 'doc', content: [{ type: 'paragraph', content: finalizeInline(content) }] } as DocNode
  })
  const refs: Occ[] = []
  for (let n = 1; n <= k; n++) refs.push(occ.get(n)![0]!)
  for (let n = k; n >= 1; n--) {
    const o = refs[n - 1]!
    const par = blocks[o.block]!
    const node = par.content![o.node]!
    const before = node.text!.slice(0, o.offset)
    const after = node.text!.slice(o.offset + o.len)
    const parts: DocNode[] = []
    if (before) parts.push({ ...node, text: before })
    parts.push({ type: 'footnote', attrs: { content: noteDocs[n - 1] } })
    if (after) parts.push({ ...node, text: after })
    par.content!.splice(o.node, 1, ...parts)
  }
  for (const bi of [...noteIdx].reverse()) blocks.splice(bi, 1)
  stat(ctx, 'notas_al_pie', k)
  stat(ctx, 'notas_texto_plano', k)
}

const BIO_RE =
  /\b(nació|nace en|es (?:escritor|escritora|poeta|poetisa|licenciad[oa]|profesor|profesora|periodista|traductor|traductora|doctor|doctora|artista|director|directora|docente|investigador|investigadora|músico|fotógraf[oa]|dramaturg[oa]|narrador|narradora|cineasta|editor|editora|crítico|crítica|historiador|historiadora|antropólog[oa]|sociólog[oa]|filósof[oa]|actor|actriz|ilustrador|ilustradora|dibujante|guionista|ensayista)|publicó|autor[a]? de|colabora|dirige|coordina|estudió|egresad[oa])/i

function extractBio(blocks: DocNode[], ctx: Ctx): DocNode[] | null {
  let lastHr = -1
  blocks.forEach((b, i) => {
    if (b.type === '__hr') lastHr = i
  })
  let bio: DocNode[] | null = null
  if (lastHr >= 0) {
    const tail = blocks.slice(lastHr + 1)
    const paras = tail.filter((b) => b.type === 'paragraph')
    if (tail.length > 0 && tail.length <= 5 && tail.every((b) => b.type === 'paragraph' || b.type === 'imagen') && paras.some((p) => BIO_RE.test(inlineText(p.content)))) {
      bio = tail
      blocks.splice(lastHr)
      stat(ctx, 'bio_extraida')
    }
  }
  if (!bio) {
    const last = [...blocks].reverse().find((b) => b.type === 'paragraph')
    const txt = inlineText(last?.content)
    if (last && BIO_RE.test(txt) && txt.length < 900) warn(ctx, 'bio_posible_en_el_cuerpo', txt.slice(0, 100))
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]!.type === '__hr') {
      blocks.splice(i, 1)
      stat(ctx, 'hr_descartados')
    }
  }
  return bio
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export function convertWpContent(raw: string, options: ConvertOptions = {}): ConvertResult {
  const ctx: Ctx = {
    warnings: new Map(),
    stats: {},
    images: [],
    internalLinks: [],
    noteDocs: new Map(),
    siteHosts: options.siteHosts ?? ['evaristocultural.com.ar', 'evaristocultural.ar'],
  }

  const html = wpautop(preprocess(raw, ctx))
  const root = parseFragment(html) as unknown as HNode
  if (/<sup[\s>]/i.test(html)) walk(root, (n) => tag(n) === 'sup' && /^\s*\[?\d{1,3}\]?\s*$/.test(textOf(n)) && warn(ctx, 'sup_numerico_sin_ancla', textOf(n)))

  footnotePass(root, ctx)
  const blocks = blocksFromChildren(root.childNodes ?? [], ctx, null)
  plainTextFootnotes(blocks, ctx)
  const bio = extractBio(blocks, ctx)

  const clean = blocks.filter((b) => !(b.type === 'paragraph' && !b.content?.length))
  if (!clean.length) {
    warn(ctx, 'contenido_vacio')
    clean.push({ type: 'paragraph' })
  }

  const plain = clean.map((b) => inlineText(b.content)).join(' ')
  if (/Editorial\s*:/.test(plain) && /(P[aá]ginas?|ISBN|Año)\s*:/.test(plain)) stat(ctx, 'ficha_libro_en_texto')
  if (/(Direcci[oó]n|Elenco|Int[eé]rpretes)\s*:/.test(plain)) stat(ctx, 'ficha_obra_en_texto')

  return {
    doc: { type: 'doc', content: clean },
    bio,
    warnings: [...ctx.warnings.values()],
    assets: { images: ctx.images, internalLinks: [...new Set(ctx.internalLinks)] },
    stats: ctx.stats,
  }
}

export interface ConvertPostOptions extends ConvertOptions {
  /** display_name del autor en WordPress: sirve para detectar el autor dentro del título. */
  autor?: string | null
  /** Léxico de títulos; por defecto, el de data/lexico-titulos.csv. */
  lexico?: Lexico
  /** Categorías de WordPress del artículo y el mapeo a la taxonomía nueva (data/mapeo-taxonomias.json). Sin esto, seccion = null. */
  taxonomia?: { id: number; slugs: string[]; mapeo: MapeoTaxonomias }
}

/**
 * Convierte un artículo completo: el cuerpo con convertWpContent (sin cambios) y el título con normalizarTitulo.
 * El título no pasa por la validación del cuerpo.
 */
export function convertWpPost(post: { titulo: string; contenido_crudo: string }, options: ConvertPostOptions = {}): ConvertPostResult {
  const { autor, lexico, taxonomia, ...opcionesCuerpo } = options
  const cuerpo = convertWpContent(post.contenido_crudo, opcionesCuerpo)
  const t = normalizarTitulo(post.titulo, autor, lexico ?? lexicoPorDefecto())
  const tax = taxonomia ? resolverTaxonomia(taxonomia.id, taxonomia.slugs, taxonomia.mapeo, post.titulo) : null
  return { ...cuerpo, titulo: t.titulo, bajada: t.bajada, avisosTitulo: t.avisos, seccion: tax?.seccion ?? null, categorias: tax?.categorias ?? [], categoriaPrincipal: tax?.categoriaPrincipal ?? null, taxonomia: tax, novedadHasta: null }
}

export { parseVideoUrl, videoUrl }
