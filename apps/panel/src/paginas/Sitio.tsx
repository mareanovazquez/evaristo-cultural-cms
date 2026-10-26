import { useEffect, useState, type FormEvent } from "react";
import { TOPBAR_ENLACE_MAX, TOPBAR_TEXTO_MAX, type Topbar } from "@evaristo/compartido/sitio";
import { ErrorApi, pedirApi } from "../api";
import { BannerAdmin } from "../BannerAdmin";
import { useAvisarAlSalir } from "../salida";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Configuración del sitio (solo administrador): el topbar, la franja de arriba del sitio público (un interruptor para mostrarlo u ocultarlo,
// el texto y un enlace opcional, con una vista de cómo queda) y el banner de la portada. El footer no se edita acá (es fijo en el código, decisión 75).

interface Campos {
  activo: boolean;
  texto: string;
  enlace: string;
}

const aCampos = (t: Topbar): Campos => ({ activo: t.activo, texto: t.texto, enlace: t.enlace ?? "" });
const igual = (a: Campos, b: Campos): boolean => a.activo === b.activo && a.texto === b.texto && a.enlace === b.enlace;

export function Sitio() {
  useTitulo("Configuración del sitio");
  const { sesionVencida } = useSesion();
  const [guardado, setGuardado] = useState<Campos | null>(null);
  const [campos, setCampos] = useState<Campos>({ activo: true, texto: "", enlace: "" });
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [bannerConCambios, setBannerConCambios] = useState(false);

  useEffect(() => {
    const control = new AbortController();
    pedirApi<{ topbar: Topbar }>("/api/admin/sitio", { signal: control.signal })
      .then((r) => {
        setGuardado(aCampos(r.topbar));
        setCampos(aCampos(r.topbar));
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
        setErrorCarga(e instanceof ErrorApi ? e.message : "No pudimos cargar la configuración. Recargá la pantalla.");
      });
    return () => control.abort();
  }, [sesionVencida]);

  const hayCambios = guardado !== null && !igual(campos, guardado);
  useAvisarAlSalir(hayCambios || bannerConCambios);

  const poner = (cambio: Partial<Campos>) => {
    setCampos((c) => ({ ...c, ...cambio }));
    setOk(false);
    setProblemas([]);
  };

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    setProblemas([]);
    setGuardando(true);
    try {
      const r = await pedirApi<{ topbar: Topbar }>("/api/admin/sitio", {
        metodo: "PUT",
        cuerpo: { topbar: { activo: campos.activo, texto: campos.texto, enlace: campos.enlace.trim() === "" ? null : campos.enlace } },
      });
      setGuardado(aCampos(r.topbar));
      setCampos(aCampos(r.topbar));
      setOk(true);
    } catch (e_) {
      if (e_ instanceof ErrorApi && e_.estado === 401) sesionVencida();
      setProblemas(e_ instanceof ErrorApi ? (e_.problemas.length ? e_.problemas : [e_.message]) : ["No se pudo guardar. Probá de nuevo."]);
    } finally {
      setGuardando(false);
    }
  }

  if (errorCarga)
    return (
      <section className="pantalla">
        <h1>Configuración del sitio</h1>
        <p className="aviso aviso-error" role="alert">
          {errorCarga}
        </p>
      </section>
    );
  if (!guardado) return <p className="cargando" role="status">Cargando…</p>;

  const seMuestra = campos.activo && campos.texto.trim() !== "";

  return (
    <section className="pantalla">
      <h1>Configuración del sitio</h1>
      <p className="ayuda">Lo que se ve en el sitio público. Los cambios aparecen apenas los guardás.</p>

      <form className="grupo" onSubmit={(e) => void guardar(e)} noValidate>
        <h2 className="grupo-titulo">Topbar</h2>
        <p className="ayuda">La franja que está arriba de todo en cada página del sitio.</p>

        <label className="interruptor">
          <input type="checkbox" role="switch" checked={campos.activo} onChange={(e) => poner({ activo: e.target.checked })} />
          <span className="interruptor-pista" aria-hidden="true" />
          <span>{campos.activo ? "Se muestra en el sitio" : "Está oculto"}</span>
        </label>

        <div className="campo">
          <label htmlFor="topbar-texto">Texto</label>
          <input id="topbar-texto" type="text" maxLength={TOPBAR_TEXTO_MAX} value={campos.texto} onChange={(e) => poner({ texto: e.target.value })} aria-describedby="topbar-texto-ayuda" />
          <p className="ayuda" id="topbar-texto-ayuda">
            Una sola línea, sin formato. {campos.texto.length} de {TOPBAR_TEXTO_MAX} caracteres.
          </p>
        </div>

        <div className="campo">
          <label htmlFor="topbar-enlace">Enlace (opcional)</label>
          <input id="topbar-enlace" type="text" inputMode="url" maxLength={TOPBAR_ENLACE_MAX} placeholder="https://" value={campos.enlace} onChange={(e) => poner({ enlace: e.target.value })} aria-describedby="topbar-enlace-ayuda" />
          <p className="ayuda" id="topbar-enlace-ayuda">
            A dónde lleva el texto. Empieza con https:// (o con / si es una página de este sitio). Sin enlace, el texto se muestra solo.
          </p>
        </div>

        <h3 className="vista-titulo">Así queda</h3>
        {seMuestra ? (
          <div className="vista-topbar" role="img" aria-label={`Vista previa del topbar: ${campos.texto}`}>
            <span className={campos.enlace.trim() === "" ? "" : "vista-topbar-enlace"}>{campos.texto}</span>
          </div>
        ) : (
          <p className="vista-topbar-vacio">{campos.activo ? "Sin texto, el topbar no se muestra." : "El topbar no se muestra."}</p>
        )}

        {problemas.length > 0 && (
          <div className="aviso aviso-error" role="alert">
            {problemas.length === 1 ? (
              <p>{problemas[0]}</p>
            ) : (
              <ul>
                {problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {ok && (
          <p className="aviso aviso-ok" role="status">
            Guardamos los cambios. Ya se ven en el sitio.
          </p>
        )}
        {hayCambios && !ok && <p className="ayuda">Hay cambios sin guardar.</p>}
        <button type="submit" className="boton boton-primario" disabled={guardando || !hayCambios}>
          {guardando ? "Guardando…" : "Guardar los cambios"}
        </button>
      </form>

      <BannerAdmin alCambiar={setBannerConCambios} />
    </section>
  );
}
