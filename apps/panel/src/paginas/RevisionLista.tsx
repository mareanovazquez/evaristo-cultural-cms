import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { tienePermiso } from "@evaristo/compartido/permisos";
import { ErrorApi, pedirApi, type ArticuloDeRevision, type Catalogos, type EstadoArticulo, type RespuestaRevision } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Lista de artículos a revisar, filtrada desde el tablero. En cada fila: abrir el artículo, asignar la sección si está en «Sin asignar»,
// marcar un aviso como revisado (o deshacerlo) y, el administrador, eliminar un borrador.

const NOMBRES: Record<EstadoArticulo, string> = { PUBLICADO: "Publicado", BORRADOR: "Borrador", PROGRAMADO: "Programado" };

function tituloDelFiltro(filtro: string | null, datos: RespuestaRevision | null = null): string {
  if (!filtro) return "Todos los artículos";
  if (filtro === "alt") return "Artículos con imágenes sin texto alternativo";
  if (filtro === "sin-asignar") return "Artículos sin sección";
  if (filtro === "sin-autor") return "Artículos sin autor";
  if (filtro === "borrador-migrado") return "Borradores que vienen de WordPress";
  const etiqueta = (codigo: string) => datos?.articulos.flatMap((a) => a.avisos).find((v) => v.codigo === codigo)?.etiqueta ?? codigo;
  if (filtro.startsWith("aviso:")) return `Por revisar: ${etiqueta(filtro.slice(6))}`;
  if (filtro.startsWith("revisado:")) return `Ya revisados: ${etiqueta(filtro.slice(9))}`;
  if (filtro.startsWith("seccion:")) return "Artículos de una sección";
  return "Artículos";
}

export function RevisionLista() {
  const { usuario, sesionVencida } = useSesion();
  const [params, setParams] = useSearchParams();
  const filtro = params.get("filtro");
  const q = params.get("q") ?? "";
  const paginaTexto = Number(params.get("pagina"));
  const pagina = Number.isInteger(paginaTexto) && paginaTexto >= 1 ? paginaTexto : 1;
  const [datos, setDatos] = useState<RespuestaRevision | null>(null);
  useTitulo(tituloDelFiltro(filtro, datos));
  const [secciones, setSecciones] = useState<Catalogos["secciones"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState(q);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => setBusqueda(q), [q]);

  const falla = useCallback(
    (e: unknown, porDefecto: string): string => {
      if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
      return e instanceof ErrorApi ? (e.problemas[0] ?? e.message) : porDefecto;
    },
    [sesionVencida],
  );

  useEffect(() => {
    pedirApi<Catalogos>("/api/admin/catalogos")
      .then((c) => setSecciones(c.secciones))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const control = new AbortController();
    setCargando(true);
    const consulta = new URLSearchParams();
    if (filtro) consulta.set("filtro", filtro);
    if (q) consulta.set("q", q);
    if (pagina > 1) consulta.set("pagina", String(pagina));
    pedirApi<RespuestaRevision>(`/api/admin/revision/articulos${consulta.size ? `?${consulta}` : ""}`, { signal: control.signal })
      .then((r) => {
        setDatos(r);
        setError(null);
        setCargando(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(falla(e, "No se pudieron cargar los artículos."));
        setCargando(false);
      });
    return () => control.abort();
  }, [filtro, q, pagina, recarga, falla]);

  const irA = (cambios: Record<string, string | null>) => {
    const siguiente = new URLSearchParams(params);
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) siguiente.set(clave, valor);
      else siguiente.delete(clave);
    }
    setParams(siguiente);
  };
  const buscar = (e: FormEvent) => {
    e.preventDefault();
    irA({ q: busqueda.trim() || null, pagina: null });
  };

  const cambiarFila = (id: number, cambio: (a: ArticuloDeRevision) => ArticuloDeRevision) => setDatos((d) => (d ? { ...d, articulos: d.articulos.map((a) => (a.id === id ? cambio(a) : a)) } : d));

  async function revisar(a: ArticuloDeRevision, codigo: string, revisado: boolean) {
    setError(null);
    setAviso(null);
    try {
      const r = await pedirApi<{ por: string | null }>(`/api/admin/articulos/${a.id}/avisos`, { metodo: "POST", cuerpo: { codigo, revisado } });
      cambiarFila(a.id, (x) => ({ ...x, avisos: x.avisos.map((v) => (v.codigo === codigo ? { ...v, revisado, por: r.por, en: revisado ? new Date().toISOString() : null } : v)) }));
      setAviso(revisado ? "Marcamos el aviso como revisado." : "Volvió a quedar pendiente.");
    } catch (e) {
      setError(falla(e, "No se pudo marcar el aviso."));
    }
  }

  async function asignarSeccion(a: ArticuloDeRevision, seccionId: number) {
    setError(null);
    setAviso(null);
    try {
      await pedirApi(`/api/admin/articulos/${a.id}/seccion`, { metodo: "POST", cuerpo: { seccionId } });
      const nombre = secciones.find((s) => s.id === seccionId)?.nombre ?? "la sección elegida";
      cambiarFila(a.id, (x) => ({ ...x, seccion: { id: seccionId, nombre, interna: false } }));
      setAviso(`«${a.titulo}» quedó en ${nombre}.`);
      // Si se está mirando la cola de «Sin asignar», el artículo sale de ella.
      if (filtro === "sin-asignar") setRecarga((n) => n + 1);
    } catch (e) {
      setError(falla(e, "No se pudo asignar la sección."));
    }
  }

  async function eliminar(a: ArticuloDeRevision) {
    if (!window.confirm(`¿Eliminar el borrador «${a.titulo}»? No se puede deshacer. Las imágenes quedan en la biblioteca.`)) return;
    setError(null);
    setAviso(null);
    try {
      await pedirApi(`/api/admin/articulos/${a.id}`, { metodo: "DELETE" });
      setAviso(`Eliminamos el borrador «${a.titulo}».`);
      setRecarga((n) => n + 1);
    } catch (e) {
      setError(falla(e, "No se pudo eliminar el borrador."));
    }
  }

  const puedeEliminar = !!usuario && tienePermiso(usuario.rol, "articulos.eliminar");

  return (
    <section>
      <p className="migas">
        <Link to="/revision">← Revisión de la migración</Link>
      </p>
      <div className="listado-encabezado">
        <h1>{tituloDelFiltro(filtro, datos)}</h1>
      </div>

      <form className="busqueda" role="search" onSubmit={buscar}>
        <label htmlFor="busqueda-revision" className="solo-lectores">
          Buscar por título
        </label>
        <input id="busqueda-revision" type="search" placeholder="Buscar por título" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} maxLength={100} />
        <button type="submit" className="boton boton-primario">
          Buscar
        </button>
        {q && (
          <button type="button" className="boton boton-suave" onClick={() => irA({ q: null, pagina: null })}>
            Quitar búsqueda
          </button>
        )}
      </form>

      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}
      {aviso && (
        <p className="aviso aviso-ok" role="status">
          {aviso}
        </p>
      )}

      <div className={cargando ? "tabla-envoltorio cargando-tabla" : "tabla-envoltorio"} aria-busy={cargando}>
        {datos && datos.articulos.length > 0 && (
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Artículo</th>
                <th scope="col">Sección</th>
                <th scope="col">Avisos</th>
                <th scope="col">
                  <span className="solo-lectores">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.articulos.map((a) => (
                <tr key={a.id}>
                  <td className="celda-titulo">
                    <Link className="titulo-articulo" to={`/articulos/${a.id}`}>
                      {a.titulo}
                    </Link>
                    <span className="ayuda">
                      <span className={`estado estado-${a.estado.toLowerCase()}`}>{NOMBRES[a.estado]}</span> · {a.autores.length ? a.autores.join(", ") : "Sin autor"}
                    </span>
                    {a.ruta && (
                      <a className="ver-en-sitio" href={a.ruta} target="_blank" rel="noopener noreferrer">
                        Ver en el sitio
                      </a>
                    )}
                  </td>
                  <td>
                    {a.seccion.interna ? (
                      <SeleccionSeccion secciones={secciones} titulo={a.titulo} alAsignar={(id) => asignarSeccion(a, id)} />
                    ) : (
                      a.seccion.nombre
                    )}
                  </td>
                  <td>
                    {a.altPendientes > 0 && <span className="etiqueta etiqueta-alerta">{a.altPendientes === 1 ? "1 imagen sin texto alternativo" : `${a.altPendientes} imágenes sin texto alternativo`}</span>}
                    <ul className="lista-sin-estilo avisos-fila">
                      {a.avisos.map((v) => (
                        <li key={v.codigo} className={v.revisado ? "aviso-revisado" : undefined}>
                          <span>{v.etiqueta}</span>
                          {v.revisado ? (
                            <>
                              <span className="ayuda"> · revisado por {v.por ?? "alguien"}</span>
                              <button type="button" className="boton boton-suave" onClick={() => void revisar(a, v.codigo, false)} aria-label={`Deshacer: ${v.etiqueta} en ${a.titulo}`}>
                                Deshacer
                              </button>
                            </>
                          ) : (
                            <button type="button" className="boton boton-suave" onClick={() => void revisar(a, v.codigo, true)} aria-label={`Marcar como revisado: ${v.etiqueta} en ${a.titulo}`}>
                              Marcar revisado
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {a.avisos.length === 0 && a.altPendientes === 0 && <span className="ayuda">Sin avisos</span>}
                  </td>
                  <td>
                    <span className="acciones-fila">
                      <Link className="boton boton-suave boton-enlace" to={`/articulos/${a.id}`}>
                        Abrir<span className="solo-lectores"> {a.titulo}</span>
                      </Link>
                      {puedeEliminar && a.estado === "BORRADOR" && (
                        <button type="button" className="boton boton-peligro" onClick={() => void eliminar(a)}>
                          Eliminar<span className="solo-lectores"> el borrador {a.titulo}</span>
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {datos && datos.articulos.length === 0 && !error && <p className="vacio">No hay artículos para revisar acá. 🎉</p>}
        {!datos && cargando && (
          <p className="cargando" role="status">
            Cargando…
          </p>
        )}
      </div>

      {datos && datos.paginas > 1 && (
        <nav className="paginacion" aria-label="Páginas de la lista">
          {pagina > 1 ? (
            <button type="button" className="boton boton-suave" onClick={() => irA({ pagina: pagina - 1 > 1 ? String(pagina - 1) : null })}>
              ← Anterior
            </button>
          ) : (
            <span />
          )}
          <span>
            Página {datos.pagina} de {datos.paginas} · {datos.total} artículos
          </span>
          {pagina < datos.paginas ? (
            <button type="button" className="boton boton-suave" onClick={() => irA({ pagina: String(pagina + 1) })}>
              Siguiente →
            </button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}

function SeleccionSeccion({ secciones, titulo, alAsignar }: { secciones: Catalogos["secciones"]; titulo: string; alAsignar: (seccionId: number) => Promise<void> }) {
  const [elegida, setElegida] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <div className="asignar-seccion">
      <span className="etiqueta etiqueta-alerta">Sin sección</span>
      <label className="solo-lectores" htmlFor={`seccion-${titulo}`}>
        Sección para {titulo}
      </label>
      <select id={`seccion-${titulo}`} value={elegida} onChange={(e) => setElegida(e.target.value)}>
        <option value="">Elegí una sección</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="boton boton-suave"
        disabled={!elegida || enviando}
        onClick={() => {
          setEnviando(true);
          void alAsignar(Number(elegida)).finally(() => setEnviando(false));
        }}
      >
        Asignar<span className="solo-lectores"> sección a {titulo}</span>
      </button>
    </div>
  );
}
