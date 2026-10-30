// Pruebas de la resolución de sección y categorías (data/mapeo-taxonomias.json).
// Modelo (decisión 78): la sección es el formato (o histórica); los temas son categorías y no repiten secciones;
// sin formato pero con tema o marca de Novedades -> Textos; sin ninguna señal -> sin-asignar.
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
t('Rastros gana a Reseña y la perdedora se descarta (no pasa a categoría)', () => assert.deepEqual(sc(r(1, 'resena', 'rastros', 'mexico')), ['rastros', []]))
t('Asia gana a Reseña y a Ensayo', () => assert.deepEqual(sc(r(1, 'resena', 'ensayo', 'seda')), ['asia', []]))
t('Reseñas Seda -> Asia; Reseñas Rastros -> Rastros (Reseña no se repite como categoría)', () => {
  assert.deepEqual(sc(r(1, 'resenas-seda')), ['asia', []])
  assert.deepEqual(sc(r(1, 'resenas-rastros')), ['rastros', []])
  assert.deepEqual(sc(r(1, 'resenas-rastros', 'rastros')), ['rastros', []])
})
t('Reseña gana a Ensayo y Crónica; el tema queda como categoría', () => assert.deepEqual(sc(r(1, 'literatura', 'cronica', 'resena', 'ensayo')), ['resena', ['literatura']]))
t('Ensayo gana a Crónica', () => assert.deepEqual(sc(r(1, 'cronica', 'ensayo')), ['ensayo', []]))
t('variantes de reseña con tema: sección Reseña, el tema es categoría', () => {
  assert.deepEqual(sc(r(1, 'resenas-historietas')), ['resena', ['historieta']])
  assert.deepEqual(sc(r(1, 'resenas-fantastico', 'literatura')), ['resena', ['fantastico', 'literatura']])
})
t('los temas ya no son secciones: sin formato van a Textos con su tema como categoría', () => {
  assert.deepEqual(sc(r(1, 'poesia')), ['textos', ['poesia']])
  assert.deepEqual(sc(r(1, 'literatura', 'musica')), ['textos', ['musica', 'literatura']])
  assert.equal(r(1, 'poesia').sinAsignar, false)
})
t('los temas no le ganan al formato: Música + Seda -> Asia, sin categorías de sección', () => assert.deepEqual(sc(r(1, 'literatura', 'musica', 'seda', 'rastros')), ['rastros', ['musica', 'literatura']]))
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
t('Entrevista gana a Reseña, Ensayo y Crónica; los temas quedan como categorías', () => {
  const x = rt(1, 'TÍTULO | Entrevista a X', 'literatura', 'resena', 'ensayo')
  assert.deepEqual([x.seccion, x.categorias, x.esEntrevista], ['entrevista', ['literatura'], true])
})
t('Rastros y Asia ganan a Entrevista', () => {
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'rastros', 'poesia')), ['rastros', ['poesia']])
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'seda')), ['asia', []])
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'resenas-seda')), ['asia', []])
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'rastros', 'seda')), ['rastros', []])
})
t('Entrevista sin categoría de sección (solo Uncategorized): sección Entrevista, no sin-asignar', () => {
  const x = rt(18633, '| Entrevista a Juan Mendoza', 'uncategorized')
  assert.deepEqual([x.seccion, x.sinAsignar, x.categorias], ['entrevista', false, []])
})
t('excepciones por id de Entrevista: 2388 y 19565 sí; 648, 9485 y 20919 no', () => {
  assert.deepEqual(sc(rt(2388, 'SERENGUETI: Entrevista a Ramiro Torres de Miguel', 'teatro')), ['entrevista', ['teatro']])
  assert.deepEqual(sc(rt(19565, 'UNA ENTREVISTA A BANANA YOSHIMOTO', 'poesia')), ['entrevista', ['poesia']])
  assert.deepEqual(sc(rt(19565, 'UNA ENTREVISTA A BANANA YOSHIMOTO', 'seda')), ['asia', []]) // sí es entrevista, pero Asia pasa antes
  assert.deepEqual(sc(rt(648, 'LA ENTREVISTA', 'historieta', 'mexico', 'resenas-historietas')), ['resena', ['historieta']])
  assert.equal(esEntrevista(648, 'Entrevista a quien sea', m), false) // el id manda sobre el patrón
  assert.deepEqual(sc(rt(9485, 'VIERNES 29 19HS PRESENTACIÓN DE RASTROS | Entrevistas de género negro', 'rastros')), ['rastros', []])
  assert.deepEqual(sc(rt(20919, 'ENTREVISTA CON MUERTOS', 'poesia')), ['textos', ['poesia']]) // el patrón lo detectaría; el id lo excluye
  assert.equal(rt(20919, 'ENTREVISTA CON MUERTOS', 'rastros').esEntrevista, false)
  assert.equal(esEntrevista(20920, 'ENTREVISTA CON MUERTOS', m), true) // otro id con el mismo título: sí
})
t('sin título no hay Entrevista (compatibilidad)', () => assert.deepEqual(sc(r(1, 'poesia')), ['textos', ['poesia']]))
t('series-tv -> categoría TV & Cine', () => assert.deepEqual(sc(r(1, 'series-tv')), ['textos', ['tv-y-cine']]))
t('México solo, Uncategorized y Artículos -> sin-asignar', () => {
  for (const s of ['mexico', 'uncategorized', 'articulos']) assert.deepEqual([r(1, s).seccion, r(1, s).sinAsignar], ['sin-asignar', true])
})
t('México con otra taxonomía: se descarta', () => {
  assert.deepEqual(sc(r(1, 'mexico', 'poesia')), ['textos', ['poesia']])
  assert.deepEqual(sc(r(1, 'mexico', 'resena')), ['resena', []])
})
t('poesia-rumana: categoría; sola va a Textos, con Poesía suma las dos', () => {
  assert.deepEqual(sc(r(1, 'poesia', 'poesia-rumana')), ['textos', ['poesia', 'poesia-rumana']])
  assert.deepEqual(sc(r(1, 'poesia-rumana')), ['textos', ['poesia-rumana']])
})
t('Novedades sola -> Textos con marca de novedad (no sin-asignar)', () => {
  const x = r(1, 'novedades')
  assert.deepEqual([x.seccion, x.sinAsignar, x.categorias, x.novedad], ['textos', false, [], true])
})
t('Novedades con formato o tema: conserva la sección que le toca y marca la novedad', () => {
  assert.deepEqual(sc(r(1, 'novedades', 'resena')), ['resena', []])
  assert.equal(r(1, 'novedades', 'resena').novedad, true)
  assert.deepEqual(sc(r(1, 'novedades', 'poesia')), ['textos', ['poesia']])
  assert.deepEqual(sc(rt(1, 'Entrevista a X', 'novedades')), ['entrevista', []])
  assert.equal(rt(1, 'Entrevista a X', 'novedades').novedad, true)
})
t('sin Novedades no hay marca; Novedades + Uncategorized -> Textos', () => {
  assert.equal(r(1, 'poesia').novedad, false)
  assert.equal(r(1, 'seda').novedad, false)
  const x = rt(7, 'Un título cualquiera', 'novedades', 'uncategorized')
  assert.deepEqual([x.seccion, x.sinAsignar, x.esEntrevista, x.candidatas, x.novedad], ['textos', false, false, [], true])
})
t('excepción por id 21482 -> Textos con Fantástico y la categoría del encuentro', () => {
  const x = r(21482, 'encuentro-internacional-literatura-fantastica')
  assert.deepEqual([x.seccion, x.categorias, x.excepcion, x.sinAsignar], ['textos', ['fantastico', 'encuentro-internacional-literatura-fantastica'], true, false])
  assert.deepEqual(sc(rt(21482, 'EL REY OSCURO', 'encuentro-internacional-literatura-fantastica')), ['textos', ['fantastico', 'encuentro-internacional-literatura-fantastica']])
  assert.deepEqual(sc(r(5, 'encuentro-internacional-literatura-fantastica')), ['textos', ['encuentro-internacional-literatura-fantastica']]) // otro id: solo la categoría
})
t('varias candidatas y taxonomía sin mapear', () => {
  assert.equal(r(1, 'seda', 'resena').variasCandidatas, true)
  assert.equal(r(1, 'seda', 'musica').variasCandidatas, false) // la música es categoría, no candidata
  assert.equal(r(1, 'seda').variasCandidatas, false)
  assert.deepEqual(r(1, 'nueva', 'seda').sinMapear, ['nueva'])
})
t('Novedades registra el id', () => assert.deepEqual(r(1, 'novedades', 'poesia').registrarEn, ['novedades-ids']))
t('es determinista (re-ejecutable)', () => assert.deepEqual(r(1, 'musica', 'seda', 'literatura'), r(1, 'literatura', 'seda', 'musica')))
const cp = (...cats: string[]) => categoriaPrincipal(cats, m)
t('categoría principal: sin categorías -> null', () => {
  assert.equal(cp(), null)
  assert.equal(r(1, 'seda').categoriaPrincipal, null)
  assert.equal(r(1, 'resena', 'rastros').categoriaPrincipal, null)
  assert.equal(r(1, 'novedades').categoriaPrincipal, null)
})
t('categoría principal: con una sola categoría, esa', () => {
  assert.equal(cp('literatura'), 'literatura')
  assert.equal(cp('poesia-rumana'), 'poesia-rumana')
  assert.equal(r(1, 'poesia').categoriaPrincipal, 'poesia')
  assert.equal(r(1, 'resenas-historietas').categoriaPrincipal, 'historieta')
})
t('categoría principal: con dos o más, la primera según prioridadCategorias', () => {
  assert.equal(cp('literatura', 'musica', 'arte'), 'musica')
  assert.equal(cp('literatura', 'poesia', 'teatro'), 'poesia')
  assert.equal(cp('arte', 'historieta'), 'historieta')
  assert.deepEqual(r(1, 'literatura', 'musica', 'seda', 'rastros').categorias, ['musica', 'literatura'])
  assert.equal(r(1, 'literatura', 'musica', 'seda', 'rastros').categoriaPrincipal, 'musica') // sección Rastros; categorías Música y Literatura
  assert.equal(rt(1, 'Entrevista a X', 'arte', 'teatro').categoriaPrincipal, 'teatro') // sección Entrevista
})
t('categoría principal: una fuera de la lista junto a una de la lista -> gana la de la lista', () => {
  assert.equal(cp('poesia-rumana', 'literatura'), 'literatura')
  assert.equal(cp('literatura', 'encuentro-internacional-literatura-fantastica'), 'literatura')
  const x = r(1, 'poesia', 'poesia-rumana', 'literatura')
  assert.deepEqual([x.seccion, x.categorias, x.categoriaPrincipal], ['textos', ['poesia', 'literatura', 'poesia-rumana'], 'poesia'])
  const y = r(1, 'poesia-rumana', 'literatura')
  assert.deepEqual([y.categorias, y.categoriaPrincipal], [['literatura', 'poesia-rumana'], 'literatura'])
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
t('ninguna categoría repite una sección, en ninguna combinación', () => {
  const secciones = new Set(m.secciones.map((s) => s.slug))
  const slugs = Object.keys(m.taxonomiasWp)
  for (const a of slugs) for (const b of slugs) for (const titulo of ['', 'Entrevista a X']) {
    const x = rt(1, titulo, a, b)
    for (const c of x.categorias) assert.equal(secciones.has(c), false, `${a} + ${b}: la categoría "${c}" repite una sección`)
    assert.ok(secciones.has(x.seccion) || x.sinAsignar, `${a} + ${b}: sección desconocida "${x.seccion}"`)
  }
})
t('categoría principal en convertWpPost y sin taxonomía', () => {
  const p = { titulo: 'Un título', contenido_crudo: '<p>hola</p>' }
  assert.equal(convertWpPost(p, { taxonomia: { id: 1, slugs: ['resenas-historietas'], mapeo: m } }).categoriaPrincipal, 'historieta')
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
  const repite = structuredClone(m); repite.categorias.push({ slug: 'asia', nombre: 'Asia' })
  assert.throws(() => validarMapeo(repite), /repite una sección/)
  const sinComodin = structuredClone(m); sinComodin.seccionSinFormato = 'inexistente'
  assert.throws(() => validarMapeo(sinComodin), /sin formato/)
  const comodinEnPrioridad = structuredClone(m); comodinEnPrioridad.prioridadSecciones.push('textos')
  assert.throws(() => validarMapeo(comodinEnPrioridad), /sin formato/)
  const prioCat = structuredClone(m); prioCat.prioridadCategorias.push('inexistente')
  assert.throws(() => validarMapeo(prioCat), /prioridadCategorias/)
})
t('convertWpPost: sección y categorías; novedadHasta sigue null (la fecha la pone el armado); sin taxonomía, seccion null', () => {
  const p = { titulo: 'Un título', contenido_crudo: '<p>hola</p>' }
  const a = convertWpPost(p, { taxonomia: { id: 1, slugs: ['seda'], mapeo: m } })
  assert.deepEqual([a.novedadHasta, a.seccion, a.categorias], [null, 'asia', []])
  const e = convertWpPost({ titulo: 'ÉNFASIS | Entrevista a Fulano', contenido_crudo: '<p>hola</p>' }, { taxonomia: { id: 1, slugs: ['poesia'], mapeo: m } })
  assert.deepEqual([e.seccion, e.categorias], ['entrevista', ['poesia']]) // usa el título crudo
  const n = convertWpPost(p, { taxonomia: { id: 1, slugs: ['novedades'], mapeo: m } })
  assert.deepEqual([n.novedadHasta, n.seccion, n.taxonomia?.novedad], [null, 'textos', true])
  const b = convertWpPost(p)
  assert.deepEqual([b.novedadHasta, b.seccion], [null, null])
  assert.deepEqual(b.doc, a.doc) // el cuerpo no cambia
})
console.log(`${ok} pruebas de taxonomía ok`)
