// Pruebas de la resolución de sección y categorías (data/mapeo-taxonomias.json).
import assert from 'node:assert/strict'
import { convertWpPost } from '../convert.ts'
import { cargarMapeo, categoriaPrincipal, esEntrevista, resolverTaxonomia, validarCategoriaPrincipal, validarMapeo } from '../taxonomia.ts'

const m = cargarMapeo()
let ok = 0
const t = (name: string, fn: () => void) => { fn(); ok++; console.log('ok', name) }
const r = (id: number, ...slugs: string[]) => resolverTaxonomia(id, slugs, m)
const rt = (id: number, titulo: string, ...slugs: string[]) => resolverTaxonomia(id, slugs, m, titulo)
const sc = (x: ReturnType<typeof r>) => [x.seccion, x.categorias]

t('seda -> Asia', () => assert.deepEqual(sc(r(1, 'seda')), ['asia', []]))
t('Rastros gana a Reseña y el ganador no se repite', () => assert.deepEqual(sc(r(1, 'resena', 'rastros', 'mexico')), ['rastros', ['resena']]))
t('Asia gana a Reseña y a Ensayo', () => assert.deepEqual(sc(r(1, 'resena', 'ensayo', 'seda')), ['asia', ['resena', 'ensayo']]))
t('Reseñas Rastros + Rastros: sección Rastros, categoría Reseña una sola vez', () => assert.deepEqual(sc(r(1, 'resenas-rastros', 'rastros')), ['rastros', ['resena']]))
t('Reseñas Seda -> Asia + categoría Reseña; Reseñas Rastros -> Rastros + categoría Reseña', () => {
  assert.deepEqual(sc(r(1, 'resenas-seda')), ['asia', ['resena']])
  assert.deepEqual(sc(r(1, 'resenas-rastros')), ['rastros', ['resena']])
})
t('Reseña gana a Ensayo, Crónica y temas', () => assert.deepEqual(sc(r(1, 'literatura', 'cronica', 'resena', 'ensayo')), ['resena', ['ensayo', 'cronica', 'literatura']]))
t('variantes de reseña con tema: sección Reseña, el tema pasa a categoría', () => {
  assert.deepEqual(sc(r(1, 'resenas-historietas')), ['resena', ['historieta']])
  assert.deepEqual(sc(r(1, 'resenas-fantastico', 'literatura')), ['resena', ['fantastico', 'literatura']])
})
t('prioridad de tema: Rastros > Asia > Música > Literatura', () => assert.deepEqual(sc(r(1, 'literatura', 'musica', 'seda', 'rastros')), ['rastros', ['asia', 'musica', 'literatura']]))
t('Entrevista: título que empieza con "Entrevista", sin distinguir mayúsculas', () => {
  for (const tit of ['Entrevista a Inés Garland', 'ENTREVISTA A YASUKATA TSUTSUI', 'entrevista Javier Galarza', '  Entrevista: Loris Z']) assert.equal(esEntrevista(1, tit, m), true, tit)
  for (const tit of ['Entrevistas de género negro', 'Una entrevista a alguien', 'La entrevista', 'Sin relación', '']) assert.equal(esEntrevista(1, tit, m), false, tit)
})
t('Entrevista: también el tramo tras " | " (y con el primero vacío)', () => {
  assert.equal(esEntrevista(1, 'LA ESTRUCTURA IMPOSIBLE | Entrevista a Inés Garland', m), true)
  assert.equal(esEntrevista(1, '| Entrevista a Juan Mendoza', m), true)
  assert.equal(esEntrevista(1, 'TÍTULO | Un texto | Entrevista a alguien', m), false) // solo se revisan dos tramos
  assert.equal(esEntrevista(1, 'TÍTULO | Una bajada con entrevista adentro', m), false)
})
t('Entrevista gana a Reseña, Ensayo, Crónica y temas; el resto pasa a categorías', () => {
  const x = rt(1, 'TÍTULO | Entrevista a X', 'literatura', 'resena', 'ensayo')
  assert.deepEqual([x.seccion, x.categorias, x.esEntrevista], ['entrevista', ['resena', 'ensayo', 'literatura'], true])
})
t('Rastros y Asia ganan a Entrevista', () => {
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'rastros', 'poesia')), ['rastros', ['entrevista', 'poesia']])
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'seda')), ['asia', ['entrevista']])
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'resenas-seda')), ['asia', ['resena', 'entrevista']])
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'rastros', 'seda')), ['rastros', ['entrevista', 'asia']])
})
t('Entrevista sin categoría de sección (solo Uncategorized): sección Entrevista, no sin-asignar', () => {
  const x = rt(18633, '| Entrevista a Juan Mendoza', 'uncategorized')
  assert.deepEqual([x.seccion, x.sinAsignar, x.categorias], ['entrevista', false, []])
})
t('excepciones por id de Entrevista: 2388 y 19565 sí; 648, 9485 y 20919 no', () => {
  assert.deepEqual(sc(rt(2388, 'SERENGUETI: Entrevista a Ramiro Torres de Miguel', 'teatro')), ['entrevista', ['teatro']])
  assert.deepEqual(sc(rt(19565, 'UNA ENTREVISTA A BANANA YOSHIMOTO', 'poesia')), ['entrevista', ['poesia']])
  assert.deepEqual(sc(rt(19565, 'UNA ENTREVISTA A BANANA YOSHIMOTO', 'seda')), ['asia', ['entrevista']]) // sí es entrevista, pero Asia pasa antes
  assert.deepEqual(sc(rt(648, 'LA ENTREVISTA', 'historieta', 'mexico', 'resenas-historietas')), ['resena', ['historieta']])
  assert.equal(esEntrevista(648, 'Entrevista a quien sea', m), false) // el id manda sobre el patrón
  assert.deepEqual(sc(rt(9485, 'VIERNES 29 19HS PRESENTACIÓN DE RASTROS | Entrevistas de género negro', 'rastros')), ['rastros', []])
  assert.deepEqual(sc(rt(20919, 'ENTREVISTA CON MUERTOS', 'poesia')), ['poesia', []]) // el patrón lo detectaría; el id lo excluye
  assert.equal(rt(20919, 'ENTREVISTA CON MUERTOS', 'rastros').esEntrevista, false)
  assert.equal(esEntrevista(20920, 'ENTREVISTA CON MUERTOS', m), true) // otro id con el mismo título: sí
})
t('sin título no hay Entrevista (compatibilidad)', () => assert.deepEqual(sc(r(1, 'poesia')), ['poesia', []]))
t('series-tv -> TV & Cine', () => assert.deepEqual(sc(r(1, 'series-tv')), ['tv-cine', []]))
t('México solo, Novedades solo, Uncategorized y Artículos -> sin-asignar', () => {
  for (const s of ['mexico', 'novedades', 'uncategorized', 'articulos']) assert.deepEqual([r(1, s).seccion, r(1, s).sinAsignar], ['sin-asignar', true])
})
t('México con otra sección: se descarta', () => assert.deepEqual(sc(r(1, 'mexico', 'poesia')), ['poesia', []]))
t('poesia-rumana con poesia: sección Poesía + categoría', () => assert.deepEqual(sc(r(1, 'poesia', 'poesia-rumana')), ['poesia', ['poesia-rumana']]))
t('sin candidatas -> sin-asignar (Novedades + Uncategorized, con título común)', () => {
  const x = rt(7, 'Un título cualquiera', 'novedades', 'uncategorized')
  assert.deepEqual([x.seccion, x.sinAsignar, x.esEntrevista, x.candidatas], ['sin-asignar', true, false, []])
})
t('excepción por id 21482 -> Fantástico + categoría del encuentro', () => {
  const x = r(21482, 'encuentro-internacional-literatura-fantastica')
  assert.deepEqual([x.seccion, x.categorias, x.excepcion, x.sinAsignar], ['fantastico', ['encuentro-internacional-literatura-fantastica'], true, false])
  assert.deepEqual(sc(rt(21482, 'EL REY OSCURO', 'encuentro-internacional-literatura-fantastica')), ['fantastico', ['encuentro-internacional-literatura-fantastica']])
  assert.equal(r(5, 'encuentro-internacional-literatura-fantastica').sinAsignar, true) // no es regla general
})
t('varias candidatas y taxonomía sin mapear', () => {
  assert.equal(r(1, 'seda', 'musica').variasCandidatas, true)
  assert.equal(r(1, 'seda').variasCandidatas, false)
  assert.deepEqual(r(1, 'nueva', 'seda').sinMapear, ['nueva'])
})
t('Novedades registra el id', () => assert.deepEqual(r(1, 'novedades', 'poesia').registrarEn, ['novedades-ids']))
t('es determinista (re-ejecutable)', () => assert.deepEqual(r(1, 'musica', 'seda', 'literatura'), r(1, 'literatura', 'seda', 'musica')))
const cp = (...cats: string[]) => categoriaPrincipal(cats, m)
t('categoría principal: sin categorías -> null', () => {
  assert.equal(cp(), null)
  assert.equal(r(1, 'poesia').categoriaPrincipal, null) // la sección ganadora no cuenta como categoría
  assert.equal(r(1, 'novedades').categoriaPrincipal, null)
})
t('categoría principal: con una sola categoría, esa', () => {
  assert.equal(cp('literatura'), 'literatura')
  assert.equal(cp('poesia-rumana'), 'poesia-rumana')
  assert.equal(r(1, 'resena', 'rastros').categoriaPrincipal, 'resena')
})
t('categoría principal: con dos o más, la primera según la prioridad de secciones', () => {
  assert.equal(cp('literatura', 'musica', 'asia'), 'asia')
  assert.equal(cp('resena', 'rastros', 'entrevista'), 'rastros')
  assert.equal(cp('cronica', 'ensayo'), 'ensayo')
  assert.equal(cp('literatura', 'poesia', 'teatro'), 'poesia')
  assert.deepEqual(r(1, 'literatura', 'musica', 'seda', 'rastros').categorias, ['asia', 'musica', 'literatura'])
  assert.equal(r(1, 'literatura', 'musica', 'seda', 'rastros').categoriaPrincipal, 'asia') // sección Rastros; categorías Asia, Música, Literatura
  assert.equal(rt(1, 'Entrevista a X', 'resena', 'ensayo').categoriaPrincipal, 'resena') // sección Entrevista
})
t('categoría principal: una fuera de la lista junto a una de la lista -> gana la de la lista', () => {
  assert.equal(cp('poesia-rumana', 'literatura'), 'literatura')
  assert.equal(cp('literatura', 'encuentro-internacional-literatura-fantastica'), 'literatura')
  const x = r(1, 'poesia', 'poesia-rumana', 'literatura')
  assert.deepEqual([x.seccion, x.categorias, x.categoriaPrincipal], ['poesia', ['literatura', 'poesia-rumana'], 'literatura'])
})
t('categoría principal: dos fuera de la lista -> alfabético, sin distinguir tildes ni mayúsculas, sin depender del orden', () => {
  // "Encuentro Internacional Literatura Fantástica" < "Poesía rumana"
  assert.equal(cp('poesia-rumana', 'encuentro-internacional-literatura-fantastica'), 'encuentro-internacional-literatura-fantastica')
  assert.equal(cp('encuentro-internacional-literatura-fantastica', 'poesia-rumana'), 'encuentro-internacional-literatura-fantastica')
  // slugs no catalogados: se comparan tal cual, ignorando tildes y mayúsculas
  assert.equal(cp('zeta', 'Ánfora', 'beta'), 'Ánfora')
  assert.equal(cp('árbol', 'Arbol2', 'arbol'), 'arbol') // empate de base: desempata el slug
})
t('categoría principal: siempre está entre las categorías finales, o es null si no hay', () => {
  const casos: Array<[string[], string | null]> = [
    [[], null], [['arte'], 'arte'], [['arte', 'poesia-rumana'], 'arte'], [['poesia-rumana', 'encuentro-internacional-literatura-fantastica'], 'encuentro-internacional-literatura-fantastica'],
  ]
  for (const [cats, esperada] of casos) { const x = categoriaPrincipal(cats, m); assert.equal(x, esperada); validarCategoriaPrincipal(cats, x) }
  assert.throws(() => validarCategoriaPrincipal(['arte'], 'musica'), /categoría principal inválida/)
  assert.throws(() => validarCategoriaPrincipal(['arte'], null), /categoría principal inválida/)
  assert.throws(() => validarCategoriaPrincipal([], 'arte'), /categoría principal inválida/)
  // todas las combinaciones de slugs de WordPress mapeados cumplen la invariante
  const slugs = Object.keys(m.taxonomiasWp)
  for (const a of slugs) for (const b of slugs) for (const titulo of ['', 'Entrevista a X']) {
    const x = rt(1, titulo, a, b); validarCategoriaPrincipal(x.categorias, x.categoriaPrincipal)
  }
})
t('categoría principal en convertWpPost y sin taxonomía', () => {
  const p = { titulo: 'Un título', contenido_crudo: '<p>hola</p>' }
  assert.equal(convertWpPost(p, { taxonomia: { id: 1, slugs: ['resenas-seda'], mapeo: m } }).categoriaPrincipal, 'resena')
  assert.equal(convertWpPost(p, { taxonomia: { id: 1, slugs: ['seda'], mapeo: m } }).categoriaPrincipal, null)
  assert.equal(convertWpPost(p).categoriaPrincipal, null)
})
t('mapeo inválido se rechaza', () => {
  const sinEnt = structuredClone(m); sinEnt.entrevista.seccion = 'inexistente'
  assert.throws(() => validarMapeo(sinEnt), /entrevista/)
  const malPatron = structuredClone(m); malPatron.entrevista.patronTitulo = '(['
  assert.throws(() => validarMapeo(malPatron), /patronTitulo/)
  const malo = structuredClone(m); malo.taxonomiasWp.seda!.seccion = 'inexistente'
  assert.throws(() => validarMapeo(malo), /inexistente/)
})
t('convertWpPost: novedadHasta null y sección; sin taxonomía, seccion null', () => {
  const p = { titulo: 'Un título', contenido_crudo: '<p>hola</p>' }
  const a = convertWpPost(p, { taxonomia: { id: 1, slugs: ['seda'], mapeo: m } })
  assert.deepEqual([a.novedadHasta, a.seccion, a.categorias], [null, 'asia', []])
  const e = convertWpPost({ titulo: 'ÉNFASIS | Entrevista a Fulano', contenido_crudo: '<p>hola</p>' }, { taxonomia: { id: 1, slugs: ['poesia'], mapeo: m } })
  assert.deepEqual([e.seccion, e.categorias], ['entrevista', ['poesia']]) // usa el título crudo
  const b = convertWpPost(p)
  assert.deepEqual([b.novedadHasta, b.seccion], [null, null])
  assert.deepEqual(b.doc, a.doc) // el cuerpo no cambia
})
console.log(`${ok} pruebas de taxonomía ok`)
