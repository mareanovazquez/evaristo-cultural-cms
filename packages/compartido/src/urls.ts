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
 * Anchos de las variantes de tamaño (decisión 83). La API solo acepta estos en /media/<clave>?w=N, y si la imagen ya mide eso o
 * menos sirve el original. 160 es para las fotos chicas de autor (72 px y 56 px en pantallas de doble densidad).
 */
export const ANCHOS_VARIANTES = [160, 320, 480, 640, 800, 1200, 1600, 2000] as const;
export type AnchoVariante = (typeof ANCHOS_VARIANTES)[number];

/** Ruta de una variante de tamaño: /media/<clave>?w=N. */
export const urlMediaAncho = (clave: string, ancho: AnchoVariante): string => `${urlMedia(clave)}?w=${ancho}`;

// Los GIF no se achican: pueden ser animados y volver a codificarlos rompe la animación.
const esGif = (clave: string): boolean => /\.gif$/i.test(clave);

/**
 * Atributo `srcset` para una imagen de la biblioteca. Con el ancho del original, solo se ofrecen las variantes más chicas y el
 * original con su ancho real; sin él, todas (la API sirve el original si ya es más chico). Devuelve undefined si no hay nada que
 * elegir (GIF, o imagen más chica que la variante más chica).
 */
export function srcsetMedia(clave: string, ancho?: number | null): string | undefined {
  if (esGif(clave)) return undefined;
  const conAncho = typeof ancho === "number" && Number.isInteger(ancho) && ancho > 0;
  const anchos = conAncho ? ANCHOS_VARIANTES.filter((w) => w < ancho) : [...ANCHOS_VARIANTES];
  if (anchos.length === 0) return undefined;
  const partes = anchos.map((w) => `${urlMediaAncho(clave, w)} ${w}w`);
  if (conAncho) partes.push(`${urlMedia(clave)} ${ancho}w`);
  return partes.join(", ");
}

/** La clave de una ruta /media/<clave> (sin consulta), o undefined si la ruta es otra cosa (una URL externa, por ejemplo). */
export function claveDeUrlMedia(src: string): string | undefined {
  const m = /^\/media\/([^/?#]+)$/.exec(src.trim());
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return undefined;
  }
}

/** `srcset` a partir de una ruta /media/<clave> ya armada (tarjetas, carrusel, banner, cuerpo). */
export function srcsetDeUrl(src: string, ancho?: number | null): string | undefined {
  const clave = claveDeUrlMedia(src);
  return clave === undefined ? undefined : srcsetMedia(clave, ancho);
}

/**
 * Valores de `sizes` según dónde va la imagen (anchos de tokens.css: página 1200, ancho 960, texto 680; grilla de 3, 2 y 1 columnas
 * en 1024 y 640 px). Aproximados por arriba: el navegador elige la variante que alcanza para ese ancho.
 */
export const TAMANOS = {
  /** Encabezado del artículo (.wide). */
  encabezado: "(min-width: 1000px) 960px, 100vw",
  /** Imágenes del cuerpo (.col). */
  cuerpo: "(min-width: 720px) 680px, 100vw",
  /** Carrusel y banner de la portada, a lo ancho de la página. */
  pagina: "(min-width: 1240px) 1200px, 100vw",
  /** Tarjetas de los listados y de la portada. */
  tarjeta: "(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw",
  /** Miniaturas de la galería. */
  galeria: "(min-width: 640px) 320px, 100vw",
} as const;

/**
 * Ruta normalizada para comparar con `redirecciones.origen`: empieza con "/" y las secuencias %XX van con
 * el hexadecimal en minúscula (como las guarda WordPress: %e2%80%8e).
 */
export function normalizarRuta(ruta: string): string {
  const conBarra = ruta.startsWith("/") ? ruta : `/${ruta}`;
  return conBarra.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toLowerCase());
}
