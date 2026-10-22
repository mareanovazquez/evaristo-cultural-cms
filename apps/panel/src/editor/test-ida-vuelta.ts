// Prueba de ida y vuelta del editor: los cuerpos migrados que están en evaristo_cms_dev se cargan en TipTap, se vuelven a
// serializar con getJSON() y tienen que dar el mismo contenido. Solo LEE; corre únicamente contra evaristo_cms_dev (3308).
//
// Qué se ignora al comparar (en los dos lados, para que una pérdida de datos igual aparezca):
//  - el orden de las claves (MySQL reordena las del JSON);
//  - el orden de las marcas de un texto (TipTap las ordena por su esquema: <em><strong> pasa a <strong><em>, que se ve igual);
//  - los atributos que el editor agrega con su valor por defecto: textAlign "left", altPendiente false, decorativa false,
//    epigrafe "" e imagenId null; colspan y rowspan 1 en las celdas; start 1 y type null en las listas ordenadas; class, rel, target y title null en los enlaces.
// Toda otra diferencia (o un valor que no sea el de por defecto) es un fallo.
//
// Uso: npm run test:editor (corre esta prueba después de test-editor.ts)
import assert from 'node:assert/strict'
import { dom as _dom } from './entorno-jsdom'

void _dom
function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`)
  process.exit(1)
}

// Solo contra la base de desarrollo, igual que la API (src/entorno.ts).
const urlDev = process.env['DATABASE_URL_DEV']
if (!urlDev) fallar('falta DATABASE_URL_DEV en el entorno (.env)')
const u = new URL(urlDev)
if (u.port !== '3308' || decodeURIComponent(u.pathname.slice(1)) !== 'evaristo_cms_dev') fallar('esta prueba solo corre contra evaristo_cms_dev en el 3308')
process.env['DATABASE_URL'] = urlDev

const { Editor } = await import('@tiptap/core')
const { getEditorExtensions } = await import('./extensions')
const { obtenerClientePrisma } = await import('@evaristo/compartido/db')
const { validateArticleBody } = await import('@evaristo/compartido/schema')
const { sinAltPendienteFalso } = await import('./imagen-alt')
type Doc = import('@evaristo/compartido/schema').JSONNode

const PREDETERMINADOS: Record<string, Record<string, unknown>> = {
  '*': { textAlign: 'left', altPendiente: false, decorativa: false, epigrafe: '', imagenId: null, colspan: 1, rowspan: 1 },
  orderedList: { start: 1, type: null },
  link: { class: null, rel: null, target: null, title: null },
}

/** Forma canónica: claves ordenadas y sin los atributos que valen su valor por defecto. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico)
  if (valor && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>
    const tipo = typeof objeto['type'] === 'string' ? objeto['type'] : ''
    const salida: Record<string, unknown> = {}
    for (const clave of Object.keys(objeto).sort()) {
      const v = objeto[clave]
      if (clave === 'attrs' && v && typeof v === 'object') {
        const attrs = canonico(v) as Record<string, unknown>
        for (const [k, porDefecto] of Object.entries({ ...PREDETERMINADOS['*'], ...PREDETERMINADOS[tipo] })) if (k in attrs && attrs[k] === porDefecto) delete attrs[k]
        if (Object.keys(attrs).length > 0) salida[clave] = attrs
      } else if (clave === 'marks' && Array.isArray(v)) {
        salida[clave] = v.map(canonico).sort((x, y) => String((x as { type: string }).type).localeCompare(String((y as { type: string }).type)))
      } else {
        salida[clave] = canonico(v)
      }
    }
    return salida
  }
  return valor
}

/** Primera diferencia entre dos valores canónicos, con su ruta. */
function diferencia(a: unknown, b: unknown, ruta = '$'): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = diferencia(a[i], b[i], `${ruta}[${i}]`)
      if (d) return d
    }
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = diferencia((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${ruta}.${k}`)
      if (d) return d
    }
  }
  return `${ruta}: original ${JSON.stringify(a)?.slice(0, 160)} / editor ${JSON.stringify(b)?.slice(0, 160)}`
}

const prisma = obtenerClientePrisma()
const articulos = await prisma.articulo.findMany({ select: { id: true, cuerpo: true }, orderBy: { id: 'asc' } })
assert.ok(articulos.length >= 1, 'no hay artículos en evaristo_cms_dev')

let imagenes = 0
const fallos: string[] = []
for (const articulo of articulos) {
  const original = articulo.cuerpo as unknown as Doc
  imagenes += JSON.stringify(original).split('"type":"imagen"').length - 1
  const editor = new Editor({ element: document.getElementById('editor')!, extensions: getEditorExtensions(), content: original })
  const devuelto = sinAltPendienteFalso(editor.getJSON() as Doc)
  editor.destroy()
  const d = diferencia(canonico(original), canonico(devuelto))
  if (d) fallos.push(`artículo ${articulo.id}: ${d}`)
  const errores = validateArticleBody(devuelto)
  if (errores.length > 0) fallos.push(`artículo ${articulo.id}: el validador estricto rechaza lo que devuelve el editor: ${errores[0]}`)
}

await prisma.$disconnect()
if (fallos.length > 0) {
  for (const f of fallos) console.error(f)
  fallar(`${fallos.length} de ${articulos.length} cuerpos no volvieron iguales`)
}
console.log(`ok ida y vuelta: ${articulos.length} cuerpos (${imagenes} imágenes con su imagenId) vuelven iguales y pasan el modo estricto`)
process.exit(0)
