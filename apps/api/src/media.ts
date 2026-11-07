import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { Request, RequestHandler, Response } from "express";
import sharp from "sharp";
import { ANCHOS_VARIANTES } from "@evaristo/compartido/urls";

// Ruta pública /media/<clave>: sirve el archivo original de una imagen de la biblioteca, o una variante más angosta con ?w=N
// (decisión 83).
//
// Seguridad:
//  - La ruta del archivo sale de la fila de `imagenes`, nunca del texto de la URL: sin fila, 404.
//  - La clave es un solo segmento: se rechazan "/", "\", NUL, "." y "..", y una barra codificada (%2f, %5c).
//  - Como la colación de MySQL es laxa, la fila se elige con igualdad exacta en JavaScript.
//  - El archivo se resuelve dentro de MEDIA_DIR y se comprueba que quede adentro.
//
// Variantes (?w=N):
//  - Solo los anchos de ANCHOS_VARIANTES; cualquier otro valor es 400 (así nadie llena el disco pidiendo anchos al azar).
//  - Si la imagen ya mide N o menos, o es un GIF, o está animada, se sirve el original.
//  - La primera vez se genera con sharp (rotación EXIF aplicada, sin metadatos, mismo formato) y se guarda en MEDIA_DIR_VARIANTES
//    como <hash>-w<N>.<ext>: el hash es el del original, así que si cambia el archivo cambia la variante. Nunca se borran solas.
//  - Se generan pocas a la vez y nunca la misma dos veces en paralelo. Si sharp falla, se sirve el original.
//  - Sin MEDIA_DIR_VARIANTES, ?w se ignora y se sirve el original.

export interface FilaImagen {
  clave: string;
  tipoMime: string;
  hash: string;
  /** Ancho guardado (ya con la orientación EXIF aplicada). Si falta, se averigua al generar la variante. */
  ancho?: number;
}

/** Busca filas candidatas por clave (la base puede devolver varias por la colación laxa). */
export type BuscarImagenes = (clave: string) => Promise<FilaImagen[]>;

// Solo se sirven estos tipos; el tipo sale de la fila, no de la extensión.
const TIPOS_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const CACHE_CONTROL = "public, max-age=86400";
const EXTENSION_VARIANTE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const ANCHOS = new Set<number>(ANCHOS_VARIANTES);
const HASH_VALIDO = /^[0-9a-f]{64}$/;
/** Variantes que se pueden estar generando al mismo tiempo (cada una usa varios hilos de libvips). */
const MAX_GENERANDO = 2;
/** Píxeles de entrada que acepta sharp (el original más grande de la migración mide 6.300 px de ancho). */
const MAX_PIXELES = 10_000 * 10_000;
// sharp deja abiertos los archivos que leyó (caché de archivos de libvips). En Windows eso los bloquea: no se podría borrar desde el
// panel una imagen que se achicó. Las variantes ya quedan en disco, así que esa caché no hace falta.
sharp.cache({ files: 0 });

export interface OpcionesMedia {
  buscar: BuscarImagenes;
  /** Carpeta de los originales. Sin ella ni carpeta de subidas, la ruta responde 503. */
  dirMedia: string | undefined;
  /** Carpeta de las imágenes subidas desde el panel. Se busca primero acá y después en `dirMedia` (en desarrollo, la muestra queda intacta). */
  dirSubidas?: string | undefined;
  /** Carpeta de la caché de variantes de tamaño (MEDIA_DIR_VARIANTES). Sin ella, ?w se ignora. */
  dirVariantes?: string | undefined;
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

// El ancho pedido con ?w=N: undefined si no se pidió, 400 si no es uno de los permitidos.
function anchoDelPedido(req: Request): number | undefined | 400 {
  const w = req.query["w"];
  if (w === undefined) return undefined;
  if (typeof w !== "string" || !/^[1-9]\d{0,4}$/.test(w)) return 400;
  const n = Number(w);
  return ANCHOS.has(n) ? n : 400;
}

/** Limita cuántas tareas corren a la vez. */
function crearLimite(maximo: number): <T>(tarea: () => Promise<T>) => Promise<T> {
  let activas = 0;
  const espera: Array<() => void> = [];
  return async (tarea) => {
    if (activas >= maximo) await new Promise<void>((listo) => espera.push(listo));
    activas++;
    try {
      return await tarea();
    } finally {
      activas--;
      espera.shift()?.();
    }
  };
}

/** "original": la imagen ya mide ese ancho o menos; "animada": no se achica nunca. */
type Generada = "variante" | "original" | "animada";

export function crearManejadorMedia({ buscar, dirMedia, dirSubidas, dirVariantes }: OpcionesMedia): RequestHandler {
  // Carpetas donde buscar el archivo, en orden: las subidas primero.
  const raices = [dirSubidas, dirMedia].filter((r): r is string => !!r).map((r) => resolve(r));
  const raizVariantes = dirVariantes ? resolve(dirVariantes) : undefined;
  let carpetaVariantesLista = false;
  const enCurso = new Map<string, Promise<Generada>>();
  // Originales que no conviene achicar (animados o que sharp no pudo leer): se recuerdan para no volver a abrirlos.
  const sinVariantes = new Set<string>();
  const limite = crearLimite(MAX_GENERANDO);

  async function generar(origen: string, destino: string, ancho: number, tipoMime: string): Promise<Generada> {
    const imagen = sharp(origen, { limitInputPixels: MAX_PIXELES });
    const meta = await imagen.metadata();
    if ((meta.pages ?? 1) > 1) return "animada";
    // Ancho ya orientado: con EXIF 5 a 8 la foto se gira y el ancho visible es el alto guardado en el archivo.
    const anchoReal = (meta.orientation ?? 1) >= 5 ? meta.height : meta.width;
    if (!anchoReal || anchoReal <= ancho) return "original";
    let salida = imagen.rotate().resize({ width: ancho, withoutEnlargement: true });
    if (tipoMime === "image/jpeg") salida = salida.jpeg({ quality: 82, progressive: true });
    else if (tipoMime === "image/png") salida = salida.png({ compressionLevel: 9 });
    else salida = salida.webp({ quality: 80 });
    if (!carpetaVariantesLista) {
      mkdirSync(raizVariantes!, { recursive: true });
      carpetaVariantesLista = true;
    }
    // Se escribe a un temporal y se renombra: nadie lee nunca una variante a medio escribir.
    const temporal = `${destino}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await salida.toFile(temporal);
      await rename(temporal, destino);
    } catch (error) {
      await rm(temporal, { force: true });
      if (!existsSync(destino)) throw error;
    }
    return "variante";
  }

  function variante(origen: string, destino: string, ancho: number, tipoMime: string): Promise<Generada> {
    const previa = enCurso.get(destino);
    if (previa) return previa;
    const promesa = limite(() => (existsSync(destino) ? Promise.resolve<Generada>("variante") : generar(origen, destino, ancho, tipoMime))).finally(() =>
      enCurso.delete(destino),
    );
    enCurso.set(destino, promesa);
    return promesa;
  }

  function enviar(req: Request, res: Response, next: Parameters<RequestHandler>[2], raiz: string, archivo: string, etag: string, tipoMime: string): void {
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", tipoMime);
    if (req.headers["if-none-match"]?.split(",").some((v) => v.trim() === etag)) {
      res.status(304).end();
      return;
    }
    res.sendFile(archivo, { root: raiz, dotfiles: "deny", etag: false, lastModified: false, cacheControl: false }, (error) => {
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
  }

  return async (req, res, next) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        texto(res, 405, "Método no permitido");
        return;
      }
      if (raices.length === 0) {
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
      const ancho = anchoDelPedido(req);
      if (ancho === 400) {
        texto(res, 400, `Ancho no permitido. Valores posibles: ${ANCHOS_VARIANTES.join(", ")}`);
        return;
      }

      const fila = (await buscar(clave)).find((f) => f.clave === clave);
      if (!fila || !TIPOS_PERMITIDOS.has(fila.tipoMime)) {
        texto(res, 404, "No encontrado");
        return;
      }

      // El archivo se busca en cada carpeta, y se comprueba que quede adentro de ella.
      const raiz = raices.find((r) => {
        const ruta = resolve(r, fila.clave);
        return ruta.startsWith(r + sep) && basename(ruta) === fila.clave && existsSync(ruta) && statSync(ruta).isFile();
      });
      if (!raiz) {
        texto(res, 404, "No encontrado");
        return;
      }

      const extension = EXTENSION_VARIANTE[fila.tipoMime];
      const quiereVariante =
        ancho !== undefined &&
        raizVariantes !== undefined &&
        extension !== undefined &&
        HASH_VALIDO.test(fila.hash) &&
        !sinVariantes.has(fila.hash) &&
        !(fila.ancho !== undefined && fila.ancho > 0 && fila.ancho <= ancho);
      if (quiereVariante) {
        const etag = `"${fila.hash}-w${ancho}"`;
        const nombre = `${fila.hash}-w${ancho}.${extension}`;
        // Si el navegador ya la tiene, no hace falta generarla.
        if (req.headers["if-none-match"]?.split(",").some((v) => v.trim() === etag)) {
          res.setHeader("ETag", etag);
          res.setHeader("Cache-Control", CACHE_CONTROL);
          res.status(304).end();
          return;
        }
        let resultado: Generada;
        try {
          resultado = await variante(join(raiz, fila.clave), join(raizVariantes, nombre), ancho, fila.tipoMime);
        } catch (error) {
          console.error(`/media: no se pudo generar la variante de ${ancho} px de «${fila.clave}»; se sirve el original.`, error);
          sinVariantes.add(fila.hash);
          resultado = "original";
        }
        if (resultado === "variante") {
          enviar(req, res, next, raizVariantes, nombre, etag, fila.tipoMime);
          return;
        }
        if (resultado === "animada") sinVariantes.add(fila.hash);
      }

      enviar(req, res, next, raiz, fila.clave, `"${fila.hash}"`, fila.tipoMime);
    } catch (error) {
      next(error);
    }
  };
}
