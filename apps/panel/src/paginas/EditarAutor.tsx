import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { tienePermiso } from "@evaristo/compartido/permisos";
import { renderArticleBody, type JSONNode } from "@evaristo/compartido/render";
import { ErrorApi, pedirApi, urlImagen, type AutorDeLista, type AutorFicha, type ImagenDeLista, type RespuestaAutores, type VistaPreviaUnion } from "../api";
import { BioEditor } from "../editor/BioEditor";
import { SelectorImagen } from "../editor/SelectorImagen";
import { PuntoFocal } from "../PuntoFocal";
import { useAvisarAlSalir } from "../salida";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Ficha de un autor. Editores y administradores editan cualquiera; un Redactor solo la suya (y no cambia la dirección ni el tipo).
// El administrador además puede unirla con otra (duplicados que dejó WordPress) o eliminarla si no tiene artículos.

type Carga = { autor: AutorFicha; puedeEditarTodo: boolean };

/** JSON con las claves ordenadas, para comparar la bio sin importar el orden en que se guardó. */
const canonico = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

export function EditarAutor() {
  const { id } = useParams();
  const { sesionVencida } = useSesion();
  const navegar = useNavigate();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lectura, setLectura] = useState(0);
  useTitulo(carga ? `Autor: ${carga.autor.nombre}` : "Autor");

  useEffect(() => {
    const control = new AbortController();
    setCarga(null);
    setError(null);
    const fallo = (e: unknown, porDefecto: string) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof ErrorApi && e.estado === 401) {
        sesionVencida();
        return;
      }
      setError(e instanceof ErrorApi ? e.message : porDefecto);
    };
    if (id === "mia") {
      // «Mi ficha»: se busca cuál es y se abre su pantalla.
      pedirApi<{ id: number }>("/api/admin/autores/mia", { signal: control.signal })
        .then((r) => void navegar(`/autores/${r.id}`, { replace: true }))
        .catch((e: unknown) => fallo(e, "No se pudo abrir tu ficha."));
    } else {
      pedirApi<{ autor: AutorFicha; puedeEditarTodo: boolean }>(`/api/admin/autores/${id ?? ""}`, { signal: control.signal })
        .then((r) => setCarga({ autor: r.autor, puedeEditarTodo: r.puedeEditarTodo }))
        .catch((e: unknown) => fallo(e, "No se pudo cargar la ficha."));
    }
    return () => control.abort();
  }, [id, lectura, sesionVencida, navegar]);

  if (error)
    return (
      <section className="pantalla">
        <h1>No pudimos abrir la ficha</h1>
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
        <p>
          <Link to="/autores">Volver a los autores</Link>
        </p>
      </section>
    );
  if (!carga)
    return (
      <p className="cargando" role="status">
        Cargando…
      </p>
    );
  return <Formulario key={`${carga.autor.id}-${lectura}`} carga={carga} recargar={() => setLectura((n) => n + 1)} />;
}

function Formulario({ carga, recargar }: { carga: Carga; recargar: () => void }) {
  const { usuario, sesionVencida } = useSesion();
  const [original, setOriginal] = useState(carga.autor);
  const { puedeEditarTodo } = carga;
  const [nombre, setNombre] = useState(original.nombre);
  const [slug, setSlug] = useState(original.slug);
  const [soloTexto, setSoloTexto] = useState(original.soloTexto);
  const [bio, setBio] = useState<JSONNode | null>(original.bio);
  const [redes, setRedes] = useState({ instagram: original.instagram ?? "", x: original.x ?? "", facebook: original.facebook ?? "", sitioWeb: original.sitioWeb ?? "" });
  const [foto, setFoto] = useState(original.foto);
  const [fotoAlt, setFotoAlt] = useState(original.fotoAlt ?? "");
  const [foco, setFoco] = useState({ x: original.fotoPuntoFocalX, y: original.fotoPuntoFocalY });
  const [eligiendoFoto, setEligiendoFoto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);

  const bioSinCambios = canonico(bio) === canonico(original.bio) || (!bio && !original.bio);
  const hayCambios = useMemo(
    () =>
      nombre !== original.nombre ||
      slug !== original.slug ||
      soloTexto !== original.soloTexto ||
      !bioSinCambios ||
      redes.instagram !== (original.instagram ?? "") ||
      redes.x !== (original.x ?? "") ||
      redes.facebook !== (original.facebook ?? "") ||
      redes.sitioWeb !== (original.sitioWeb ?? "") ||
      (foto?.id ?? null) !== original.fotoId ||
      fotoAlt !== (original.fotoAlt ?? "") ||
      foco.x !== original.fotoPuntoFocalX ||
      foco.y !== original.fotoPuntoFocalY,
    [nombre, slug, soloTexto, bioSinCambios, redes, foto, fotoAlt, foco, original],
  );
  useAvisarAlSalir(hayCambios);

  const alCambiarBio = useCallback((json: JSONNode) => setBio(json), []);

  async function guardar() {
    setProblemas([]);
    setAviso(null);
    setExito(null);
    setGuardando(true);
    try {
      const datos = {
        nombre,
        ...(puedeEditarTodo ? { slug, soloTexto } : {}),
        bio,
        instagram: redes.instagram.trim() || null,
        x: redes.x.trim() || null,
        facebook: redes.facebook.trim() || null,
        sitioWeb: redes.sitioWeb.trim() || null,
        fotoId: foto?.id ?? null,
        fotoAlt: foto ? fotoAlt.trim() || null : null,
        fotoPuntoFocalX: foco.x,
        fotoPuntoFocalY: foco.y,
      };
      const r = await pedirApi<{ autor: AutorFicha }>(`/api/admin/autores/${original.id}`, { metodo: "PUT", cuerpo: { version: original.version, datos } });
      const a = r.autor;
      setOriginal(a);
      setNombre(a.nombre);
      setSlug(a.slug);
      setSoloTexto(a.soloTexto);
      setBio(a.bio);
      setRedes({ instagram: a.instagram ?? "", x: a.x ?? "", facebook: a.facebook ?? "", sitioWeb: a.sitioWeb ?? "" });
      setFotoAlt(a.fotoAlt ?? "");
      setFoto(a.foto);
      setFoco({ x: a.fotoPuntoFocalX, y: a.fotoPuntoFocalY });
      setExito("Guardamos los cambios.");
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 401) {
        sesionVencida();
        return;
      }
      if (e instanceof ErrorApi && e.estado === 409) setConflicto(true);
      else if (e instanceof ErrorApi && e.estado === 422) {
        setAviso(e.message);
        setProblemas(e.problemas);
      } else setAviso(e instanceof ErrorApi ? e.message : "No se pudo guardar. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  const elegirFoto = (imagen: ImagenDeLista) => {
    setFoto({ id: imagen.id, clave: imagen.clave, nombreOriginal: imagen.nombreOriginal });
    setFoco({ x: 0.5, y: 0.5 });
    setEligiendoFoto(false);
  };
  const puntoFocal = (eje: "x" | "y", texto: string) => {
    const n = Number(texto);
    if (texto.trim() === "" || !Number.isFinite(n)) return;
    setFoco((f) => ({ ...f, [eje]: Math.min(1, Math.max(0, n / 100)) }));
  };

  const htmlBio = useMemo(() => (bio && bio.content?.length ? renderArticleBody(bio).html : ""), [bio]);
  const iniciales = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const puedeUnir = !!usuario && tienePermiso(usuario.rol, "autores.eliminar");
  const redesDe: Array<[keyof typeof redes, string]> = [
    ["instagram", "Instagram"],
    ["x", "X"],
    ["facebook", "Facebook"],
    ["sitioWeb", "Sitio web"],
  ];

  return (
    <section>
      {puedeEditarTodo && (
        <p className="migas">
          <Link to="/autores">← Autores</Link>
        </p>
      )}
      <div className="edicion-encabezado">
        <h1>{original.nombre}</h1>
        {!original.soloTexto && puedeEditarTodo && (
          <a href={`/author/${original.slug}/`} target="_blank" rel="noopener noreferrer" className="ver-en-sitio">
            Ver la página del autor
          </a>
        )}
      </div>
      <p className="ayuda">
        {original.articulos === 1 ? "1 artículo" : `${original.articulos} artículos`}
        {original.usuario ? ` · Es la ficha de ${original.usuario.nombre} (usuario del panel)` : ""}
      </p>

      {conflicto && (
        <div className="aviso aviso-alerta" role="alert">
          <p>Esta ficha cambió mientras la editabas, y no guardamos nada para no pisar el cambio de la otra persona.</p>
          <button
            type="button"
            className="boton boton-suave"
            onClick={() => {
              if (window.confirm("Vas a perder lo que cambiaste en esta pantalla y se va a cargar la versión que guardó la otra persona. ¿Seguís?")) recargar();
            }}
          >
            Cargar la versión nueva
          </button>
        </div>
      )}
      {aviso && (
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
      {exito && (
        <p className="aviso aviso-ok" role="status">
          {exito}
        </p>
      )}

      <div className="edicion-grilla">
        <div>
          <div className="campo">
            <label htmlFor="autor-nombre">Nombre</label>
            <input id="autor-nombre" type="text" maxLength={255} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>

          {!soloTexto && (
            <div className="campo">
              <span className="etiqueta-campo" id="bio-etiqueta">
                Bio
              </span>
              <p className="ayuda">Corta: unas tres o cuatro oraciones. Admite cursiva y enlaces (por ejemplo, a un libro del autor).</p>
              <BioEditor inicial={original.bio} alCambiar={alCambiarBio} sinCambios={bioSinCambios} />
            </div>
          )}

          <fieldset className="grupo">
            <legend>Redes</legend>
            <p className="ayuda">Pegá la dirección completa, que empiece con https://. Todas son opcionales.</p>
            {redesDe.map(([clave, titulo]) => (
              <div className="campo" key={clave}>
                <label htmlFor={`red-${clave}`}>{titulo}</label>
                <input id={`red-${clave}`} type="text" inputMode="url" maxLength={255} placeholder="https://" value={redes[clave]} onChange={(e) => setRedes((r) => ({ ...r, [clave]: e.target.value }))} />
              </div>
            ))}
          </fieldset>
        </div>

        <aside className="edicion-lateral" aria-label="Más datos de la ficha">
          {puedeEditarTodo && (
            <fieldset className="grupo">
              <legend>Tipo y dirección</legend>
              <label className="casilla">
                <input type="checkbox" checked={soloTexto} onChange={(e) => setSoloTexto(e.target.checked)} />
                No es una persona (por ejemplo «Redacción»)
              </label>
              <p className="ayuda">Un autor que no es una persona aparece solo como texto: sin página, sin bio y sin enlace.</p>
              <div className="campo">
                <label htmlFor="autor-slug">Dirección</label>
                <input id="autor-slug" type="text" maxLength={255} value={slug} onChange={(e) => setSlug(e.target.value)} />
                <p className="ayuda">Solo letras minúsculas sin tildes, números y guiones. Si la cambiás, la anterior sigue funcionando y lleva a la nueva.</p>
              </div>
            </fieldset>
          )}

          {!soloTexto && (
            <fieldset className="grupo">
              <legend>Foto</legend>
              {foto ? (
                <>
                  <img className="imagen-miniatura" src={urlImagen(foto.clave)} alt="" />
                  <p className="ayuda">{foto.nombreOriginal}</p>
                  <div className="campo">
                    <label htmlFor="foto-alt">Texto alternativo de la foto</label>
                    <input id="foto-alt" type="text" maxLength={512} value={fotoAlt} onChange={(e) => setFotoAlt(e.target.value)} />
                    <p className="ayuda">Describe la foto para quien no puede verla, por ejemplo «Retrato de Ana Pérez».</p>
                    {!fotoAlt.trim() && <p className="form-aviso">Falta el texto alternativo.</p>}
                  </div>
                  <PuntoFocal
                    src={urlImagen(foto.clave)}
                    x={foco.x}
                    y={foco.y}
                    onCambio={(x, y) => setFoco({ x, y })}
                    proporcion="1 / 1"
                    ayuda="Hacé clic en la parte más importante de la foto (la cara, por ejemplo). En el sitio se muestra en un recuadro cuadrado y esa parte no se corta."
                  />
                  <div className="par-campos">
                    <div className="campo">
                      <label htmlFor="foto-foco-x">Horizontal (%)</label>
                      <input id="foto-foco-x" type="number" min={0} max={100} step={5} value={Math.round(foco.x * 100)} onChange={(e) => puntoFocal("x", e.target.value)} />
                    </div>
                    <div className="campo">
                      <label htmlFor="foto-foco-y">Vertical (%)</label>
                      <input id="foto-foco-y" type="number" min={0} max={100} step={5} value={Math.round(foco.y * 100)} onChange={(e) => puntoFocal("y", e.target.value)} />
                    </div>
                  </div>
                  <div className="acciones-fila">
                    <button type="button" className="boton boton-suave" onClick={() => setEligiendoFoto(true)}>
                      Cambiar la foto
                    </button>
                    <button
                      type="button"
                      className="boton boton-suave"
                      onClick={() => {
                        setFoto(null);
                        setFotoAlt("");
                        setFoco({ x: 0.5, y: 0.5 });
                      }}
                    >
                      Quitar la foto
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="ayuda">Sin foto se muestran las iniciales. Tiene que ser una imagen de la biblioteca (se puede subir una nueva).</p>
                  <button type="button" className="boton boton-suave" onClick={() => setEligiendoFoto(true)}>
                    Elegir una foto
                  </button>
                </>
              )}
            </fieldset>
          )}

          {!soloTexto && (
            <fieldset className="grupo">
              <legend>Así se ve en el artículo</legend>
              <div className="bio-previa">
                <div className="bio-previa-foto">
                  {foto ? <img src={urlImagen(foto.clave)} alt="" style={{ objectPosition: `${foco.x * 100}% ${foco.y * 100}%` }} /> : <span aria-hidden="true">{iniciales}</span>}
                </div>
                <div>
                  <p className="bio-previa-nombre">{nombre || "Sin nombre"}</p>
                  {htmlBio ? <div className="bio-previa-texto" dangerouslySetInnerHTML={{ __html: htmlBio }} /> : <p className="ayuda">Sin bio: en el artículo no se muestra este bloque.</p>}
                </div>
              </div>
            </fieldset>
          )}

          {puedeUnir && <Administracion autor={original} hayCambios={hayCambios} />}
        </aside>
      </div>

      <div className="barra-guardar">
        <button type="button" className="boton boton-primario" disabled={guardando || conflicto || !hayCambios} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <span className="estado-guardado" role="status">
          {guardando ? "Guardando…" : hayCambios ? "Hay cambios sin guardar." : "Todo guardado."}
        </span>
      </div>

      {eligiendoFoto && <SelectorImagen onElegir={elegirFoto} onCancelar={() => setEligiendoFoto(false)} />}
    </section>
  );
}

/** Unir con otro autor y eliminar: solo administrador. */
function Administracion({ autor, hayCambios }: { autor: AutorFicha; hayCambios: boolean }) {
  const { sesionVencida } = useSesion();
  const navegar = useNavigate();
  const [busqueda, setBusqueda] = useState("");
  const [candidatos, setCandidatos] = useState<AutorDeLista[]>([]);
  const [destinoId, setDestinoId] = useState("");
  const [vista, setVista] = useState<VistaPreviaUnion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const fallo = (e: unknown, porDefecto: string) => {
    if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
    setError(e instanceof ErrorApi ? (e.problemas[0] ?? e.message) : porDefecto);
  };

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setCandidatos([]);
      return;
    }
    const control = new AbortController();
    const t = setTimeout(() => {
      pedirApi<RespuestaAutores>(`/api/admin/autores?q=${encodeURIComponent(busqueda.trim())}`, { signal: control.signal })
        .then((r) => setCandidatos(r.autores.filter((a) => a.id !== autor.id)))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(t);
      control.abort();
    };
  }, [busqueda, autor.id]);

  async function verQueCambia() {
    setError(null);
    setVista(null);
    setOcupado(true);
    try {
      setVista(await pedirApi<VistaPreviaUnion>(`/api/admin/autores/${autor.id}/unir?destinoId=${destinoId}`));
    } catch (e) {
      fallo(e, "No se pudo preparar la unión.");
    } finally {
      setOcupado(false);
    }
  }

  async function unir() {
    if (!vista || !window.confirm(`¿Unir «${vista.sobrante.nombre}» con «${vista.elegido.nombre}»? «${vista.sobrante.nombre}» deja de existir y no se puede deshacer.`)) return;
    setOcupado(true);
    try {
      await pedirApi(`/api/admin/autores/${autor.id}/unir`, { metodo: "POST", cuerpo: { destinoId: vista.elegido.id } });
      void navegar(`/autores/${vista.elegido.id}`);
    } catch (e) {
      fallo(e, "No se pudo unir.");
      setOcupado(false);
    }
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar a «${autor.nombre}»? No se puede deshacer.`)) return;
    setOcupado(true);
    setError(null);
    try {
      await pedirApi(`/api/admin/autores/${autor.id}`, { metodo: "DELETE" });
      void navegar("/autores");
    } catch (e) {
      fallo(e, "No se pudo eliminar.");
      setOcupado(false);
    }
  }

  return (
    <fieldset className="grupo">
      <legend>Administrar</legend>
      {hayCambios && <p className="form-aviso">Guardá los cambios antes de unir o eliminar.</p>}
      <div className="campo">
        <label htmlFor="unir-busqueda">Unir con otro autor</label>
        <input id="unir-busqueda" type="search" placeholder="Buscar el autor que se queda" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <p className="ayuda">Los artículos de «{autor.nombre}» pasan al autor que elijas, y esta ficha se borra (su dirección sigue funcionando y lleva al otro).</p>
        {candidatos.length > 0 && (
          <>
            <label htmlFor="unir-destino" className="solo-lectores">
              Autor que se queda
            </label>
            <select
              id="unir-destino"
              value={destinoId}
              onChange={(e) => {
                setDestinoId(e.target.value);
                setVista(null);
              }}
            >
              <option value="">Elegí el autor que se queda</option>
              {candidatos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre} ({a.articulos} {a.articulos === 1 ? "artículo" : "artículos"})
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <button type="button" className="boton boton-suave" disabled={!destinoId || ocupado || hayCambios} onClick={() => void verQueCambia()}>
        Ver qué cambia
      </button>

      {vista && (
        <div className="aviso aviso-alerta" role="status">
          <p>
            Se mueven <strong>{vista.articulos}</strong> {vista.articulos === 1 ? "artículo" : "artículos"} a <strong>{vista.elegido.nombre}</strong>.
            {vista.seCompleta.length > 0 ? ` Se le completa ${vista.seCompleta.join(", ")} con lo de «${vista.sobrante.nombre}».` : " No se le copia nada: ya tiene todo lo que tiene este autor."}
          </p>
          {vista.muestra.length > 0 && (
            <ul>
              {vista.muestra.map((m) => (
                <li key={m.id}>
                  {m.titulo}
                  {m.yaTieneAlElegido ? " (ya tiene a los dos: queda con uno solo)" : ""}
                </li>
              ))}
              {vista.articulos > vista.muestra.length && <li>…y {vista.articulos - vista.muestra.length} más</li>}
            </ul>
          )}
          <button type="button" className="boton boton-peligro" disabled={ocupado} onClick={() => void unir()}>
            Unir los dos autores
          </button>
        </div>
      )}

      <hr />
      <button type="button" className="boton boton-peligro" disabled={ocupado || autor.articulos > 0 || autor.usuario !== null} onClick={() => void eliminar()}>
        Eliminar este autor
      </button>
      {(autor.articulos > 0 || autor.usuario) && <p className="ayuda">Solo se puede eliminar un autor sin artículos y que no sea la ficha de un usuario.</p>}
      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
