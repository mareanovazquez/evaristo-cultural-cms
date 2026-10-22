import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorApi, pedirApi, type Catalogos } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Alta de un artículo: solo título y sección. Se crea como borrador y se sigue en la pantalla de edición.
export function NuevoArticulo() {
  useTitulo("Nuevo artículo");
  const { sesionVencida } = useSesion();
  const navegar = useNavigate();
  const [secciones, setSecciones] = useState<Catalogos["secciones"] | null>(null);
  const [titulo, setTitulo] = useState("");
  const [seccionId, setSeccionId] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);

  useEffect(() => {
    const control = new AbortController();
    pedirApi<Catalogos>("/api/admin/catalogos", { signal: control.signal })
      .then((c) => setSecciones(c.secciones))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ErrorApi && e.estado === 401) {
          sesionVencida();
          return;
        }
        setError(e instanceof ErrorApi ? e.message : "No se pudieron cargar las secciones.");
      });
    return () => control.abort();
  }, [sesionVencida]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (creando) return;
    setError(null);
    setProblemas([]);
    if (!titulo.trim()) {
      setError("Escribí el título del artículo.");
      return;
    }
    if (!seccionId) {
      setError("Elegí una sección.");
      return;
    }
    setCreando(true);
    try {
      const r = await pedirApi<{ id: number }>("/api/admin/articulos", { metodo: "POST", cuerpo: { titulo: titulo.trim(), seccionId: Number(seccionId) } });
      navegar(`/articulos/${r.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ErrorApi && err.estado === 401) {
        sesionVencida();
        return;
      }
      setError(err instanceof ErrorApi ? err.message : "No se pudo crear el artículo.");
      if (err instanceof ErrorApi) setProblemas(err.problemas);
      setCreando(false);
    }
  };

  return (
    <section className="pantalla">
      <p className="migas">
        <Link to="/">← Volver a los artículos</Link>
      </p>
      <h1>Nuevo artículo</h1>
      <form onSubmit={(e) => void crear(e)} noValidate>
        {error && (
          <div className="aviso aviso-error" role="alert">
            <p>{error}</p>
            {problemas.length > 0 && (
              <ul>
                {problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="campo">
          <label htmlFor="nuevo-titulo">Título</label>
          <input id="nuevo-titulo" type="text" value={titulo} maxLength={512} onChange={(e) => setTitulo(e.target.value)} autoFocus />
        </div>
        <div className="campo">
          <label htmlFor="nueva-seccion">Sección</label>
          <select id="nueva-seccion" value={seccionId} onChange={(e) => setSeccionId(e.target.value)} disabled={!secciones}>
            <option value="">{secciones ? "Elegí una sección…" : "Cargando secciones…"}</option>
            {secciones?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        <p className="ayuda">Se crea como borrador: no se ve en el sitio hasta que lo publiques.</p>
        <button type="submit" className="boton boton-primario" disabled={creando}>
          {creando ? "Creando…" : "Crear y empezar a escribir"}
        </button>
      </form>
    </section>
  );
}
