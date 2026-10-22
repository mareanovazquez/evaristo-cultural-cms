import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorApi, pedirApi, type EstadoArticulo, type RespuestaLista } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

const NOMBRES: Record<EstadoArticulo, string> = { PUBLICADO: "Publicado", BORRADOR: "Borrador", PROGRAMADO: "Programado" };
const SOLAPAS: Array<{ estado: EstadoArticulo | null; titulo: string }> = [
  { estado: null, titulo: "Todos" },
  { estado: "PUBLICADO", titulo: "Publicados" },
  { estado: "BORRADOR", titulo: "Borradores" },
  { estado: "PROGRAMADO", titulo: "Programados" },
];

const fechaPublicacion = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" });
const fechaEdicion = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

function estadoValido(v: string | null): EstadoArticulo | null {
  return v === "PUBLICADO" || v === "BORRADOR" || v === "PROGRAMADO" ? v : null;
}

export function Articulos() {
  useTitulo("Artículos");
  const { sesionVencida } = useSesion();
  const [params, setParams] = useSearchParams();
  const estado = estadoValido(params.get("estado"));
  const q = params.get("q") ?? "";
  const paginaTexto = Number(params.get("pagina"));
  const pagina = Number.isInteger(paginaTexto) && paginaTexto >= 1 ? paginaTexto : 1;

  const [busqueda, setBusqueda] = useState(q);
  const [datos, setDatos] = useState<RespuestaLista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  // Si cambia la búsqueda desde afuera (botón Atrás, enlace), el cuadro la acompaña.
  useEffect(() => setBusqueda(q), [q]);

  useEffect(() => {
    const control = new AbortController();
    setCargando(true);
    setError(null);
    const consulta = new URLSearchParams();
    if (estado) consulta.set("estado", estado);
    if (q) consulta.set("q", q);
    if (pagina > 1) consulta.set("pagina", String(pagina));
    pedirApi<RespuestaLista>(`/api/admin/articulos${consulta.size ? `?${consulta}` : ""}`, { signal: control.signal })
      .then((r) => {
        setDatos(r);
        setCargando(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ErrorApi && e.estado === 401) {
          sesionVencida();
          return;
        }
        setError(e instanceof ErrorApi ? e.message : "No se pudieron cargar los artículos.");
        setCargando(false);
      });
    return () => control.abort();
  }, [estado, q, pagina, sesionVencida]);

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

  const total = datos ? datos.conteos.BORRADOR + datos.conteos.PUBLICADO + datos.conteos.PROGRAMADO : 0;

  return (
    <section>
      <div className="listado-encabezado">
        <h1>Artículos</h1>
        <Link to="/articulos/nuevo" className="boton boton-primario boton-enlace">
          Nuevo artículo
        </Link>
      </div>

      <form className="busqueda" role="search" onSubmit={buscar}>
        <label htmlFor="busqueda" className="solo-lectores">
          Buscar por título
        </label>
        <input id="busqueda" type="search" placeholder="Buscar por título" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} maxLength={100} />
        <button type="submit" className="boton boton-primario">
          Buscar
        </button>
        {q && (
          <button type="button" className="boton boton-suave" onClick={() => irA({ q: null, pagina: null })}>
            Quitar búsqueda
          </button>
        )}
      </form>

      <nav className="solapas" aria-label="Estado de los artículos">
        {SOLAPAS.map((s) => {
          const cantidad = datos ? (s.estado ? datos.conteos[s.estado] : total) : null;
          return (
            <button key={s.titulo} type="button" className="solapa" aria-current={s.estado === estado ? "true" : undefined} onClick={() => irA({ estado: s.estado, pagina: null })}>
              {s.titulo}
              {cantidad !== null && <span className="solapa-cantidad">{cantidad}</span>}
            </button>
          );
        })}
      </nav>

      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}

      <div className={cargando ? "tabla-envoltorio cargando-tabla" : "tabla-envoltorio"} aria-busy={cargando}>
        {datos && datos.articulos.length > 0 && (
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Título</th>
                <th scope="col">Sección</th>
                <th scope="col">Autoría</th>
                <th scope="col">Estado</th>
                <th scope="col">Publicación</th>
                <th scope="col">Última edición</th>
              </tr>
            </thead>
            <tbody>
              {datos.articulos.map((a) => (
                <tr key={a.id}>
                  <td className="celda-titulo">
                    <Link className="titulo-articulo" to={`/articulos/${a.id}`}>
                      {a.titulo}
                    </Link>
                    {a.altPendientes > 0 && <span className="etiqueta etiqueta-alerta">{a.altPendientes === 1 ? "1 imagen sin texto alternativo" : `${a.altPendientes} imágenes sin texto alternativo`}</span>}
                    {a.ruta && (
                      <a className="ver-en-sitio" href={a.ruta} target="_blank" rel="noopener noreferrer">
                        Ver en el sitio
                      </a>
                    )}
                  </td>
                  <td>{a.seccion}</td>
                  <td>{a.autores.length ? a.autores.join(", ") : "—"}</td>
                  <td>
                    <span className={`estado estado-${a.estado.toLowerCase()}`}>{NOMBRES[a.estado]}</span>
                  </td>
                  <td>{a.publicadoEn ? fechaPublicacion.format(new Date(a.publicadoEn)) : "—"}</td>
                  <td>{fechaEdicion.format(new Date(a.actualizadoEn))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {datos && datos.articulos.length === 0 && !error && (
          <p className="vacio">{q || estado ? "No hay artículos que coincidan con la búsqueda." : "Todavía no hay artículos."}</p>
        )}
        {!datos && cargando && <p className="cargando" role="status">Cargando artículos…</p>}
      </div>

      {datos && datos.paginas > 1 && (
        <nav className="paginacion" aria-label="Páginas del listado">
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
