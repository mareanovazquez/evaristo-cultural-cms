// Llamadas a la API del panel. Los errores salen con un mensaje en lenguaje común, listo para mostrar.

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

function mensajePorEstado(estado: number): string {
  if (estado === 401) return "Tu sesión terminó. Ingresá de nuevo.";
  if (estado === 403) return "No tenés permiso para hacer esto.";
  if (estado === 404) return "No encontramos lo que buscabas.";
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
  const datos = (await respuesta.json().catch(() => null)) as { mensaje?: string } | null;
  if (!respuesta.ok) throw new ErrorApi(respuesta.status, datos?.mensaje ?? mensajePorEstado(respuesta.status));
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
