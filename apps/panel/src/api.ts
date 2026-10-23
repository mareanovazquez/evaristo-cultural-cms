// Llamadas a la API del panel. Los errores salen con un mensaje en lenguaje común, listo para mostrar.
import type { Permiso, Rol } from "@evaristo/compartido/permisos";
import type { JSONNode } from "@evaristo/compartido/schema";
import { problemasEnLenguajeComun } from "./mensajes";

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
  if (estado === 415) return "Ese tipo de archivo no se puede subir.";
  if (estado === 429) return "Hubo demasiados intentos. Esperá unos minutos y probá de nuevo.";
  if (estado >= 500) return "Algo salió mal de nuestro lado. Probá de nuevo en un momento.";
  return "No se pudo completar la acción. Revisá los datos y probá de nuevo.";
}

export async function pedirApi<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  return enviar<T>(ruta, {
    method: opciones.metodo ?? "GET",
    credentials: "same-origin",
    ...(opciones.cuerpo !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(opciones.cuerpo) } : {}),
    ...(opciones.signal ? { signal: opciones.signal } : {}),
  });
}

/** Sube un archivo (multipart). No se fija el Content-Type: el navegador agrega el límite del formulario. */
export async function subirArchivo<T>(ruta: string, campo: string, archivo: File, signal?: AbortSignal): Promise<T> {
  const cuerpo = new FormData();
  cuerpo.append(campo, archivo);
  return enviar<T>(ruta, { method: "POST", credentials: "same-origin", body: cuerpo, ...(signal ? { signal } : {}) });
}

async function enviar<T>(ruta: string, init: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ErrorApi(0, "No hay conexión con el servidor. Revisá tu conexión y probá de nuevo.");
  }
  const datos = (await respuesta.json().catch(() => null)) as { mensaje?: string; problemas?: unknown } | null;
  if (!respuesta.ok) {
    const problemas = Array.isArray(datos?.problemas) ? problemasEnLenguajeComun(datos.problemas.filter((p): p is string => typeof p === "string")) : [];
    throw new ErrorApi(respuesta.status, datos?.mensaje ?? mensajePorEstado(respuesta.status), problemas);
  }
  return datos as T;
}

export interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  /** El administrador le puso la contraseña: tiene que elegir una propia antes de seguir. */
  debeCambiarClave: boolean;
  /** Qué puede hacer según su rol (la API vuelve a comprobarlo en cada pedido). */
  permisos: Permiso[];
}

// ---------- Autores ----------

export interface AutorDeLista {
  id: number;
  slug: string;
  nombre: string;
  soloTexto: boolean;
  conBio: boolean;
  conFoto: boolean;
  fotoSinAlt: boolean;
  usuario: { id: number; nombre: string } | null;
  articulos: number;
}

export interface RespuestaAutores {
  total: number;
  pagina: number;
  paginas: number;
  autores: AutorDeLista[];
}

/** La ficha de un autor tal como se edita. */
export interface AutorFicha {
  id: number;
  slug: string;
  nombre: string;
  soloTexto: boolean;
  bio: JSONNode | null;
  instagram: string | null;
  x: string | null;
  facebook: string | null;
  sitioWeb: string | null;
  fotoId: number | null;
  fotoAlt: string | null;
  fotoPuntoFocalX: number;
  fotoPuntoFocalY: number;
  foto: { id: number; clave: string; nombreOriginal: string } | null;
  /** Se manda de vuelta al guardar: así la API detecta si otra persona guardó en el medio. */
  version: string;
  usuario: { id: number; nombre: string } | null;
  articulos: number;
}

export interface VistaPreviaUnion {
  sobrante: { id: number; nombre: string; slug: string };
  elegido: { id: number; nombre: string; slug: string };
  articulos: number;
  muestra: Array<{ id: number; titulo: string; yaTieneAlElegido: boolean }>;
  seCompleta: string[];
  redireccion: string;
}

/** Un usuario tal como lo ve el administrador en la pantalla de usuarios. */
export interface UsuarioAdmin {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  debeCambiarClave: boolean;
  ultimoAccesoEn: string | null;
  creadoEn: string;
  /** Su ficha de autor, si tiene. */
  autor: { id: number; nombre: string; slug: string } | null;
  /** Cantidad de artículos que creó. */
  articulos: number;
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

/** Una imagen de la galería de un artículo, con su texto alternativo y su epígrafe (viven en cada uso). */
export interface GaleriaItemDatos {
  imagenId: number;
  alt: string | null;
  epigrafe: string | null;
}

/** Ficha técnica del libro (reseñas): una por artículo, todos los campos opcionales. */
export interface FichaDatos {
  titulo: string | null;
  autor: string | null;
  traductor: string | null;
  editorial: string | null;
  coleccion: string | null;
  anio: number | null;
  paginas: number | null;
  isbn: string | null;
  precio: string | null;
}

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
  galeria: GaleriaItemDatos[];
  ficha: FichaDatos | null;
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
  /** Quién lo creó en el panel (los migrados no tienen). */
  creadoPor: { id: number; nombre: string } | null;
  ruta: string | null;
  datos: DatosArticulo;
  /** La imagen de encabezado de datos, para mostrar su miniatura. */
  imagenEncabezado: { id: number; clave: string; nombreOriginal: string } | null;
  /** Las imágenes de la galería de datos, en el mismo orden, para mostrar sus miniaturas. */
  imagenesGaleria: Array<{ id: number; clave: string; nombreOriginal: string }>;
}

export interface Catalogos {
  secciones: Array<{ id: number; slug: string; nombre: string }>;
  categorias: Array<{ id: number; slug: string; nombre: string }>;
  autores: Array<{ id: number; nombre: string; soloTexto: boolean }>;
  /** Personas con acceso, para pasarles un artículo (viene vacío si no se puede). */
  usuarios: Array<{ id: number; nombre: string; rol: Rol }>;
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

export interface RespuestaSubida {
  /** true si ya había una imagen con el mismo contenido: no se guardó otra. */
  repetida: boolean;
  imagen: ImagenDeLista;
}

/** Cantidad máxima de imágenes de la galería de un artículo (la misma que valida la API). */
export const MAX_GALERIA = 40;

/** Tamaño máximo de una imagen al subirla (el mismo que valida la API). */
export const MAX_BYTES_IMAGEN = 10 * 1024 * 1024;

/** Proporción con la que el sitio muestra la imagen de encabezado (hero-img en apps/sitio/src/styles/articulo.css). */
export const PROPORCION_ENCABEZADO = "3 / 2";

// ---------- Publicación ----------

/** Lo que falta y lo que se propone para publicar (GET /api/admin/articulos/:id/publicacion). */
export interface RevisionPublicacion {
  /** publicar: un borrador; cambios: uno publicado con cambios sin publicar; ninguna: nada que publicar. */
  accion: "publicar" | "cambios" | "ninguna";
  problemas: string[];
  slugPropuesto?: string;
  /** Fecha con la que ya estuvo publicado (si se despublicó). */
  publicadoOriginal?: string | null;
  ahora?: string;
}

export interface RespuestaPublicar {
  version: string;
  articuloEstado: EstadoArticulo;
  publicadoEn: string;
  slug: string;
  ruta: string;
}
