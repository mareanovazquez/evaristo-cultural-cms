import { z } from "zod";
import { contarImagenesPendientes, validateArticleBodyDetallado, type JSONNode } from "@evaristo/compartido/schema";

// Los campos que una persona puede editar de un artículo, con su validación. Es el mismo formato en la API, en el borrador de cambios
// (`articulos_borradores.datos`) y en lo que vuelve el panel. El estado y la fecha de publicación NO se editan acá (publicar es otro paso).

export const MAX_CUERPO_BYTES = 1_500_000;

const Id = z.number().int().positive();

const esDocumento = (v: unknown): v is JSONNode => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const d = v as { type?: unknown; content?: unknown };
  return d.type === "doc" && Array.isArray(d.content);
};

export const CuerpoSchema = z
  .custom<JSONNode>(esDocumento, "El texto del artículo no tiene el formato esperado.")
  .refine((v) => JSON.stringify(v).length <= MAX_CUERPO_BYTES, "El texto del artículo es demasiado largo.");

export const SlugSchema = z
  .string()
  .max(255)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "La dirección solo puede tener letras minúsculas sin tildes, números y guiones.");

/** Cantidad máxima de imágenes de la galería de un artículo. */
export const MAX_GALERIA = 40;

/** Una imagen de la galería: la de la biblioteca, con su texto alternativo y su epígrafe (los dos viven en cada uso). */
export const GaleriaItemSchema = z
  .object({
    imagenId: Id,
    alt: z.string().trim().max(2000, "El texto alternativo de una imagen de la galería es demasiado largo (máximo 2.000 caracteres).").nullable(),
    epigrafe: z.string().trim().max(1000, "El epígrafe de una imagen de la galería es demasiado largo (máximo 1.000 caracteres).").nullable(),
  })
  .strict();

const textoDeFicha = (max: number, mensaje: string) => z.string().trim().max(max, mensaje).nullable();

/** Ficha técnica del libro (reseñas): una por artículo y todos los campos son opcionales. El autor es el del libro, no el de la nota. */
export const FichaSchema = z
  .object({
    titulo: textoDeFicha(512, "El título del libro es demasiado largo (máximo 512 caracteres)."),
    autor: textoDeFicha(512, "El autor del libro es demasiado largo (máximo 512 caracteres)."),
    traductor: textoDeFicha(255, "El traductor es demasiado largo (máximo 255 caracteres)."),
    editorial: textoDeFicha(255, "La editorial es demasiado larga (máximo 255 caracteres)."),
    coleccion: textoDeFicha(255, "La colección es demasiado larga (máximo 255 caracteres)."),
    anio: z.number().int("El año tiene que ser un número entero.").min(1000, "El año del libro no es válido.").max(new Date().getFullYear() + 2, "El año del libro no es válido.").nullable(),
    paginas: z.number().int("La cantidad de páginas tiene que ser un número entero.").min(1, "La cantidad de páginas no es válida.").max(20000, "La cantidad de páginas no es válida.").nullable(),
    isbn: z.string().trim().max(20, "El ISBN es demasiado largo.").regex(/^[0-9Xx -]*$/, "El ISBN solo puede tener números, guiones y la letra X.").nullable(),
    precio: textoDeFicha(50, "El precio es demasiado largo (máximo 50 caracteres)."),
  })
  .strict();

export type FichaTecnicaDatos = z.infer<typeof FichaSchema>;
export type GaleriaItemDatos = z.infer<typeof GaleriaItemSchema>;

/** La ficha sin campos en blanco; null si no queda ninguno (una ficha vacía es lo mismo que no tener ficha). */
export function normalizarFicha(ficha: FichaTecnicaDatos | null): FichaTecnicaDatos | null {
  if (!ficha) return null;
  const limpia = Object.fromEntries(Object.entries(ficha).map(([k, v]) => [k, typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v])) as FichaTecnicaDatos;
  return Object.values(limpia).every((v) => v === null) ? null : limpia;
}

export const DatosSchema = z
  .object({
    titulo: z.string().trim().min(1, "Escribí el título del artículo.").max(512, "El título es demasiado largo (máximo 512 caracteres)."),
    bajada: z.string().trim().max(2000, "La bajada es demasiado larga (máximo 2.000 caracteres).").nullable(),
    cuerpo: CuerpoSchema,
    seccionId: Id,
    categoriaIds: z.array(Id).max(30, "Hay demasiadas categorías (el máximo es 30)."),
    categoriaPrincipalId: Id.nullable(),
    autorIds: z.array(Id).max(20, "Hay demasiados autores (el máximo es 20)."),
    imagenEncabezadoId: Id.nullable(),
    encabezadoAlt: z.string().trim().max(2000, "El texto alternativo de la imagen principal es demasiado largo (máximo 2.000 caracteres).").nullable(),
    encabezadoCredito: z.string().trim().max(255, "El crédito de la imagen principal es demasiado largo (máximo 255 caracteres).").nullable(),
    encabezadoPuntoFocalX: z.number().min(0, "El punto focal tiene que estar entre 0 y 100.").max(1, "El punto focal tiene que estar entre 0 y 100."),
    encabezadoPuntoFocalY: z.number().min(0, "El punto focal tiene que estar entre 0 y 100.").max(1, "El punto focal tiene que estar entre 0 y 100."),
    galeria: z.array(GaleriaItemSchema).max(MAX_GALERIA, `La galería tiene demasiadas imágenes (el máximo es ${MAX_GALERIA}).`).default([]),
    ficha: FichaSchema.nullable().default(null),
    conCapital: z.boolean(),
    novedadHasta: z.string().datetime().nullable(),
    // Solo se puede cambiar mientras el artículo es BORRADOR: el de uno publicado es su dirección pública.
    // El formato estricto (SlugSchema) se exige solo cuando cambia; los migrados pueden traer uno que no lo cumpla y tienen que poder guardarse.
    slug: z.string().min(1, "La dirección del artículo no puede quedar vacía.").max(255, "La dirección del artículo es demasiado larga.").optional(),
  })
  .strict();

export type DatosArticulo = z.infer<typeof DatosSchema>;

/** Datos mínimos para crear un artículo nuevo; el resto arranca vacío. */
export const NuevoSchema = z
  .object({ titulo: DatosSchema.shape.titulo, seccionId: Id })
  .strict();

export const cuerpoVacio = (): JSONNode => ({ type: "doc", content: [] });

/** Clave con la que se reconoce una imagen del cuerpo entre dos versiones: su imagenId o, si no tiene, su dirección. */
const claveDeImagen = (n: JSONNode): string => (typeof n.attrs?.["imagenId"] === "number" ? `id:${String(n.attrs["imagenId"])}` : `src:${String(n.attrs?.["src"] ?? "")}`);

function imagenes(doc: JSONNode, destino: JSONNode[] = []): JSONNode[] {
  if (doc.type === "imagen") destino.push(doc);
  // Las notas al pie guardan su contenido en attrs.content, pero ahí no hay imágenes (el validador no las admite).
  doc.content?.forEach((h) => imagenes(h, destino));
  return destino;
}

/** imagenId que el cuerpo referencia. */
export const imagenIdsDelCuerpo = (doc: JSONNode): number[] => [...new Set(imagenes(doc).flatMap((n) => (typeof n.attrs?.["imagenId"] === "number" ? [n.attrs["imagenId"]] : [])))];

/**
 * Errores de validar un cuerpo nuevo (modo estricto, el del panel) más la regla de altPendiente: la marca "falta el texto alternativo"
 * solo puede estar en imágenes que ya la tenían en alguna versión guardada antes (la del artículo o la de su borrador de cambios).
 * Nadie puede marcar una imagen como pendiente a mano para saltearse el texto alternativo obligatorio.
 */
export function erroresDelCuerpo(nuevo: JSONNode, anteriores: JSONNode[]): string[] {
  const { errores } = validateArticleBodyDetallado(nuevo, { modo: "estricto" });
  const permitidas = new Set(anteriores.flatMap((doc) => imagenes(doc).filter((n) => n.attrs?.["altPendiente"] === true).map(claveDeImagen)));
  for (const img of imagenes(nuevo)) {
    if (img.attrs?.["altPendiente"] === true && !permitidas.has(claveDeImagen(img))) {
      errores.push("Una imagen nueva no puede quedar con el texto alternativo pendiente: completá el texto alternativo o marcala como decorativa.");
    }
  }
  return errores;
}

/** Imágenes del artículo con el texto alternativo pendiente (cuerpo, encabezado y galería). Lo guarda `articulos.altPendientes`. */
export function contarAltPendientes(d: Pick<DatosArticulo, "cuerpo" | "imagenEncabezadoId" | "encabezadoAlt" | "galeria">): number {
  return contarImagenesPendientes(d.cuerpo) + (d.imagenEncabezadoId !== null && !d.encabezadoAlt?.trim() ? 1 : 0) + d.galeria.filter((i) => !i.alt?.trim()).length;
}
