// Integración del título normalizado en el conversor, con artículos reales de la muestra (fixtures/muestra-wordpress.json)
// y el léxico versionado (data/lexico-titulos.csv).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { convertWpContent, convertWpPost } from '../convert.ts'
import { validateArticleBody } from '../../schema/validate.ts'
import { aCsv, aFormatoOracion, COLUMNAS_LEXICO, construirLexico, filasLexico, lexicoDesdeCsv, normalizarTitulo, recortarLexico } from '../titulos.ts'
import { lexicoPorDefecto } from '../lexico-datos.ts'

let ok = 0
const t = (name: string, fn: () => void) => { fn(); ok++; console.log('ok', name) }

const muestra: Array<{ id: number; titulo: string; autor: string; contenido_crudo: string }> = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/muestra-wordpress.json', import.meta.url)), 'utf8'))
const articulo = (id: number) => muestra.find((m) => m.id === id)!
const conv = (id: number) => { const m = articulo(id); return convertWpPost(m, { autor: m.autor }) }
const resumen = (id: number) => { const r = conv(id); return { titulo: r.titulo, bajada: r.bajada, avisosTitulo: r.avisosTitulo } }

t('sin_barra: título normalizado y bajada vacía (12939)', () => {
  assert.equal(articulo(12939).titulo, 'UNA CARTA PARA MOMO')
  assert.deepEqual(resumen(12939), { titulo: 'Una carta para Momo', bajada: '', avisosTitulo: [] })
})
t('dividido: título y bajada normalizados (1555)', () => {
  assert.deepEqual(resumen(1555), { titulo: 'La literatura no vuelve más a Japón', bajada: 'Entrevista a Guillermo Quartucci', avisosTitulo: [] })
})
t('dividido con aviso de revisión: nombre fuera del corpus (3433 "DESPOJOS DE GUERRA | HA JIN")', () => {
  assert.deepEqual(resumen(3433), { titulo: 'Despojos de guerra', bajada: 'Ha Jin', avisosTitulo: ['palabra_ambigua:JIN'] })
})
t('posible_autor: no se divide, " | " conservado y aviso revisar_autor_en_titulo (22255)', () => {
  assert.equal(articulo(22255).titulo, 'FEDERICO RACCA | LA FLOR DEL DIENTE DE LEÓN')
  assert.deepEqual(resumen(22255), { titulo: 'Federico Racca | La flor del diente de León', bajada: '', avisosTitulo: ['palabra_ambigua:LEÓN', 'revisar_autor_en_titulo'] })
  assert.equal(normalizarTitulo(articulo(22255).titulo, articulo(22255).autor, lexicoPorDefecto()).accion, 'posible_autor')
})
t('autor_en_titulo: el autor de WordPress está en el título (14791)', () => {
  assert.equal(articulo(14791).autor, 'Mercedes Roffe')
  assert.deepEqual(resumen(14791), { titulo: 'Mercedes Roffé | Poesía', bajada: '', avisosTitulo: ['revisar_autor_en_titulo'] })
  assert.equal(normalizarTitulo(articulo(14791).titulo, articulo(14791).autor, lexicoPorDefecto()).accion, 'autor_en_titulo')
})
t('título vacío: "" con aviso titulo_vacio, sin inventar nada', () => {
  const r = convertWpPost({ titulo: '', contenido_crudo: articulo(12939).contenido_crudo })
  assert.deepEqual([r.titulo, r.bajada, r.avisosTitulo], ['', '', ['titulo_vacio']])
  const real = fileURLToPath(new URL('../../../posts.json', import.meta.url))
  if (existsSync(real)) { // posts.json no se versiona: solo si está
    const posts: Array<{ id: number; titulo: string; contenido_crudo: string }> = JSON.parse(readFileSync(real, 'utf8'))
    for (const id of [5562, 5602]) {
      const p = posts.find((x) => x.id === id)!
      assert.deepEqual([p.titulo, convertWpPost(p).titulo, convertWpPost(p).avisosTitulo], ['', '', ['titulo_vacio']])
    }
  }
})
t('barra_vacia (18633): se saca la barra inicial y se conservan los avisos', () => {
  const r = convertWpPost({ titulo: '| Entrevista a Juan Mendoza', contenido_crudo: 'x' })
  assert.deepEqual([r.titulo, r.bajada, r.avisosTitulo], ['Entrevista a Juan Mendoza', '', ['barra_sin_espacios', 'barra_vacia']])
  assert.deepEqual(convertWpPost({ titulo: 'ENTREVISTA A JUAN MENDOZA |', contenido_crudo: 'x' }).titulo, 'Entrevista a Juan Mendoza') // formato oración
})
t('el cuerpo no cambia: convertWpPost devuelve lo mismo que convertWpContent y el doc sigue validando', () => {
  for (const m of muestra) {
    const { titulo, bajada, avisosTitulo, seccion, categorias, categoriaPrincipal, taxonomia, novedadHasta, ...cuerpo } = convertWpPost(m, { autor: m.autor })
    assert.deepEqual(cuerpo, convertWpContent(m.contenido_crudo), String(m.id))
    assert.deepEqual(validateArticleBody(cuerpo.doc as any, { modo: 'migracion' }), [], String(m.id))
    assert.equal(typeof titulo + typeof bajada, 'stringstring')
    assert.equal(Array.isArray(avisosTitulo), true)
    assert.deepEqual([seccion, categorias, categoriaPrincipal, taxonomia, novedadHasta], [null, [], null, null, null])
  }
})
t('el léxico del CSV da los mismos resultados que el léxico en memoria', () => {
  const cuerpos = ['<p>' + Array(3).fill('Luego vio a Zoe Marín con la mar y el gato, y la Plata, la plata.').join(' ') + '</p>', '<p>' + Array(6).fill('Luego habló de la educación.').join(' ') + '</p>']
  const lex = construirLexico(['Entrevista a Zoe Marín'], ['Zoe Pérez'], cuerpos)
  const copia = lexicoDesdeCsv(aCsv(COLUMNAS_LEXICO, filasLexico(lex)))
  for (const x of ['ZOE MARÍN Y LA MAR', 'LA EDUCACION', 'VER LA PLATA', 'EL GATO DE XYZ']) assert.deepEqual(aFormatoOracion(x, copia), aFormatoOracion(x, lex), x)
  assert.deepEqual([...copia.nombresDePila], [...lex.nombresDePila])
  assert.throws(() => lexicoDesdeCsv('"a";"b"\r\n'), /columnas inesperadas/)
})

t('léxico recortado: mismo resultado que el completo para los títulos del corpus, y mucho más chico', () => {
  const cuerpos = ['<p>' + Array(3).fill('Luego vio a Zoe Marín con la mar y el gato, y la Plata, la plata, y la casa de la mar.').join(' ') + '</p>', '<p>' + Array(6).fill('Luego habló de la educación y de otras cosas sin importancia.').join(' ') + '</p>']
  const titulos = ['ZOE MARÍN | LA MAR', 'LA EDUCACION', 'VER LA PLATA', 'EL GATO DE XYZ', 'Entrevista a Zoe Marín']
  const lex = construirLexico(titulos, ['Zoe Pérez'], cuerpos)
  const corto = lexicoDesdeCsv(aCsv(COLUMNAS_LEXICO, filasLexico(recortarLexico(lex, titulos, ['Zoe Pérez']))))
  assert.equal(corto.entradas.has('importancia'), false) // no está en ningún título
  assert.equal(corto.entradas.has('educacion'), true)
  assert.equal(corto.tildes.get('educacion'), 'educación')
  for (const x of titulos) assert.deepEqual(normalizarTitulo(x, 'Zoe Pérez', corto), normalizarTitulo(x, 'Zoe Pérez', lex), x)
})

console.log(`${ok} pruebas de integración de títulos ok`)
