import { existsSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import type { Request, RequestHandler, Response } from "express";

// Ruta pública /media/<clave>: sirve el archivo original de una imagen de la biblioteca.
//
// Seguridad:
//  - La ruta del archivo sale de la fila de `imagenes`, nunca del texto de la URL: sin fila, 404.
//  - La clave es un solo segmento: se rechazan "/", "\", NUL, "." y "..", y una barra codificada (%2f, %5c).
//  - Como la colación de MySQL es laxa, la fila se elige con igualdad exacta en JavaScript.
//  - El archivo se resuelve dentro de MEDIA_DIR y se comprueba que quede adentro.

export interface FilaImagen {
  clave: string;
  tipoMime: string;
  hash: string;
}

/** Busca filas candidatas por clave (la base puede devolver varias por la colación laxa). */
export type BuscarImagenes = (clave: string) => Promise<FilaImagen[]>;

// Solo se sirven estos tipos; el tipo sale de la fila, no de la extensión.
const TIPOS_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const CACHE_CONTROL = "public, max-age=86400";

export interface OpcionesMedia {
  buscar: BuscarImagenes;
  /** Carpeta de los originales. Sin ella, la ruta responde 503. */
  dirMedia: string | undefined;
}

function texto(res: Response, estado: number, mensaje: string): void {
  res.status(estado).type("text/plain; charset=utf-8").send(mensaje);
}

// Devuelve la clave decodificada, o un número de estado si el pedido no es válido.
function claveDelPedido(req: Request): string | 400 | 404 {
  const cruda = req.path.replace(/^\//, "");
  if (!cruda) return 404;
  if (cruda.includes("/") || /%2f|%5c/i.test(cruda)) return 404;
  let clave: string;
  try {
    clave = decodeURIComponent(cruda);
  } catch {
    return 400;
  }
  if (!clave || clave === "." || clave === ".." || /[/\\\0]/.test(clave)) return 404;
  return clave;
}

export function crearManejadorMedia({ buscar, dirMedia }: OpcionesMedia): RequestHandler {
  return async (req, res, next) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        texto(res, 405, "Método no permitido");
        return;
      }
      if (!dirMedia) {
        texto(res, 503, "Falta configurar MEDIA_DIR");
        return;
      }

      const clave = claveDelPedido(req);
      if (clave === 400) {
        texto(res, 400, "Solicitud inválida");
        return;
      }
      if (clave === 404) {
        texto(res, 404, "No encontrado");
        return;
      }

      const fila = (await buscar(clave)).find((f) => f.clave === clave);
      if (!fila || !TIPOS_PERMITIDOS.has(fila.tipoMime)) {
        texto(res, 404, "No encontrado");
        return;
      }

      const raiz = resolve(dirMedia);
      const ruta = resolve(raiz, fila.clave);
      if (!ruta.startsWith(raiz + sep) || basename(ruta) !== fila.clave) {
        texto(res, 404, "No encontrado");
        return;
      }
      if (!existsSync(ruta) || !statSync(ruta).isFile()) {
        texto(res, 404, "No encontrado");
        return;
      }

      const etag = `"${fila.hash}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", CACHE_CONTROL);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", fila.tipoMime);
      if (req.headers["if-none-match"]?.split(",").some((v) => v.trim() === etag)) {
        res.status(304).end();
        return;
      }

      res.sendFile(fila.clave, { root: raiz, dotfiles: "deny", etag: false, lastModified: false, cacheControl: false }, (error) => {
        if (!error || res.headersSent) return;
        const estado = (error as { status?: number }).status;
        if (estado === 403 || estado === 404) {
          // El archivo no se puede servir: se cambian los encabezados de caché de la respuesta correcta.
          res.removeHeader("ETag");
          res.setHeader("Cache-Control", "no-store");
          res.removeHeader("Content-Type");
          texto(res, 404, "No encontrado");
        } else {
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  };
}
