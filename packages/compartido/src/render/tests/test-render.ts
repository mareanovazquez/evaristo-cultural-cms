// Pruebas puras del renderizador del cuerpo (src/render/render.ts), sin base de datos.
import assert from 'node:assert/strict'
import { renderArticleBody, validateArticleBody, SPRITE_ICONO_VOLVER, parseVideoUrl, type JSONNode } from '../render.ts'

let ok = 0
const t = (name: string, fn: () => void) => { fn(); ok++; console.log('ok', name) }

const T = (text: string, marks?: JSONNode['marks']): JSONNode => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const P = (...content: JSONNode[]): JSONNode => ({ type: 'paragraph', content })
const PA = (textAlign: string, ...content: JSONNode[]): JSONNode => ({ type: 'paragraph', attrs: { textAlign }, content })
const doc = (...content: JSONNode[]): JSONNode => ({ type: 'doc', content })
const nota = (...content: JSONNode[]): JSONNode => ({ type: 'footnote', attrs: { content: { type: 'doc', content: [P(...content)] } } })
const html = (d: JSONNode, o = {}) => renderArticleBody(d, o).html

const ICONO = '<svg class="icon" aria-hidden="true"><use href="#i-corner-up-left"/></svg>'
const volver = (n: number, p = '') =>
  `<a class="nota-volver" href="#${p}ref-${n}" role="doc-backlink" aria-label="Volver al texto (nota ${n})">${ICONO}</a>`
const llamada = (n: number, p = '') =>
  `<sup class="nota-ref" id="${p}ref-${n}"><a href="#${p}nota-${n}" role="doc-noteref" aria-label="Nota ${n}">${n}</a></sup>`

// --- Notas al pie ---
t('nota: marcado exacto, con punto agregado', () => {
  const r = renderArticleBody(doc(P(T('Hola'), nota(T('Ver Borges')))))
  assert.equal(r.html, `<p>Hola${llamada(1)}</p>`)
  assert.equal(
    r.notesHtml,
    `<section class="notas-al-pie" role="doc-endnotes" aria-labelledby="notas-titulo"><h2 id="notas-titulo">Notas</h2><ol>` +
      `<li id="nota-1">Ver Borges<span class="nw">.${volver(1)}</span></li></ol></section>`,
  )
  assert.equal(r.footnoteCount, 1)
})
t('nota: no agrega punto si ya termina en . ! ? …', () => {
  for (const fin of ['Ver Borges.', 'Qué cosa!', 'Será?', 'Y así…']) {
    const r = renderArticleBody(doc(P(nota(T(fin)))))
    assert.ok(r.notesHtml.includes(`<li id="nota-1">${fin}<span class="nw">${volver(1)}</span></li>`), fin)
  }
})
t('nota: puntuación seguida de comillas o paréntesis de cierre tampoco lleva punto', () => {
  for (const fin of ['Dijo "basta."', 'Dijo «basta.»', 'Dijo “basta.”', '(ver arriba.)', 'Lo dijo (¿cómo?)', "Dijo 'no.'"]) {
    const r = renderArticleBody(doc(P(nota(T(fin)))))
    assert.ok(r.notesHtml.includes(`<span class="nw">${volver(1)}</span>`), fin)
  }
})
t('nota: terminada en coma, dos puntos, o letra con formato sí lleva punto', () => {
  for (const fin of ['Algo,', 'Algo:', 'Algo']) {
    const r = renderArticleBody(doc(P(nota(T(fin)))))
    assert.ok(r.notesHtml.includes(`<span class="nw">.${volver(1)}</span>`), fin)
  }
  const r = renderArticleBody(doc(P(nota(T('Título', [{ type: 'italic' }])))))
  assert.ok(r.notesHtml.includes(`<em>Título</em><span class="nw">.${volver(1)}</span>`))
  const r2 = renderArticleBody(doc(P(nota(T('Fin.', [{ type: 'italic' }])))))
  assert.ok(r2.notesHtml.includes(`<em>Fin.</em><span class="nw">${volver(1)}</span>`))
})
t('nota: numeración en orden de documento, también en títulos y listas', () => {
  const r = renderArticleBody(
    doc(
      P(T('a'), nota(T('uno'))),
      { type: 'heading', attrs: { level: 2 }, content: [T('t'), nota(T('dos'))] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [P(nota(T('tres')))] }] },
    ),
  )
  assert.equal(r.footnoteCount, 3)
  assert.deepEqual([...r.html.matchAll(/id="ref-(\d+)"/g)].map((m) => m[1]), ['1', '2', '3'])
  assert.deepEqual([...r.notesHtml.matchAll(/<li id="nota-(\d+)"/g)].map((m) => m[1]), ['1', '2', '3'])
})
t('nota: prefijoIds cambia ids y href de forma coherente', () => {
  const r = renderArticleBody(doc(P(nota(T('x')))), { prefijoIds: 'a7-' })
  assert.ok(r.html.includes(llamada(1, 'a7-')))
  assert.ok(r.notesHtml.includes('aria-labelledby="a7-notas-titulo"'))
  assert.ok(r.notesHtml.includes('<h2 id="a7-notas-titulo">Notas</h2>'))
  assert.ok(r.notesHtml.includes('<li id="a7-nota-1">'))
  assert.ok(r.notesHtml.includes(volver(1, 'a7-')))
  assert.ok(!r.html.includes('id="ref-1"'))
})
t('nota: con hardBreak, enlace y varios párrafos', () => {
  const salto: JSONNode = { type: 'hardBreak' }
  const r = renderArticleBody(doc(P(nota(T('uno'), salto, T('dos')))))
  assert.ok(r.notesHtml.includes('uno<br>dos<span class="nw">.'))
  const varias: JSONNode = { type: 'footnote', attrs: { content: { type: 'doc', content: [P(T('Primero.')), P(T('Segundo'))] } } }
  const r2 = renderArticleBody(doc(P(varias)))
  assert.ok(r2.notesHtml.includes(`<li id="nota-1"><p>Primero.</p><p>Segundo<span class="nw">.${volver(1)}</span></p></li>`))
  const r3 = renderArticleBody(doc(P(nota(T('web', [{ type: 'link', attrs: { href: 'https://a.com/?x=1&y=2' } }])))))
  assert.ok(r3.notesHtml.includes('<a href="https://a.com/?x=1&amp;y=2">web</a>'))
})
t('nota: el sprite se exporta pero el renderizador no lo emite', () => {
  assert.ok(SPRITE_ICONO_VOLVER.startsWith('<symbol id="i-corner-up-left" viewBox="0 0 24 24">'))
  assert.ok(SPRITE_ICONO_VOLVER.includes('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'))
  const r = renderArticleBody(doc(P(nota(T('x')))))
  assert.ok(!r.html.includes('<symbol') && !r.notesHtml.includes('<symbol'))
})
t('nota: sin notas, notesHtml vacío', () => {
  const r = renderArticleBody(doc(P(T('hola'))))
  assert.equal(r.notesHtml, '')
  assert.equal(r.footnoteCount, 0)
})
t('caso tipo 4265: marcas [n] como texto sin nodo footnote salen tal cual', () => {
  const r = renderArticleBody(doc(P(T('Dijo algo [1] y luego otra cosa [2].')), P(nota(T('Única nota.')))))
  assert.ok(r.html.includes('Dijo algo [1] y luego otra cosa [2].'))
  assert.equal(r.footnoteCount, 1)
  assert.ok(!r.html.includes('href="#nota-2"'))
})

// --- Alineación ---
t('alineación: center y justify llevan clase; left y right no', () => {
  assert.equal(html(doc(PA('center', T('a')))), '<p class="alin-centro">a</p>')
  assert.equal(html(doc(PA('justify', T('a')))), '<p class="alin-justificado">a</p>')
  assert.equal(html(doc(PA('left', T('a')))), '<p>a</p>')
  assert.equal(html(doc(PA('right', T('a')))), '<p>a</p>')
  assert.equal(html(doc(P(T('a')))), '<p>a</p>')
})

// --- Letra capital ---
t('capital: apagada por defecto', () => {
  assert.ok(!html(doc(P(T('Hola')))).includes('con-capital'))
  assert.ok(!html(doc(P(T('Hola'))), { conCapital: false }).includes('con-capital'))
})
t('capital: primer párrafo que empieza con letra', () => {
  assert.equal(html(doc(P(T('Hola'))), { conCapital: true }), '<p class="con-capital">Hola</p>')
  assert.equal(html(doc(P(T('Ñandú'))), { conCapital: true }), '<p class="con-capital">Ñandú</p>')
  assert.equal(html(doc(P(T('  Árbol'))), { conCapital: true }), '<p class="con-capital">  Árbol</p>')
  assert.equal(html(doc(P(T('Hola', [{ type: 'bold' }]))), { conCapital: true }), '<p class="con-capital"><strong>Hola</strong></p>')
})
t('capital: se combina con la alineación', () => {
  assert.equal(html(doc(PA('justify', T('Hola'))), { conCapital: true }), '<p class="alin-justificado con-capital">Hola</p>')
  assert.equal(html(doc(PA('center', T('Hola'))), { conCapital: true }), '<p class="alin-centro con-capital">Hola</p>')
})
t('capital: no si empieza con comillas, número, signo, llamada a nota o salto', () => {
  for (const d of [
    P(T('«Hola»')),
    P(T('"Hola"')),
    P(T('—Hola')),
    P(T('¿Qué?')),
    P(T('1944 fue')),
    P(T('(Hola)')),
    P(nota(T('x')), T('Hola')),
    P({ type: 'hardBreak' }, T('Hola')),
    P(),
  ]) {
    assert.ok(!html(doc(d), { conCapital: true }).includes('con-capital'), JSON.stringify(d))
  }
})
t('capital: no si el primer bloque no es un párrafo, y nunca en otros párrafos', () => {
  const bloques: JSONNode[] = [
    { type: 'heading', attrs: { level: 2 }, content: [T('Título')] },
    { type: 'imagen', attrs: { src: '/media/a.jpg', alt: 'x' } },
    { type: 'bulletList', content: [{ type: 'listItem', content: [P(T('Item'))] }] },
    { type: 'cita', attrs: { variante: 'textual' }, content: [P(T('Cita'))] },
  ]
  for (const b of bloques) {
    const h = html(doc(b, P(T('Segundo'))), { conCapital: true })
    assert.ok(!h.includes('con-capital'), JSON.stringify(b.type))
  }
  const h = html(doc(P(T('Primero')), P(T('Segundo')), P(T('Tercero'))), { conCapital: true })
  assert.equal(h.match(/con-capital/g)?.length, 1)
  assert.ok(h.startsWith('<p class="con-capital">Primero</p><p>Segundo</p>'))
})

// --- Títulos ---
t('título: nivel acotado a 2..6', () => {
  const h = (level: unknown) => html(doc({ type: 'heading', attrs: { level }, content: [T('t')] }))
  assert.equal(h(1), '<h2>t</h2>')
  assert.equal(h(0), '<h2>t</h2>')
  assert.equal(h(2), '<h2>t</h2>')
  assert.equal(h(3), '<h3>t</h3>')
  assert.equal(h(4), '<h4>t</h4>')
  assert.equal(h(6), '<h6>t</h6>')
  assert.equal(h(9), '<h6>t</h6>')
  assert.equal(h(undefined), '<h2>t</h2>')
  assert.equal(h('x'), '<h2>t</h2>')
  assert.ok(!h(1).includes('<h1'))
})

// --- Imágenes ---
const img = (attrs: Record<string, unknown>): JSONNode => ({ type: 'imagen', attrs })
t('imagen: con dimensiones, epígrafe y clase', () => {
  const dimensionesImagenes = new Map([[7, { ancho: 800, alto: 600 }]])
  assert.equal(
    html(doc(img({ src: '/media/a.jpg', alt: 'Un gato', imagenId: 7, epigrafe: 'Pie' })), { dimensionesImagenes }),
    '<figure><img class="cuerpo-img" src="/media/a.jpg" alt="Un gato" width="800" height="600" loading="lazy"><figcaption>Pie</figcaption></figure>',
  )
})
t('imagen: sin medida o sin imagenId sale sin width ni height', () => {
  const dimensionesImagenes = new Map([[7, { ancho: 800, alto: 600 }]])
  const esperado = '<figure><img class="cuerpo-img" src="/media/a.jpg" alt="x" loading="lazy"></figure>'
  assert.equal(html(doc(img({ src: '/media/a.jpg', alt: 'x', imagenId: 8 })), { dimensionesImagenes }), esperado)
  assert.equal(html(doc(img({ src: '/media/a.jpg', alt: 'x' })), { dimensionesImagenes }), esperado)
  assert.equal(html(doc(img({ src: '/media/a.jpg', alt: 'x', imagenId: 7 }))), esperado)
  const invalida = new Map([[7, { ancho: 0, alto: 600 }]])
  assert.equal(html(doc(img({ src: '/media/a.jpg', alt: 'x', imagenId: 7 })), { dimensionesImagenes: invalida }), esperado)
})
t('imagen: altPendiente y decorativa salen con alt="" y sin la marca', () => {
  const a = html(doc(img({ src: '/media/a.jpg', alt: '', altPendiente: true })))
  assert.equal(a, '<figure><img class="cuerpo-img" src="/media/a.jpg" alt="" loading="lazy"></figure>')
  assert.ok(!/pendiente/i.test(a))
  const b = html(doc(img({ src: '/media/a.jpg', alt: 'algo', decorativa: true })))
  assert.ok(b.includes('alt=""') && !b.includes('algo'))
  assert.ok(!b.includes('figcaption'))
})
t('imagen: sin estilos en línea ni aspect-ratio', () => {
  const h = html(doc(img({ src: '/media/a.jpg', alt: 'x', imagenId: 7 })), { dimensionesImagenes: new Map([[7, { ancho: 1, alto: 2 }]]) })
  assert.ok(!/style|aspect|object-fit/i.test(h))
})
t('imagen: src no permitido no se renderiza', () => {
  for (const src of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.com/a.png', 'interior/a.gif', '', undefined]) {
    assert.equal(html(doc(img({ src, alt: 'x' }))), '', String(src))
  }
})
t('imagen: escape de alt, src y epígrafe', () => {
  const h = html(doc(img({ src: '/media/a.jpg?x=1&y="2"', alt: 'a "b" <c>', epigrafe: '<script>x</script> & más' })))
  assert.ok(h.includes('alt="a &quot;b&quot; &lt;c&gt;"'))
  assert.ok(h.includes('src="/media/a.jpg?x=1&amp;y=&quot;2&quot;"'))
  assert.ok(h.includes('<figcaption>&lt;script&gt;x&lt;/script&gt; &amp; más</figcaption>'))
})

// --- Citas ---
t('cita: blockquote.cita con p y cite', () => {
  const d = doc({ type: 'cita', attrs: { variante: 'destacada', autor: 'Borges', fuente: 'Ficciones' }, content: [P(T('Frase'))] })
  assert.equal(html(d), '<blockquote class="cita"><p>Frase</p><cite>Borges, Ficciones</cite></blockquote>')
  const sinAtribucion = doc({ type: 'cita', attrs: { variante: 'destacada' }, content: [P(T('Frase'))] })
  assert.equal(html(sinAtribucion), '<blockquote class="cita"><p>Frase</p></blockquote>')
  const soloAutor = doc({ type: 'cita', attrs: { variante: 'destacada', autor: 'Arlt' }, content: [P(T('Frase'))] })
  assert.ok(html(soloAutor).includes('<cite>Arlt</cite>'))
})
t('cita con llamada a nota (caso sintético)', () => {
  const d = doc(P(T('Antes'), nota(T('Primera'))), {
    type: 'cita',
    attrs: { variante: 'destacada', autor: 'Arlt' },
    content: [P(T('Frase'), nota(T('Segunda')))],
  })
  const r = renderArticleBody(d)
  assert.equal(r.footnoteCount, 2)
  assert.ok(r.html.includes(`<blockquote class="cita"><p>Frase${llamada(2)}</p><cite>Arlt</cite></blockquote>`))
  assert.ok(r.notesHtml.includes('<li id="nota-2">Segunda'))
})
t('cita: una sola, sin importar la variante heredada (textual, destacada o ninguna)', () => {
  const esperado = '<blockquote class="cita"><p>x</p><cite>A, B</cite></blockquote>'
  for (const variante of ['textual', 'destacada', undefined]) {
    const d = doc({ type: 'cita', attrs: { ...(variante ? { variante } : {}), autor: 'A', fuente: 'B' }, content: [P(T('x'))] })
    assert.equal(html(d), esperado, `variante ${String(variante)}`)
  }
  // Sin autor ni fuente (lo que genera el conversor con las citas de WordPress): sin <cite>
  assert.equal(html(doc({ type: 'cita', attrs: { variante: 'textual', autor: '', fuente: '' }, content: [P(T('x'))] })), '<blockquote class="cita"><p>x</p></blockquote>')
  assert.equal(html(doc({ type: 'cita', content: [P(T('x'))] })), '<blockquote class="cita"><p>x</p></blockquote>')
  assert.ok(!html(doc({ type: 'cita', content: [P(T('x'))] })).includes('cita-textual'), 'ya no existe la cita textual')
})
t('cita: el autor y la fuente se escapan', () => {
  const d = doc({ type: 'cita', attrs: { autor: '<b>A</b> & Cía' }, content: [P(T('x'))] })
  assert.ok(html(d).includes('<cite>&lt;b&gt;A&lt;/b&gt; &amp; Cía</cite>'))
})

// --- Tablas, videos, saltos, enlaces, escape ---
t('tabla: con encabezado lleva thead y tbody; sin encabezado solo tbody', () => {
  const fila = (tipo: string, ...txt: string[]): JSONNode => ({ type: 'tableRow', content: txt.map((x) => ({ type: tipo, content: [P(T(x))] })) })
  const con = html(doc({ type: 'table', content: [fila('tableHeader', 'A', 'B'), fila('tableCell', '1', '2')] }))
  assert.equal(
    con,
    '<div class="tabla-scroll"><table><thead><tr><th><p>A</p></th><th><p>B</p></th></tr></thead><tbody><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table></div>',
  )
  const sin = html(doc({ type: 'table', content: [fila('tableCell', '1', '2')] }))
  assert.equal(sin, '<div class="tabla-scroll"><table><tbody><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table></div>')
  const mixta = html(doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [P(T('A'))] }, { type: 'tableCell', content: [P(T('B'))] }] }] }))
  assert.ok(!mixta.includes('<thead>'))
})
t('video: YouTube (nocookie) y Vimeo; proveedor o id inválidos no salen', () => {
  assert.equal(
    html(doc({ type: 'video', attrs: { provider: 'youtube', id: 'aqz-KE-bpKQ' } })),
    '<figure class="video"><iframe src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ" title="Video de YouTube" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></figure>',
  )
  assert.ok(html(doc({ type: 'video', attrs: { provider: 'vimeo', id: '76979871' } })).includes('src="https://player.vimeo.com/video/76979871"'))
  assert.equal(html(doc({ type: 'video', attrs: { provider: 'facebook', id: '12345678' } })), '')
  assert.equal(html(doc({ type: 'video', attrs: { provider: 'youtube', id: 'x' } })), '')
  assert.equal(html(doc({ type: 'video', attrs: { provider: 'vimeo', id: 'abc' } })), '')
})
t('parseVideoUrl: variantes y rechazo de dominios ajenos', () => {
  for (const u of ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'https://youtu.be/aqz-KE-bpKQ?t=10', 'https://www.youtube.com/shorts/aqz-KE-bpKQ']) {
    assert.deepEqual(parseVideoUrl(u), { provider: 'youtube', id: 'aqz-KE-bpKQ' })
  }
  assert.deepEqual(parseVideoUrl('https://player.vimeo.com/video/76979871?h=abc'), { provider: 'vimeo', id: '76979871' })
  for (const u of ['https://evil.com/watch?v=aqz-KE-bpKQ', 'javascript:alert(1)', 'https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ', '']) {
    assert.equal(parseVideoUrl(u), null, u)
  }
})
t('hardBreak: <br> en párrafos', () => {
  assert.equal(html(doc(P(T('uno'), { type: 'hardBreak' }, T('dos')))), '<p>uno<br>dos</p>')
})
t('enlace: http, https y mailto pasan; javascript: y similares se descartan', () => {
  const enlace = (href: string) => html(doc(P(T('x', [{ type: 'link', attrs: { href } }]))))
  assert.equal(enlace('https://a.com'), '<p><a href="https://a.com">x</a></p>')
  assert.equal(enlace('mailto:a@b.com'), '<p><a href="mailto:a@b.com">x</a></p>')
  for (const h of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', '/relativo', '']) {
    assert.equal(enlace(h), '<p>x</p>', h)
  }
})
t('enlace: el href se escapa', () => {
  const h = html(doc(P(T('x', [{ type: 'link', attrs: { href: 'https://a.com/?q="1"&r=<2>' } }]))))
  assert.ok(h.includes('href="https://a.com/?q=&quot;1&quot;&amp;r=&lt;2&gt;"'))
})
t('marcas: negrita y cursiva anidadas', () => {
  assert.equal(html(doc(P(T('x', [{ type: 'bold' }, { type: 'italic' }])))), '<p><em><strong>x</strong></em></p>')
})
t('escape de HTML en texto', () => {
  assert.equal(html(doc(P(T('<b>a</b> & "c" \'d\'')))), '<p>&lt;b&gt;a&lt;/b&gt; &amp; &quot;c&quot; &#039;d&#039;</p>')
  const r = renderArticleBody(doc(P(nota(T('<img src=x onerror=alert(1)>')))))
  assert.ok(r.notesHtml.includes('&lt;img src=x onerror=alert(1)&gt;') && !r.notesHtml.includes('<img'))
})
t('listas', () => {
  const lista = (tipo: string) => doc({ type: tipo, content: [{ type: 'listItem', content: [P(T('a'))] }] })
  assert.equal(html(lista('bulletList')), '<ul><li><p>a</p></li></ul>')
  assert.equal(html(lista('orderedList')), '<ol><li><p>a</p></li></ol>')
})
t('nodo desconocido: renderiza sus hijos sin emitir nada propio', () => {
  assert.equal(html(doc({ type: 'rarito', content: [P(T('a'))] })), '<p>a</p>')
})
t('documento vacío', () => {
  assert.deepEqual(renderArticleBody({ type: 'doc', content: [] }), { html: '', notesHtml: '', footnoteCount: 0 })
  assert.deepEqual(renderArticleBody({ type: 'doc' }, { conCapital: true }), { html: '', notesHtml: '', footnoteCount: 0 })
})
t('validador: sigue rechazando H1 y enlaces javascript: (el renderizador no lo reemplaza)', () => {
  const errs = validateArticleBody(doc({ type: 'heading', attrs: { level: 1 }, content: [T('x')] }))
  assert.ok(errs.some((e) => e.includes('H1')))
})

console.log(`\n${ok} pruebas del renderizador pasaron`)
