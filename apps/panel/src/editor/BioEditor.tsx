import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { BIO_MAX, largoDeBio } from '@evaristo/compartido/bio'
import { isAllowedUrl, type JSONNode } from '@evaristo/compartido/render'

// Editor chico de la bio de un autor: párrafos con itálica y enlaces, sin negrita, listas, títulos ni saltos de línea.
// Con contador de caracteres (decidido el 23/10/2026: hasta 500). Una bio migrada que ya se pasa del límite se puede guardar
// mientras no se la cambie; el contador avisa en ese caso.

interface BioEditorProps {
  /** La bio al abrir la ficha (no se vuelve a leer: el editor es el dueño del texto mientras se edita). */
  inicial: JSONNode | null
  /** Para saber si la bio sigue como estaba (y entonces el límite no se aplica). */
  alCambiar: (bio: JSONNode) => void
  /** ¿Sigue igual que la guardada? Lo decide quien guarda; acá solo se usa para el aviso del contador. */
  sinCambios: boolean
}

const VACIA: JSONNode = { type: 'doc', content: [{ type: 'paragraph' }] }

export function BioEditor({ inicial, alCambiar, sinCambios }: BioEditorProps) {
  const [largo, setLargo] = useState(largoDeBio(inicial))
  const [enlaceAbierto, setEnlaceAbierto] = useState(false)
  const [enlace, setEnlace] = useState('')
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null)
  const callback = useRef(alCambiar)
  useEffect(() => {
    callback.current = alCambiar
  }, [alCambiar])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bold: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        hardBreak: false,
        link: { openOnClick: false, HTMLAttributes: { rel: null, target: null, class: null }, isAllowedUri: (url) => isAllowedUrl(url) },
      }),
    ],
    content: (inicial && inicial.content?.length ? inicial : VACIA) as never,
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON() as JSONNode
      setLargo(largoDeBio(json))
      callback.current(json)
    },
    editorProps: { attributes: { class: 'bio-prosemirror', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Bio del autor', 'aria-describedby': 'bio-contador' } },
  })

  const estado = useEditorState({
    editor,
    selector: ({ editor: ed }) => (ed ? { cursiva: ed.isActive('italic'), enlace: ed.isActive('link') } : null),
  })

  if (!editor || !estado) return <p className="cargando" role="status">Cargando el editor…</p>

  const abrirEnlace = () => {
    setEnlace((editor.getAttributes('link')['href'] as string | undefined) ?? '')
    setErrorEnlace(null)
    setEnlaceAbierto(true)
  }
  const aplicarEnlace = () => {
    if (!enlace.trim()) {
      editor.chain().focus().unsetLink().run()
    } else if (!isAllowedUrl(enlace.trim())) {
      setErrorEnlace('Solo se admiten enlaces que empiecen con http://, https:// o mailto:.')
      return
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: enlace.trim() }).run()
    }
    setEnlaceAbierto(false)
  }

  const pasado = largo > BIO_MAX
  return (
    <div className="editor-cuerpo bio-editor">
      <div className="toolbar-container" role="toolbar" aria-label="Formato de la bio">
        <button type="button" className={`btn-toolbar${estado.cursiva ? ' is-active' : ''}`} aria-pressed={estado.cursiva} onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursiva">
          <em>I</em>
          <span className="solo-lectores"> Cursiva</span>
        </button>
        <button type="button" className={`btn-toolbar${estado.enlace ? ' is-active' : ''}`} aria-pressed={estado.enlace} onClick={abrirEnlace} title="Enlace">
          Enlace
        </button>
        {estado.enlace && (
          <button type="button" className="btn-toolbar" onClick={() => editor.chain().focus().unsetLink().run()}>
            Quitar enlace
          </button>
        )}
      </div>
      {enlaceAbierto && (
        <div className="link-input-inline">
          <label htmlFor="bio-enlace" className="solo-lectores">
            Dirección del enlace
          </label>
          <input
            id="bio-enlace"
            type="text"
            placeholder="https://ejemplo.com"
            value={enlace}
            autoFocus
            onChange={(e) => setEnlace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                aplicarEnlace()
              } else if (e.key === 'Escape') {
                setEnlaceAbierto(false)
              }
            }}
          />
          <button type="button" className="boton boton-suave" onClick={aplicarEnlace}>
            Aplicar
          </button>
          <button type="button" className="boton boton-suave" onClick={() => setEnlaceAbierto(false)}>
            Cancelar
          </button>
        </div>
      )}
      {errorEnlace && (
        <p className="form-error" role="alert">
          {errorEnlace}
        </p>
      )}
      <div className="editor-area">
        <EditorContent editor={editor} />
      </div>
      <p id="bio-contador" className={`bio-contador${pasado ? (sinCambios ? ' bio-contador-aviso' : ' bio-contador-excedido') : ''}`} role="status">
        {largo} de {BIO_MAX} caracteres
        {pasado && sinCambios && ' · Esta bio es más larga que el límite; se puede guardar así mientras no la cambies.'}
        {pasado && !sinCambios && ' · Acortala para poder guardar.'}
      </p>
    </div>
  )
}
