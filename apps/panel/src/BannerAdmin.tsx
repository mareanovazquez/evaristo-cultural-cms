import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type ScreenReaderInstructions } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BANNER_ALT_MAX, BANNER_ANCHO, BANNER_ALTO, BANNER_AYUDA_MEDIDA, BANNER_MAX_IMAGENES, BANNER_MIMES, enlaceValido, problemaDeImagenDeBanner, TOPBAR_ENLACE_MAX } from "@evaristo/compartido/sitio";
import { ErrorApi, pedirApi, subirArchivo, urlImagen, type BannerSlideDatos, type ImagenDeLista, type RespuestaBanner, type RespuestaSubida } from "./api";
import { BotonIcono } from "./BotonIcono";
import { Icono } from "./iconos";
import { Tooltip } from "./Tooltip";
import { useSesion } from "./sesion";

// Banner de la portada (solo administrador; decisión 77). El interruptor se guarda solo; las imágenes (hasta BANNER_MAX_IMAGENES), con su
// texto alternativo y su enlace opcional, se guardan todas juntas con el botón Guardar. El orden de la lista es el orden de rotación y se
// cambia arrastrando. Cada fila es un solo objeto, así que reordenar no desalinea nada.
//  - Al elegir un archivo se comprueban en el panel el tipo, el peso y la medida; no se sube hasta Guardar.
//  - Al guardar: se suben los archivos pendientes, se descartan las filas sin imagen y la API borra las imágenes que ya no se usan.

interface Fila {
  /** Clave local: no cambia al reordenar. */
  id: number;
  /** Imagen que ya está en la biblioteca (guardada en el banner o recién subida). */
  imagen: ImagenDeLista | null;
  /** Archivo elegido que todavía no se subió. */
  archivo: File | null;
  /** Lo que se ve: una dirección temporal del archivo (hay que liberarla) o la imagen ya subida. */
  preview: string | null;
  enlace: string;
  alt: string;
  error: string | null;
}

/** Mide una imagen del disco. Se puede reemplazar en las pruebas, que no tienen decodificador. */
export const lectorDeImagen = {
  medir: async (archivo: File): Promise<{ ancho: number; alto: number } | null> => {
    try {
      const mapa = await createImageBitmap(archivo);
      const medida = { ancho: mapa.width, alto: mapa.height };
      mapa.close();
      return medida;
    } catch {
      return null;
    }
  },
};

// Las filas sin imagen no cuentan: se descartan al guardar, así que agregar una vacía no es un cambio.
const firma = (filas: Fila[]) => JSON.stringify(filas.filter((f) => f.imagen || f.archivo).map((f) => [f.imagen?.id ?? null, f.archivo ? [f.archivo.name, f.archivo.size, f.archivo.lastModified] : null, f.enlace.trim(), f.alt.trim()]));

export function BannerAdmin({ alCambiar }: { alCambiar: (hayCambios: boolean) => void }) {
  const { sesionVencida } = useSesion();
  const proximoId = useRef(1);
  const vacia = useCallback((): Fila => ({ id: proximoId.current++, imagen: null, archivo: null, preview: null, enlace: "", alt: "", error: null }), []);
  const desdeApi = useCallback(
    (slides: BannerSlideDatos[]): Fila[] =>
      slides.length
        ? slides.map((s) => ({ id: proximoId.current++, imagen: s.imagen, archivo: null, preview: urlImagen(s.imagen.clave), enlace: s.enlace ?? "", alt: s.alt, error: null }))
        : [vacia()],
    [vacia],
  );

  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [base, setBase] = useState("");
  const [guardadas, setGuardadas] = useState(0);
  const [activo, setActivo] = useState(false);
  const [cambiandoActivo, setCambiandoActivo] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorActivo, setErrorActivo] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const ultimas = useRef<Fila[] | null>(null);
  ultimas.current = filas;
  // Cada dirección temporal se libera una sola vez, aunque se llegue por dos caminos (por ejemplo, subir y después guardar).
  const liberadas = useRef(new Set<string>());
  const liberar = useCallback((f: Fila) => {
    if (!f.archivo || !f.preview || liberadas.current.has(f.preview)) return;
    liberadas.current.add(f.preview);
    URL.revokeObjectURL(f.preview);
  }, []);

  const falla = useCallback(
    (e: unknown, porDefecto: string): string[] => {
      if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
      return e instanceof ErrorApi ? (e.problemas.length ? e.problemas : [e.message]) : [porDefecto];
    },
    [sesionVencida],
  );

  useEffect(() => {
    const control = new AbortController();
    pedirApi<RespuestaBanner>("/api/admin/banner", { signal: control.signal })
      .then((r) => {
        const nuevas = desdeApi(r.slides);
        setFilas(nuevas);
        setBase(firma(nuevas));
        setGuardadas(r.slides.length);
        setActivo(r.activo);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setErrorCarga(falla(e, "No pudimos cargar el banner. Recargá la pantalla.")[0]!);
      });
    return () => control.abort();
  }, [desdeApi, falla]);

  // Al salir de la pantalla se liberan las direcciones temporales de los archivos que quedaron sin subir.
  useEffect(
    () => () => {
      ultimas.current?.forEach(liberar);
    },
    [liberar],
  );

  const hayCambios = filas !== null && firma(filas) !== base;
  useEffect(() => alCambiar(hayCambios), [hayCambios, alCambiar]);

  const cambiar = (id: number, cambio: Partial<Fila>) => {
    setFilas((fs) => fs?.map((f) => (f.id === id ? { ...f, ...cambio } : f)) ?? fs);
    setOk(null);
    setProblemas([]);
  };

  async function cambiarActivo(valor: boolean) {
    const anterior = activo;
    setActivo(valor);
    setErrorActivo(null);
    setOk(null);
    setCambiandoActivo(true);
    try {
      await pedirApi("/api/admin/banner/activo", { metodo: "PATCH", cuerpo: { activo: valor } });
      setOk(!valor ? "El banner está oculto." : guardadas === 0 ? "El banner está activado, pero todavía no tiene imágenes: cargalas y guardá para que se vea." : "El banner se muestra en la portada.");
    } catch (e) {
      setActivo(anterior);
      setErrorActivo(falla(e, "No se pudo cambiar el banner. Probá de nuevo.")[0]!);
    } finally {
      setCambiandoActivo(false);
    }
  }

  async function elegirArchivo(id: number, archivo: File) {
    // Primero el tipo y el peso (sin leer el archivo) y después la medida.
    let motivo = problemaDeImagenDeBanner({ tipoMime: archivo.type, bytes: archivo.size, ancho: BANNER_ANCHO, alto: BANNER_ALTO });
    if (!motivo) {
      const medida = await lectorDeImagen.medir(archivo);
      motivo = medida ? problemaDeImagenDeBanner({ tipoMime: archivo.type, bytes: archivo.size, ...medida }) : "No se pudo leer la imagen. Probá con otro archivo.";
    }
    if (motivo) {
      cambiar(id, { error: motivo });
      return;
    }
    const preview = URL.createObjectURL(archivo);
    setOk(null);
    setProblemas([]);
    setFilas((fs) =>
      fs?.map((f) => {
        if (f.id !== id) return f;
        liberar(f);
        return { ...f, archivo, imagen: null, preview, error: null };
      }) ?? fs,
    );
  }

  function quitar(id: number) {
    setFilas((fs) => {
      const sacada = fs?.find((f) => f.id === id);
      if (sacada) liberar(sacada);
      return fs?.filter((f) => f.id !== id) ?? fs;
    });
    setOk(null);
    setProblemas([]);
  }

  async function guardar() {
    if (!filas) return;
    setOk(null);
    setProblemas([]);

    // Las filas sin imagen se descartan; las demás tienen que estar completas.
    const conImagen = filas.filter((f) => f.imagen || f.archivo);
    const revisadas = filas.map((f) => {
      if (!f.imagen && !f.archivo) return f;
      const alt = f.alt.trim();
      const enlace = f.enlace.trim();
      const error = !alt ? "Escribí qué dice la imagen (es lo que escucha quien usa un lector de pantalla)." : alt.length > BANNER_ALT_MAX ? `El texto de la imagen es demasiado largo (máximo ${BANNER_ALT_MAX} caracteres).` : enlace && !enlaceValido(enlace) ? "El enlace tiene que empezar con https:// (o con / si es una página de este sitio) y no puede tener espacios." : null;
      return { ...f, error };
    });
    if (revisadas.some((f) => f.error)) {
      setFilas(revisadas);
      setProblemas(["Revisá las imágenes marcadas antes de guardar."]);
      return;
    }

    setGuardando(true);
    const subidas = new Map<number, ImagenDeLista>();
    try {
      for (const f of conImagen) {
        if (!f.archivo) continue;
        try {
          const r = await subirArchivo<RespuestaSubida>("/api/admin/imagenes", "archivo", f.archivo);
          subidas.set(f.id, r.imagen);
          // Ya está subida: si lo que sigue falla, al reintentar no se vuelve a subir.
          setFilas((fs) =>
            fs?.map((x) => {
              if (x.id !== f.id) return x;
              liberar(x);
              return { ...x, imagen: r.imagen, archivo: null, preview: urlImagen(r.imagen.clave), error: null };
            }) ?? fs,
          );
        } catch (e) {
          cambiar(f.id, { error: falla(e, "No se pudo subir la imagen. Probá de nuevo.")[0]! });
          setProblemas(["No se pudo subir una imagen. No se guardó nada."]);
          return;
        }
      }
      const slides = conImagen.map((f) => ({ imagenId: (f.imagen ?? subidas.get(f.id)!).id, enlace: f.enlace.trim() || null, alt: f.alt.trim() }));
      const r = await pedirApi<RespuestaBanner>("/api/admin/banner", { metodo: "PUT", cuerpo: { slides } });
      ultimas.current?.forEach(liberar);
      const nuevas = desdeApi(r.slides);
      setFilas(nuevas);
      setBase(firma(nuevas));
      setGuardadas(r.slides.length);
      const borradas = r.borradas ?? 0;
      setOk(`Guardamos el banner.${borradas ? ` Borramos ${borradas} ${borradas === 1 ? "imagen que ya no se usaba" : "imágenes que ya no se usaban"}.` : ""}`);
    } catch (e) {
      setProblemas(falla(e, "No se pudo guardar el banner. Probá de nuevo."));
    } finally {
      setGuardando(false);
    }
  }

  // Ordenar arrastrando (con el mouse, el dedo o el teclado): el orden se guarda con el botón Guardar.
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const lugarDe = (id: unknown) => (filas?.findIndex((f) => f.id === id) ?? -1) + 1;
  const total = filas?.length ?? 0;
  const anuncios: Announcements = {
    onDragStart: ({ active }) => `Levantaste la imagen ${lugarDe(active.id)} de ${total}.`,
    onDragOver: ({ active, over }) => (over && over.id !== active.id ? `La imagen ${lugarDe(active.id)} pasó sobre el lugar ${lugarDe(over.id)} de ${total}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Soltaste la imagen en el lugar ${lugarDe(over.id)} de ${total}. Guardá para que quede así.` : `Soltaste la imagen en su lugar de siempre.`),
    onDragCancel: ({ active }) => `Cancelaste el movimiento de la imagen ${lugarDe(active.id)}: queda en su lugar.`,
  };
  const instrucciones: ScreenReaderInstructions = {
    draggable: "Para cambiar de lugar una imagen del banner: apretá la barra espaciadora para levantarla, movela con las flechas arriba y abajo y volvé a apretar la barra espaciadora para soltarla. Con Esc cancelás.",
  };
  const alSoltar = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setFilas((fs) => (fs ? arrayMove(fs, fs.findIndex((f) => f.id === active.id), fs.findIndex((f) => f.id === over.id)) : fs));
    setOk(null);
  };

  if (errorCarga)
    return (
      <p className="aviso aviso-error" role="alert">
        {errorCarga}
      </p>
    );
  if (!filas) return <p className="cargando" role="status">Cargando el banner…</p>;

  const enElMaximo = filas.length >= BANNER_MAX_IMAGENES;

  return (
    <section className="grupo" aria-labelledby="banner-titulo">
      <h2 className="grupo-titulo" id="banner-titulo">
        Banner de la portada
      </h2>
      <p className="ayuda">
        Un banner de imágenes en el medio de la portada, pensado para promociones. La imagen es todo el contenido: no lleva texto encima. Con una sola imagen queda fija; con dos o tres rota sola cada 6 segundos.
      </p>
      <p className="ayuda">
        <strong>Medida:</strong> {BANNER_AYUDA_MEDIDA} Se ve igual en computadora y en celular, así que conviene que el texto de la imagen sea grande.
      </p>

      <label className="interruptor">
        <input type="checkbox" role="switch" checked={activo} disabled={cambiandoActivo} onChange={(e) => void cambiarActivo(e.target.checked)} />
        <span className="interruptor-pista" aria-hidden="true" />
        <span>{activo ? "Se muestra en la portada" : "Está oculto"}</span>
      </label>
      {errorActivo && (
        <p className="aviso aviso-error" role="alert">
          {errorActivo}
        </p>
      )}

      <DndContext sensors={sensores} collisionDetection={closestCenter} accessibility={{ announcements: anuncios, screenReaderInstructions: instrucciones }} onDragEnd={alSoltar}>
        <SortableContext items={filas.map((f) => f.id)} strategy={verticalListSortingStrategy} disabled={guardando}>
          <ol className="banner-lista" aria-label="Imágenes del banner, en el orden en que rotan">
            {filas.map((f, i) => (
              <FilaBanner
                key={f.id}
                fila={f}
                numero={i + 1}
                ocupado={guardando}
                unica={filas.length === 1}
                alCambiar={(c) => cambiar(f.id, c)}
                alElegir={(a) => void elegirArchivo(f.id, a)}
                alQuitar={() => quitar(f.id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <p>
        <button type="button" className="boton boton-suave" disabled={enElMaximo || guardando} aria-describedby={enElMaximo ? "banner-maximo" : undefined} onClick={() => setFilas((fs) => (fs ? [...fs, vacia()] : fs))}>
          Agregar imagen
        </button>
      </p>
      {enElMaximo && (
        <p className="ayuda" id="banner-maximo">
          Llegaste al máximo de {BANNER_MAX_IMAGENES} imágenes. Eliminá una para agregar otra.
        </p>
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
          {ok}
        </p>
      )}
      {hayCambios && !ok && <p className="ayuda">Hay cambios sin guardar.</p>}
      <button type="button" className="boton boton-primario" disabled={guardando || !hayCambios} onClick={() => void guardar()}>
        {guardando ? "Guardando…" : "Guardar el banner"}
      </button>
    </section>
  );
}

function FilaBanner({ fila, numero, ocupado, unica, alCambiar, alElegir, alQuitar }: { fila: Fila; numero: number; ocupado: boolean; unica: boolean; alCambiar: (c: Partial<Fila>) => void; alElegir: (a: File) => void; alQuitar: () => void }) {
  const arrastre = useSortable({ id: fila.id, disabled: ocupado });
  const entrada = useRef<HTMLInputElement>(null);
  const estilo: CSSProperties = {
    transform: CSS.Transform.toString(arrastre.transform ? { ...arrastre.transform, x: 0, scaleX: 1, scaleY: 1 } : null) ?? undefined,
    transition: arrastre.transition,
    ...(arrastre.isDragging ? { position: "relative", zIndex: 5 } : {}),
  };
  const id = `banner-${fila.id}`;
  return (
    <li ref={arrastre.setNodeRef} style={estilo} className={`banner-fila${arrastre.isDragging ? " fila-arrastrando" : ""}`}>
      <div className="banner-fila-cabeza">
        <Tooltip texto="Arrastrá para cambiar el orden de rotación">
          <button type="button" ref={arrastre.setActivatorNodeRef} className="boton-icono boton-arrastre" aria-label={`Cambiar de lugar la imagen ${numero} del banner`} disabled={ocupado} {...arrastre.attributes} {...arrastre.listeners}>
            <Icono nombre="arrastrar" clase="icono icono-boton" />
          </button>
        </Tooltip>
        <h3 className="banner-fila-titulo">Imagen {numero}</h3>
        <BotonIcono icono="eliminar" etiqueta={`Eliminar la imagen ${numero} del banner`} texto="Eliminar esta imagen" peligro disabled={ocupado || unica} motivo="El banner necesita al menos una imagen" onClick={alQuitar} />
      </div>

      <div className="banner-fila-preview">{fila.preview ? <img src={fila.preview} alt="" /> : <span className="ayuda">Todavía no elegiste una imagen</span>}</div>
      <p>
        <input
          ref={entrada}
          id={`${id}-archivo`}
          type="file"
          hidden
          accept={BANNER_MIMES.join(",")}
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            e.target.value = "";
            if (archivo) alElegir(archivo);
          }}
        />
        <button type="button" className="boton boton-suave" disabled={ocupado} onClick={() => entrada.current?.click()}>
          {fila.preview ? "Cambiar imagen" : "Elegir imagen"}
        </button>
        {fila.archivo && <span className="ayuda"> {fila.archivo.name}: se sube al guardar.</span>}
      </p>

      <div className="campo">
        <label htmlFor={`${id}-alt`}>Qué dice la imagen</label>
        <input id={`${id}-alt`} type="text" maxLength={BANNER_ALT_MAX} value={fila.alt} onChange={(e) => alCambiar({ alt: e.target.value, error: null })} aria-describedby={`${id}-alt-ayuda`} />
        <p className="ayuda" id={`${id}-alt-ayuda`}>
          Es lo que escucha quien usa un lector de pantalla. Si la imagen tiene un texto, escribilo acá.
        </p>
      </div>
      <div className="campo">
        <label htmlFor={`${id}-enlace`}>Enlace (opcional)</label>
        <input id={`${id}-enlace`} type="text" inputMode="url" maxLength={TOPBAR_ENLACE_MAX} placeholder="https://" value={fila.enlace} onChange={(e) => alCambiar({ enlace: e.target.value, error: null })} aria-describedby={`${id}-enlace-ayuda`} />
        <p className="ayuda" id={`${id}-enlace-ayuda`}>
          Puede ser interno (por ejemplo /contacto) o externo (https://…). Sin enlace, la imagen no es clickeable.
        </p>
      </div>
      {fila.error && (
        <p className="aviso aviso-error" role="alert">
          {fila.error}
        </p>
      )}
    </li>
  );
}
