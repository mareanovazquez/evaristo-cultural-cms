import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type DragStartEvent, type ScreenReaderInstructions } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "react-router";
import { ErrorApi, pedirApi } from "../api";
import { BotonIcono } from "../BotonIcono";
import { Icono } from "../iconos";
import { Tooltip } from "../Tooltip";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Secciones y categorías (solo administrador). Las secciones se ordenan (es el orden del menú del sitio); las dos se pueden crear,
// renombrar, cambiar de dirección (la vieja sigue funcionando), unir con otra y eliminar si están vacías. No se ocultan.

type Tipo = "secciones" | "categorias";

interface Item {
  id: number;
  slug: string;
  nombre: string;
  articulos: number;
  interna?: boolean;
  orden?: number;
  comoPrincipal?: number;
}

interface VistaUnion {
  sobrante: { nombre: string };
  elegida: { nombre: string };
  articulos: number;
  yaConAmbas?: number;
  comoPrincipal?: number;
  enBorradores: number;
  redireccion: string;
}

const CONFIG: Record<Tipo, { ruta: string; singular: string; plural: string; articulo: string; publica: (slug: string) => string; ordena: boolean }> = {
  secciones: { ruta: "/api/admin/secciones", singular: "sección", plural: "secciones", articulo: "la", publica: (s) => `/seccion/${s}/`, ordena: true },
  categorias: { ruta: "/api/admin/categorias", singular: "categoría", plural: "categorías", articulo: "la", publica: (s) => `/categoria/${s}/`, ordena: false },
};

export function Clasificacion() {
  useTitulo("Secciones y categorías");
  const [params, setParams] = useSearchParams();
  const tipo: Tipo = params.get("ver") === "categorias" ? "categorias" : "secciones";
  return (
    <section>
      <div className="listado-encabezado">
        <h1>Secciones y categorías</h1>
      </div>
      <nav className="solapas" aria-label="Qué administrar">
        {(["secciones", "categorias"] as const).map((t) => (
          <button key={t} type="button" className="solapa" aria-current={t === tipo ? "true" : undefined} onClick={() => setParams(t === "secciones" ? {} : { ver: t })}>
            {t === "secciones" ? "Secciones" : "Categorías"}
          </button>
        ))}
      </nav>
      <Lista key={tipo} tipo={tipo} />
    </section>
  );
}

function Lista({ tipo }: { tipo: Tipo }) {
  const c = CONFIG[tipo];
  const { sesionVencida } = useSesion();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [uniendo, setUniendo] = useState<number | null>(null);
  const [nuevo, setNuevo] = useState("");
  const [filtro, setFiltro] = useState("");

  const falla = useCallback(
    (e: unknown, porDefecto: string): string => {
      if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
      return e instanceof ErrorApi ? (e.problemas[0] ?? e.message) : porDefecto;
    },
    [sesionVencida],
  );

  const cargar = useCallback(async () => {
    try {
      const r = await pedirApi<Record<Tipo, Item[]>>(c.ruta);
      setItems(r[tipo]);
    } catch (e) {
      setError(falla(e, `No se pudo cargar la lista de ${c.plural}.`));
    }
  }, [c.ruta, c.plural, tipo, falla]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Hace un pedido, muestra el resultado y recarga la lista. */
  async function hacer(ruta: string, metodo: string, cuerpo: unknown, exito: string): Promise<boolean> {
    setError(null);
    setOk(null);
    setOcupado(true);
    try {
      await pedirApi(ruta, { metodo, ...(cuerpo !== undefined ? { cuerpo } : {}) });
      setOk(exito);
      await cargar();
      return true;
    } catch (e) {
      setError(falla(e, "No se pudo completar la acción. Probá de nuevo."));
      await cargar();
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!nuevo.trim()) {
      setError(`Escribí el nombre de ${c.articulo} ${c.singular}.`);
      return;
    }
    if (await hacer(c.ruta, "POST", { nombre: nuevo }, `Creamos ${c.articulo} ${c.singular} «${nuevo.trim()}».`)) setNuevo("");
  }

  const editables = (items ?? []).filter((i) => !i.interna);

  // Ordenar arrastrando (con el mouse, el dedo o el teclado). Se ve el orden nuevo enseguida y se guarda; si falla, se vuelve a cargar el de la base.
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const nombreDe = (id: unknown) => items?.find((i) => i.id === id)?.nombre ?? "la sección";
  const lugarDe = (id: unknown) => editables.findIndex((i) => i.id === id) + 1;
  const anuncios: Announcements = {
    onDragStart: ({ active }) => `Levantaste «${nombreDe(active.id)}», que está en el lugar ${lugarDe(active.id)} de ${editables.length}.`,
    onDragOver: ({ active, over }) => (over && over.id !== active.id ? `«${nombreDe(active.id)}» pasó sobre el lugar ${lugarDe(over.id)} de ${editables.length}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Soltaste «${nombreDe(active.id)}» en el lugar ${lugarDe(over.id)} de ${editables.length}.` : `Soltaste «${nombreDe(active.id)}» en su lugar de siempre.`),
    onDragCancel: ({ active }) => `Cancelaste el movimiento de «${nombreDe(active.id)}»: queda en su lugar.`,
  };
  const instrucciones: ScreenReaderInstructions = {
    draggable: "Para cambiar de lugar una sección del menú: apretá la barra espaciadora para levantarla, movela con las flechas arriba y abajo y volvé a apretar la barra espaciadora para soltarla. Con Esc cancelás.",
  };
  const alEmpezarAArrastrar = (_e: DragStartEvent) => {
    // Los paneles abiertos (editar, unir) se cierran: no se mueven junto con la fila.
    setEditando(null);
    setUniendo(null);
  };
  const alSoltar = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = editables.map((i) => i.id);
    const nuevoOrden = arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
    setItems((actuales) => (actuales ? [...nuevoOrden.map((id) => actuales.find((x) => x.id === id)!), ...actuales.filter((x) => x.interna)] : actuales));
    void hacer(`${c.ruta}/orden`, "POST", { ids: nuevoOrden }, `Guardamos el orden del menú: «${nombreDe(active.id)}» quedó en el lugar ${nuevoOrden.indexOf(Number(active.id)) + 1}.`);
  };

  const visibles = items?.filter((i) => !filtro.trim() || i.nombre.toLowerCase().includes(filtro.trim().toLowerCase()) || i.slug.includes(filtro.trim().toLowerCase())) ?? [];

  return (
    <div>
      <p className="ayuda">
        {tipo === "secciones"
          ? "Las secciones son las del menú del sitio. Cada artículo tiene una. Para sacar una del menú hay que pasar sus artículos a otra (unir) y eliminarla."
          : "Las categorías sirven para agrupar artículos de distintas secciones. Cada artículo puede tener varias; una es la principal (la volanta)."}
      </p>

      <form className="busqueda" onSubmit={(e) => void crear(e)} noValidate aria-label={`Nueva ${c.singular}`}>
        <label htmlFor={`nuevo-${tipo}`} className="solo-lectores">
          Nombre de la nueva {c.singular}
        </label>
        <input id={`nuevo-${tipo}`} type="text" placeholder={`Nueva ${c.singular}`} maxLength={150} value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button type="submit" className="boton boton-primario" disabled={ocupado}>
          Crear {c.singular}
        </button>
      </form>
      {tipo === "categorias" && items && items.length > 8 && (
        <div className="busqueda">
          <label htmlFor="filtro-categorias" className="solo-lectores">
            Filtrar categorías
          </label>
          <input id="filtro-categorias" type="search" placeholder="Filtrar por nombre" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
      )}

      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className="aviso aviso-ok" role="status">
          {ok}
        </p>
      )}

      {!items && !error && (
        <p className="cargando" role="status">
          Cargando…
        </p>
      )}
      {items && (
        <div className="tabla-envoltorio">
          <DndContext sensors={sensores} collisionDetection={closestCenter} accessibility={{ announcements: anuncios, screenReaderInstructions: instrucciones }} onDragStart={alEmpezarAArrastrar} onDragEnd={alSoltar}>
          <table className="tabla">
            <caption className="solo-lectores">{c.plural}</caption>
            <thead>
              <tr>
                {c.ordena && (
                  <th scope="col" className="celda-arrastre">
                    <span className="solo-lectores">Orden en el menú</span>
                  </th>
                )}
                <th scope="col">Nombre</th>
                <th scope="col">Dirección</th>
                <th scope="col">Artículos</th>
                <th scope="col">
                  <span className="solo-lectores">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <SortableContext items={editables.map((i) => i.id)} strategy={verticalListSortingStrategy} disabled={!c.ordena}>
              {visibles.map((i) => {
                const Fila = c.ordena && !i.interna ? FilaOrdenable : FilaItem;
                return (
                  <Fila
                    key={i.id}
                    tipo={tipo}
                    item={i}
                    ocupado={ocupado}
                    editando={editando === i.id}
                    uniendo={uniendo === i.id}
                    otros={editables.filter((x) => x.id !== i.id)}
                    falla={falla}
                    alEditar={() => {
                      setEditando(editando === i.id ? null : i.id);
                      setUniendo(null);
                    }}
                    alUnir={() => {
                      setUniendo(uniendo === i.id ? null : i.id);
                      setEditando(null);
                    }}
                    alGuardar={async (nombre, slug) => {
                      const bien = await hacer(`${c.ruta}/${i.id}`, "PUT", { nombre, slug }, "Guardamos los cambios.");
                      if (bien) setEditando(null);
                    }}
                    alUnirConfirmado={async (destinoId) => {
                      const bien = await hacer(`${c.ruta}/${i.id}/unir`, "POST", { destinoId }, `Unimos «${i.nombre}» con la otra ${c.singular}.`);
                      if (bien) setUniendo(null);
                    }}
                    alEliminar={async () => {
                      if (window.confirm(`¿Eliminar ${c.articulo} ${c.singular} «${i.nombre}»? No se puede deshacer.`)) await hacer(`${c.ruta}/${i.id}`, "DELETE", undefined, `Eliminamos ${c.articulo} ${c.singular} «${i.nombre}».`);
                    }}
                  />
                );
              })}
              </SortableContext>
            </tbody>
          </table>
          </DndContext>
          {visibles.length === 0 && <p className="vacio">No hay {c.plural} que coincidan.</p>}
        </div>
      )}
    </div>
  );
}

type Arrastre = ReturnType<typeof useSortable>;

interface PropsFila {
  tipo: Tipo;
  item: Item;
  ocupado: boolean;
  editando: boolean;
  uniendo: boolean;
  otros: Item[];
  falla: (e: unknown, porDefecto: string) => string;
  alEditar: () => void;
  alUnir: () => void;
  alGuardar: (nombre: string, slug: string) => Promise<void>;
  alUnirConfirmado: (destinoId: number) => Promise<void>;
  alEliminar: () => Promise<void>;
}

/** Una fila que se puede arrastrar para cambiarla de lugar. */
function FilaOrdenable(props: PropsFila) {
  const arrastre = useSortable({ id: props.item.id, disabled: props.ocupado });
  return <FilaItem {...props} arrastre={arrastre} />;
}

function FilaItem({
  tipo,
  item,
  ocupado,
  editando,
  uniendo,
  otros,
  falla,
  alEditar,
  alUnir,
  alGuardar,
  alUnirConfirmado,
  alEliminar,
  arrastre,
}: PropsFila & { arrastre?: Arrastre }) {
  const c = CONFIG[tipo];
  const [nombre, setNombre] = useState(item.nombre);
  const [slug, setSlug] = useState(item.slug);
  const [destino, setDestino] = useState("");
  const [vista, setVista] = useState<VistaUnion | null>(null);
  const [errorVista, setErrorVista] = useState<string | null>(null);

  useEffect(() => {
    setVista(null);
    setErrorVista(null);
    if (!destino) return;
    let cancelado = false;
    pedirApi<VistaUnion>(`${c.ruta}/${item.id}/unir?destinoId=${destino}`)
      .then((v) => !cancelado && setVista(v))
      .catch((e: unknown) => !cancelado && setErrorVista(falla(e, "No se pudo preparar la unión.")));
    return () => {
      cancelado = true;
    };
  }, [destino, c.ruta, item.id, falla]);

  const cambios = nombre.trim() !== item.nombre || slug !== item.slug;
  const estiloFila: CSSProperties | undefined = arrastre
    ? { transform: CSS.Transform.toString(arrastre.transform ? { ...arrastre.transform, x: 0, scaleX: 1, scaleY: 1 } : null) ?? undefined, transition: arrastre.transition, ...(arrastre.isDragging ? { position: "relative", zIndex: 5 } : {}) }
    : undefined;
  const columnas = arrastre || c.ordena ? 5 : 4;
  return (
    <>
      <tr ref={arrastre?.setNodeRef} style={estiloFila} className={arrastre?.isDragging ? "fila-arrastrando" : undefined}>
        {c.ordena && (
          <td className="celda-arrastre">
            {arrastre && (
              <Tooltip texto="Arrastrá para cambiar el orden en el menú">
                <button
                  type="button"
                  ref={arrastre.setActivatorNodeRef}
                  className="boton-icono boton-arrastre"
                  aria-label={`Cambiar de lugar ${item.nombre} en el menú`}
                  disabled={ocupado}
                  {...arrastre.attributes}
                  {...arrastre.listeners}
                >
                  <Icono nombre="arrastrar" clase="icono icono-boton" />
                </button>
              </Tooltip>
            )}
          </td>
        )}
        <td className="celda-titulo">
          <span className="titulo-articulo">{item.nombre}</span>
          {item.interna && <span className="ayuda">Es interna: reúne los artículos que todavía no tienen sección. No se cambia.</span>}
        </td>
        <td>
          <span className="ayuda">{c.publica(item.slug)}</span>
        </td>
        <td>
          {item.articulos}
          {item.comoPrincipal ? <span className="ayuda"> ({item.comoPrincipal} como principal)</span> : null}
        </td>
        <td>
          {!item.interna && (
            <span className="acciones-fila">
              <BotonIcono icono="editar" etiqueta={`Editar ${item.nombre}`} texto="Editar nombre y dirección" expandido={editando} onClick={alEditar} />
              <BotonIcono icono="unir" etiqueta={`Unir ${item.nombre} con otra`} texto={`Unir con ${c.articulo} ${c.singular}…`} expandido={uniendo} onClick={alUnir} />
              <BotonIcono
                icono="eliminar"
                etiqueta={`Eliminar ${item.nombre}`}
                texto={`Eliminar ${c.articulo} ${c.singular}`}
                peligro
                disabled={ocupado || item.articulos > 0}
                motivo={item.articulos > 0 ? `Tiene ${item.articulos} ${item.articulos === 1 ? "artículo" : "artículos"}: pasalos a otra antes (Unir)` : undefined}
                onClick={() => void alEliminar()}
              />
            </span>
          )}
        </td>
      </tr>
      {editando && (
        <tr>
          <td colSpan={columnas}>
            <form
              className="grupo"
              aria-label={`Editar ${item.nombre}`}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void alGuardar(nombre, slug);
              }}
            >
              <div className="par-campos">
                <div className="campo">
                  <label htmlFor={`nombre-${tipo}-${item.id}`}>Nombre</label>
                  <input id={`nombre-${tipo}-${item.id}`} type="text" maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor={`slug-${tipo}-${item.id}`}>Dirección</label>
                  <input id={`slug-${tipo}-${item.id}`} type="text" maxLength={150} value={slug} onChange={(e) => setSlug(e.target.value)} />
                </div>
              </div>
              <p className="ayuda">La dirección usa solo letras minúsculas sin tildes, números y guiones. Si la cambiás, la anterior sigue funcionando y lleva a la nueva.</p>
              {tipo === "secciones" && slug !== item.slug && <p className="form-aviso">Cambiar la dirección de una sección que ya se usa en enlaces es delicado: la vieja redirige, pero conviene hacerlo pocas veces.</p>}
              <button type="submit" className="boton boton-primario" disabled={ocupado || !cambios}>
                Guardar
              </button>
            </form>
          </td>
        </tr>
      )}
      {uniendo && (
        <tr>
          <td colSpan={columnas}>
            <div className="grupo" role="group" aria-label={`Unir ${item.nombre} con otra`}>
              <div className="campo">
                <label htmlFor={`unir-${tipo}-${item.id}`}>
                  Unir «{item.nombre}» con {c.articulo} {c.singular}…
                </label>
                <select id={`unir-${tipo}-${item.id}`} value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Elegí cuál se queda</option>
                  {otros.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre} ({o.articulos})
                    </option>
                  ))}
                </select>
                <p className="ayuda">Los artículos pasan a la que elijas y esta se elimina (su dirección sigue funcionando y lleva a la otra).</p>
              </div>
              {errorVista && (
                <p className="aviso aviso-error" role="alert">
                  {errorVista}
                </p>
              )}
              {vista && (
                <div className="aviso aviso-alerta" role="status">
                  <p>
                    Se mueven <strong>{vista.articulos}</strong> {vista.articulos === 1 ? "artículo" : "artículos"} a <strong>{vista.elegida.nombre}</strong>.
                    {vista.yaConAmbas ? ` ${vista.yaConAmbas} ya tienen las dos y quedan con una sola.` : ""}
                    {vista.comoPrincipal ? ` ${vista.comoPrincipal} la tenían como principal (volanta) y pasan a tener la otra.` : ""}
                    {vista.enBorradores ? ` También se corrigen ${vista.enBorradores} con cambios sin publicar.` : ""}
                  </p>
                  <button
                    type="button"
                    className="boton boton-peligro"
                    disabled={ocupado}
                    onClick={() => {
                      if (window.confirm(`¿Unir «${vista.sobrante.nombre}» con «${vista.elegida.nombre}»? «${vista.sobrante.nombre}» deja de existir y no se puede deshacer.`)) void alUnirConfirmado(Number(destino));
                    }}
                  >
                    Unir
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
