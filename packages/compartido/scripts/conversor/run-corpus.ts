import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { convertWpPost } from '../../src/conversor/convert.ts'
import { aCsv } from '../../src/conversor/titulos.ts'
import { cargarMapeo, urlVieja } from '../../src/conversor/taxonomia.ts'
import { validateArticleBodyDetallado, type ModoValidacion } from '../../src/schema/validate.ts'
import type { DocNode } from '../../src/conversor/types.ts'

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url))
// Uso: run-corpus.ts [posts.json] [salida] [--modo=migracion|estricto]  (por defecto: migracion)
const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith('--'))
const modo = (args.find((a) => a.startsWith('--modo='))?.slice(7) ?? 'migracion') as ModoValidacion
if (modo !== 'migracion' && modo !== 'estricto') { console.error(`--modo inválido: ${modo}`); process.exit(1) }
const posts = JSON.parse(readFileSync(positional[0] ?? root('../../posts.json'), 'utf8'))
const out = positional[1] ?? root('../../out')
mkdirSync(out, { recursive: true })

// Autor de WordPress por artículo (out/autor-por-post.json, de scripts/extraer-autores-por-post.ts): hace falta para detectar el autor dentro del título.
let autorDe = new Map<number, string | null>()
try { autorDe = new Map(JSON.parse(readFileSync(root('../../out/autor-por-post.json'), 'utf8')).map((a: any) => [a.id, a.autor])) } catch {
  console.warn('Aviso: no hay out/autor-por-post.json; no se detectará el autor dentro del título (autor_en_titulo). Generalo con scripts/extraer-autores-por-post.ts')
}
// Categorías de WordPress por artículo (out/categorias-por-post.json, de scripts/consultar-categorias.ts) y mapeo a la taxonomía nueva.
const mapeo = cargarMapeo()
let categoriasDe: Map<number, string[]> | null = null
try { categoriasDe = new Map(Object.entries(JSON.parse(readFileSync(root('../../out/categorias-por-post.json'), 'utf8'))).map(([id, c]) => [Number(id), c as string[]])) } catch {
  console.warn('Aviso: no hay out/categorias-por-post.json; no se asignan secciones ni categorías. Generalo con scripts/consultar-categorias.ts')
}
const nombreWp = (slug: string) => mapeo.taxonomiasWp[slug]?.nombre ?? slug
const filasSinAsignar: Array<Array<string | number>> = [], filasMultiples: Array<Array<string | number>> = [], filasClasificacion: Array<Array<string | number>> = []
const registros = new Map<string, Array<Array<string | number>>>()
const porSeccion: Record<string, number> = {}
const porCategoriaPrincipal: Record<string, number> = {}
const porCantidadCategorias: Record<string, number> = {}
const sinMapear: Record<string, number> = {}
let variasCandidatas = 0, porExcepcion = 0
/** Avisos del título que requieren revisión humana. */
const REVISION_HUMANA = new Set(['palabra_desconocida', 'palabra_ambigua', 'revisar_autor_en_titulo', 'titulo_vacio'])
const filasAvisos: Array<Array<string | number>> = []

const dec = (s: string) => s.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'")
  .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
  .replace(/&([a-z]+);/gi,(m,n)=>({aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ',Aacute:'Á',Eacute:'É',Iacute:'Í',Oacute:'Ó',Uacute:'Ú',Ntilde:'Ñ',uuml:'ü',hellip:'…',ndash:'–',mdash:'—',laquo:'«',raquo:'»',ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’',iexcl:'¡',iquest:'¿'} as any)[n] ?? m)
const isContent = (t: string) => !/^\d{1,2}$/.test(t) && !/^(?:i{1,3}|iv|vi{0,3}|ix|x{1,3}|xi{1,3})$/.test(t)
const tok = (s: string) => (s.normalize('NFC').replace(/­/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
function srcTokens(raw: string) {
  let s = raw.replace(/\[caption[^\]]*\]/g,' ').replace(/\[\/caption\]/g,' ').replace(/\[embed\][\s\S]*?\[\/embed\]/g,' ').replace(/\[gallery[^\]]*\]/g,' ')
  s = s.replace(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)[^\s<"']*/g,' ').replace(/<iframe[\s\S]*?<\/iframe>/g,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style)[\s\S]*?<\/\1>/g,' ').replace(/<img\b[^>]*>/g,' ')
  s = s.replace(/<\/?(?:span|em|strong|i|b|a|sup|sub|font|u|small|big|cite|abbr|mark)\b[^>]*>/gi,'').replace(/<[^>]+>/g,' ')
  return tok(dec(s)).filter(isContent)
}
function docText(n: DocNode | DocNode[], acc: string[] = []): string[] {
  if (Array.isArray(n)) { n.forEach(x => docText(x, acc)); return acc }
  if (n.text) acc.push(n.text)
  if (n.type === 'imagen' && n.attrs?.epigrafe) acc.push(String(n.attrs.epigrafe))
  if (n.type === 'cita') { if (n.attrs?.autor) acc.push(String(n.attrs.autor)); if (n.attrs?.fuente) acc.push(String(n.attrs.fuente)) }
  if (n.type === 'footnote') docText(n.attrs!.content as DocNode, acc)
  n.content?.forEach(c => docText(c, acc))
  return acc
}

const report: any[] = []
const codeTotals: Record<string, { articulos: number; total: number }> = {}
const statTotals: Record<string, number> = {}
let crashes = 0, invalid = 0
const sampleIds = new Set<number>()
const muestraPath = root('../../src/conversor/tests/fixtures/muestra-wordpress.json')
try { for (const m of JSON.parse(readFileSync(muestraPath, 'utf8'))) sampleIds.add(m.id) } catch (e: any) {
  console.error(`No se pudo leer la muestra ${muestraPath}: ${e.message}`); process.exit(1)
}
const sampleOut: any[] = []
const avisosValidador: Record<string, number> = {}
const normMsg = (e: string) => e.replace(/^bio: /, '').replace(/ en doc.*$/, '').replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N')
console.log(`modo de validación: ${modo}`)

for (const p of posts) {
  let r
  const slugsWp = categoriasDe?.get(p.id)
  if (categoriasDe && !slugsWp) console.warn(`Aviso: el artículo ${p.id} no figura en categorias-por-post.json`)
  try { r = convertWpPost(p, { autor: autorDe.get(p.id) ?? null, taxonomia: categoriasDe ? { id: p.id, slugs: slugsWp ?? [], mapeo } : undefined }) } catch (e: any) {
    crashes++; report.push({ id: p.id, slug: p.slug, crash: String(e.stack ?? e).slice(0, 300) }); continue
  }
  const tax = r.taxonomia
  if (tax) {
    const originales = (slugsWp ?? []).map(nombreWp).join(' + ')
    const base = [p.id, p.titulo, p.fecha, urlVieja(mapeo, p.id), originales]
    porSeccion[tax.seccion] = (porSeccion[tax.seccion] ?? 0) + 1
    const clavePrincipal = tax.categoriaPrincipal ?? 'null'
    porCategoriaPrincipal[clavePrincipal] = (porCategoriaPrincipal[clavePrincipal] ?? 0) + 1
    const claveCantidad = tax.categorias.length >= 2 ? '2+' : String(tax.categorias.length)
    porCantidadCategorias[claveCantidad] = (porCantidadCategorias[claveCantidad] ?? 0) + 1
    for (const s of tax.sinMapear) sinMapear[s] = (sinMapear[s] ?? 0) + 1
    if (tax.excepcion) porExcepcion++
    if (tax.sinAsignar) filasSinAsignar.push(base)
    if (tax.variasCandidatas) { variasCandidatas++; filasMultiples.push([...base, tax.candidatas.join(' + '), tax.seccion, tax.categorias.join(' + ')]) }
    filasClasificacion.push([p.id, p.titulo, p.fecha, originales, tax.seccion, tax.categorias.join(' + '), tax.categoriaPrincipal ?? '', tax.excepcion ? 'sí' : 'no'])
    for (const f of tax.registrarEn) { if (!registros.has(f)) registros.set(f, []); registros.get(f)!.push([p.id, p.titulo, p.fecha, tax.seccion]) }
  }
  const val = validateArticleBodyDetallado(r.doc as any, { modo })
  const errs = [...val.errores]
  const avisosVal = [...val.avisos]
  if (r.bio) { const vb = validateArticleBodyDetallado({ type: 'doc', content: r.bio } as any, { modo }); errs.push(...vb.errores.map((e) => `bio: ${e}`)); avisosVal.push(...vb.avisos) }
  if (errs.length) invalid++
  for (const a of new Set(avisosVal.map(normMsg))) avisosValidador[a] = (avisosValidador[a] ?? 0) + 1
  const a = srcTokens(p.contenido_crudo)
  const b = tok(docText([r.doc, ...(r.bio ?? [])]).join(' '))
  const cnt = new Map<string, number>(); for (const t of b) cnt.set(t, (cnt.get(t) ?? 0) + 1)
  let lost = 0; const lostEx: string[] = []
  for (const t of a) { const c = cnt.get(t) ?? 0; if (c > 0) cnt.set(t, c - 1); else { lost++; if (lostEx.length < 8) lostEx.push(t) } }
  let extra = 0; for (const v of cnt.values()) extra += v
  for (const w of r.warnings) { const c = (codeTotals[w.code] ??= { articulos: 0, total: 0 }); c.articulos++; c.total += w.count }
  for (const [k, v] of Object.entries(r.stats)) statTotals[k] = (statTotals[k] ?? 0) + v
  for (const w of r.warnings) filasAvisos.push([p.id, p.slug, 'cuerpo', w.code, w.count, 'no', w.ejemplos.join(' | ')])
  for (const av of r.avisosTitulo) { const [codigo, ...detalle] = av.split(':'); filasAvisos.push([p.id, p.slug, 'titulo', codigo!, 1, REVISION_HUMANA.has(codigo!) ? 'sí' : 'no', detalle.join(':')]) }
  const row = { id: p.id, slug: p.slug, seccion: r.seccion, categorias: r.categorias, categoriaPrincipal: r.categoriaPrincipal, novedadHasta: r.novedadHasta, titulo: r.titulo, bajada: r.bajada, avisosTitulo: r.avisosTitulo, palabras: a.length, perdidas: lost, extra, pctPerdido: a.length ? +(lost / a.length * 100).toFixed(2) : 0, perdidasEj: lostEx, invalido: errs.slice(0, 5), avisosValidador: avisosVal.slice(0, 5), warnings: r.warnings, stats: r.stats }
  report.push(row)
  if (sampleIds.has(p.id)) sampleOut.push({ id: p.id, slug: p.slug, seccion: r.seccion, categorias: r.categorias, categoriaPrincipal: r.categoriaPrincipal, novedadHasta: r.novedadHasta, titulo: r.titulo, bajada: r.bajada, avisosTitulo: r.avisosTitulo, doc: r.doc, bio: r.bio, warnings: r.warnings, assets: r.assets })
}
writeFileSync(`${out}/reporte-por-articulo.json`, JSON.stringify(report, null, 1))
// Una fila por aviso (del cuerpo o del título); revision_humana = sí en los avisos del título que hay que mirar a mano.
writeFileSync(`${out}/avisos-por-articulo.csv`, aCsv(['id', 'slug', 'origen', 'codigo', 'cantidad', 'revision_humana', 'detalle'], filasAvisos))
writeFileSync(`${out}/muestra-convertida.json`, JSON.stringify(sampleOut, null, 1))
if (categoriasDe) {
  const encabezadoBase = ['id', 'titulo', 'fecha', 'url_vieja', 'taxonomias_originales']
  writeFileSync(`${out}/sin-asignar.csv`, aCsv(encabezadoBase, filasSinAsignar))
  writeFileSync(`${out}/secciones-multiples.csv`, aCsv([...encabezadoBase, 'candidatas', 'seccion', 'categorias'], filasMultiples))
  writeFileSync(`${out}/clasificacion-por-articulo.csv`, aCsv(['id', 'titulo', 'fecha', 'taxonomias_originales', 'seccion', 'categorias', 'categoria_principal', 'excepcion_por_id'], filasClasificacion))
  for (const [nombre, filas] of registros) writeFileSync(`${out}/${nombre}.csv`, aCsv(['id', 'titulo', 'fecha', 'seccion_resultante'], filas))
  const resumen = {
    articulos: posts.length,
    porSeccion: Object.fromEntries([...mapeo.secciones.map((s) => s.slug), mapeo.seccionSinAsignar.slug].map((s) => [s, porSeccion[s] ?? 0])),
    sinAsignar: porSeccion[mapeo.seccionSinAsignar.slug] ?? 0,
    porCategoriaPrincipal,
    porCantidadCategorias,
    conVariasSeccionesOriginales: variasCandidatas,
    porExcepcionPorId: porExcepcion,
    taxonomiasSinMapear: sinMapear,
    idsRegistrados: Object.fromEntries([...registros].map(([f, filas]) => [f, filas.length])),
  }
  writeFileSync(`${out}/reporte-taxonomias.json`, JSON.stringify(resumen, null, 1))
  console.log('taxonomía:', JSON.stringify(resumen, null, 1))
}
console.log({ articulos: posts.length, crashes, invalidos: invalid })
console.log("perdida>1%:", report.filter(r=>r.pctPerdido>1).length, " perdida>0:", report.filter(r=>r.perdidas>0).length)
console.log("warnings:", codeTotals)
console.log("stats:", statTotals)
console.log("peores:", report.filter(r=>r.perdidas>0).sort((a,b)=>b.pctPerdido-a.pctPerdido).slice(0,15).map(r=>[r.id,r.slug.slice(0,30),r.pctPerdido,r.perdidasEj.join(",")]))
console.log("invalidos ej:", report.filter(r=>r.invalido?.length).slice(0,10).map(r=>[r.id,r.invalido[0]]))
console.log("crash ej:", report.filter(r=>r.crash).slice(0,3))

console.log("avisos del validador (artículos):", avisosValidador)
const ic: Record<string, number> = {}; for (const r of report) for (const e of new Set<string>((r.invalido ?? []).map(normMsg))) ic[e]=(ic[e]??0)+1
console.log("tipos de invalidez:", ic)
