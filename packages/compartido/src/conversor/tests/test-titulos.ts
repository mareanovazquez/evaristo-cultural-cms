import assert from 'node:assert/strict'
import { aCsv, aFormatoOracion, bajadaCoincideConAutor, esPronunciable, aFormatoOracionPorSegmentos, construirLexico, dividirTitulo, estaEnMayusculas, normalizar, pareceNombreDePersona, textoPlano } from '../titulos.ts'

let ok = 0
const t = (name: string, fn: () => void) => { fn(); ok++; console.log('ok', name) }

// Cuerpos de prueba: el léxico sale de cómo aparecen las palabras en medio de frase (cada frase se repite 3 veces).
const x3 = (frase: string) => Array(3).fill(frase).join(' ')
const cuerpos = [
  // palabras comunes (la primera palabra de cada frase no cuenta)
  '<p>' + x3('Luego dijo que el mar de la mafia en una charla del cine se sienta a la mesa con mi libro y su casa, o e a lo que hoy lee al viaje, a vivir y a ver.') + '</p>',
  '<p>' + x3('Luego vio los misterios del mar, la cultura de un acto y el tomo II sobre qué cultural entrevista, quién lee los años.') + '</p>',
  // nombres propios
  '<p>' + x3('Escuché a Billy Paul con Elvis Presley y Roland Barthes junto a Tim Maia en Buenos Aires.') + '</p>',
  '<p>' + x3('Leímos a Julio Cortázar en Buenos Aires con Ana María Pérez y Roberto Bolaño.') + '</p>',
  '<p>' + x3('Hablé con John e Yves Berger sobre Ludwig van Beethoven y Vincent Van Gogh.') + '</p>',
  // siglas
  '<p>' + x3('Trabajó para la ONU, la UNESCO y la UNLP, vio la TV y la EEUU.') + '</p>',
  // esta oración está entera en mayúsculas: no cuenta
  '<p>' + x3('ESTE TEXTO ESTÁ EN MAYÚSCULAS CON XYZ XYZ XYZ.') + '</p>',
  // tildes casi siempre presentes (≥5 apariciones) y un par ambiguo
  '<p>' + Array(6).fill('Luego habló de la educación, del túnel y de lo que sólo uno sabe.').join(' ') + '</p>',
  // palabras sin clasificar: Plata (4 capitalizadas, 2 en minúscula), gato (4 en minúscula, 1 capitalizada, 5 en mayúsculas), sirena y faro (empates)
  '<p>Vimos la Plata, la Plata, la Plata y la Plata, y la plata, y la plata.</p>',
  '<p>Luego el gato, el gato, el gato, el gato y el Gato y GATO GATO GATO GATO GATO.</p>',
  '<p>Luego vio la sirena y la Sirena.</p>',
  '<p>Luego vio el faro, el faro y el Faro, el Faro.</p>',
  '<p>' + x3('Visitó buscolafelicidad.com y ver.com') + '</p>',
  // Tsutsui es un nombre; Yasukata no está en el corpus
  '<p>' + x3('Leímos a Tsutsui en Buenos Aires.') + '</p>',
  // falsas siglas (ANDAYA, MUTIL), siglas conocidas de 5 letras y numerales romanos
  '<p>' + x3('Vio a ANDAYA y a MUTIL con COVID y la UNESCO, en el siglo XX y en el siglo XXI, con II y IV.') + '</p>',
  // una palabra que aparece capitalizada y en minúscula: no es nombre propio
  '<p>' + x3('Vimos la zeta y la Zeta y Zeta') + '</p>',
]
const lexico = construirLexico(
  ['Entrevista a Julio Cortázar en Buenos Aires', 'Una charla con Julio Cortázar', 'Cartas de Julio Cortázar'],
  ['Damian Blas Vives', 'Evaristo Cultural', 'Roberto Gómez', 'Ana María Pérez', 'John Smith', 'El Pensador', 'Encuentro Internacional de Cultura Japonesa'],
  cuerpos,
)

t('normalizar: minúsculas, sin acentos ni puntuación', () => {
  assert.equal(normalizar('  María-José   NÚÑEZ, ¿ok? '), 'maria jose nunez ok')
})
t('estaEnMayusculas: más del 80 % de las letras', () => {
  assert.equal(estaEnMayusculas('LA MAFIA SE SIENTA A LA MESA'), true)
  assert.equal(estaEnMayusculas('Entrevista a Nicolás Manzur'), false)
  assert.equal(estaEnMayusculas('2666'), false)
  assert.equal(estaEnMayusculas('4ª JORNADA DEL ENCUENTRO'), true)
})
t('textoPlano: sin HTML, entidades ni shortcodes; [ii] y [risas] son texto', () => {
  const r = textoPlano('<p>Hola&nbsp;<em>mundo</em> &amp; [embed]http://x.y/z[/embed]</p><p>[ii] [risas]</p>')
  assert.equal(/<|&amp;|embed|http/.test(r), false)
  assert.equal(r.includes('Hola mundo & '), true)
  assert.equal(r.includes('[ii] [risas]'), true)
})

t('léxico: nombre (≥3 veces y ≥80 % capitalizada en medio de frase), sigla y común', () => {
  const tipo = (w: string) => lexico.entradas.get(normalizar(w))?.tipo
  for (const w of ['Cortázar', 'Billy', 'Paul', 'Elvis', 'Presley', 'Roland', 'Barthes', 'Tim', 'Maia', 'Yves', 'Berger', 'Beethoven', 'Ludwig', 'Buenos', 'Aires']) assert.equal(tipo(w), 'nombre', 'nombre: ' + w)
  for (const w of ['mar', 'cine', 'charla', 'la', 'de', 'e', 'quién']) assert.equal(tipo(w), 'común', w)
  for (const w of ['ONU', 'UNESCO', 'UNLP', 'TV', 'EEUU']) assert.equal(tipo(w), 'sigla', w)
  assert.equal(lexico.entradas.get('onu')?.forma, 'ONU')
})
t('léxico: "Jose" y "José" son una sola entrada y se guarda la forma con tilde', () => {
  const l = construirLexico([], [], [x3('Luego fue con José Pérez y con Jose Pérez y con José Pérez.')])
  assert.equal(l.entradas.get('jose')?.forma, 'José')
  assert.equal(l.entradas.get('jose')?.cap, 9)
})
t('léxico: con menos de 3 apariciones capitalizadas, o a menudo en minúscula, no es nombre', () => {
  assert.equal(lexico.entradas.get('zeta')?.tipo, undefined) // 6 capitalizadas y 3 en minúscula: 67 %
  assert.equal(construirLexico([], [], ['Luego vio a Zeta y a Zeta']).entradas.has('zeta'), false) // solo 2 veces
})
t('léxico: las oraciones enteras en mayúsculas no cuentan (ni para siglas)', () => {
  assert.equal(lexico.entradas.has('xyz'), false)
  assert.equal(lexico.entradas.has('texto'), false)
})
t('léxico: una palabra que aparece como "Juan" no entra como sigla', () => {
  const l = construirLexico([], [], [x3('Luego vio a Juan, a Juan Pérez, a Juan Gómez, a Juan Díaz y a JUAN.')])
  assert.equal(l.entradas.get('juan')?.tipo, 'nombre')
})
t('léxico: nombres de autor → nombres propios; nombre de pila = primera palabra, salvo comunes', () => {
  assert.equal(lexico.entradas.get('damian')?.tipo, 'nombre')
  assert.equal(lexico.nombresDePila.has('damian'), true)
  assert.equal(lexico.nombresDePila.has('roberto'), true)
  assert.equal(lexico.nombresDePila.has('el'), false) // "El Pensador": "el" es una palabra común
})
t('léxico: tildes restaurables solo con ≥5 apariciones y ≥95 % con tilde', () => {
  assert.equal(lexico.tildes.get('educacion'), 'educación')
  assert.equal(lexico.tildes.get('tunel'), 'túnel')
  assert.equal(lexico.tildes.has('mar'), false)
})

t('dividirTitulo: dividido simple', () => {
  const r = dividirTitulo('LOS MISTERIOS DEL MAR | Entrevista a Nicolás Manzur', 'Josefina Goggi', lexico)
  assert.deepEqual([r.accion, r.titulo, r.bajada, r.avisos], ['dividido', 'LOS MISTERIOS DEL MAR', 'Entrevista a Nicolás Manzur', []])
  assert.equal(r.alt_titulo, undefined)
})
t('dividirTitulo: autor_en_titulo (igualdad, inclusión de tokens y lado derecho)', () => {
  const a = dividirTitulo('Julio Cortázar | Rayuela', 'JULIO CORTAZAR', lexico)
  assert.equal(a.accion, 'autor_en_titulo')
  assert.equal(a.titulo, 'Julio Cortázar | Rayuela')
  assert.equal(a.bajada, '')
  assert.deepEqual([a.alt_titulo, a.alt_bajada], ['Rayuela', 'Julio Cortázar'])
  assert.equal(dividirTitulo('Rayuela | Julio Cortázar', 'Julio Cortázar', lexico).accion, 'autor_en_titulo')
  assert.equal(dividirTitulo('Rayuela | Cortázar', 'Julio Cortázar', lexico).accion, 'autor_en_titulo')
  assert.equal(dividirTitulo('RAYUELA | JULIO CORTÁZAR', 'Roxana Artal y Julio Cortázar', lexico).accion, 'autor_en_titulo')
})
t('dividirTitulo: posible_autor (izquierda parece persona con nombre de pila conocido y la derecha no)', () => {
  const r = dividirTitulo('Roberto Bolaño | Los detectives salvajes', 'Evaristo Cultural', lexico)
  assert.equal(r.accion, 'posible_autor')
  assert.equal(r.titulo, 'Roberto Bolaño | Los detectives salvajes')
  assert.deepEqual([r.alt_titulo, r.alt_bajada], ['Los detectives salvajes', 'Roberto Bolaño'])
  assert.equal(dividirTitulo('ROBERTO BOLAÑO | LA CHARLA DEL MAR', 'Evaristo Cultural', lexico).accion, 'posible_autor')
  // Con palabras comunes a la izquierda no parece una persona.
  assert.equal(dividirTitulo('LOS MISTERIOS DEL MAR | Entrevista', 'X', lexico).accion, 'dividido')
  assert.equal(dividirTitulo('EL MAR | Entrevista', 'X', lexico).accion, 'dividido')
})
t('dividirTitulo: Billy Paul, Elvis Presley, Roland Barthes, Tim Maia (sin nombre de pila de autor) no son posible_autor', () => {
  for (const nombre of ['BILLY PAUL', 'ELVIS PRESLEY', 'ROLAND BARTHES', 'TIM MAIA']) {
    const r = dividirTitulo(`${nombre} | El padre del soul`, 'Evaristo Cultural', lexico)
    assert.deepEqual([r.accion, r.bajada, r.avisos], ['dividido', 'El padre del soul', []], nombre)
  }
})
t('dividirTitulo: dos palabras que no son persona (STRIP TEASE, TALK FEM) se dividen', () => {
  for (const x of ['STRIP TEASE', 'TALK FEM']) {
    const r = dividirTitulo(`${x} | Enrique Medina`, 'Alejandro Saloni', lexico)
    assert.deepEqual([r.accion, r.titulo, r.bajada, r.avisos], ['dividido', x, 'Enrique Medina', []])
  }
})
t('dividirTitulo: ambos lados parecen persona → dividido con aviso ambos_lados_persona', () => {
  const r = dividirTitulo('ROBERTO BOLAÑO | Ana María Pérez', 'Evaristo Cultural', lexico)
  assert.deepEqual([r.accion, r.titulo, r.bajada, r.avisos], ['dividido', 'ROBERTO BOLAÑO', 'Ana María Pérez', ['ambos_lados_persona']])
})
t('pareceNombreDePersona: 2 a 4 palabras sin contar partículas, 70 % nombres y un nombre de pila', () => {
  assert.equal(pareceNombreDePersona('Ana María Pérez', lexico), true)
  assert.equal(pareceNombreDePersona('Ludwig van Beethoven', lexico), false) // ningún nombre de pila de autor
  assert.equal(pareceNombreDePersona('Roberto', lexico), false) // una palabra
  assert.equal(pareceNombreDePersona('Roberto Bolaño 2', lexico), false)
  assert.equal(pareceNombreDePersona('Roberto Bolaño y los mares', lexico), false) // 2 de 4: la partícula "y" no cuenta, "los mares" sí
})
t('dividirTitulo: varias_barras divide solo en la primera', () => {
  const r = dividirTitulo('EL MAR | Entrevista | Parte 2', 'X', lexico)
  assert.equal(r.accion, 'dividido')
  assert.equal(r.titulo, 'EL MAR')
  assert.equal(r.bajada, 'Entrevista | Parte 2')
  assert.deepEqual(r.avisos, ['varias_barras'])
})
t('dividirTitulo: sin barra y barra vacía', () => {
  assert.deepEqual(dividirTitulo('Un título sin barra', 'X', lexico), { titulo: 'Un título sin barra', bajada: '', accion: 'sin_barra', avisos: [] })
  const v = dividirTitulo('SOLO | ', 'X', lexico)
  assert.deepEqual([v.accion, v.titulo, v.avisos], ['sin_barra', 'SOLO', ['barra_vacia']])
})
t('dividirTitulo: la barra sin espacios también divide, normalizando espacios', () => {
  for (const x of ['PEQUEÑOS ESTATISTAS| Sobre Pájaros', 'PEQUEÑOS ESTATISTAS |Sobre Pájaros', 'PEQUEÑOS  ESTATISTAS|Sobre   Pájaros']) {
    const r = dividirTitulo(x, 'X', lexico)
    assert.deepEqual([r.accion, r.titulo, r.bajada, r.avisos], ['dividido', 'PEQUEÑOS ESTATISTAS', 'Sobre Pájaros', ['barra_sin_espacios']], x)
  }
  assert.equal(dividirTitulo('Julio Cortázar|Rayuela', 'Julio Cortázar', lexico).titulo, 'Julio Cortázar | Rayuela')
})

t('aFormatoOracion: nombres propios y siglas del corpus', () => {
  assert.deepEqual(aFormatoOracion('LA ONU Y JULIO CORTÁZAR EN BUENOS AIRES', lexico), { texto: 'La ONU y Julio Cortázar en Buenos Aires', avisos: [] })
  assert.deepEqual(aFormatoOracion('LA UNESCO, LA TV Y EL MAR', lexico), { texto: 'La UNESCO, la TV y el mar', avisos: [] })
})
t('aFormatoOracion: Billy Paul, Elvis Presley, Roland Barthes, Tim Maia', () => {
  for (const [orig, esperado] of [['BILLY PAUL', 'Billy Paul'], ['ELVIS PRESLEY', 'Elvis Presley'], ['ROLAND BARTHES Y EL MAR', 'Roland Barthes y el mar'], ['TIM MAIA', 'Tim Maia']]) {
    assert.deepEqual(aFormatoOracion(orig!, lexico), { texto: esperado, avisos: [] }, orig)
  }
})
t('aFormatoOracion: partículas en minúscula entre palabras de nombre propio', () => {
  assert.equal(aFormatoOracion('JOHN E YVES BERGER', lexico).texto, 'John e Yves Berger')
  assert.equal(aFormatoOracion('LUDWIG VAN BEETHOVEN', lexico).texto, 'Ludwig van Beethoven')
  assert.equal(aFormatoOracion('EL MAR DE JULIO CORTÁZAR', lexico).texto, 'El mar de Julio Cortázar')
})
t('aFormatoOracion: comillas, signos de apertura e interrogación', () => {
  assert.equal(aFormatoOracion('¿QUIÉN LEE A JULIO CORTÁZAR HOY?', lexico).texto, '¿Quién lee a Julio Cortázar hoy?')
  assert.equal(aFormatoOracion('“LA MAFIA” EN BUENOS AIRES: EL MAR. LA CHARLA', lexico).texto, '“La mafia” en Buenos Aires: el mar. La charla')
  assert.equal(aFormatoOracion('EL LIBRO «LA CHARLA» Y EL MAR', lexico).texto, 'El libro «La charla» y el mar')
  assert.equal(aFormatoOracion('¡VIAJE AL MAR! ¿QUÉ CINE?', lexico).texto, '¡Viaje al mar! ¿Qué cine?')
})
t('aFormatoOracion: después de ":" va en minúscula, salvo nombre propio', () => {
  assert.equal(aFormatoOracion('CINE: LA CHARLA DE JULIO CORTÁZAR', lexico).texto, 'Cine: la charla de Julio Cortázar')
  assert.equal(aFormatoOracion('CINE: BUENOS AIRES', lexico).texto, 'Cine: Buenos Aires')
})
t('aFormatoOracion: números romanos, iniciales y espacios dobles', () => {
  assert.equal(aFormatoOracion('EL  TOMO  XIV Y EL ACTO II', lexico).texto, 'El tomo XIV y el acto II')
  assert.equal(aFormatoOracion('J. L. CORTÁZAR Y EL MAR', lexico).texto, 'J. L. Cortázar y el mar')
  assert.equal(aFormatoOracion('MI CASA EN EL MAR', lexico).texto, 'Mi casa en el mar') // "MI" no es romano
})
t('aFormatoOracion: un título que ya está en formato oración no se toca', () => {
  for (const x of ['Entrevista a Nicolás Manzur', 'La ONU en Buenos Aires', 'Nadie se está luciendo hoy', '2666']) {
    assert.deepEqual(aFormatoOracion(x, lexico), { texto: x, avisos: [] })
  }
})
t('aFormatoOracion: palabra fuera del corpus → minúscula con aviso palabra_desconocida (sin nombre_posible)', () => {
  const b = aFormatoOracion('EL MAR Y LA XYZ', lexico)
  assert.equal(b.texto, 'El mar y la xyz')
  assert.deepEqual(b.avisos, ['palabra_desconocida:XYZ'])
  assert.deepEqual(aFormatoOracion('EL MAR DE ANDROMETAMORFOSIS Y ANDROMETAMORFOSIS', lexico).avisos, ['palabra_desconocida:ANDROMETAMORFOSIS']) // una vez por palabra
  assert.equal(aFormatoOracion('LA ONU EN EL MAR', lexico).avisos.length, 0)
  assert.equal(aFormatoOracion('EL MAR DE SADIE JONES', lexico).avisos.some((a) => a.startsWith('nombre_posible')), false)
})
t('aFormatoOracion: restaura tildes (EDUCACION → educación) con aviso tilde_restaurada', () => {
  assert.deepEqual(aFormatoOracion('EDUCACION', lexico), { texto: 'Educación', avisos: ['tilde_restaurada:EDUCACION'] })
  assert.equal(aFormatoOracion('LA EDUCACION Y EL TUNEL', lexico).texto, 'La educación y el túnel')
  assert.equal(aFormatoOracion('LA EDUCACIÓN', lexico).avisos.length, 0) // ya tiene tilde
})
t('aFormatoOracion: no restaura tilde en pares ambiguos (solo/sólo)', () => {
  const r = aFormatoOracion('SOLO EL MAR', lexico)
  assert.equal(r.texto, 'Solo el mar')
  assert.equal(r.avisos.some((a) => a.startsWith('tilde_restaurada')), false)
})
t('siglas: ANDAYA y MUTIL no son siglas (pronunciables); COVID y UNESCO sí (lista de conocidas)', () => {
  for (const w of ['andaya', 'mutil']) assert.notEqual(lexico.entradas.get(w)?.tipo, 'sigla', w)
  for (const w of ['covid', 'unesco', 'onu']) assert.equal(lexico.entradas.get(w)?.tipo, 'sigla', w)
  assert.equal(esPronunciable('ANDAYA'), true)
  assert.equal(esPronunciable('MUTIL'), true)
  assert.equal(esPronunciable('FLACS'), false) // una sola vocal
})
t('siglas: los numerales romanos no entran al léxico como siglas pero se mantienen en mayúsculas', () => {
  for (const w of ['xx', 'xxi', 'ii', 'iv']) assert.equal(lexico.entradas.get(w)?.tipo, undefined, w)
  assert.deepEqual(aFormatoOracion('SIGLO XX', lexico), { texto: 'Siglo XX', avisos: [] })
  assert.equal(aFormatoOracion('EL SIGLO XXI Y EL ACTO IV', lexico).texto, 'El siglo XXI y el acto IV')
})
t('aFormatoOracion: palabra desconocida pegada a un nombre propio (2 a 4 palabras) se capitaliza', () => {
  assert.deepEqual(aFormatoOracion('ENTREVISTA A YASUKATA TSUTSUI', lexico), { texto: 'Entrevista a Yasukata Tsutsui', avisos: ['palabra_desconocida:YASUKATA'] })
  assert.equal(aFormatoOracion('ENTREVISTA A TSUTSUI YASUKATA', lexico).texto, 'Entrevista a Tsutsui Yasukata') // después del nombre
  // sin nombre propio al lado: minúscula
  assert.deepEqual(aFormatoOracion('EL MAR Y YASUKATA', lexico), { texto: 'El mar y yasukata', avisos: ['palabra_desconocida:YASUKATA'] })
  // secuencia de más de 4 palabras: no se capitaliza
  assert.equal(aFormatoOracion('TSUTSUI TSUTSUI TSUTSUI TSUTSUI YASUKATA', lexico).texto, 'Tsutsui Tsutsui Tsutsui Tsutsui yasukata')
})
t('aFormatoOracion: palabra ambigua con más apariciones capitalizadas → Capitalizada con aviso palabra_ambigua', () => {
  assert.deepEqual(aFormatoOracion('VIVIR EN LA PLATA', lexico), { texto: 'Vivir en la Plata', avisos: ['palabra_ambigua:PLATA'] })
})
t('aFormatoOracion: palabra ambigua con más apariciones en minúscula → minúscula sin aviso', () => {
  assert.deepEqual(aFormatoOracion('VER EL GATO', lexico), { texto: 'Ver el gato', avisos: [] })
})
t('aFormatoOracion: empate entre capitalizadas y minúsculas → Capitalizada con aviso palabra_ambigua', () => {
  assert.deepEqual(aFormatoOracion('VER LA SIRENA', lexico), { texto: 'Ver la Sirena', avisos: ['palabra_ambigua:SIRENA'] })
  assert.deepEqual(aFormatoOracion('EL FARO DEL MAR', lexico), { texto: 'El Faro del mar', avisos: ['palabra_ambigua:FARO'] })
})
t('aFormatoOracion: un punto pegado a la palabra (dominios) no inicia oración', () => {
  assert.equal(aFormatoOracion('BUSCOLAFELICIDAD.COM', lexico).texto, 'Buscolafelicidad.com')
  assert.equal(aFormatoOracion('F.R.I.E.N.D.S', lexico).texto, 'F.R.I.E.N.D.S')
  assert.equal(aFormatoOracion('EL MAR.LA CASA', lexico).texto, 'El mar.la casa')
  assert.equal(aFormatoOracion('EL MAR. LA CASA', lexico).texto, 'El mar. La casa') // con espacio sí
})
t('bajadaCoincideConAutor: igual o contiene al autor, sin tildes ni espacios de más', () => {
  assert.equal(bajadaCoincideConAutor('Julio  CORTÁZAR', 'Julio Cortazar'), true)
  assert.equal(bajadaCoincideConAutor('Entrevista a Julio Cortázar', 'Julio Cortázar'), true)
  assert.equal(bajadaCoincideConAutor('Entrevista a Ana María Pérez', 'Julio Cortázar'), false)
  assert.equal(bajadaCoincideConAutor('Cortázar', 'Julio Cortázar'), false) // la bajada no contiene el nombre completo
  assert.equal(bajadaCoincideConAutor('Algo', null), false)
})
t('aFormatoOracionPorSegmentos: cada lado de la barra por separado', () => {
  assert.equal(aFormatoOracionPorSegmentos('GOTAS DE LLUVIA | Yasunari Kawabata', lexico).texto, 'Gotas de lluvia | Yasunari Kawabata')
  assert.equal(aFormatoOracionPorSegmentos('Julio Cortázar | RAYUELA EN EL MAR', lexico).texto, 'Julio Cortázar | Rayuela en el mar')
})
t('aFormatoOracion: sin_tildes marca palabras que llevarían tilde y no se restauraron', () => {
  assert.equal(aFormatoOracion('LA CANCION DE LA POESIA', lexico).avisos.includes('sin_tildes'), true)
  assert.equal(aFormatoOracion('LA CANCIÓN DE LA POESÍA', lexico).avisos.includes('sin_tildes'), false)
  assert.equal(aFormatoOracion('LAS ANUNCIACIONES DEL MAR', lexico).avisos.includes('sin_tildes'), false)
  assert.equal(aFormatoOracion('AÑOS DE CINE', lexico).avisos.includes('sin_tildes'), false)
  assert.equal(aFormatoOracion('LA ANUNCIACION DEL MAR', lexico).avisos.includes('sin_tildes'), true)
  assert.equal(aFormatoOracion('LA EDUCACION', lexico).avisos.includes('sin_tildes'), false) // se restauró
})
t('aCsv: BOM, separador ; y todo entre comillas', () => {
  const csv = aCsv(['a', 'b'], [['x "y"', 1]])
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.equal(csv, '﻿"a";"b"\r\n"x ""y""";"1"\r\n')
})

console.log(`${ok} pruebas de títulos ok`)
