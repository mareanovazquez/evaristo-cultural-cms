import assert from 'node:assert/strict'
import { convertWpContent, parseVideoUrl } from '../convert.ts'
import { validateArticleBody, validateArticleBodyDetallado } from '../../schema/validate.ts'
import type { DocNode } from '../types.ts'

const txt = (n: DocNode): string => (n.text ?? '') + (n.content ?? []).map(txt).join('')
let ok = 0
const t = (name: string, fn: () => void) => { fn(); ok++; console.log('ok', name) }
const conv = (s: string) => { const r = convertWpContent(s); assert.deepEqual(validateArticleBody(r.doc as any, { modo: 'migracion' }), []); return r }

t('wpautop: saltos dobles son párrafos', () => {
  const r = conv('Uno\n\nDos')
  assert.equal(r.doc.content!.length, 2)
})
t('h1 baja a h2, h5 a h4', () => {
  const r = conv('<h1>A</h1><h5>B</h5>')
  assert.deepEqual(r.doc.content!.map((n) => n.attrs!.level), [2, 4])
})
t('negrita, cursiva y enlace', () => {
  const r = conv('<p><strong>a</strong> <em>b</em> <a href="https://x.com">c</a></p>')
  const m = r.doc.content![0]!.content!.map((n) => n.marks?.[0]?.type)
  assert.deepEqual(m, ['bold', undefined, 'italic', undefined, 'link'])
})
t('subrayado se descarta', () => {
  const r = conv('<p><u>x</u></p>')
  assert.equal(r.doc.content![0]!.content![0]!.marks, undefined)
})
t('nota de Word _ftn', () => {
  const r = conv('<p>Hola<a href="#_ftn1" name="_ftnref1">[1]</a> mundo</p><div id="ftn1"><p><a href="#_ftnref1" name="_ftn1">[1]</a> Texto de la nota</p></div>')
  const p = r.doc.content![0]!
  assert.equal(p.content!.some((n) => n.type === 'footnote'), true)
  assert.equal(r.doc.content!.length, 1)
  assert.match(txt(p.content!.find((n) => n.type === 'footnote')!.attrs!.content as DocNode), /Texto de la nota/)
})
t('nota con texto dentro del span', () => {
  const r = conv('<p>A<a href="#_ftn1" name="_ftnref1">[1]</a></p><div id="ftn1"><span><a href="#_ftnref1" name="_ftn1">[1]</a> Cuerpo</span></div>')
  const f = r.doc.content![0]!.content!.find((n) => n.type === 'footnote')!
  assert.match(txt(f.attrs!.content as DocNode), /Cuerpo/)
})
t('[caption] pasa a imagen con epígrafe', () => {
  const r = conv('[caption id="a" width="300"]<img src="http://x/a.jpg" alt="A" /> Pie[/caption]')
  const im = r.doc.content![0]!
  assert.equal(im.type, 'imagen'); assert.equal(im.attrs!.epigrafe, 'Pie'); assert.equal(im.attrs!.alt, 'A')
})
t('[embed] y URL suelta de YouTube', () => {
  const r = conv('[embed]https://www.youtube.com/watch?v=abcDEF12345[/embed]\n\nhttps://youtu.be/zzzDEF12345')
  assert.deepEqual(r.doc.content!.map((n) => n.type), ['video', 'video'])
})
t('parseVideoUrl', () => {
  assert.deepEqual(parseVideoUrl('https://vimeo.com/12345678'), { provider: 'vimeo', id: '12345678' })
  assert.equal(parseVideoUrl('https://example.com/watch?v=abcdefghij'), null)
})
t('tabla simple y tabla de una celda (maquetación)', () => {
  assert.equal(conv('<table><tr><th>A</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>').doc.content![0]!.type, 'table')
  assert.equal(conv('<table><tr><td><p>Texto</p></td></tr></table>').doc.content![0]!.type, 'paragraph')
})
t('blockquote es cita textual', () => {
  const r = conv('<blockquote><p>Q</p></blockquote>')
  assert.equal(r.doc.content![0]!.type, 'cita'); assert.equal(r.doc.content![0]!.attrs!.variante, 'textual')
})
t('validador único: hardBreak válido en párrafo, inválido en título', () => {
  const r = conv('<p>uno<br>dos</p>')
  assert.equal(r.doc.content![0]!.content!.some((n) => n.type === 'hardBreak'), true)
  const bad: DocNode = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }] }] }
  assert.match(validateArticleBody(bad as any, { modo: 'migracion' })[0]!, /hardBreak/)
})
t('hardBreak en un título se reemplaza por un espacio y avisa salto_en_titulo', () => {
  const r = conv('<h2>Primera línea<br>Segunda línea</h2>')
  const h = r.doc.content![0]!
  assert.equal(h.type, 'heading')
  assert.equal(txt(h), 'Primera línea Segunda línea')
  assert.equal(h.content!.some((n) => n.type === 'hardBreak'), false)
  assert.equal(r.warnings.some((w) => w.code === 'salto_en_titulo'), true)
})
t('imagen sin alt: sale con altPendiente: true, el aviso sigue en el informe y el doc valida en ambos modos', () => {
  const r = conv('<p><img src="https://x.com/a.png"></p>')
  const im = r.doc.content![0]!
  assert.equal(im.type, 'imagen')
  assert.equal(im.attrs!.altPendiente, true)
  assert.equal(im.attrs!.alt, '')
  assert.equal(r.warnings.some((w) => w.code === 'imagen_sin_alt'), true)
  assert.deepEqual(validateArticleBody(r.doc as any, { modo: 'estricto' }), [])
  const d = validateArticleBodyDetallado(r.doc as any, { modo: 'migracion' })
  assert.deepEqual([d.errores, d.avisos], [[], []]) // ya está marcada: sin aviso de imagen sin alt
})
t('imagen con alt: no lleva el atributo altPendiente', () => {
  const r = conv('<p><img src="https://x.com/a.png" alt="Un gato"></p>')
  assert.equal('altPendiente' in r.doc.content![0]!.attrs!, false)
  assert.equal(r.warnings.some((w) => w.code === 'imagen_sin_alt'), false)
  const c = conv('[caption id="a" width="300"]<img src="http://x/a.jpg" alt="A" /> Pie[/caption]')
  assert.equal('altPendiente' in c.doc.content![0]!.attrs!, false)
})
t('imagen sin alt dentro de [caption] también sale pendiente', () => {
  const c = conv('[caption id="a" width="300"]<img src="http://x/a.jpg" /> Pie[/caption]')
  assert.equal(c.doc.content![0]!.attrs!.altPendiente, true)
  assert.equal(c.doc.content![0]!.attrs!.epigrafe, 'Pie')
})
t('imagen con ruta relativa: aviso imagen_ruta_relativa', () => {
  const r = conv('<p><img src="interior/image001.gif" alt="x"></p>')
  assert.equal(r.warnings.some((w) => w.code === 'imagen_ruta_relativa'), true)
  assert.notDeepEqual(validateArticleBody(r.doc as any, { modo: 'estricto' }), [])
  assert.equal(validateArticleBodyDetallado(r.doc as any, { modo: 'migracion' }).avisos.length, 1)
})
t('javascript:, data: y //host fallan en ambos modos', () => {
  for (const src of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.com/a.png']) {
    for (const modo of ['estricto', 'migracion'] as const) {
      const doc = { type: 'doc', content: [{ type: 'imagen', attrs: { src, alt: 'x' } }] }
      assert.notDeepEqual(validateArticleBody(doc, { modo }), [], `${src} en ${modo}`)
    }
  }
})
t('estructura: lista vacía, texto vacío y padre no permitido', () => {
  const v = (n: object) => validateArticleBody({ type: 'doc', content: [n] } as any, { modo: 'migracion' })
  assert.match(v({ type: 'bulletList', content: [] })[0]!, /vacío/)
  assert.match(v({ type: 'paragraph', content: [{ type: 'text', text: '' }] })[0]!, /Texto vacío/)
  assert.match(v({ type: 'bulletList', content: [{ type: 'paragraph' }] })[0]!, /no permitido dentro de <bulletList>/)
})
console.log(`${ok} pruebas ok`)
