import { useEffect, useState, type FormEvent } from 'react'
import { ErrorApi, pedirApi, urlImagen, type ImagenDeLista, type RespuestaImagenes } from '../api'
import { useAtraparFoco } from './useAtraparFoco'

interface SelectorImagenProps {
  onElegir: (imagen: ImagenDeLista) => void
  onCancelar: () => void
}

// Ventana para elegir una imagen de la biblioteca (hasta el paso 5 no hay subida: solo se eligen las ya cargadas).
export function SelectorImagen({ onElegir, onCancelar }: SelectorImagenProps) {
  const [busqueda, setBusqueda] = useState('')
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<RespuestaImagenes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

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
  }, [q, pagina])

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
          <form className="busqueda" role="search" onSubmit={buscar}>
            <label htmlFor="selector-busqueda" className="solo-lectores">
              Buscar por nombre de archivo
            </label>
            <input id="selector-busqueda" type="search" placeholder="Buscar por nombre de archivo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} maxLength={100} autoFocus />
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
              <li key={imagen.id}>
                <button type="button" className="imagen-opcion" onClick={() => onElegir(imagen)}>
                  <img src={urlImagen(imagen.clave)} alt="" loading="lazy" />
                  <span className="imagen-opcion-nombre">{imagen.nombreOriginal}</span>
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
