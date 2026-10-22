import { useEffect, useMemo, useState, type FormEvent } from "react";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { ErrorApi, pedirApi, type RespuestaPublicar, type RevisionPublicacion } from "./api";
import { useAtraparFoco } from "./editor/useAtraparFoco";

// Ventana para publicar un borrador: muestra lo que falta (si falta algo), y si está todo, pide la dirección y la fecha (ahora, la
// original si ya estuvo publicado, o una fecha futura para programarlo) y confirma. Programar es publicar con una fecha futura:
// el sitio lo muestra solo cuando llega.

interface PublicarDialogProps {
  articuloId: number;
  /** La versión guardada del artículo, en el momento de publicar. */
  version: () => string;
  onPublicado: (resultado: RespuestaPublicar, programado: boolean) => void;
  onCancelar: () => void;
  /** Para pedir que se vuelva a leer el artículo (por ejemplo, tras un conflicto). */
  onRecargar: () => void;
}

type Cuando = "ahora" | "original" | "programar";

const fechaLarga = new Intl.DateTimeFormat("es-AR", { dateStyle: "long" });
const fechaHora = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeStyle: "short" });

/** Valor de <input type="datetime-local"> (hora local) a partir de una fecha. */
function paraCampo(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

export function PublicarDialog({ articuloId, version, onPublicado, onCancelar, onRecargar }: PublicarDialogProps) {
  const [revision, setRevision] = useState<RevisionPublicacion | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [cuando, setCuando] = useState<Cuando>("ahora");
  const [fechaProgramada, setFechaProgramada] = useState("");
  const [publicando, setPublicando] = useState(false);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);

  useAtraparFoco(true);

  useEffect(() => {
    const control = new AbortController();
    pedirApi<RevisionPublicacion>(`/api/admin/articulos/${articuloId}/publicacion`, { signal: control.signal })
      .then((r) => {
        setRevision(r);
        setSlug(r.slugPropuesto ?? "");
        if (r.publicadoOriginal) setCuando("original");
        // Una fecha para programar: mañana a la misma hora.
        setFechaProgramada(paraCampo(new Date(Date.now() + 24 * 3600 * 1000)));
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setErrorCarga(e instanceof ErrorApi ? e.message : "No se pudo revisar el artículo.");
      });
    return () => control.abort();
  }, [articuloId]);

  useEffect(() => {
    const alApretar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !publicando) {
        e.preventDefault();
        onCancelar();
      }
    };
    window.addEventListener("keydown", alApretar);
    return () => window.removeEventListener("keydown", alApretar);
  }, [onCancelar, publicando]);

  /** La fecha elegida: undefined si se mantiene la original (el servidor la conoce), null si es ahora. */
  const fechaElegida = (): Date | null | undefined => {
    if (cuando === "original") return undefined;
    if (cuando === "ahora") return null;
    const d = new Date(fechaProgramada);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const instante = useMemo(() => {
    if (cuando === "original" && revision?.publicadoOriginal) return new Date(revision.publicadoOriginal);
    if (cuando === "programar") {
      const d = new Date(fechaProgramada);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return new Date();
  }, [cuando, fechaProgramada, revision]);

  const direccion = instante && slug.trim() ? rutaArticulo({ slug: slug.trim(), publicadoEn: instante }) : null;
  const esFuturo = cuando === "programar" && instante !== null && instante.getTime() > Date.now();
  const programaMal = cuando === "programar" && (instante === null || instante.getTime() <= Date.now());

  const publicar = async (e: FormEvent) => {
    e.preventDefault();
    if (publicando || programaMal) return;
    setPublicando(true);
    setError(null);
    setProblemas([]);
    const fecha = fechaElegida();
    try {
      const r = await pedirApi<RespuestaPublicar>(`/api/admin/articulos/${articuloId}/publicar`, {
        metodo: "POST",
        cuerpo: { version: version(), slug: slug.trim(), ...(fecha === undefined ? {} : { publicadoEn: fecha === null ? null : fecha.toISOString() }) },
      });
      onPublicado(r, r.articuloEstado === "PROGRAMADO");
    } catch (err) {
      if (err instanceof ErrorApi && err.estado === 409) setConflicto(true);
      else {
        setError(err instanceof ErrorApi ? err.message : "No se pudo publicar. Probá de nuevo.");
        if (err instanceof ErrorApi) setProblemas(err.problemas);
      }
      setPublicando(false);
    }
  };

  const puedePublicar = revision !== null && revision.accion === "publicar" && revision.problemas.length === 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="publicar-titulo">
      <div className="modal-container">
        <div className="modal-header">
          <h3 id="publicar-titulo">Publicar el artículo</h3>
          <button type="button" className="btn-close" onClick={onCancelar} aria-label="Cerrar ventana" disabled={publicando}>
            ×
          </button>
        </div>

        <form onSubmit={(e) => void publicar(e)} noValidate>
          <div className="modal-body modal-form">
            {errorCarga && (
              <p className="aviso aviso-error" role="alert">
                {errorCarga}
              </p>
            )}
            {!revision && !errorCarga && (
              <p className="cargando" role="status">
                Revisando el artículo…
              </p>
            )}

            {revision && revision.problemas.length > 0 && (
              <div className="aviso aviso-error" role="alert">
                <p>
                  <strong>Todavía no se puede publicar.</strong> Falta corregir:
                </p>
                <ul>
                  {revision.problemas.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {revision && revision.accion !== "publicar" && (
              <p className="aviso aviso-alerta" role="status">
                Este artículo ya no es un borrador. Cerrá esta ventana y volvé a abrir el artículo.
              </p>
            )}

            {puedePublicar && (
              <>
                <div className="form-field">
                  <label htmlFor="publicar-slug">Dirección del artículo</label>
                  <input id="publicar-slug" type="text" value={slug} maxLength={255} onChange={(e) => setSlug(e.target.value)} />
                  <p className="ayuda">Solo letras minúsculas sin tildes, números y guiones. Una vez publicado no se cambia.</p>
                </div>

                <fieldset className="subgrupo">
                  <legend>¿Cuándo sale?</legend>
                  <label className="casilla">
                    <input type="radio" name="cuando" checked={cuando === "ahora"} onChange={() => setCuando("ahora")} />
                    Ahora
                  </label>
                  {revision.publicadoOriginal && (
                    <label className="casilla">
                      <input type="radio" name="cuando" checked={cuando === "original"} onChange={() => setCuando("original")} />
                      Con su fecha original ({fechaLarga.format(new Date(revision.publicadoOriginal))}): vuelve a salir en la misma dirección
                    </label>
                  )}
                  <label className="casilla">
                    <input type="radio" name="cuando" checked={cuando === "programar"} onChange={() => setCuando("programar")} />
                    Programarlo para más adelante
                  </label>
                  {cuando === "programar" && (
                    <div className="campo">
                      <label htmlFor="publicar-fecha">Fecha y hora</label>
                      <input id="publicar-fecha" type="datetime-local" value={fechaProgramada} min={paraCampo(new Date())} onChange={(e) => setFechaProgramada(e.target.value)} aria-invalid={programaMal} />
                      {programaMal && <p className="form-error">Elegí una fecha y hora que todavía no pasaron.</p>}
                    </div>
                  )}
                </fieldset>

                {direccion && (
                  <p className="ayuda">
                    Va a quedar en <code>{direccion}</code>
                    {esFuturo && instante ? ` y se va a ver en el sitio el ${fechaHora.format(instante)}.` : "."}
                  </p>
                )}
              </>
            )}

            {conflicto && (
              <div className="aviso aviso-error" role="alert">
                <p>
                  <strong>Este artículo cambió mientras lo editabas.</strong> No se publicó nada.
                </p>
                <button type="button" className="boton boton-suave" onClick={onRecargar}>
                  Cargar la versión nueva
                </button>
              </div>
            )}
            {!conflicto && error && (
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
          </div>

          <div className="modal-footer">
            <span />
            <div className="modal-footer-right">
              <button type="button" className="btn-secondary" onClick={onCancelar} disabled={publicando}>
                Cancelar
              </button>
              {puedePublicar && !conflicto && (
                <button type="submit" className="btn-primary" disabled={publicando || programaMal || !slug.trim()}>
                  {publicando ? "Publicando…" : cuando === "programar" ? "Programar" : "Publicar"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
