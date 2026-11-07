// URLs viejas de WordPress que no están en la tabla `redirecciones` (Etapa 1, punto 5 de la fase 7; decidido con Mariano el 7/11/2026).
// Funciones puras: la API (apps/api/src/redirecciones.ts) las usa antes de consultar la base. Lo que necesita la base (?p=, ?author=,
// /wp-content/uploads/) se devuelve como un pedido para que lo resuelva la API.
//
// Medido sobre el dump del 31/10/2026: los enlaces permanentes eran /%year%/%monthnum%/%day%/%postname%/ con la hora en UTC
// (gmt_offset 0), así que la fecha de la URL vieja coincide siempre con la canónica; categorías y etiquetas sin base (/category/…, /tag/…);
// uploads en una carpeta plana; 5 páginas fijas publicadas (home, rastros, historieta, literatura y la de ejemplo); 5.959 etiquetas.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MapeoTaxonomias } from "./conversor/taxonomia.ts";

export interface EtiquetasWp {
  /** slug decodificado → nombre */
  etiquetas: Record<string, string>;
}

export function cargarEtiquetasWp(ruta = fileURLToPath(new URL("../datos/redirecciones/etiquetas-wp.json", import.meta.url))): EtiquetasWp {
  const datos = JSON.parse(readFileSync(ruta, "utf8")) as Partial<EtiquetasWp>;
  if (!datos.etiquetas || typeof datos.etiquetas !== "object") throw new Error(`${ruta}: falta "etiquetas"`);
  return { etiquetas: datos.etiquetas };
}

/** Lo que hay que hacer con una URL vieja: redirigir a un destino fijo, o buscar en la base el artículo, el autor o la imagen. */
export type RutaWp =
  | { destino: string }
  | { articuloWpId: number }
  | { autorWpUserId: number }
  | { uploads: string };

/** Páginas fijas de WordPress (post_type = page, publicadas): slug e id → a dónde van. Las de taxonomía usan el destino del mapeo. */
const PAGINAS_WP: Array<{ id: number; slug: string; destino: string | { taxonomia: string } }> = [
  { id: 23, slug: "home", destino: "/" },
  { id: 69, slug: "rastros", destino: { taxonomia: "rastros" } },
  { id: 71, slug: "historieta", destino: { taxonomia: "historieta" } },
  { id: 74, slug: "literatura", destino: { taxonomia: "literatura" } },
  // La 2 («Sample Page», la de ejemplo de WordPress) no se redirige: da 404.
];

const FEEDS = /^(?:feed|rss2?|atom|rdf)$/;

const decodificar = (s: string): string | undefined => {
  try {
    return decodeURIComponent(s).normalize("NFC");
  } catch {
    return undefined;
  }
};
const buscar = (texto: string) => `/buscar/?q=${encodeURIComponent(texto)}`;
const entero = (v: string | null): number | undefined => (v !== null && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : undefined);

function destinoPagina(p: (typeof PAGINAS_WP)[number], mapeo: MapeoTaxonomias): string | undefined {
  if (typeof p.destino === "string") return p.destino;
  const t = mapeo.taxonomiasWp[p.destino.taxonomia];
  return t?.destino;
}

/**
 * Resuelve una URL vieja de WordPress. `ruta` es el path del pedido (sin la consulta) y `consulta`, sus parámetros. Devuelve undefined si
 * no es una URL de WordPress conocida (el pedido sigue: la tabla de redirecciones, el sitio o el 404). Las /category/… no se tratan acá
 * (las resuelve `destinoCategoriaWp`).
 */
export function rutaWordPress(ruta: string, consulta: URLSearchParams, mapeo: MapeoTaxonomias, etiquetas: EtiquetasWp): RutaWp | undefined {
  // Portada con parámetros de WordPress: /?p=ID, /?page_id=ID, /?author=ID, /?s=texto, /?tag=slug, /?feed=rss2.
  if (ruta === "/") {
    const p = entero(consulta.get("p"));
    if (p !== undefined) return { articuloWpId: p };
    const pagina = entero(consulta.get("page_id"));
    if (pagina !== undefined) {
      const fija = PAGINAS_WP.find((x) => x.id === pagina);
      const d = fija && destinoPagina(fija, mapeo);
      return d ? { destino: d } : undefined;
    }
    const autor = entero(consulta.get("author"));
    if (autor !== undefined) return { autorWpUserId: autor };
    const s = consulta.get("s")?.trim();
    if (s) return { destino: buscar(s.slice(0, 200)) };
    const tag = consulta.get("tag")?.trim();
    if (tag) return { destino: buscar(etiquetas.etiquetas[tag.normalize("NFC")] ?? tag.replace(/-+/g, " ")) };
    if (consulta.has("feed")) return { destino: "/feed/" };
    return undefined;
  }

  // Imágenes y archivos: /wp-content/uploads/<archivo> (carpeta plana). Lo resuelve la API con la base.
  const up = /^\/wp-content\/uploads\/([^/]+)$/.exec(ruta);
  if (up) {
    const archivo = decodificar(up[1]!);
    return archivo && !/^\.+$/.test(archivo) ? { uploads: archivo } : undefined;
  }

  // Etiquetas: /tag/<slug>/, con /page/N/ o /feed/ → el buscador con el nombre de la etiqueta.
  const tag = /^\/tag\/([^/]+)(?:\/page\/\d+|\/feed(?:\/(?:rss2?|atom|rdf))?)?\/?$/.exec(ruta);
  if (tag) {
    const slug = decodificar(tag[1]!);
    if (!slug) return undefined;
    return { destino: buscar(etiquetas.etiquetas[slug] ?? slug.replace(/-+/g, " ")) };
  }

  // Feeds del sitio: /feed/ lo atiende el sitio; sus variantes y los de comentarios van ahí.
  const partes = ruta.split("/").filter(Boolean);
  if (partes.length === 2 && partes[0] === "feed" && FEEDS.test(partes[1]!)) return { destino: "/feed/" };
  if (partes.length === 1 && FEEDS.test(partes[0]!) && partes[0] !== "feed") return { destino: "/feed/" };
  if (partes[0] === "comments" && partes[1] === "feed") return { destino: "/feed/" };

  // Artículo con algo atrás: /AAAA/MM/DD/slug/feed/, /amp/ o /N/ (artículo paginado) → el artículo.
  const art = /^(\/\d{4}\/\d{2}\/\d{2}\/[^/]+)\/(?:feed(?:\/(?:rss2?|atom|rdf))?|amp|\d{1,3})\/?$/.exec(ruta);
  if (art) return { destino: `${art[1]}/` };

  // Archivos por fecha (/2017/, /2017/09/, /2017/09/01/, con /page/N/) y la paginación de la portada (/page/N/) → «Últimas publicaciones».
  if (/^\/\d{4}(?:\/\d{2}(?:\/\d{2})?)?(?:\/page\/\d+)?\/?$/.test(ruta) || /^\/page\/\d+\/?$/.test(ruta)) return { destino: "/ultimas/" };

  // Autor con paginación o feed: /author/<slug>/page/N/ → /author/<slug>/ (la página del autor la resuelve la tabla o el sitio).
  const autor = /^(\/author\/[^/]+)\/(?:page\/\d+|feed)(?:\/[^/]*)?\/?$/.exec(ruta);
  if (autor) return { destino: `${autor[1]}/` };

  // Páginas fijas: /home/, /rastros/, /historieta/, /literatura/.
  if (partes.length === 1) {
    const fija = PAGINAS_WP.find((x) => x.slug === partes[0]);
    const d = fija && destinoPagina(fija, mapeo);
    if (d) return { destino: d };
  }
  return undefined;
}

/**
 * Nombre del original de una miniatura de WordPress: «foto-300x200.jpg» → «foto.jpg». Undefined si no tiene el sufijo de tamaño.
 * (La migración no trae las miniaturas: una URL vieja de miniatura va al original.)
 */
export function originalDeMiniatura(archivo: string): string | undefined {
  const m = /^(.+)-\d{1,5}x\d{1,5}(\.[a-z0-9]+)$/i.exec(archivo);
  return m ? `${m[1]}${m[2]}` : undefined;
}
