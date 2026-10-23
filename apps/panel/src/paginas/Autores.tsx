import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { tienePermiso } from "@evaristo/compartido/permisos";
import { ErrorApi, pedirApi, type RespuestaAutores } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Listado de autores (son unos 424): búsqueda por nombre o dirección, filtros por lo que falta completar, y alta de un autor nuevo.
// Lo ven los editores y los administradores; un Redactor llega solo a su propia ficha (menú «Mi ficha»).

const FILTROS: Array<{ valor: string | null; titulo: string }> = [
  { valor: null, titulo: "Todos" },
  { valor: "sin-bio", titulo: "Sin bio" },
  { valor: "sin-foto", titulo: "Sin foto" },
  { valor: "sin-alt", titulo: "Foto sin texto alternativo" },
  { valor: "solo-texto", titulo: "No son personas" },
  { valor: "con-usuario", titulo: "Con usuario del panel" },
];
const FILTROS_VALIDOS = new Set(FILTROS.map((f) => f.valor).filter(Boolean));

export function Autores() {
  useTitulo("Autores");
  const { usuario, sesionVencida } = useSesion();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const filtroParam = params.get("filtro");
  const filtro = filtroParam && FILTROS_VALIDOS.has(filtroParam) ? filtroParam : null;
  const q = params.get("q") ?? "";
  const paginaTexto = Number(params.get("pagina"));
  const pagina = Number.isInteger(paginaTexto) && paginaTexto >= 1 ? paginaTexto : 1;

  const [busqueda, setBusqueda] = useState(q);
  const [datos, setDatos] = useState<RespuestaAutores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [errorNuevo, setErrorNuevo] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  useEffect(() => setBusqueda(q), [q]);

  useEffect(() => {
    const control = new AbortController();
    setCargando(true);
    setError(null);
    const consulta = new URLSearchParams();
    if (filtro) consulta.set("filtro", filtro);
    if (q) consulta.set("q", q);
    if (pagina > 1) consulta.set("pagina", String(pagina));
    pedirApi<RespuestaAutores>(`/api/admin/autores${consulta.size ? `?${consulta}` : ""}`, { signal: control.signal })
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
        setError(e instanceof ErrorApi ? e.message : "No se pudieron cargar los autores.");
        setCargando(false);
      });
    return () => control.abort();
  }, [filtro, q, pagina, sesionVencida]);

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

  async function crear(e: FormEvent) {
    e.preventDefault();
    setErrorNuevo(null);
    if (!nombreNuevo.trim()) {
      setErrorNuevo("Escribí el nombre del autor.");
      return;
    }
    setCreando(true);
    try {
      const r = await pedirApi<{ id: number }>("/api/admin/autores", { metodo: "POST", cuerpo: { nombre: nombreNuevo } });
      void navegar(`/autores/${r.id}`);
    } catch (e_) {
      if (e_ instanceof ErrorApi && e_.estado === 401) sesionVencida();
      setErrorNuevo(e_ instanceof ErrorApi ? (e_.problemas[0] ?? e_.message) : "No se pudo crear el autor. Probá de nuevo.");
    } finally {
      setCreando(false);
    }
  }

  return (
    <section>
      <div className="listado-encabezado">
        <h1>Autores</h1>
        {usuario && tienePermiso(usuario.rol, "autores.crear") && (
          <button type="button" className="boton boton-primario" aria-expanded={nuevo} onClick={() => setNuevo((v) => !v)}>
            {nuevo ? "Cerrar" : "Nuevo autor"}
          </button>
        )}
      </div>

      {nuevo && (
        <form className="grupo" onSubmit={(e) => void crear(e)} noValidate aria-label="Nuevo autor">
          <div className="campo">
            <label htmlFor="autor-nuevo">Nombre del autor</label>
            <input id="autor-nuevo" type="text" value={nombreNuevo} autoFocus maxLength={255} onChange={(e) => setNombreNuevo(e.target.value)} />
            <p className="ayuda">Después completás la bio, la foto y las redes. La dirección se arma sola desde el nombre.</p>
          </div>
          {errorNuevo && (
            <p className="aviso aviso-error" role="alert">
              {errorNuevo}
            </p>
          )}
          <button type="submit" className="boton boton-primario" disabled={creando}>
            {creando ? "Creando…" : "Crear autor"}
          </button>
        </form>
      )}

      <form className="busqueda" role="search" onSubmit={buscar}>
        <label htmlFor="busqueda-autores" className="solo-lectores">
          Buscar por nombre
        </label>
        <input id="busqueda-autores" type="search" placeholder="Buscar por nombre" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} maxLength={100} />
        <button type="submit" className="boton boton-primario">
          Buscar
        </button>
        {q && (
          <button type="button" className="boton boton-suave" onClick={() => irA({ q: null, pagina: null })}>
            Quitar búsqueda
          </button>
        )}
      </form>

      <nav className="solapas" aria-label="Qué autores mostrar">
        {FILTROS.map((f) => (
          <button key={f.titulo} type="button" className="solapa" aria-current={f.valor === filtro ? "true" : undefined} onClick={() => irA({ filtro: f.valor, pagina: null })}>
            {f.titulo}
          </button>
        ))}
      </nav>

      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}

      <div className={cargando ? "tabla-envoltorio cargando-tabla" : "tabla-envoltorio"} aria-busy={cargando}>
        {datos && datos.autores.length > 0 && (
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Artículos</th>
                <th scope="col">Ficha</th>
                <th scope="col">Usuario</th>
              </tr>
            </thead>
            <tbody>
              {datos.autores.map((a) => (
                <tr key={a.id}>
                  <td className="celda-titulo">
                    <Link className="titulo-articulo" to={`/autores/${a.id}`}>
                      {a.nombre}
                    </Link>
                    <span className="ayuda">/author/{a.slug}/</span>
                  </td>
                  <td>{a.articulos}</td>
                  <td>
                    {a.soloTexto ? (
                      <span className="etiqueta">No es una persona</span>
                    ) : (
                      <>
                        {!a.conBio && <span className="etiqueta etiqueta-alerta">Sin bio</span>} {!a.conFoto && <span className="etiqueta etiqueta-alerta">Sin foto</span>}
                        {a.fotoSinAlt && <span className="etiqueta etiqueta-alerta">Foto sin texto alternativo</span>}
                        {a.conBio && a.conFoto && !a.fotoSinAlt && <span className="ayuda">Completa</span>}
                      </>
                    )}
                  </td>
                  <td>{a.usuario ? a.usuario.nombre : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {datos && datos.autores.length === 0 && !error && <p className="vacio">{q || filtro ? "No hay autores que coincidan con la búsqueda." : "Todavía no hay autores."}</p>}
        {!datos && cargando && (
          <p className="cargando" role="status">
            Cargando autores…
          </p>
        )}
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
            Página {datos.pagina} de {datos.paginas} · {datos.total} autores
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
