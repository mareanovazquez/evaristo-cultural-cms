import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { isAllowedUrl, type JSONNode, type ParsedVideo } from '@evaristo/compartido/render'
import { getEditorExtensions } from './extensions'
import { FootnoteDialog } from './FootnoteDialog'
import { ImagenDialog } from './ImagenDialog'
import { VideoDialog } from './VideoDialog'
import type { ImagenAttributes } from './imagen'
import { guardarAtributosImagen, sinAltPendienteFalso } from './imagen-alt'

interface EditorCuerpoProps {
  /** Texto con el que se abre el editor. Después el editor es el dueño del contenido (no se vuelve a cargar). */
  contenido: JSONNode
  /** Se llama con cada cambio del texto. */
  onCambio: () => void
  /** Entrega el editor para pedirle el texto cuando hace falta (por ejemplo, al guardar). */
  onEditor: (editor: Editor | null) => void
  /** Avisa si hay una ventana abierta (nota, imagen o video): mientras tanto el texto puede estar a medio armar y no conviene autoguardar. */
  onVentanaAbierta?: (abierta: boolean) => void
}

interface NotaAlPie {
  abierta: boolean
  pos: number
  contenido: Record<string, unknown> | null
  nueva: boolean
}

interface VentanaImagen {
  abierta: boolean
  pos: number
  atributos: ImagenAttributes | null
  nueva: boolean
}

const NOTA_CERRADA: NotaAlPie = { abierta: false, pos: 0, contenido: null, nueva: false }
const IMAGEN_CERRADA: VentanaImagen = { abierta: false, pos: 0, atributos: null, nueva: false }

/** El texto del editor tal como se guarda (altPendiente e imagenId solo cuando corresponde). */
export const textoDelEditor = (editor: Editor): JSONNode => sinAltPendienteFalso(editor.getJSON() as JSONNode)

function Herramienta({ activo, deshabilitado, titulo, onClick, children, clase }: { activo?: boolean | undefined; deshabilitado?: boolean | undefined; titulo: string; onClick: () => void; children: ReactNode; clase?: string }) {
  return (
    <button type="button" className={`btn-tool ${clase ?? ''} ${activo ? 'is-active' : ''}`} aria-pressed={activo === undefined ? undefined : activo} disabled={deshabilitado} title={titulo} aria-label={titulo} onClick={onClick}>
      {children}
    </button>
  )
}

export function EditorCuerpo({ contenido, onCambio, onEditor, onVentanaAbierta }: EditorCuerpoProps) {
  const [enlaceAbierto, setEnlaceAbierto] = useState(false)
  const [enlace, setEnlace] = useState('')
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null)
  const [nota, setNota] = useState<NotaAlPie>(NOTA_CERRADA)
  const [imagen, setImagen] = useState<VentanaImagen>(IMAGEN_CERRADA)
  const [videoAbierto, setVideoAbierto] = useState(false)

  const alCambiar = useRef(onCambio)
  useEffect(() => {
    alCambiar.current = onCambio
  }, [onCambio])

  const abrirNota = useCallback((pos: number, contenidoNota: Record<string, unknown>, nueva = false) => {
    setNota({ abierta: true, pos, contenido: contenidoNota, nueva })
  }, [])
  const abrirImagen = useCallback((pos: number, atributos: ImagenAttributes, nueva = false) => {
    setImagen({ abierta: true, pos, atributos, nueva })
  }, [])

  const extensions = useMemo(() => getEditorExtensions({ onOpenFootnoteDialog: abrirNota, onOpenImageDialog: abrirImagen }), [abrirNota, abrirImagen])

  const editor = useEditor({
    extensions,
    content: contenido,
    onUpdate: () => alCambiar.current(),
    editorProps: { attributes: { class: 'main-editor-prosemirror', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texto del artículo' } },
  })

  useEffect(() => {
    onEditor(editor)
    return () => onEditor(null)
  }, [editor, onEditor])

  const hayVentana = nota.abierta || imagen.abierta || videoAbierto
  useEffect(() => {
    onVentanaAbierta?.(hayVentana)
  }, [hayVentana, onVentanaAbierta])

  const estado = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return null
      const esCita = ed.isActive('cita')
      const atributosCita = esCita ? ed.getAttributes('cita') : null
      return {
        parrafo: ed.isActive('paragraph') && !esCita,
        h2: ed.isActive('heading', { level: 2 }),
        h3: ed.isActive('heading', { level: 3 }),
        h4: ed.isActive('heading', { level: 4 }),
        negrita: ed.isActive('bold'),
        cursiva: ed.isActive('italic'),
        enlace: ed.isActive('link'),
        viñetas: ed.isActive('bulletList'),
        numerada: ed.isActive('orderedList'),
        tabla: ed.isActive('table'),
        izquierda: ed.isActive({ textAlign: 'left' }),
        centro: ed.isActive({ textAlign: 'center' }),
        justificado: ed.isActive({ textAlign: 'justify' }),
        cita: esCita,
        citaDestacada: esCita && atributosCita?.variante === 'destacada',
        citaTextual: esCita && (!atributosCita?.variante || atributosCita?.variante === 'textual'),
        citaAutor: (atributosCita?.autor as string | undefined) ?? '',
        citaFuente: (atributosCita?.fuente as string | undefined) ?? '',
        puedeDeshacer: ed.can().undo(),
        puedeRehacer: ed.can().redo(),
      }
    },
  })

  if (!editor || !estado) return <p className="cargando" role="status">Cargando el editor…</p>

  const cadena = () => editor.chain().focus()

  // ---- Nota al pie ----
  const insertarNota = () => {
    const { to } = editor.state.selection
    const vacia = { type: 'doc', content: [{ type: 'paragraph' }] }
    cadena().insertContentAt(to, { type: 'footnote', attrs: { content: vacia } }).run()
    abrirNota(to, vacia, true)
  }
  const borrarNodo = (pos: number, tipo: string) =>
    cadena()
      .command(({ tr, state }) => {
        const nodo = state.doc.nodeAt(pos)
        if (nodo && nodo.type.name === tipo) {
          tr.delete(pos, pos + nodo.nodeSize)
          return true
        }
        return false
      })
      .run()
  const guardarNota = (doc: Record<string, unknown>) => {
    cadena()
      .command(({ tr, state }) => {
        const nodo = state.doc.nodeAt(nota.pos)
        if (nodo && nodo.type.name === 'footnote') {
          tr.setNodeMarkup(nota.pos, undefined, { ...nodo.attrs, content: doc })
          return true
        }
        return false
      })
      .run()
    setNota(NOTA_CERRADA)
  }
  const borrarNota = () => {
    borrarNodo(nota.pos, 'footnote')
    setNota(NOTA_CERRADA)
  }
  const cancelarNota = () => (nota.nueva ? borrarNota() : setNota(NOTA_CERRADA))

  // ---- Imagen ----
  const insertarImagen = () => {
    const vacia: ImagenAttributes = { imagenId: null, src: '', alt: '', decorativa: false, epigrafe: '', altPendiente: false } // una imagen nueva nunca nace pendiente
    cadena().insertImagen(vacia).run()
    let pos = -1
    editor.state.doc.descendants((nodo, posicion) => {
      if (pos === -1 && nodo.type.name === 'imagen' && !nodo.attrs.src) pos = posicion
    })
    if (pos !== -1) abrirImagen(pos, vacia, true)
  }
  const guardarImagen = (atributos: ImagenAttributes) => {
    guardarAtributosImagen(editor, imagen.pos, atributos)
    setImagen(IMAGEN_CERRADA)
  }
  const borrarImagen = () => {
    borrarNodo(imagen.pos, 'imagen')
    setImagen(IMAGEN_CERRADA)
  }
  const cancelarImagen = () => (imagen.nueva ? borrarImagen() : setImagen(IMAGEN_CERRADA))

  // ---- Video y enlace ----
  const insertarVideo = (video: ParsedVideo) => {
    cadena().insertVideo(video).run()
    setVideoAbierto(false)
  }
  const abrirEnlace = () => {
    setEnlace((editor.getAttributes('link').href as string | undefined) ?? '')
    setErrorEnlace(null)
    setEnlaceAbierto(true)
  }
  const aplicarEnlace = () => {
    const direccion = enlace.trim()
    if (!direccion) {
      cadena().unsetLink().run()
    } else if (isAllowedUrl(direccion)) {
      cadena().extendMarkRange('link').setLink({ href: direccion }).run()
    } else {
      setErrorEnlace('Solo se admiten enlaces que empiecen con http://, https:// o mailto:')
      return
    }
    setEnlaceAbierto(false)
    setEnlace('')
  }

  const actualizarCita = (cambios: { variante?: 'textual' | 'destacada'; autor?: string; fuente?: string }) =>
    cadena()
      .updateCita({ variante: cambios.variante ?? (estado.citaDestacada ? 'destacada' : 'textual'), autor: cambios.autor ?? estado.citaAutor, fuente: cambios.fuente ?? estado.citaFuente })
      .run()

  return (
    <div className="editor-cuerpo">
      <div className="toolbar-container" role="toolbar" aria-label="Herramientas del editor">
        <div className="toolbar-group">
          <Herramienta activo={estado.parrafo} titulo="Párrafo normal" onClick={() => cadena().setParagraph().run()}>Párrafo</Herramienta>
          <Herramienta activo={estado.h2} titulo="Título grande (nivel 2)" onClick={() => cadena().toggleHeading({ level: 2 }).run()}>Título 2</Herramienta>
          <Herramienta activo={estado.h3} titulo="Título mediano (nivel 3)" onClick={() => cadena().toggleHeading({ level: 3 }).run()}>Título 3</Herramienta>
          <Herramienta activo={estado.h4} titulo="Título chico (nivel 4)" onClick={() => cadena().toggleHeading({ level: 4 }).run()}>Título 4</Herramienta>
        </div>
        <div className="toolbar-group">
          <Herramienta activo={estado.negrita} titulo="Negrita (Ctrl+B)" onClick={() => cadena().toggleBold().run()}><strong>N</strong></Herramienta>
          <Herramienta activo={estado.cursiva} titulo="Cursiva (Ctrl+I)" onClick={() => cadena().toggleItalic().run()}><em>C</em></Herramienta>
          <Herramienta activo={estado.enlace} titulo="Enlace" onClick={abrirEnlace}>Enlace</Herramienta>
          {estado.enlace && <Herramienta titulo="Quitar enlace" onClick={() => cadena().unsetLink().run()}>Quitar enlace</Herramienta>}
        </div>
        <div className="toolbar-group">
          <Herramienta activo={estado.viñetas} titulo="Lista con viñetas" onClick={() => cadena().toggleBulletList().run()}>Viñetas</Herramienta>
          <Herramienta activo={estado.numerada} titulo="Lista numerada" onClick={() => cadena().toggleOrderedList().run()}>Numerada</Herramienta>
        </div>
        <div className="toolbar-group">
          <Herramienta activo={estado.izquierda} titulo="Alinear a la izquierda" onClick={() => cadena().setTextAlign('left').run()}>Izquierda</Herramienta>
          <Herramienta activo={estado.centro} titulo="Centrar" onClick={() => cadena().setTextAlign('center').run()}>Centro</Herramienta>
          <Herramienta activo={estado.justificado} titulo="Justificar" onClick={() => cadena().setTextAlign('justify').run()}>Justificado</Herramienta>
        </div>
        <div className="toolbar-group">
          <Herramienta activo={estado.citaTextual} titulo="Cita textual, con autor y fuente" onClick={() => cadena().toggleCita({ variante: 'textual' }).run()}>Cita</Herramienta>
          <Herramienta activo={estado.citaDestacada} titulo="Cita destacada, sin autor" onClick={() => cadena().toggleCita({ variante: 'destacada' }).run()}>Cita destacada</Herramienta>
        </div>
        <div className="toolbar-group">
          <Herramienta clase="btn-footnote-add" titulo="Insertar una nota al pie en el cursor" onClick={insertarNota}>Nota al pie</Herramienta>
          <Herramienta titulo="Insertar una imagen de la biblioteca" onClick={insertarImagen}>Imagen</Herramienta>
          <Herramienta titulo="Insertar un video de YouTube o Vimeo" onClick={() => setVideoAbierto(true)}>Video</Herramienta>
          <Herramienta deshabilitado={estado.tabla} titulo="Insertar una tabla de 3 por 3 con fila de encabezado" onClick={() => cadena().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Tabla</Herramienta>
        </div>
        <div className="toolbar-group">
          <Herramienta deshabilitado={!estado.puedeDeshacer} titulo="Deshacer (Ctrl+Z)" onClick={() => cadena().undo().run()}>Deshacer</Herramienta>
          <Herramienta deshabilitado={!estado.puedeRehacer} titulo="Rehacer (Ctrl+Y)" onClick={() => cadena().redo().run()}>Rehacer</Herramienta>
        </div>
      </div>

      {enlaceAbierto && (
        <div className="barra-contextual">
          <label htmlFor="editor-enlace">Dirección del enlace</label>
          <input
            id="editor-enlace"
            type="text"
            placeholder="https://ejemplo.com o mailto:redaccion@ejemplo.com"
            value={enlace}
            onChange={(e) => setEnlace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                aplicarEnlace()
              } else if (e.key === 'Escape') {
                setEnlaceAbierto(false)
              }
            }}
            aria-invalid={errorEnlace !== null}
            autoFocus
          />
          <button type="button" className="boton boton-primario" onClick={aplicarEnlace}>Aplicar</button>
          <button type="button" className="boton boton-suave" onClick={() => setEnlaceAbierto(false)}>Cancelar</button>
          {errorEnlace && <p className="form-error" role="alert">{errorEnlace}</p>}
        </div>
      )}

      {estado.cita && (
        <div className="barra-contextual">
          <label htmlFor="cita-variante">Tipo de cita</label>
          <select id="cita-variante" value={estado.citaDestacada ? 'destacada' : 'textual'} onChange={(e) => actualizarCita({ variante: e.target.value as 'textual' | 'destacada' })}>
            <option value="textual">Cita textual (con autor y fuente)</option>
            <option value="destacada">Cita destacada (sin autor)</option>
          </select>
          {estado.citaTextual && (
            <>
              <label htmlFor="cita-autor">Autor</label>
              <input id="cita-autor" type="text" value={estado.citaAutor} onChange={(e) => actualizarCita({ autor: e.target.value })} />
              <label htmlFor="cita-fuente">Fuente u obra</label>
              <input id="cita-fuente" type="text" value={estado.citaFuente} onChange={(e) => actualizarCita({ fuente: e.target.value })} />
            </>
          )}
        </div>
      )}

      {estado.tabla && (
        <div className="barra-contextual" role="toolbar" aria-label="Opciones de la tabla">
          <span className="barra-contextual-titulo">Tabla</span>
          <button type="button" className="boton boton-suave" onClick={() => cadena().addRowAfter().run()}>Agregar fila</button>
          <button type="button" className="boton boton-suave" onClick={() => cadena().deleteRow().run()}>Eliminar fila</button>
          <button type="button" className="boton boton-suave" onClick={() => cadena().addColumnAfter().run()}>Agregar columna</button>
          <button type="button" className="boton boton-suave" onClick={() => cadena().deleteColumn().run()}>Eliminar columna</button>
          <button type="button" className="boton boton-suave" onClick={() => cadena().toggleHeaderRow().run()}>Alternar fila de encabezado</button>
          <button type="button" className="boton boton-peligro" onClick={() => cadena().deleteTable().run()}>Eliminar tabla</button>
        </div>
      )}

      <div className="editor-area">
        <EditorContent editor={editor} />
      </div>

      <FootnoteDialog isOpen={nota.abierta} initialContent={nota.contenido} isNew={nota.nueva} onSave={guardarNota} onCancel={cancelarNota} onDelete={borrarNota} />
      <ImagenDialog isOpen={imagen.abierta} initialAttrs={imagen.atributos} isNew={imagen.nueva} onSave={guardarImagen} onCancel={cancelarImagen} onDelete={borrarImagen} />
      <VideoDialog isOpen={videoAbierto} onSave={insertarVideo} onCancel={() => setVideoAbierto(false)} />
    </div>
  )
}
