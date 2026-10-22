import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Link, useParams } from "react-router";
import { ErrorApi, pedirApi, urlImagen, type ArticuloEditable, type Catalogos, type DatosArticulo, type ImagenDeLista } from "../api";
import { EditorCuerpo, textoDelEditor } from "../editor/EditorCuerpo";
import { SelectorImagen } from "../editor/SelectorImagen";
import { useSesion } from "../sesion";

const ESTADOS = { PUBLICADO: "Publicado", BORRADOR: "Borrador", PROGRAMADO: "Programado" } as const;
const hora = new Intl.DateTimeFormat("es-AR", { timeStyle: "short" });

const vacioANull = (v: string | null): string | null => (v && v.trim() ? v : null);

/** novedadHasta guardada (ISO) -> valor de <input type="date"> en la hora local. */
function fechaParaCampo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Valor de <input type="date"> -> fin de ese día en la hora local, en ISO. */
function fechaDesdeCampo(valor: string): string | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!partes) return null;
  return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]), 23, 59, 59).toISOString();
}

const porcentaje = (v: number): string => String(Math.round(v * 100));

export function EditarArticulo() {
  const { id } = useParams();
  const { sesionVencida } = useSesion();
  const [carga, setCarga] = useState<{ articulo: ArticuloEditable; catalogos: Catalogos } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cambia cada vez que hay que volver a leer el artículo del servidor (por ejemplo, tras un conflicto).
  const [lectura, setLectura] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    setCarga(null);
    setError(null);
    Promise.all([
      pedirApi<{ articulo: ArticuloEditable }>(`/api/admin/articulos/${id}`, { signal: control.signal }),
      pedirApi<Catalogos>("/api/admin/catalogos", { signal: control.signal }),
    ])
      .then(([a, catalogos]) => setCarga({ articulo: a.articulo, catalogos }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ErrorApi && e.estado === 401) {
          sesionVencida();
          return;
        }
        setError(e instanceof ErrorApi ? e.message : "No se pudo abrir el artículo.");
      });
    return () => control.abort();
  }, [id, lectura, sesionVencida]);

  if (error) {
    return (
      <section>
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
        <p>
          <Link to="/">Volver a los artículos</Link>
        </p>
      </section>
    );
  }
  if (!carga) return <p className="cargando" role="status">Abriendo el artículo…</p>;
  return <Formulario key={`${carga.articulo.id}-${lectura}`} articulo={carga.articulo} catalogos={carga.catalogos} recargar={() => setLectura((n) => n + 1)} />;
}

function Formulario({ articulo, catalogos, recargar }: { articulo: ArticuloEditable; catalogos: Catalogos; recargar: () => void }) {
  const { sesionVencida } = useSesion();
  const [campos, setCampos] = useState<DatosArticulo>(articulo.datos);
  const [imagenEncabezado, setImagenEncabezado] = useState(articulo.imagenEncabezado);
  const [version, setVersion] = useState(articulo.version);
  const [conCambiosSinPublicar, setConCambiosSinPublicar] = useState(articulo.conCambiosSinPublicar);
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardadoA, setGuardadoA] = useState<Date | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [eligiendoEncabezado, setEligiendoEncabezado] = useState(false);
  const [autorAgregar, setAutorAgregar] = useState("");

  const editor = useRef<Editor | null>(null);
  // Cuenta los cambios para no marcar "guardado" si alguien siguió escribiendo mientras se guardaba.
  const cambios = useRef(0);
  const alEditor = useCallback((e: Editor | null) => {
    editor.current = e;
  }, []);

  const marcarCambio = useCallback(() => {
    cambios.current += 1;
    setSucio(true);
  }, []);
  const poner = (parcial: Partial<DatosArticulo>) => {
    setCampos((prev) => ({ ...prev, ...parcial }));
    marcarCambio();
  };

  const esBorrador = articulo.estado === "BORRADOR";
  const nombreDe = (autorId: number) => catalogos.autores.find((a) => a.id === autorId)?.nombre ?? `Autor ${autorId}`;

  const guardar = async () => {
    if (!editor.current || guardando) return;
    const cambiosAlEmpezar = cambios.current;
    setGuardando(true);
    setProblemas([]);
    setAviso(null);
    const datos: DatosArticulo = {
      ...campos,
      bajada: vacioANull(campos.bajada),
      encabezadoAlt: vacioANull(campos.encabezadoAlt),
      encabezadoCredito: vacioANull(campos.encabezadoCredito),
      cuerpo: textoDelEditor(editor.current),
    };
    try {
      const r = await pedirApi<{ version: string; conCambiosSinPublicar: boolean }>(`/api/admin/articulos/${articulo.id}`, { metodo: "PUT", cuerpo: { version, datos } });
      setVersion(r.version);
      setConCambiosSinPublicar(r.conCambiosSinPublicar);
      setGuardadoA(new Date());
      if (cambios.current === cambiosAlEmpezar) setSucio(false);
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 401) {
        sesionVencida();
        return;
      }
      if (e instanceof ErrorApi && e.estado === 409) setConflicto(true);
      else if (e instanceof ErrorApi && e.problemas.length > 0) setProblemas(e.problemas);
      setAviso(e instanceof ErrorApi ? e.message : "No se pudo guardar. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  const elegirEncabezado = (imagen: ImagenDeLista) => {
    setImagenEncabezado({ id: imagen.id, clave: imagen.clave, nombreOriginal: imagen.nombreOriginal });
    // El texto alternativo y el crédito son de la imagen anterior: con otra imagen hay que escribirlos de nuevo.
    poner(imagen.id === campos.imagenEncabezadoId ? { imagenEncabezadoId: imagen.id } : { imagenEncabezadoId: imagen.id, encabezadoAlt: null, encabezadoCredito: null });
    setEligiendoEncabezado(false);
  };
  const quitarEncabezado = () => {
    setImagenEncabezado(null);
    poner({ imagenEncabezadoId: null, encabezadoAlt: null, encabezadoCredito: null, encabezadoPuntoFocalX: 0.5, encabezadoPuntoFocalY: 0.5 });
  };

  const alternarCategoria = (categoriaId: number, marcada: boolean) => {
    const ids = marcada ? [...campos.categoriaIds, categoriaId] : campos.categoriaIds.filter((c) => c !== categoriaId);
    let principal = campos.categoriaPrincipalId;
    if (!marcada && principal === categoriaId) principal = ids[0] ?? null;
    if (marcada && principal === null) principal = categoriaId;
    poner({ categoriaIds: ids, categoriaPrincipalId: principal });
  };
  const moverAutor = (indice: number, salto: -1 | 1) => {
    const ids = [...campos.autorIds];
    const destino = indice + salto;
    if (destino < 0 || destino >= ids.length) return;
    [ids[indice], ids[destino]] = [ids[destino]!, ids[indice]!];
    poner({ autorIds: ids });
  };
  const autoresDisponibles = catalogos.autores.filter((a) => !campos.autorIds.includes(a.id));
  const puntoFocal = (eje: "encabezadoPuntoFocalX" | "encabezadoPuntoFocalY", texto: string) => {
    const n = Number(texto);
    if (texto.trim() === "" || !Number.isFinite(n)) return;
    poner({ [eje]: Math.min(100, Math.max(0, n)) / 100 });
  };

  return (
    <section className="edicion">
      <p className="migas">
        <Link to="/">← Volver a los artículos</Link>
      </p>
      <div className="edicion-encabezado">
        <h1>Editar artículo</h1>
        <span className={`estado estado-${articulo.estado.toLowerCase()}`}>{ESTADOS[articulo.estado]}</span>
        {articulo.ruta && (
          <a className="ver-en-sitio" href={articulo.ruta} target="_blank" rel="noopener noreferrer">
            Ver en el sitio
          </a>
        )}
      </div>

      {conCambiosSinPublicar && (
        <p className="aviso aviso-alerta" role="status">
          Este artículo tiene cambios sin publicar. El sitio sigue mostrando la versión publicada.
        </p>
      )}
      {conflicto && (
        <div className="aviso aviso-error" role="alert">
          <p>
            <strong>Este artículo cambió mientras lo editabas.</strong> Tus cambios de esta pantalla no se guardaron, para no pisar lo que guardó otra persona.
          </p>
          <p>Si necesitás conservar lo que escribiste, copialo ahora. Después cargá la versión nueva.</p>
          <button type="button" className="boton boton-suave" onClick={recargar}>
            Cargar la versión nueva
          </button>
        </div>
      )}
      {!conflicto && aviso && (
        <div className="aviso aviso-error" role="alert">
          <p>{aviso}</p>
          {problemas.length > 0 && (
            <ul>
              {problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="edicion-grilla">
        <div className="edicion-principal">
          <div className="campo">
            <label htmlFor="titulo">Título</label>
            <input id="titulo" type="text" value={campos.titulo} maxLength={512} onChange={(e) => poner({ titulo: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="bajada">Bajada</label>
            <textarea id="bajada" rows={3} maxLength={2000} value={campos.bajada ?? ""} onChange={(e) => poner({ bajada: e.target.value })} />
            <p className="ayuda">Una o dos frases debajo del título. Es opcional.</p>
          </div>
          <div className="campo">
            <span className="etiqueta-campo" id="etiqueta-cuerpo">
              Texto del artículo
            </span>
            <EditorCuerpo contenido={campos.cuerpo} onCambio={marcarCambio} onEditor={alEditor} />
          </div>
        </div>

        <aside className="edicion-lateral" aria-label="Datos del artículo">
          <fieldset className="grupo">
            <legend>Ubicación</legend>
            <div className="campo">
              <label htmlFor="seccion">Sección</label>
              <select id="seccion" value={campos.seccionId} onChange={(e) => poner({ seccionId: Number(e.target.value) })}>
                {!catalogos.secciones.some((s) => s.id === campos.seccionId) && <option value={campos.seccionId}>Sección actual (interna)</option>}
                {catalogos.secciones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="subgrupo">
              <legend>Categorías</legend>
              <p className="ayuda">Marcá las que correspondan y elegí cuál es la principal (la que se ve como volanta).</p>
              <ul className="lista-sin-estilo">
                {catalogos.categorias.map((c) => {
                  const marcada = campos.categoriaIds.includes(c.id);
                  return (
                    <li key={c.id} className="fila-categoria">
                      <label className="casilla">
                        <input type="checkbox" checked={marcada} onChange={(e) => alternarCategoria(c.id, e.target.checked)} />
                        {c.nombre}
                      </label>
                      {marcada && (
                        <label className="casilla casilla-chica">
                          <input type="radio" name="categoria-principal" checked={campos.categoriaPrincipalId === c.id} onChange={() => poner({ categoriaPrincipalId: c.id })} />
                          Principal
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          </fieldset>

          <fieldset className="grupo">
            <legend>Autoría</legend>
            {campos.autorIds.length === 0 && <p className="ayuda">Todavía no hay autores.</p>}
            <ol className="lista-autores">
              {campos.autorIds.map((autorId, i) => (
                <li key={autorId}>
                  <span>{nombreDe(autorId)}</span>
                  <span className="acciones-fila">
                    <button type="button" className="boton boton-suave" disabled={i === 0} aria-label={`Subir a ${nombreDe(autorId)}`} onClick={() => moverAutor(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="boton boton-suave" disabled={i === campos.autorIds.length - 1} aria-label={`Bajar a ${nombreDe(autorId)}`} onClick={() => moverAutor(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="boton boton-suave" aria-label={`Quitar a ${nombreDe(autorId)}`} onClick={() => poner({ autorIds: campos.autorIds.filter((a) => a !== autorId) })}>
                      Quitar
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            {autoresDisponibles.length > 0 && (
              <div className="campo">
                <label htmlFor="autor-agregar">Agregar un autor</label>
                <select
                  id="autor-agregar"
                  value={autorAgregar}
                  onChange={(e) => {
                    const elegido = Number(e.target.value);
                    setAutorAgregar("");
                    if (elegido) poner({ autorIds: [...campos.autorIds, elegido] });
                  }}
                >
                  <option value="">Elegí un autor…</option>
                  {autoresDisponibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          <fieldset className="grupo">
            <legend>Imagen de encabezado</legend>
            {imagenEncabezado ? (
              <img className="imagen-miniatura" src={urlImagen(imagenEncabezado.clave)} alt="" />
            ) : (
              <p className="ayuda">Este artículo no tiene imagen de encabezado.</p>
            )}
            <div className="acciones-fila">
              <button type="button" className="boton boton-suave" onClick={() => setEligiendoEncabezado(true)}>
                {imagenEncabezado ? "Cambiar imagen" : "Elegir imagen"}
              </button>
              {imagenEncabezado && (
                <button type="button" className="boton boton-suave" onClick={quitarEncabezado}>
                  Quitar imagen
                </button>
              )}
            </div>
            {imagenEncabezado && (
              <>
                <div className="campo">
                  <label htmlFor="encabezado-alt">Texto alternativo</label>
                  <input id="encabezado-alt" type="text" value={campos.encabezadoAlt ?? ""} maxLength={2000} onChange={(e) => poner({ encabezadoAlt: e.target.value })} />
                  <p className="ayuda">Describe la imagen para quien no puede verla.</p>
                </div>
                <div className="campo">
                  <label htmlFor="encabezado-credito">Crédito</label>
                  <input id="encabezado-credito" type="text" value={campos.encabezadoCredito ?? ""} maxLength={255} onChange={(e) => poner({ encabezadoCredito: e.target.value })} />
                </div>
                <div className="par-campos">
                  <div className="campo">
                    <label htmlFor="foco-x">Punto focal horizontal (%)</label>
                    <input id="foco-x" type="number" min={0} max={100} step={5} value={porcentaje(campos.encabezadoPuntoFocalX)} onChange={(e) => puntoFocal("encabezadoPuntoFocalX", e.target.value)} />
                  </div>
                  <div className="campo">
                    <label htmlFor="foco-y">Punto focal vertical (%)</label>
                    <input id="foco-y" type="number" min={0} max={100} step={5} value={porcentaje(campos.encabezadoPuntoFocalY)} onChange={(e) => puntoFocal("encabezadoPuntoFocalY", e.target.value)} />
                  </div>
                </div>
                <p className="ayuda">Indica qué parte de la imagen no debe quedar cortada: 0 es izquierda o arriba, 100 es derecha o abajo.</p>
              </>
            )}
          </fieldset>

          <fieldset className="grupo">
            <legend>Opciones</legend>
            <label className="casilla">
              <input type="checkbox" checked={campos.conCapital} onChange={(e) => poner({ conCapital: e.target.checked })} />
              Letra capital en el primer párrafo
            </label>
            <div className="campo">
              <label htmlFor="novedad-hasta">Novedad hasta</label>
              <input
                id="novedad-hasta"
                type="date"
                value={fechaParaCampo(campos.novedadHasta)}
                onChange={(e) => poner({ novedadHasta: e.target.value ? fechaDesdeCampo(e.target.value) : null })}
              />
              <p className="ayuda">Si la completás, el artículo se marca como novedad hasta ese día.</p>
            </div>
            <div className="campo">
              <label htmlFor="slug">Dirección del artículo</label>
              {esBorrador ? (
                <>
                  <input id="slug" type="text" value={campos.slug ?? ""} maxLength={255} onChange={(e) => poner({ slug: e.target.value })} />
                  <p className="ayuda">Solo letras minúsculas sin tildes, números y guiones. Se define antes de publicar.</p>
                </>
              ) : (
                <>
                  <input id="slug" type="text" value={campos.slug ?? ""} readOnly />
                  <p className="ayuda">Un artículo publicado no cambia de dirección desde acá.</p>
                </>
              )}
            </div>
          </fieldset>
        </aside>
      </div>

      <div className="barra-guardar">
        <button type="button" className="boton boton-primario" disabled={guardando || conflicto} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <span className="estado-guardado" role="status">
          {guardando ? "" : sucio ? "Hay cambios sin guardar." : guardadoA ? `Guardado a las ${hora.format(guardadoA)}.` : "Sin cambios."}
        </span>
      </div>

      {eligiendoEncabezado && <SelectorImagen onElegir={elegirEncabezado} onCancelar={() => setEligiendoEncabezado(false)} />}
    </section>
  );
}
