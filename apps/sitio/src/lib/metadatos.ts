// Metadatos del <head> para buscadores y redes (punto 6 del lanzamiento, 11/11/2026): dirección canónica, descripción y Open Graph.
// Funciones puras; las usa layouts/Base.astro. Las direcciones completas salen de SITIO_URL (baseDelSitio, la misma del feed).
import { ANCHOS_VARIANTES, urlMedia, urlMediaAncho } from "@evaristo/compartido/urls";

export { baseDelSitio } from "./feed";

export const NOMBRE_SITIO = "Evaristo Cultural";
/** Descripción de las páginas que no traen una propia. */
export const DESCRIPCION_SITIO = "Revista cultural de Evaristo Editorial: entrevistas, reseñas, ensayos y crónicas desde 2006.";
/** Largo máximo de la descripción: lo que muestran los buscadores sin cortar. */
export const LARGO_DESCRIPCION = 160;
/** Ancho de la imagen para redes: Facebook y WhatsApp recomiendan 1200 px. */
export const ANCHO_REDES = 1200;

/**
 * La dirección canónica de una página: la base del sitio, la ruta tal cual y, de la consulta, solo `pagina` (desde la 2). Todo lo demás
 * (marcas de campañas, ?capital=1, etc.) no forma parte de la dirección.
 */
export function urlCanonica(url: URL, base: string): string {
  const pagina = url.searchParams.get("pagina");
  const conPagina = pagina && /^\d+$/.test(pagina) && Number(pagina) > 1 ? `?pagina=${Number(pagina)}` : "";
  return `${base}${url.pathname}${conPagina}`;
}

/**
 * La descripción para buscadores y redes: sin espacios de más y, si es larga, cortada en una palabra con «…». Vacía o ausente: la del
 * sitio.
 */
export function descripcionCorta(texto: string | null | undefined, largo: number = LARGO_DESCRIPCION): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return DESCRIPCION_SITIO;
  if (limpio.length <= largo) return limpio;
  const corte = limpio.slice(0, largo - 1);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > largo * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s.,;:—–-]+$/, "")}…`;
}

export interface ImagenParaRedes {
  url: string;
  ancho?: number;
  alto?: number;
}

/**
 * La imagen para redes: la variante de 1200 px (o el original si es más chico, o si es un GIF, que no se achica), con dirección completa y
 * sus medidas si se conocen.
 */
export function imagenParaRedes(imagen: { clave: string; ancho?: number | null; alto?: number | null }, base: string): ImagenParaRedes {
  const { clave, ancho, alto } = imagen;
  const conMedidas = typeof ancho === "number" && ancho > 0 && typeof alto === "number" && alto > 0;
  const achicar = !/\.gif$/i.test(clave) && (!conMedidas || ancho > ANCHO_REDES) && ANCHOS_VARIANTES.includes(ANCHO_REDES as (typeof ANCHOS_VARIANTES)[number]);
  const url = `${base}${achicar ? urlMediaAncho(clave, ANCHO_REDES as (typeof ANCHOS_VARIANTES)[number]) : urlMedia(clave)}`;
  if (!conMedidas) return { url };
  if (!achicar) return { url, ancho, alto };
  return { url, ancho: ANCHO_REDES, alto: Math.round((alto * ANCHO_REDES) / ancho) };
}
