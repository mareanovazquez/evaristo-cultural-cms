import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Cita } from './cita'
import { Titulo } from './titulo'
import { Footnote, type FootnoteOptions } from './footnote'
import { Imagen, type ImagenOptions } from './imagen'
import { Video } from './video'
import { Tabla, FilaTabla, CeldaEncabezado, CeldaTabla } from './tabla'
import { isAllowedUrl } from '@evaristo/compartido/render'

export interface CustomExtensionsOptions {
  onOpenFootnoteDialog?: FootnoteOptions['onOpenDialog']
  onOpenImageDialog?: ImagenOptions['onOpenDialog']
}

export function getEditorExtensions(options?: CustomExtensionsOptions) {
  return [
    StarterKit.configure({
      heading: false, // lo reemplaza Titulo (H2 a H4, sin saltos de línea)
      bold: {},
      italic: {},
      link: {
        openOnClick: false,
        // El enlace guarda solo `href`: el renderizador no usa rel ni target, y así no se agregan a cada enlace del JSON.
        HTMLAttributes: { rel: null, target: null, class: null },
        isAllowedUri: (url) => isAllowedUrl(url),
      },
      bulletList: {},
      orderedList: {},
      // Desactivados
      blockquote: false,
      code: false,
      codeBlock: false,
      strike: false,
      horizontalRule: false,
    }),

    Titulo.configure({
      levels: [2, 3, 4],
    }),

    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'justify'],
      defaultAlignment: 'left',
    }),

    Cita,

    Footnote.configure({
      onOpenDialog: options?.onOpenFootnoteDialog,
    }),

    Imagen.configure({
      onOpenDialog: options?.onOpenImageDialog,
    }),

    Video,

    Tabla,
    FilaTabla,
    CeldaEncabezado,
    CeldaTabla,
  ]
}
