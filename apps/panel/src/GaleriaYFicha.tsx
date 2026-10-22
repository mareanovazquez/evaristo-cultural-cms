import { useState } from "react";
import { MAX_GALERIA, urlImagen, type FichaDatos, type GaleriaItemDatos, type ImagenDeLista } from "./api";
import { SelectorImagen } from "./editor/SelectorImagen";

// Los dos bloques opcionales del final de la nota que se editan acá: la galería de imágenes y la ficha técnica del libro.

export interface Miniatura {
  clave: string;
  nombreOriginal: string;
}

// ---------- Galería ----------

interface EditorGaleriaProps {
  items: GaleriaItemDatos[];
  /** Cómo se ve cada imagen (por su id), para las miniaturas. */
  miniaturas: Record<number, Miniatura>;
  onCambio: (items: GaleriaItemDatos[]) => void;
  /** Avisa de una imagen que se acaba de agregar, para poder mostrar su miniatura. */
  onMiniatura: (id: number, miniatura: Miniatura) => void;
}

export function EditorGaleria({ items, miniaturas, onCambio, onMiniatura }: EditorGaleriaProps) {
  const [eligiendo, setEligiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const agregar = (imagen: ImagenDeLista) => {
    setEligiendo(false);
    if (items.some((i) => i.imagenId === imagen.id)) {
      setAviso("Esa imagen ya está en la galería.");
      return;
    }
    if (items.length >= MAX_GALERIA) {
      setAviso(`La galería no puede tener más de ${MAX_GALERIA} imágenes.`);
      return;
    }
    setAviso(null);
    onMiniatura(imagen.id, { clave: imagen.clave, nombreOriginal: imagen.nombreOriginal });
    onCambio([...items, { imagenId: imagen.id, alt: null, epigrafe: null }]);
  };
  const cambiar = (indice: number, parcial: Partial<GaleriaItemDatos>) => onCambio(items.map((it, i) => (i === indice ? { ...it, ...parcial } : it)));
  const mover = (indice: number, salto: -1 | 1) => {
    const destino = indice + salto;
    if (destino < 0 || destino >= items.length) return;
    const copia = [...items];
    [copia[indice], copia[destino]] = [copia[destino]!, copia[indice]!];
    onCambio(copia);
  };
  const sinTexto = items.filter((i) => !i.alt?.trim()).length;

  return (
    <fieldset className="grupo galeria-editor">
      <legend>Galería de imágenes (opcional)</legend>
      <p className="ayuda">Un conjunto de imágenes que se ve al final de la nota, después de la ficha técnica. Al hacer clic en una, se abre ampliada.</p>
      {items.length === 0 && <p className="ayuda">Todavía no hay imágenes en la galería.</p>}
      {sinTexto > 0 && (
        <p className="form-aviso" role="status">
          {sinTexto === 1 ? "Falta el texto alternativo de una imagen." : `Falta el texto alternativo de ${sinTexto} imágenes.`} Es obligatorio para publicar: describe cada foto para quien no puede verla.
        </p>
      )}
      <ol className="galeria-items">
        {items.map((item, i) => {
          const mini = miniaturas[item.imagenId];
          const nombre = mini?.nombreOriginal ?? `imagen ${item.imagenId}`;
          return (
            <li key={item.imagenId} className="galeria-item">
              {mini ? <img src={urlImagen(mini.clave)} alt="" /> : <span className="galeria-sin-miniatura">Sin vista</span>}
              <div className="galeria-item-campos">
                <p className="galeria-item-nombre">{nombre}</p>
                <div className="campo">
                  <label htmlFor={`galeria-alt-${item.imagenId}`}>Texto alternativo</label>
                  <input id={`galeria-alt-${item.imagenId}`} type="text" value={item.alt ?? ""} maxLength={2000} aria-invalid={!item.alt?.trim()} onChange={(e) => cambiar(i, { alt: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor={`galeria-epigrafe-${item.imagenId}`}>Epígrafe (opcional)</label>
                  <input id={`galeria-epigrafe-${item.imagenId}`} type="text" value={item.epigrafe ?? ""} maxLength={1000} onChange={(e) => cambiar(i, { epigrafe: e.target.value })} />
                </div>
                <div className="acciones-fila">
                  <button type="button" className="boton boton-suave" disabled={i === 0} aria-label={`Subir la imagen ${nombre}`} onClick={() => mover(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="boton boton-suave" disabled={i === items.length - 1} aria-label={`Bajar la imagen ${nombre}`} onClick={() => mover(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className="boton boton-suave" aria-label={`Quitar la imagen ${nombre} de la galería`} onClick={() => onCambio(items.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {aviso && (
        <p className="form-error" role="alert">
          {aviso}
        </p>
      )}
      <button type="button" className="boton boton-suave" onClick={() => setEligiendo(true)} disabled={items.length >= MAX_GALERIA}>
        Agregar una imagen
      </button>
      {eligiendo && <SelectorImagen onElegir={agregar} onCancelar={() => setEligiendo(false)} />}
    </fieldset>
  );
}

// ---------- Ficha técnica ----------

export const FICHA_VACIA: FichaDatos = { titulo: null, autor: null, traductor: null, editorial: null, coleccion: null, anio: null, paginas: null, isbn: null, precio: null };

/** La ficha para mandar a la API: sin campos en blanco, y null si no queda ninguno. */
export function fichaParaEnviar(ficha: FichaDatos | null): FichaDatos | null {
  if (!ficha) return null;
  const limpia = Object.fromEntries(Object.entries(ficha).map(([k, v]) => [k, typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v])) as unknown as FichaDatos;
  return Object.values(limpia).every((v) => v === null) ? null : limpia;
}

const CAMPOS_TEXTO: Array<{ campo: keyof FichaDatos; etiqueta: string; max: number; ayuda?: string }> = [
  { campo: "titulo", etiqueta: "Título del libro", max: 512 },
  { campo: "autor", etiqueta: "Autor del libro", max: 512, ayuda: "El autor del libro, no el de la nota." },
  { campo: "traductor", etiqueta: "Traductor", max: 255 },
  { campo: "editorial", etiqueta: "Editorial", max: 255 },
  { campo: "coleccion", etiqueta: "Colección", max: 255 },
];

export function EditorFicha({ ficha, onCambio }: { ficha: FichaDatos | null; onCambio: (ficha: FichaDatos | null) => void }) {
  const actual = ficha ?? FICHA_VACIA;
  const hayDatos = fichaParaEnviar(ficha) !== null;
  const poner = (parcial: Partial<FichaDatos>) => onCambio({ ...actual, ...parcial });
  const numero = (campo: "anio" | "paginas", texto: string) => {
    if (texto.trim() === "") return poner({ [campo]: null });
    const n = Number(texto);
    if (Number.isFinite(n)) poner({ [campo]: Math.trunc(n) });
  };

  return (
    <fieldset className="grupo ficha-editor">
      <legend>Ficha técnica del libro (opcional)</legend>
      <details open={hayDatos}>
        <summary>{hayDatos ? "Datos del libro" : "Agregar los datos del libro reseñado"}</summary>
        <p className="ayuda">Para las reseñas. Se ve al final de la nota. Completá solo lo que tengas: los campos vacíos no se muestran.</p>
        {CAMPOS_TEXTO.map(({ campo, etiqueta, max, ayuda }) => (
          <div className="campo" key={campo}>
            <label htmlFor={`ficha-${campo}`}>{etiqueta}</label>
            <input id={`ficha-${campo}`} type="text" value={(actual[campo] as string | null) ?? ""} maxLength={max} onChange={(e) => poner({ [campo]: e.target.value })} />
            {ayuda && <p className="ayuda">{ayuda}</p>}
          </div>
        ))}
        <div className="par-campos">
          <div className="campo">
            <label htmlFor="ficha-anio">Año</label>
            <input id="ficha-anio" type="number" min={1000} max={new Date().getFullYear() + 2} step={1} value={actual.anio ?? ""} onChange={(e) => numero("anio", e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="ficha-paginas">Páginas</label>
            <input id="ficha-paginas" type="number" min={1} max={20000} step={1} value={actual.paginas ?? ""} onChange={(e) => numero("paginas", e.target.value)} />
          </div>
        </div>
        <div className="par-campos">
          <div className="campo">
            <label htmlFor="ficha-isbn">ISBN</label>
            <input id="ficha-isbn" type="text" value={actual.isbn ?? ""} maxLength={20} onChange={(e) => poner({ isbn: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="ficha-precio">Precio</label>
            <input id="ficha-precio" type="text" value={actual.precio ?? ""} maxLength={50} onChange={(e) => poner({ precio: e.target.value })} />
          </div>
        </div>
        {hayDatos && (
          <button type="button" className="boton boton-suave" onClick={() => onCambio(null)}>
            Quitar la ficha técnica
          </button>
        )}
      </details>
    </fieldset>
  );
}
