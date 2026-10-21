import type { RequestHandler } from "express";
import { normalizarRuta, rutaArticulo, rutaAutor } from "@evaristo/compartido/urls";

// Redirecciones 301 de las URLs viejas de WordPress (tabla `redirecciones`).
//
// Va después de los archivos estáticos y antes del sitio: solo ve los pedidos que ninguna otra ruta atendió.
//  - Se busca el pedido tal cual y con la barra final cambiada, con los %XX en minúscula (como los guarda WordPress).
//  - La base compara con una colación laxa, así que la fila se elige con igualdad exacta en JavaScript.
//  - Si el destino es la misma ruta del pedido (la URL vieja ya es la canónica), no se redirige: lo atiende el sitio.
//  - Un artículo que no se ve (borrador, programado a futuro) o un autor de solo texto no redirigen: el pedido sigue y da 404.

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

export function crearManejadorRedirecciones(buscar: BuscarRedirecciones): RequestHandler {
  return async (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || !req.path.startsWith("/") || req.path === "/") {
      next();
      return;
    }
    try {
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
      const consulta = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      res.redirect(CODIGOS.has(fila.codigo) ? fila.codigo : 301, destino + consulta);
    } catch (error) {
      // Si la base falla, el pedido sigue: el sitio responderá lo que corresponda.
      console.error("Redirecciones:", error instanceof Error ? error.message : "error desconocido");
      next();
    }
  };
}
