import { Node, mergeAttributes } from '@tiptap/core'

export interface CitaOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cita: {
      /**
       * Set a cita block
       */
      setCita: (attributes?: { variante?: 'textual' | 'destacada'; autor?: string; fuente?: string }) => ReturnType
      /**
       * Toggle a cita block
       */
      toggleCita: (attributes?: { variante?: 'textual' | 'destacada'; autor?: string; fuente?: string }) => ReturnType
      /**
       * Update cita attributes
       */
      updateCita: (attributes: { variante?: 'textual' | 'destacada'; autor?: string; fuente?: string }) => ReturnType
    }
  }
}

export const Cita = Node.create<CitaOptions>({
  name: 'cita',

  group: 'block',

  content: 'paragraph+',

  defining: true,

  addAttributes() {
    return {
      variante: {
        default: 'textual',
        parseHTML: (element) => element.getAttribute('data-variante') || (element.classList.contains('cita-destacada') ? 'destacada' : 'textual'),
        renderHTML: (attributes) => ({
          'data-variante': attributes.variante,
        }),
      },
      autor: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-autor') || '',
        renderHTML: (attributes) => (attributes.autor ? { 'data-autor': attributes.autor } : {}),
      },
      fuente: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-fuente') || '',
        renderHTML: (attributes) => (attributes.fuente ? { 'data-fuente': attributes.fuente } : {}),
      },
    }
  },

  parseHTML() {
    return [
      {
        // figure.cita es el formato actual; figure.cita-textual, el de antes
        tag: 'figure.cita, figure.cita-textual',
        getAttrs: (element) => {
          if (typeof element === 'string') return false
          const el = element as HTMLElement
          const figcaption = el.querySelector('figcaption')
          let autor = el.getAttribute('data-autor') || ''
          let fuente = el.getAttribute('data-fuente') || ''
          if (!autor && !fuente && figcaption) {
            const text = figcaption.textContent || ''
            const parts = text.split(',')
            if (parts.length > 1) {
              autor = parts[0].trim()
              fuente = parts.slice(1).join(',').trim()
            } else {
              autor = text.trim()
            }
          }
          return {
            variante: 'textual',
            autor,
            fuente,
          }
        },
        contentElement: 'blockquote',
      },
      {
        tag: 'figure.cita-destacada',
        getAttrs: () => ({ variante: 'destacada' }),
        contentElement: 'blockquote',
      },
      {
        tag: 'blockquote',
        getAttrs: (element) => {
          if (typeof element === 'string') return false
          const el = element as HTMLElement
          return {
            variante: el.getAttribute('data-variante') || 'textual',
            autor: el.getAttribute('data-autor') || '',
            fuente: el.getAttribute('data-fuente') || '',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    // Una sola cita (decisión del 22/10/2026): el autor y la fuente, si los hay, van en el pie. `variante` es un resto de formatos
    // anteriores: se conserva en los datos para no alterarlos, pero ya no cambia nada.
    const { autor, fuente } = node.attrs

    const captionParts: string[] = []
    if (autor) captionParts.push(autor)
    if (fuente) captionParts.push(fuente)
    const captionText = captionParts.join(', ')

    return [
      'figure',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'cita' }),
      ['blockquote', 0],
      ...(captionText ? [['figcaption', {}, captionText]] : []),
    ]
  },

  addCommands() {
    return {
      setCita:
        (attributes) =>
        ({ commands }) => {
          return commands.setNode(this.name, attributes)
        },
      toggleCita:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleWrap(this.name, attributes)
        },
      updateCita:
        (attributes) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, attributes)
        },
    }
  },
})
