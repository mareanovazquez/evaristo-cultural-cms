// Configuración del sitio que edita el administrador (tabla `configuracion_sitio`, una sola fila). La comparten la API (valida y
// guarda), el panel (muestra los límites y la vista de cómo queda) y el sitio (la lee y, si no hay fila, usa estos valores).

export const TOPBAR_TEXTO_MAX = 200;
export const TOPBAR_ENLACE_MAX = 512;

export interface Topbar {
  /** Si se muestra. Apagado, o sin texto, el sitio no dibuja la franja. */
  activo: boolean;
  texto: string;
  /** `http(s)://…` o una dirección interna (`/…`); null si el texto va sin enlace. */
  enlace: string | null;
}

/** Lo que muestra el sitio mientras no haya nada guardado (la base real hasta la fase 7). */
export const TOPBAR_POR_DEFECTO: Topbar = {
  activo: true,
  texto: "Conseguí todos los libros de Evaristo Editorial en nuestra tienda online",
  enlace: "https://evaristoeditorial.com.ar",
};

/** ¿Es un enlace permitido? `http` o `https` con dirección completa, o interno que empieza con una sola `/`. Nada de `javascript:`, `//otro.sitio` ni espacios. */
export function enlaceValido(enlace: string): boolean {
  if (enlace.length > TOPBAR_ENLACE_MAX || /[\s\\<>"]/.test(enlace) || [...enlace].some((c) => c.charCodeAt(0) < 32)) return false;
  if (enlace.startsWith("/")) return !enlace.startsWith("//");
  try {
    const url = new URL(enlace);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

// ---------- Banner de la portada ----------
// Una sola medida para todos los anchos (decisión 77): la imagen es todo el contenido y recortarla en el celular cortaría el texto.

export const BANNER_MAX_IMAGENES = 3;
/** Tiempo entre una imagen y la siguiente cuando hay más de una. */
export const BANNER_INTERVALO_MS = 6000;
export const BANNER_ANCHO = 1800;
export const BANNER_ALTO = 600;
export const BANNER_ANCHO_MIN = 1200;
/** Cuánto puede apartarse la proporción de 3:1 (2 %). */
export const BANNER_TOLERANCIA = 0.02;
export const BANNER_MAX_BYTES = 2 * 1024 * 1024;
export const BANNER_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const BANNER_ALT_MAX = 200;

/** Lo que se le dice a quien carga las imágenes. */
export const BANNER_AYUDA_MEDIDA = `${BANNER_ANCHO} × ${BANNER_ALTO} píxeles (proporción 3:1), JPEG, PNG o WebP, de hasta ${BANNER_MAX_BYTES / 1024 / 1024} MB.`;

/** Por qué una imagen no sirve para el banner, en lenguaje común; null si sirve. La comprueban el panel (con el archivo) y la API (con lo guardado). */
export function problemaDeImagenDeBanner(imagen: { tipoMime: string; bytes: number; ancho: number; alto: number }): string | null {
  if (!(BANNER_MIMES as readonly string[]).includes(imagen.tipoMime)) return "Tiene que ser una imagen JPEG, PNG o WebP.";
  if (imagen.bytes > BANNER_MAX_BYTES) return `Pesa demasiado (máximo ${BANNER_MAX_BYTES / 1024 / 1024} MB). Reducila y probá de nuevo.`;
  if (imagen.ancho < 1 || imagen.alto < 1 || Math.abs(imagen.ancho / imagen.alto - BANNER_ANCHO / BANNER_ALTO) / (BANNER_ANCHO / BANNER_ALTO) > BANNER_TOLERANCIA) {
    return `Mide ${imagen.ancho} × ${imagen.alto} píxeles y tiene que tener proporción 3:1 (${BANNER_ANCHO} × ${BANNER_ALTO}).`;
  }
  if (imagen.ancho < BANNER_ANCHO_MIN) return `Es muy chica (${imagen.ancho} píxeles de ancho): tiene que tener al menos ${BANNER_ANCHO_MIN}, mejor ${BANNER_ANCHO}.`;
  return null;
}
