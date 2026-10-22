// Títulos internos (H2 a H4): una sola línea. No admiten salto de línea (hardBreak), ni escrito con Shift+Enter ni pegado.
//  - Esquema: el contenido de un título es texto y notas al pie; el hardBreak solo existe en párrafos.
//  - Shift+Enter dentro de un título no hace nada (el atajo se consume). Elegimos "no hacer nada" y no "comportarse como Enter":
//    un título no se parte por accidente, y para crear el párrafo siguiente ya está Enter.
//  - Pegado: un <br> dentro de un título se convierte en un espacio (sin dejar espacios dobles).
import Heading from '@tiptap/extension-heading'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/** Reemplaza cada <br> dentro de <h1>…<h6> por un espacio y colapsa los espacios que quedan juntos. */
export function sinSaltosEnTitulos(html: string): string {
  if (!/<br\b/i.test(html) || !/<h[1-6]\b/i.test(html)) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const titulo of doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    for (const br of titulo.querySelectorAll('br')) br.replaceWith(doc.createTextNode(' '))
    // Espacios dobles, también entre nodos de texto vecinos ("uno " + " dos").
    let previoTerminaEnEspacio = true // los espacios al comienzo del título sobran
    const walker = doc.createTreeWalker(titulo, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      let texto = n.data.replace(/\s+/g, ' ')
      if (previoTerminaEnEspacio) texto = texto.replace(/^ /, '')
      n.data = texto
      if (texto) previoTerminaEnEspacio = texto.endsWith(' ')
    }
  }
  return doc.body.innerHTML
}

export const Titulo = Heading.extend({
  // Más prioridad que HardBreak (100): su atajo Shift-Enter tiene que ejecutarse antes.
  priority: 1000,

  // Sin hardBreak: texto y notas al pie.
  content: '(text | footnote)*',

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      'Shift-Enter': ({ editor }) => editor.isActive(this.name),
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey('titulo-sin-saltos'),
        props: { transformPastedHTML: sinSaltosEnTitulos },
      }),
    ]
  },
})
