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

export const DatosSchema = z
  .object({
    titulo: z.string().trim().min(1, "Escribí el título del artículo.").max(512, "El título es demasiado largo (máximo 512 caracteres)."),
    bajada: z.string().trim().max(2000, "La bajada es demasiado larga (máximo 2.000 caracteres).").nullable(),
    cuerpo: CuerpoSchema,
    seccionId: Id,
    categoriaIds: z.array(Id).max(30),
    categoriaPrincipalId: Id.nullable(),
    autorIds: z.array(Id).max(20),
    imagenEncabezadoId: Id.nullable(),
    encabezadoAlt: z.string().trim().max(2000).nullable(),
    encabezadoCredito: z.string().trim().max(255).nullable(),
    encabezadoPuntoFocalX: z.number().min(0).max(1),
    encabezadoPuntoFocalY: z.number().min(0).max(1),
    conCapital: z.boolean(),
    novedadHasta: z.string().datetime().nullable(),
    // Solo se puede cambiar mientras el artículo es BORRADOR: el de uno publicado es su dirección pública.
    // El formato estricto (SlugSchema) se exige solo cuando cambia; los migrados pueden traer uno que no lo cumpla y tienen que poder guardarse.
    slug: z.string().min(1).max(255).optional(),
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
export function contarAltPendientes(d: Pick<DatosArticulo, "cuerpo" | "imagenEncabezadoId" | "encabezadoAlt">, galeriaPendientes = 0): number {
  return contarImagenesPendientes(d.cuerpo) + (d.imagenEncabezadoId !== null && !d.encabezadoAlt?.trim() ? 1 : 0) + galeriaPendientes;
}
