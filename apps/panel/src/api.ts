// Llamadas a la API del panel. Los errores salen con un mensaje en lenguaje común, listo para mostrar.
import type { JSONNode } from "@evaristo/compartido/schema";

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    /** Lo que hay que corregir, en lenguaje común (respuestas 422). */
    readonly problemas: string[] = [],
  ) {
    super(mensaje);
  }
}

function mensajePorEstado(estado: number): string {
  if (estado === 401) return "Tu sesión terminó. Ingresá de nuevo.";
  if (estado === 403) return "No tenés permiso para hacer esto.";
  if (estado === 404) return "No encontramos lo que buscabas.";
  if (estado === 409) return "Este artículo cambió mientras lo editabas.";
  if (estado === 413) return "Lo que querés enviar es demasiado grande.";
  if (estado === 429) return "Hubo demasiados intentos. Esperá unos minutos y probá de nuevo.";
  if (estado >= 500) return "Algo salió mal de nuestro lado. Probá de nuevo en un momento.";
  return "No se pudo completar la acción. Revisá los datos y probá de nuevo.";
}

export async function pedirApi<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: opciones.metodo ?? "GET",
      credentials: "same-origin",
      ...(opciones.cuerpo !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(opciones.cuerpo) } : {}),
      ...(opciones.signal ? { signal: opciones.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ErrorApi(0, "No hay conexión con el servidor. Revisá tu conexión y probá de nuevo.");
  }
  const datos = (await respuesta.json().catch(() => null)) as { mensaje?: string; problemas?: unknown } | null;
  if (!respuesta.ok) {
    const problemas = Array.isArray(datos?.problemas) ? datos.problemas.filter((p): p is string => typeof p === "string") : [];
    throw new ErrorApi(respuesta.status, datos?.mensaje ?? mensajePorEstado(respuesta.status), problemas);
  }
  return datos as T;
}

export interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: "EDITOR" | "ADMINISTRADOR";
}

export type EstadoArticulo = "BORRADOR" | "PUBLICADO" | "PROGRAMADO";

export interface ArticuloDeLista {
  id: number;
  wpId: number | null;
  titulo: string;
  estado: EstadoArticulo;
  publicadoEn: string | null;
  actualizadoEn: string;
  altPendientes: number;
  seccion: string;
  autores: string[];
  ruta: string | null;
}

export interface RespuestaLista {
  total: number;
  pagina: number;
  paginas: number;
  conteos: Record<EstadoArticulo, number>;
  articulos: ArticuloDeLista[];
}

// ---------- Edición de artículos ----------

/** Los campos que se editan de un artículo (los mismos que valida la API). */
export interface DatosArticulo {
  titulo: string;
  bajada: string | null;
  cuerpo: JSONNode;
  seccionId: number;
  categoriaIds: number[];
  categoriaPrincipalId: number | null;
  autorIds: number[];
  imagenEncabezadoId: number | null;
  encabezadoAlt: string | null;
  encabezadoCredito: string | null;
  encabezadoPuntoFocalX: number;
  encabezadoPuntoFocalY: number;
  conCapital: boolean;
  novedadHasta: string | null;
  slug?: string;
}

export interface ArticuloEditable {
  id: number;
  wpId: number | null;
  estado: EstadoArticulo;
  publicadoEn: string | null;
  /** Se manda de vuelta al guardar: así la API detecta si otra persona guardó en el medio. */
  version: string;
  conCambiosSinPublicar: boolean;
  ruta: string | null;
  datos: DatosArticulo;
  /** La imagen de encabezado de datos, para mostrar su miniatura. */
  imagenEncabezado: { id: number; clave: string; nombreOriginal: string } | null;
}

export interface Catalogos {
  secciones: Array<{ id: number; slug: string; nombre: string }>;
  categorias: Array<{ id: number; slug: string; nombre: string }>;
  autores: Array<{ id: number; nombre: string; soloTexto: boolean }>;
}

export interface ImagenDeLista {
  id: number;
  clave: string;
  nombreOriginal: string;
  ancho: number;
  alto: number;
}

export interface RespuestaImagenes {
  total: number;
  pagina: number;
  paginas: number;
  imagenes: ImagenDeLista[];
}

/** Dirección con la que el panel y el sitio muestran una imagen de la biblioteca (la clave es un solo tramo, codificado). */
export const urlImagen = (clave: string): string => `/media/${encodeURIComponent(clave)}`;
