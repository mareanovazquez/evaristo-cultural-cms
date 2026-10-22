import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ErrorApi, MAX_BYTES_IMAGEN, pedirApi, subirArchivo, urlImagen, type ImagenDeLista, type RespuestaImagenes, type RespuestaSubida } from '../api'
import { useAtraparFoco } from './useAtraparFoco'

interface SelectorImagenProps {
  onElegir: (imagen: ImagenDeLista) => void
  onCancelar: () => void
}

const TIPOS_ACEPTADOS = 'image/jpeg,image/png,image/webp,image/gif'

// Ventana para elegir una imagen de la biblioteca, subir una nueva o borrar una que no se use.
export function SelectorImagen({ onElegir, onCancelar }: SelectorImagenProps) {
  const [busqueda, setBusqueda] = useState('')
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(1)
  // Cambia cuando hay que volver a pedir la lista (después de subir o de borrar).
  const [lectura, setLectura] = useState(0)
  const [datos, setDatos] = useState<RespuestaImagenes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [subida, setSubida] = useState<RespuestaSubida | null>(null)
  const [errorSubida, setErrorSubida] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const campoArchivo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const control = new AbortController()
    setCargando(true)
    setError(null)
    const consulta = new URLSearchParams()
    if (q) consulta.set('q', q)
    if (pagina > 1) consulta.set('pagina', String(pagina))
    pedirApi<RespuestaImagenes>(`/api/admin/imagenes${consulta.size ? `?${consulta}` : ''}`, { signal: control.signal })
      .then((r) => {
        setDatos(r)
        setCargando(false)
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof ErrorApi ? e.message : 'No se pudieron cargar las imágenes.')
        setCargando(false)
      })
    return () => control.abort()
  }, [q, pagina, lectura])

  useAtraparFoco(true)

  useEffect(() => {
    const alApretar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancelar()
      }
    }
    window.addEventListener('keydown', alApretar)
    return () => window.removeEventListener('keydown', alApretar)
  }, [onCancelar])

  const buscar = (e: FormEvent) => {
    e.preventDefault()
    setPagina(1)
    setQ(busqueda.trim())
  }

  const alElegirArchivo = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!archivo) return
    setErrorSubida(null)
    setAviso(null)
    if (archivo.size > MAX_BYTES_IMAGEN) {
      setErrorSubida(`La imagen pesa más de ${MAX_BYTES_IMAGEN / 1024 / 1024} MB. Reducila y probá de nuevo.`)
      return
    }
    setSubiendo(true)
    try {
      const r = await subirArchivo<RespuestaSubida>('/api/admin/imagenes', 'archivo', archivo)
      setSubida(r)
      // La imagen nueva aparece al principio de la biblioteca.
      setQ('')
      setBusqueda('')
      setPagina(1)
      setLectura((n) => n + 1)
    } catch (err) {
      setErrorSubida(err instanceof ErrorApi ? err.message : 'No se pudo subir la imagen. Probá de nuevo.')
    } finally {
      setSubiendo(false)
    }
  }

  const borrar = async (imagen: ImagenDeLista) => {
    if (!window.confirm(`¿Borrar la imagen «${imagen.nombreOriginal}»? No se puede deshacer.`)) return
    setAviso(null)
    setErrorSubida(null)
    try {
      await pedirApi(`/api/admin/imagenes/${imagen.id}`, { metodo: 'DELETE' })
      if (subida?.imagen.id === imagen.id) setSubida(null)
      setAviso(`Se borró la imagen «${imagen.nombreOriginal}».`)
      setLectura((n) => n + 1)
    } catch (err) {
      setErrorSubida(err instanceof ErrorApi ? err.message : 'No se pudo borrar la imagen. Probá de nuevo.')
    }
  }

  return (
    <div className="modal-overlay modal-encima" role="dialog" aria-modal="true" aria-labelledby="selector-imagen-titulo">
      <div className="modal-container modal-ancho">
        <div className="modal-header">
          <h3 id="selector-imagen-titulo">Elegir una imagen</h3>
          <button type="button" className="btn-close" onClick={onCancelar} aria-label="Cerrar ventana">
            ×
          </button>
        </div>
        <div className="modal-body modal-alto">
          <div className="subida">
            <label htmlFor="selector-subir" className="subida-etiqueta">
              Subir una imagen nueva
            </label>
            <input id="selector-subir" ref={campoArchivo} type="file" accept={TIPOS_ACEPTADOS} onChange={(e) => void alElegirArchivo(e)} disabled={subiendo} />
            <p className="ayuda">JPEG, PNG, WebP o GIF, de hasta {MAX_BYTES_IMAGEN / 1024 / 1024} MB.</p>
            {subiendo && (
              <p className="cargando" role="status">
                Subiendo la imagen…
              </p>
            )}
            {errorSubida && (
              <p className="aviso aviso-error" role="alert">
                {errorSubida}
              </p>
            )}
            {aviso && (
              <p className="aviso aviso-ok" role="status">
                {aviso}
              </p>
            )}
            {subida && (
              <div className="subida-lista" role="status">
                <img src={urlImagen(subida.imagen.clave)} alt="" />
                <div>
                  <p>
                    <strong>{subida.repetida ? 'Esta imagen ya estaba en la biblioteca.' : 'Imagen subida.'}</strong> {subida.imagen.nombreOriginal}
                    {subida.repetida && ' Se usa la que ya estaba, no se guardó otra copia.'}
                  </p>
                  <div className="acciones-fila">
                    <button type="button" className="boton boton-primario" onClick={() => onElegir(subida.imagen)}>
                      Usar esta imagen
                    </button>
                    <button type="button" className="boton boton-suave" onClick={() => setSubida(null)}>
                      Subir otra
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <h4 className="subtitulo-biblioteca">Biblioteca</h4>
          <form className="busqueda" role="search" onSubmit={buscar}>
            <label htmlFor="selector-busqueda" className="solo-lectores">
              Buscar por nombre de archivo
            </label>
            <input id="selector-busqueda" type="search" placeholder="Buscar por nombre de archivo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} maxLength={100} />
            <button type="submit" className="boton boton-primario">
              Buscar
            </button>
          </form>
          {error && (
            <p className="aviso aviso-error" role="alert">
              {error}
            </p>
          )}
          {datos && datos.imagenes.length === 0 && !error && <p className="vacio">{q ? 'No hay imágenes con ese nombre.' : 'Todavía no hay imágenes cargadas.'}</p>}
          <ul className={cargando ? 'galeria-imagenes cargando-tabla' : 'galeria-imagenes'} aria-busy={cargando}>
            {datos?.imagenes.map((imagen) => (
              <li key={imagen.id} className="imagen-item">
                <button type="button" className="imagen-opcion" onClick={() => onElegir(imagen)}>
                  <img src={urlImagen(imagen.clave)} alt="" loading="lazy" />
                  <span className="imagen-opcion-nombre">{imagen.nombreOriginal}</span>
                </button>
                <button type="button" className="imagen-borrar" aria-label={`Borrar la imagen ${imagen.nombreOriginal}`} onClick={() => void borrar(imagen)}>
                  Borrar
                </button>
              </li>
            ))}
          </ul>
          {!datos && cargando && (
            <p className="cargando" role="status">
              Cargando imágenes…
            </p>
          )}
        </div>
        <div className="modal-footer">
          <div className="paginacion-selector">
            {datos && datos.paginas > 1 && (
              <>
                <button type="button" className="boton boton-suave" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                  ← Anterior
                </button>
                <span>
                  Página {datos.pagina} de {datos.paginas}
                </span>
                <button type="button" className="boton boton-suave" disabled={pagina >= datos.paginas} onClick={() => setPagina(pagina + 1)}>
                  Siguiente →
                </button>
              </>
            )}
          </div>
          <button type="button" className="boton boton-suave" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
