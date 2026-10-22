import React from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { isAllowedImageSrc } from '@evaristo/compartido/render'

export interface ImagenAttributes {
  /** Referencia a la biblioteca de imágenes (`imagenes.id`). null si no hay (solo se serializa cuando es un número). */
  imagenId: number | null
  src: string
  alt: string
  decorativa: boolean
  epigrafe: string
  /** Imagen migrada sin texto alternativo, marcada para completarlo. Solo se serializa cuando es true. */
  altPendiente: boolean
}

export interface ImagenOptions {
  HTMLAttributes: Record<string, unknown>
  onOpenDialog?: (pos: number, attrs: ImagenAttributes, isNew?: boolean) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imagen: {
      /**
       * Insert an empty image block (the caller opens the dialog afterwards)
       */
      insertImagen: (attributes?: Partial<ImagenAttributes>) => ReturnType
    }
  }
}

/** `data-imagen-id` del HTML pegado o copiado: un entero positivo o null. */
const imagenIdDe = (valor: string | null): number | null => {
  const n = Number(valor)
  return valor !== null && Number.isInteger(n) && n > 0 ? n : null
}

export const ImagenView: React.FC<NodeViewProps> = (props) => {
  const attrs = props.node.attrs as ImagenAttributes

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = props.getPos()
    const options = props.extension.options as ImagenOptions
    if (typeof pos === 'number' && options.onOpenDialog) {
      options.onOpenDialog(pos, attrs, false)
    }
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={`imagen ${props.selected ? 'ProseMirror-selectednode is-selected' : ''}`}
      data-drag-handle=""
      onClick={handleClick}
      title="Imagen (clic o Enter para editar)"
    >
      {isAllowedImageSrc(attrs.src) ? (
        <img src={attrs.src} alt={attrs.decorativa || attrs.altPendiente ? '' : attrs.alt} draggable={false} />
      ) : (
        <div className="imagen-placeholder">Imagen sin dirección válida</div>
      )}
      {attrs.altPendiente && (
        <p className="imagen-alt-pendiente" role="alert">
          Falta el texto alternativo. Hacé clic en la imagen para completarlo.
        </p>
      )}
      {attrs.epigrafe && <figcaption>{attrs.epigrafe}</figcaption>}
    </NodeViewWrapper>
  )
}

export const Imagen = Node.create<ImagenOptions>({
  name: 'imagen',

  group: 'block',

  atom: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onOpenDialog: undefined,
    }
  },

  addAttributes() {
    return {
      imagenId: { default: null, rendered: false },
      src: { default: '', rendered: false },
      alt: { default: '', rendered: false },
      decorativa: { default: false, rendered: false },
      epigrafe: { default: '', rendered: false },
      altPendiente: { default: false, rendered: false },
    }
  },

  parseHTML() {
    return [
      {
        // <figure><img><figcaption></figcaption></figure> (WordPress y nuestro propio renderHTML)
        tag: 'figure',
        priority: 60,
        getAttrs: (element) => {
          const figure = element as HTMLElement
          const img = figure.querySelector('img')
          const src = img?.getAttribute('src') || ''
          if (!img || !isAllowedImageSrc(src)) return false
          return {
            imagenId: imagenIdDe(figure.getAttribute('data-imagen-id')),
            src,
            alt: img.getAttribute('alt') || '',
            decorativa: figure.getAttribute('data-decorativa') === 'true',
            epigrafe: (figure.querySelector('figcaption')?.textContent || '').trim(),
            altPendiente: false,
          }
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (element) => {
          const img = element as HTMLElement
          const src = img.getAttribute('src') || ''
          if (!isAllowedImageSrc(src)) return false
          return { imagenId: null, src, alt: img.getAttribute('alt') || '', decorativa: false, epigrafe: '', altPendiente: false }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const { imagenId, src, alt, decorativa, epigrafe, altPendiente } = node.attrs as ImagenAttributes
    const figureAttrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      class: 'imagen',
      ...(imagenId !== null ? { 'data-imagen-id': String(imagenId) } : {}),
      ...(decorativa ? { 'data-decorativa': 'true' } : {}),
    })
    const img = ['img', { src, alt: decorativa || altPendiente ? '' : alt }] as const // la marca no se escribe en el HTML
    return epigrafe
      ? ['figure', figureAttrs, img, ['figcaption', {}, epigrafe]]
      : ['figure', figureAttrs, img]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImagenView)
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false
        this.options.onOpenDialog?.(selection.from, selection.node.attrs as ImagenAttributes, false)
        return true
      },
    }
  },

  addCommands() {
    return {
      insertImagen:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    }
  },
})
