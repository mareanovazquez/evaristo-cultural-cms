import type { RequestHandler } from "express";

// Las páginas del sitio van con barra final (/autores/, /seccion/entrevista/), como en WordPress. Sin la barra, respondían igual: dos
// direcciones con el mismo contenido para los buscadores. Desde el 11/11/2026, la dirección sin barra redirige con 301 a la que la tiene
// (la canónica del <head>). Va después de las redirecciones de WordPress y antes del sitio.
//
// No se toca: lo que no es GET ni HEAD, /api, /admin, /media y /_astro, los archivos (lo que termina en una extensión: favicon.svg,
// robots.txt), las rutas que empiezan con // o /\ (el navegador tomaría el destino como otro sitio: sería una redirección abierta) y las
// mal codificadas (dan 404 directo).

const EXCLUIDAS = /^\/(api|admin|media|_astro)(\/|$)/;

/** La dirección con la barra final agregada (conserva la consulta), o undefined si no corresponde redirigir. */
export function direccionConBarraFinal(original: string): string | undefined {
  const i = original.indexOf("?");
  const ruta = i < 0 ? original : original.slice(0, i);
  const consulta = i < 0 ? "" : original.slice(i);
  if (!ruta.startsWith("/") || ruta.endsWith("/")) return undefined;
  if (/^\/[/\\]/.test(ruta) || ruta.includes("\\")) return undefined;
  if (EXCLUIDAS.test(ruta)) return undefined;
  // Mal codificada (%E0%A4%A): no tiene sentido mandarla a otra dirección igual de rota; el sitio responde 404.
  try {
    decodeURIComponent(ruta);
  } catch {
    return undefined;
  }
  const ultimo = ruta.slice(ruta.lastIndexOf("/") + 1);
  if (/\.[A-Za-z0-9]{1,8}$/.test(ultimo)) return undefined;
  return `${ruta}/${consulta}`;
}

export function crearRedireccionBarraFinal(): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const destino = direccionConBarraFinal(req.originalUrl);
    if (destino === undefined) return next();
    res.redirect(301, destino);
  };
}
