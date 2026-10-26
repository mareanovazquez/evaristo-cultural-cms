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
