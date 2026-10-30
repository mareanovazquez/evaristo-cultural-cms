// URLs públicas del sitio. Funciones puras, compartidas por el sitio (Astro) y la API (redirecciones).

const dos = (n: number): string => String(n).padStart(2, "0");

/** URL canónica del artículo: /AAAA/MM/DD/slug/ (decidido el 21/10/2026). La fecha sale de publicadoEn en UTC. */
export function rutaArticulo(a: { slug: string; publicadoEn: Date }): string {
  const d = a.publicadoEn;
  return `/${d.getUTCFullYear()}/${dos(d.getUTCMonth() + 1)}/${dos(d.getUTCDate())}/${encodeURIComponent(a.slug)}/`;
}

/** Página de un autor: /author/<slug>/ (la misma que tenía en WordPress). */
export const rutaAutor = (slug: string): string => `/author/${encodeURIComponent(slug)}/`;

/** Página de una sección: /seccion/<slug>/ (URL propia del sitio nuevo; las /category/… de WordPress se redirigen con el `destino` del mapeo de taxonomías, decisión 78). */
export const rutaSeccion = (slug: string): string => `/seccion/${encodeURIComponent(slug)}/`;

/** Página de una categoría: /categoria/<slug>/ (URL propia; las /category/… de WordPress se redirigen con el `destino` del mapeo de taxonomías, decisión 78). */
export const rutaCategoria = (slug: string): string => `/categoria/${encodeURIComponent(slug)}/`;

/** Ruta pública de un archivo de la biblioteca (la sirve apps/api en /media/<clave>). */
export const urlMedia = (clave: string): string => `/media/${encodeURIComponent(clave)}`;

/**
 * Ruta normalizada para comparar con `redirecciones.origen`: empieza con "/" y las secuencias %XX van con
 * el hexadecimal en minúscula (como las guarda WordPress: %e2%80%8e).
 */
export function normalizarRuta(ruta: string): string {
  const conBarra = ruta.startsWith("/") ? ruta : `/${ruta}`;
  return conBarra.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toLowerCase());
}
