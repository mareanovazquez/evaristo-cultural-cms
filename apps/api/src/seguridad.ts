import type { RequestHandler } from "express";
import helmet from "helmet";

// Cabeceras de seguridad del panel y del sitio público (paso 8 de la fase 4). La API ya usa `helmet()` con sus valores por defecto (app.ts).
//
//  - Panel (/admin): política de contenido estricta. Solo código propio (scripts solo de este sitio, sin nada en línea), estilos propios y en línea
//    (React y el editor los usan), imágenes propias, y los videos de YouTube y Vimeo que la vista previa puede mostrar. Nadie puede incrustarlo.
//  - Sitio público: la política de scripts y estilos la pone Astro en cada página (una etiqueta <meta> con los hashes de sus propios scripts; ver
//    apps/sitio/astro.config.mjs). Acá van las cabeceras que una etiqueta no puede decir: quién puede incrustar el sitio, `nosniff`, referrer, etc.
//    El tipo de recurso cruzado de las imágenes es abierto (`cross-origin`): las fotos se pueden mostrar en otros sitios y en vistas previas de redes.
//  - HSTS (obligar HTTPS) solo en producción: en local no tiene sentido y complica.

const VIDEOS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"];
const FUENTES_GOOGLE = { estilos: "https://fonts.googleapis.com", tipografias: "https://fonts.gstatic.com" };

const hsts = (produccion: boolean) => (produccion ? { maxAge: 15_552_000, includeSubDomains: false } : false);

export function cabecerasDelPanel(produccion: boolean): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", FUENTES_GOOGLE.estilos],
        "font-src": ["'self'", FUENTES_GOOGLE.tipografias, "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "frame-src": ["'self'", ...VIDEOS],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: hsts(produccion),
  });
}

export function cabecerasDelSitio(produccion: boolean): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      // Sin `default-src` a propósito: lo pone la etiqueta <meta> de cada página (Astro); acá solo van las directivas que una etiqueta no admite.
      directives: {
        "default-src": helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        "frame-ancestors": ["'self'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "object-src": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    strictTransportSecurity: hsts(produccion),
  });
}

/**
 * Qué proxies son de confianza para leer la dirección real de quien visita (la variable TRUST_PROXY). Sin variable, ninguno: es lo seguro cuando
 * no hay un proxy adelante. Un número es la cantidad de proxies entre el servidor y quien visita (por ejemplo, 1 detrás de un solo balanceador);
 * un texto es una lista de direcciones o nombres que Express entiende («loopback», «10.0.0.0/8»). `true` no se acepta: confiaría en cualquiera.
 */
export function confiarEnProxy(valor: string | undefined): boolean | number | string {
  const v = valor?.trim();
  if (!v || v === "0" || v.toLowerCase() === "false") return false;
  if (v.toLowerCase() === "true") throw new Error("TRUST_PROXY=true no se acepta (confiaría en cualquier encabezado). Indicá la cantidad de proxies (por ejemplo 1) o sus direcciones.");
  return /^\d+$/.test(v) ? Number(v) : v;
}
