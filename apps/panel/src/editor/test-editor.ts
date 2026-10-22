// Pruebas del editor sin navegador: TipTap sobre jsdom. Uso: npm run test:editor
//  - títulos: Shift+Enter no inserta salto de línea (en párrafos sí) y el pegado convierte <br> en espacio;
//  - imágenes: completar el texto alternativo quita altPendiente; una imagen nueva sin texto alternativo se rechaza;
//  - imagenId: sobrevive a cargar, guardar, copiar y pegar, y a los cambios del diálogo; sin él, no se serializa.
// La prueba de ida y vuelta con los 35 cuerpos migrados está en test-ida-vuelta.ts.
import assert from 'node:assert/strict'
import { dom } from './entorno-jsdom'

const { Editor } = await import('@tiptap/core')
const { getEditorExtensions } = await import('./extensions')
const { sinSaltosEnTitulos } = await import('./titulo')
const { atributosAlGuardar, guardarAtributosImagen, imagenPendiente, sinAltPendienteFalso, validarFormularioImagen } = await import('./imagen-alt')
const { validateArticleBody } = await import('@evaristo/compartido/schema')
type Doc = import('@evaristo/compartido/schema').JSONNode

let ok = 0
const t = (name: string, fn: () => void) => { fn(); ok++; console.log('ok', name) }

const crear = (content: Doc) =>
  new Editor({ element: document.getElementById('editor')!, extensions: getEditorExtensions(), content })
const T = (text: string): Doc => ({ type: 'text', text })
const doc = (...content: Doc[]): Doc => ({ type: 'doc', content })

/** Simula una pulsación de tecla pasando por los atajos del editor. Devuelve si alguien la consumió. */
const teclear = (editor: InstanceType<typeof Editor>, init: KeyboardEventInit) => {
  const ev = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  return !!editor.view.someProp('handleKeyDown', (f) => f(editor.view, ev as unknown as KeyboardEvent))
}

// ---- B. Títulos ----

t('Shift+Enter dentro de un título no cambia el documento', () => {
  const editor = crear(doc({ type: 'heading', attrs: { level: 2 }, content: [T('Un título')] }))
  editor.commands.focus('end')
  const antes = JSON.stringify(editor.getJSON())
  assert.equal(teclear(editor, { key: 'Enter', shiftKey: true }), true, 'el atajo se consume (no pasa al navegador)')
  assert.equal(JSON.stringify(editor.getJSON()), antes)
  assert.equal(JSON.stringify(editor.getJSON()).includes('hardBreak'), false)
  editor.destroy()
})
t('Shift+Enter funciona igual en H3 y H4', () => {
  for (const level of [3, 4]) {
    const editor = crear(doc({ type: 'heading', attrs: { level }, content: [T('Un título')] }))
    editor.commands.focus('end')
    const antes = JSON.stringify(editor.getJSON())
    teclear(editor, { key: 'Enter', shiftKey: true })
    assert.equal(JSON.stringify(editor.getJSON()), antes, `H${level}`)
    editor.destroy()
  }
})
t('Shift+Enter en un párrafo sí inserta un salto de línea', () => {
  const editor = crear(doc({ type: 'paragraph', content: [T('verso uno')] }))
  editor.commands.focus('end')
  teclear(editor, { key: 'Enter', shiftKey: true })
  const hijos = (editor.getJSON().content![0] as Doc).content!.map((n) => n.type)
  assert.deepEqual(hijos, ['text', 'hardBreak'])
  editor.destroy()
})
t('esquema: el título no admite hardBreak (sí texto y notas al pie); el párrafo sí', () => {
  const editor = crear(doc({ type: 'paragraph' }))
  const { heading, paragraph, hardBreak, footnote, text } = editor.schema.nodes
  assert.equal(heading!.contentMatch.matchType(hardBreak!), null)
  assert.notEqual(heading!.contentMatch.matchType(text!), null)
  assert.notEqual(heading!.contentMatch.matchType(footnote!), null)
  assert.notEqual(paragraph!.contentMatch.matchType(hardBreak!), null)
  editor.destroy()
})
t('un título con nota al pie sigue funcionando', () => {
  const nota = { type: 'footnote', attrs: { content: { type: 'doc', content: [{ type: 'paragraph', content: [T('nota')] }] } } }
  const editor = crear(doc({ type: 'heading', attrs: { level: 2 }, content: [T('Título'), nota] }))
  assert.deepEqual((editor.getJSON().content![0] as Doc).content!.map((n) => n.type), ['text', 'footnote'])
  assert.deepEqual(validateArticleBody(editor.getJSON() as Doc), [])
  editor.destroy()
})
t('sinSaltosEnTitulos: <br> dentro de un título pasa a espacio, sin espacios dobles', () => {
  assert.equal(sinSaltosEnTitulos('<h2>uno<br>dos</h2>'), '<h2>uno dos</h2>')
  assert.equal(sinSaltosEnTitulos('<h3>uno <br> dos</h3>'), '<h3>uno dos</h3>')
  assert.equal(sinSaltosEnTitulos('<h2>uno<br><br>dos</h2>'), '<h2>uno dos</h2>')
  assert.equal(sinSaltosEnTitulos('<h2>uno <em>dos</em><br><strong>tres</strong></h2>'), '<h2>uno <em>dos</em> <strong>tres</strong></h2>')
  assert.equal(sinSaltosEnTitulos('<h2><br>uno</h2>'), '<h2>uno</h2>')
  // los párrafos no se tocan
  assert.equal(sinSaltosEnTitulos('<p>verso<br>verso</p>'), '<p>verso<br>verso</p>')
  assert.equal(sinSaltosEnTitulos('<h2>uno<br>dos</h2><p>a<br>b</p>'), '<h2>uno dos</h2><p>a<br>b</p>')
})
t('pegado: "<h2>uno<br>dos</h2>" queda "uno dos" en el título', () => {
  const editor = crear(doc({ type: 'paragraph' }))
  editor.view.pasteHTML('<h2>uno<br>dos</h2>', new dom.window.Event('paste') as unknown as ClipboardEvent) // jsdom no trae ClipboardEvent
  const json = editor.getJSON()
  const titulo = json.content!.find((n: Doc) => n.type === 'heading') as Doc
  assert.ok(titulo, 'se pegó un título')
  assert.deepEqual(titulo.content, [{ type: 'text', text: 'uno dos' }])
  assert.equal(JSON.stringify(json).includes('hardBreak'), false)
  editor.destroy()
})
t('pegado: un <br> en un párrafo se conserva como salto de línea', () => {
  const editor = crear(doc({ type: 'paragraph' }))
  editor.view.pasteHTML('<p>verso uno<br>verso dos</p>', new dom.window.Event('paste') as unknown as ClipboardEvent) // jsdom no trae ClipboardEvent
  assert.equal(JSON.stringify(editor.getJSON()).includes('hardBreak'), true)
  editor.destroy()
})

// ---- A. altPendiente ----

const imagenPendienteDoc = (attrs: Record<string, unknown> = {}): Doc =>
  doc({ type: 'imagen', attrs: { src: '/a.png', alt: '', decorativa: false, epigrafe: '', altPendiente: true, ...attrs } })
const formDe = (attrs: Record<string, unknown>) => ({ imagenId: null, src: '/a.png', alt: '', decorativa: false, epigrafe: '', altPendiente: false, ...attrs }) as Parameters<typeof atributosAlGuardar>[0]

t('imagen pendiente: el editor la acepta y el validador estricto también', () => {
  const editor = crear(imagenPendienteDoc())
  assert.equal((editor.getJSON().content![0] as Doc).attrs!.altPendiente, true)
  assert.deepEqual(validateArticleBody(sinAltPendienteFalso(editor.getJSON() as Doc)), [])
  editor.destroy()
})
t('completar el texto alternativo quita altPendiente (y no se serializa)', () => {
  const editor = crear(imagenPendienteDoc())
  const pos = 0
  const form = formDe({ ...editor.state.doc.nodeAt(pos)!.attrs, alt: 'Un gato negro' })
  assert.equal(guardarAtributosImagen(editor, pos, form), true)
  const attrs = editor.state.doc.nodeAt(pos)!.attrs
  assert.equal(attrs.altPendiente, false)
  assert.equal(attrs.alt, 'Un gato negro')
  const json = sinAltPendienteFalso(editor.getJSON() as Doc)
  assert.equal('altPendiente' in (json.content![0] as Doc).attrs!, false)
  assert.deepEqual(validateArticleBody(json), [])
  editor.destroy()
})
t('una imagen pendiente se puede guardar sin texto (edita el epígrafe) y sigue pendiente', () => {
  const editor = crear(imagenPendienteDoc())
  const form = formDe({ ...editor.state.doc.nodeAt(0)!.attrs, epigrafe: '  Pie de foto ' })
  assert.deepEqual(validarFormularioImagen(form), {})
  guardarAtributosImagen(editor, 0, form)
  const attrs = editor.state.doc.nodeAt(0)!.attrs
  assert.deepEqual([attrs.altPendiente, attrs.epigrafe], [true, 'Pie de foto'])
  editor.destroy()
})
t('marcar una imagen pendiente como decorativa quita la marca', () => {
  const form = formDe({ altPendiente: true, decorativa: true })
  assert.equal(imagenPendiente(form), false)
  assert.equal(atributosAlGuardar(form).altPendiente, false)
})
t('si se borra el texto de una imagen que ya no es pendiente, NO vuelve a ponerse altPendiente: es error', () => {
  const editor = crear(imagenPendienteDoc())
  guardarAtributosImagen(editor, 0, formDe({ ...editor.state.doc.nodeAt(0)!.attrs, alt: 'Un gato negro' }))
  // El formulario se abre con la imagen completa (altPendiente: false) y se borra el texto.
  const form = formDe({ ...editor.state.doc.nodeAt(0)!.attrs, alt: '' })
  assert.ok(validarFormularioImagen(form).alt, 'el formulario no deja guardar sin texto')
  assert.equal(atributosAlGuardar(form).altPendiente, false)
  // Aunque se fuerce el guardado, el documento queda inválido en modo estricto.
  guardarAtributosImagen(editor, 0, form)
  assert.equal(editor.state.doc.nodeAt(0)!.attrs.altPendiente, false)
  assert.ok(validateArticleBody(sinAltPendienteFalso(editor.getJSON() as Doc)).some((e) => e.includes('sin texto alternativo')))
  editor.destroy()
})
t('una imagen nueva sin texto alternativo se rechaza (y nunca nace pendiente)', () => {
  const nueva = formDe({})
  assert.equal(nueva.altPendiente, false)
  assert.ok(validarFormularioImagen(nueva).alt)
  assert.equal(validarFormularioImagen({ ...nueva, decorativa: true }).alt, undefined)
  assert.equal(validarFormularioImagen({ ...nueva, alt: 'algo' }).alt, undefined)
  const editor = crear(doc({ type: 'paragraph' }))
  editor.chain().focus().insertImagen({ src: '/a.png' }).run()
  const imagen = (editor.getJSON().content as Doc[]).find((n) => n.type === 'imagen')!
  assert.equal(imagen.attrs!.altPendiente, false)
  assert.ok(validateArticleBody(sinAltPendienteFalso(editor.getJSON() as Doc)).some((e) => e.includes('sin texto alternativo')))
  editor.destroy()
})
t('altPendiente solo se serializa cuando es true', () => {
  const sin = sinAltPendienteFalso({ type: 'doc', content: [{ type: 'imagen', attrs: { src: '/a.png', alt: 'x', altPendiente: false } }] })
  assert.equal('altPendiente' in sin.content![0]!.attrs!, false)
  const con = sinAltPendienteFalso({ type: 'doc', content: [{ type: 'imagen', attrs: { src: '/a.png', alt: '', altPendiente: true } }] })
  assert.equal(con.content![0]!.attrs!.altPendiente, true)
})

// ---- C. imagenId ----

t('imagenId sobrevive a cargar y volver a serializar', () => {
  const editor = crear(imagenPendienteDoc({ imagenId: 77, altPendiente: false, alt: 'Un gato' }))
  assert.equal((editor.getJSON().content![0] as Doc).attrs!.imagenId, 77)
  assert.deepEqual(validateArticleBody(sinAltPendienteFalso(editor.getJSON() as Doc)), [])
  editor.destroy()
})
t('imagenId sobrevive a editar la imagen desde el diálogo (guardarAtributosImagen)', () => {
  const editor = crear(imagenPendienteDoc({ imagenId: 77 }))
  const form = formDe({ ...editor.state.doc.nodeAt(0)!.attrs, alt: 'Un gato negro', epigrafe: 'Pie' })
  assert.equal(form.imagenId, 77)
  assert.equal(atributosAlGuardar(form).imagenId, 77)
  guardarAtributosImagen(editor, 0, form)
  assert.equal(editor.state.doc.nodeAt(0)!.attrs.imagenId, 77)
  editor.destroy()
})
t('imagenId sobrevive a copiar y pegar (HTML del portapapeles)', () => {
  const origen = crear(imagenPendienteDoc({ imagenId: 77, altPendiente: false, alt: 'Un gato' }))
  const html = origen.getHTML()
  assert.ok(html.includes('data-imagen-id="77"'), html)
  origen.destroy()
  const destino = crear(doc({ type: 'paragraph' }))
  destino.view.pasteHTML(html, new dom.window.Event('paste') as unknown as ClipboardEvent)
  const imagen = (destino.getJSON().content as Doc[]).find((n) => n.type === 'imagen')!
  assert.equal(imagen.attrs!.imagenId, 77)
  destino.destroy()
})
t('una imagen sin imagenId (nueva o pegada de afuera) no lo serializa: el validador estricto la acepta', () => {
  const editor = crear(doc({ type: 'paragraph' }))
  editor.chain().focus().insertImagen({ src: '/a.png', alt: 'algo' }).run()
  const json = sinAltPendienteFalso(editor.getJSON() as Doc)
  const imagen = (json.content as Doc[]).find((n) => n.type === 'imagen')!
  assert.equal('imagenId' in imagen.attrs!, false)
  assert.deepEqual(validateArticleBody(json), [])
  editor.destroy()
})
t('un data-imagen-id inválido al pegar se ignora', () => {
  const editor = crear(doc({ type: 'paragraph' }))
  editor.view.pasteHTML('<figure class="imagen" data-imagen-id="abc"><img src="/a.png" alt="x"></figure>', new dom.window.Event('paste') as unknown as ClipboardEvent)
  const imagen = (editor.getJSON().content as Doc[]).find((n) => n.type === 'imagen')!
  assert.equal(imagen.attrs!.imagenId, null)
  editor.destroy()
})

console.log(`\n${ok} pruebas del editor ok`)
process.exit(0)
