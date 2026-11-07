import type { RequestHandler } from "express";
import { originalDeMiniatura, type RutaWp } from "@evaristo/compartido/rutas-wordpress";
import { normalizarRuta, rutaArticulo, rutaAutor, urlMedia } from "@evaristo/compartido/urls";

// Redirecciones 301 de las URLs viejas de WordPress (tabla `redirecciones`).
//
// Va después de los archivos estáticos y antes del sitio: solo ve los pedidos que ninguna otra ruta atendió.
//  - Se busca el pedido tal cual y con la barra final cambiada, con los %XX en minúscula (como los guarda WordPress).
//  - La base compara con una colación laxa, así que la fila se elige con igualdad exacta en JavaScript.
//  - Si el destino es la misma ruta del pedido (la URL vieja ya es la canónica), no se redirige: lo atiende el sitio.
//  - Un artículo que no se ve (borrador, programado a futuro) o un autor de solo texto no redirigen: el pedido sigue y da 404.
//  - Las categorías de WordPress (/category/<slug>/…) no están en la tabla: las resuelve `destinoEstatico` (el mapeo de taxonomías, decisión 78),
//    sin consultar la base. Si no es de una categoría conocida, el pedido sigue el camino normal.
//  - Las demás URLs de WordPress que no están en la tabla (etiquetas, feeds, páginas fijas, archivos por fecha, /?p=ID, /?s=…, /?author=ID y
//    /wp-content/uploads/…) las resuelve `OpcionesWp` (rutas-wordpress.ts en @evaristo/compartido; Etapa 1, punto 5 de la fase 7).

export type TipoRedireccion = "ARTICULO" | "SLUG_ANTERIOR" | "AUTOR" | "MANUAL";

export interface FilaRedireccion {
  origen: string;
  tipo: TipoRedireccion;
  codigo: number;
  destino: string | null;
  articulo: { slug: string; estado: string; publicadoEn: Date | null } | null;
  autor: { slug: string; soloTexto: boolean } | null;
}

export type BuscarRedirecciones = (candidatos: string[]) => Promise<FilaRedireccion[]>;

const CODIGOS = new Set([301, 302, 307, 308]);

/** Destino de una redirección, o undefined si no hay que redirigir. */
export function destinoDe(fila: FilaRedireccion, ahora: Date = new Date()): string | undefined {
  switch (fila.tipo) {
    case "ARTICULO":
    case "SLUG_ANTERIOR": {
      const a = fila.articulo;
      if (!a || a.estado !== "PUBLICADO" || !a.publicadoEn || a.publicadoEn > ahora) return undefined;
      return rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn });
    }
    case "AUTOR":
      return fila.autor && !fila.autor.soloTexto ? rutaAutor(fila.autor.slug) : undefined;
    case "MANUAL": {
      // Una ruta propia del sitio ("/algo") o una dirección http(s). Nada de "//host" ni de otros esquemas.
      const d = fila.destino?.trim();
      if (!d) return undefined;
      if (/^\/(?![/\\])/.test(d) || /^https?:\/\/[^/\s]/i.test(d)) return d;
      return undefined;
    }
  }
}

function sinBarraFinalCambiada(ruta: string): string {
  return ruta.endsWith("/") ? ruta.slice(0, -1) : `${ruta}/`;
}

export type DestinoEstatico = (ruta: string) => string | undefined;

/** Lo que hace falta para las URLs de WordPress que no están en la tabla: las reglas puras y tres consultas a la base. */
export interface OpcionesWp {
  rutaWp: (ruta: string, consulta: URLSearchParams) => RutaWp | undefined;
  articuloPorWpId: (wpId: number) => Promise<FilaRedireccion["articulo"]>;
  autorPorWpUserId: (wpUserId: number) => Promise<FilaRedireccion["autor"]>;
  /** Imágenes cuyo nombre en WordPress (`imagenes.nombreOriginal`) se parece al pedido: la colación es laxa, se elige la exacta acá. */
  imagenesPorNombre: (nombre: string) => Promise<Array<{ clave: string; nombreOriginal: string }>>;
}

async function destinoWp(r: RutaWp, wp: OpcionesWp): Promise<string | undefined> {
  if ("destino" in r) return r.destino;
  if ("articuloWpId" in r) {
    const articulo = await wp.articuloPorWpId(r.articuloWpId);
    return articulo ? destinoDe({ origen: "", tipo: "ARTICULO", codigo: 301, destino: null, articulo, autor: null }) : undefined;
  }
  if ("autorWpUserId" in r) {
    const autor = await wp.autorPorWpUserId(r.autorWpUserId);
    return autor ? destinoDe({ origen: "", tipo: "AUTOR", codigo: 301, destino: null, articulo: null, autor }) : undefined;
  }
  // /wp-content/uploads/<archivo>: el original con ese nombre; si no hay, y es una miniatura («-300x200»), su original.
  for (const nombre of [r.uploads, originalDeMiniatura(r.uploads)]) {
    if (!nombre) continue;
    const imagen = (await wp.imagenesPorNombre(nombre)).find((i) => i.nombreOriginal === nombre);
    if (imagen) return urlMedia(imagen.clave);
  }
  return undefined;
}

export function crearManejadorRedirecciones(buscar: BuscarRedirecciones, destinoEstatico?: DestinoEstatico, wp?: OpcionesWp): RequestHandler {
  return async (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || !req.path.startsWith("/") || (req.path === "/" && !wp)) {
      next();
      return;
    }
    try {
      const consulta = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      // URLs de WordPress resueltas por reglas (y, si hace falta, una consulta puntual). Su destino ya es completo: no se le agrega la consulta.
      const rutaWp = wp?.rutaWp(req.path, new URLSearchParams(consulta));
      if (rutaWp) {
        const destino = await destinoWp(rutaWp, wp!);
        if (destino !== undefined && destino !== req.originalUrl) {
          res.redirect(301, destino);
          return;
        }
        if (!("destino" in rutaWp)) {
          // Un artículo, autor o imagen que no está (o no se ve): no hay nada más que buscar.
          next();
          return;
        }
      }
      if (req.path === "/") {
        next();
        return;
      }
      const fijo = destinoEstatico?.(req.path);
      if (fijo !== undefined) {
        res.redirect(301, fijo + consulta);
        return;
      }
      const pedido = normalizarRuta(req.path);
      const candidatos = [pedido, sinBarraFinalCambiada(pedido)];
      const filas = (await buscar(candidatos)).filter((f) => candidatos.includes(f.origen));
      // Con barra final primero: es como las guardó WordPress.
      const fila = filas.find((f) => f.origen.endsWith("/")) ?? filas[0];
      const destino = fila && destinoDe(fila);
      if (!fila || !destino) {
        next();
        return;
      }
      // La URL vieja ya es la canónica: la atiende el sitio.
      if (decodeURIComponent(destino) === decodeURIComponent(req.path)) {
        next();
        return;
      }
      res.redirect(CODIGOS.has(fila.codigo) ? fila.codigo : 301, destino + consulta);
    } catch (error) {
      // Si la base falla, el pedido sigue: el sitio responderá lo que corresponda.
      console.error("Redirecciones:", error instanceof Error ? error.message : "error desconocido");
      next();
    }
  };
}
