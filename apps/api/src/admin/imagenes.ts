import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import { claveParaSubida, ErrorImagen, MAX_BYTES, nombreOriginalLimpio, procesarImagen } from "./procesar-imagen.js";

// Biblioteca de imágenes del panel: listar, subir y borrar. Las ven y las usan los editores y los administradores.
// select explícito: solo lo que la pantalla necesita.
//  - Subir: una imagen por pedido (campo "archivo"), validada y normalizada por procesar-imagen.ts y guardada en la carpeta de
//    subidas (MEDIA_DIR_SUBIDAS). Si ya hay una imagen con el mismo contenido, se devuelve esa (repetida: true) y no se guarda otra.
//  - Borrar: solo una imagen que no se use en ningún lado (cuerpo o borrador de cambios de un artículo, encabezado, imagen para redes,
//    galería o foto de autor). El archivo solo se borra si está en la carpeta de subidas: los originales de la muestra no se tocan.

export const IMAGENES_POR_PAGINA = 24;

const ConsultaSchema = z.object({
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
});
const IdSchema = z.coerce.number().int().positive();

const seleccionPublica = { id: true, clave: true, nombreOriginal: true, ancho: true, alto: true } as const;

export interface OpcionesImagenes {
  /** Carpeta donde se guardan las imágenes subidas. Sin ella, subir responde 503. */
  dirSubidas?: string | undefined;
}

export interface UsoDeImagen {
  tipo: "cuerpo" | "borrador" | "encabezado" | "redes" | "galeria" | "autor";
  id: number;
  nombre: string;
}

/** Dónde se usa una imagen. Vacío si no se usa en ningún lado. */
export async function usosDeLaImagen(prisma: PrismaClient, id: number): Promise<UsoDeImagen[]> {
  const usos: UsoDeImagen[] = [];
  const [encabezados, redes, galerias, autores, enCuerpo, enBorrador] = await Promise.all([
    prisma.articulo.findMany({ where: { imagenEncabezadoId: id }, select: { id: true, titulo: true }, take: 10 }),
    prisma.articulo.findMany({ where: { redesImagenId: id }, select: { id: true, titulo: true }, take: 10 }),
    prisma.galeriaItem.findMany({ where: { imagenId: id }, select: { articulo: { select: { id: true, titulo: true } } }, take: 10 }),
    prisma.autor.findMany({ where: { fotoId: id }, select: { id: true, nombre: true }, take: 10 }),
    // El cuerpo guarda la imagen como un nodo con imagenId, en cualquier profundidad: se busca con una ruta con comodín.
    prisma.$queryRaw<Array<{ id: number; titulo: string }>>(Prisma.sql`SELECT id, titulo FROM articulos WHERE JSON_CONTAINS(JSON_EXTRACT(cuerpo, '$**.imagenId'), JSON_ARRAY(${id})) LIMIT 10`),
    prisma.$queryRaw<Array<{ id: number; titulo: string }>>(
      Prisma.sql`SELECT a.id, a.titulo FROM articulos_borradores b JOIN articulos a ON a.id = b.articuloId
        WHERE JSON_CONTAINS(JSON_EXTRACT(b.datos, '$.cuerpo**.imagenId'), JSON_ARRAY(${id})) OR JSON_EXTRACT(b.datos, '$.imagenEncabezadoId') = ${id} LIMIT 10`,
    ),
  ]);
  for (const a of encabezados) usos.push({ tipo: "encabezado", id: a.id, nombre: a.titulo });
  for (const a of redes) usos.push({ tipo: "redes", id: a.id, nombre: a.titulo });
  for (const g of galerias) usos.push({ tipo: "galeria", id: g.articulo.id, nombre: g.articulo.titulo });
  for (const a of autores) usos.push({ tipo: "autor", id: a.id, nombre: a.nombre });
  for (const a of enCuerpo) usos.push({ tipo: "cuerpo", id: a.id, nombre: a.titulo });
  for (const a of enBorrador) usos.push({ tipo: "borrador", id: a.id, nombre: a.titulo });
  return usos;
}

const DONDE: Record<UsoDeImagen["tipo"], string> = {
  cuerpo: "el texto del artículo",
  borrador: "los cambios sin publicar del artículo",
  encabezado: "la imagen principal del artículo",
  redes: "la imagen para redes del artículo",
  galeria: "la galería del artículo",
  autor: "la foto del autor",
};

function mensajeDeUsos(usos: UsoDeImagen[]): string {
  const vistos = new Set<string>();
  const lineas: string[] = [];
  for (const u of usos) {
    const clave = `${u.tipo}:${u.id}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    lineas.push(`${DONDE[u.tipo]} «${u.nombre}»`);
  }
  const primeras = lineas.slice(0, 3).join("; ");
  const resto = lineas.length > 3 ? ` (y ${lineas.length - 3} más)` : "";
  return `No se puede borrar esta imagen porque se usa en ${primeras}${resto}. Sacala de ahí primero.`;
}

export function crearRutasAdminImagenes(prisma: PrismaClient, opciones: OpcionesImagenes = {}): express.Router {
  const router = express.Router();
  const { dirSubidas } = opciones;

  // ---------- Listar ----------
  router.get("/imagenes", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const consulta = ConsultaSchema.safeParse(req.query);
      if (!consulta.success) {
        res.status(400).json({ estado: "error", mensaje: "Los filtros de la biblioteca no son válidos." });
        return;
      }
      const { q, pagina } = consulta.data;
      const donde = q ? { nombreOriginal: { contains: q } } : {};
      const [total, filas] = await Promise.all([
        prisma.imagen.count({ where: donde }),
        prisma.imagen.findMany({
          where: donde,
          orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
          skip: (pagina - 1) * IMAGENES_POR_PAGINA,
          take: IMAGENES_POR_PAGINA,
          select: seleccionPublica,
        }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", total, pagina, paginas: Math.max(1, Math.ceil(total / IMAGENES_POR_PAGINA)), imagenes: filas });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Subir ----------
  const recibir = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 2, parts: 4 } }).single("archivo");

  router.post(
    "/imagenes",
    (req: Request, res: Response, next: NextFunction) => {
      recibir(req, res, (error: unknown) => {
        if (!error) {
          next();
          return;
        }
        const codigo = (error as { code?: string }).code;
        if (codigo === "LIMIT_FILE_SIZE") res.status(413).json({ estado: "error", mensaje: `La imagen pesa más de ${MAX_BYTES / 1024 / 1024} MB. Reducila y probá de nuevo.` });
        else if (codigo === "LIMIT_UNEXPECTED_FILE" || codigo === "LIMIT_FILE_COUNT" || codigo === "LIMIT_PART_COUNT" || codigo === "LIMIT_FIELD_COUNT")
          res.status(400).json({ estado: "error", mensaje: "Subí una sola imagen por vez." });
        else if (error instanceof multer.MulterError || /multipart|boundary|Unexpected end/i.test(String((error as Error).message)))
          res.status(400).json({ estado: "error", mensaje: "No se pudo leer el archivo que se envió. Probá de nuevo." });
        else next(error);
      });
    },
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!dirSubidas) {
          res.status(503).json({ estado: "error", mensaje: "La subida de imágenes todavía no está configurada en este servidor." });
          return;
        }
        if (!req.file) {
          res.status(400).json({ estado: "error", mensaje: "Elegí una imagen para subir." });
          return;
        }
        let procesada;
        try {
          procesada = await procesarImagen(req.file.buffer);
        } catch (e) {
          if (e instanceof ErrorImagen) {
            res.status(e.estado).json({ estado: "error", mensaje: e.message });
            return;
          }
          throw e;
        }

        // Mismo contenido que una imagen que ya está: se reusa, no se guarda otra copia.
        const existente = await prisma.imagen.findFirst({ where: { hash: procesada.hash }, orderBy: { id: "asc" }, select: seleccionPublica });
        if (existente) {
          res.setHeader("Cache-Control", "no-store");
          res.json({ estado: "ok", repetida: true, imagen: existente });
          return;
        }

        const nombreOriginal = nombreOriginalLimpio(req.file.originalname);
        const clave = claveParaSubida(nombreOriginal, procesada.hash, procesada.extension);
        // Se escribe en un archivo temporal y se renombra: nunca queda un archivo a medias con la clave final.
        await mkdir(dirSubidas, { recursive: true });
        const temporal = join(dirSubidas, `.subida-${randomBytes(6).toString("hex")}.tmp`);
        await writeFile(temporal, procesada.buffer, { flag: "wx" });
        const destino = join(dirSubidas, clave);
        try {
          await rename(temporal, destino);
        } catch (e) {
          await rm(temporal, { force: true });
          throw e;
        }
        try {
          const creada = await prisma.imagen.create({
            data: { clave, nombreOriginal, tipoMime: procesada.mime, ancho: procesada.ancho, alto: procesada.alto, bytes: procesada.bytes, hash: procesada.hash },
            select: seleccionPublica,
          });
          res.setHeader("Cache-Control", "no-store");
          res.status(201).json({ estado: "ok", repetida: false, imagen: creada });
        } catch (e) {
          // Dos subidas iguales al mismo tiempo: la otra ya la guardó. Se devuelve esa.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            const otra = await prisma.imagen.findUnique({ where: { clave }, select: seleccionPublica });
            if (otra) {
              res.json({ estado: "ok", repetida: true, imagen: otra });
              return;
            }
          }
          await rm(destino, { force: true });
          throw e;
        }
      } catch (e) {
        next(e);
      }
    },
  );

  // ---------- Borrar ----------
  router.delete("/imagenes/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      if (!id.success) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos esa imagen." });
        return;
      }
      const imagen = await prisma.imagen.findUnique({ where: { id: id.data }, select: { id: true, clave: true } });
      if (!imagen) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos esa imagen." });
        return;
      }
      const usos = await usosDeLaImagen(prisma, imagen.id);
      if (usos.length > 0) {
        res.status(409).json({ estado: "error", mensaje: mensajeDeUsos(usos), usos });
        return;
      }
      try {
        await prisma.imagen.delete({ where: { id: imagen.id } });
      } catch (e) {
        // La base también protege los usos con clave foránea (encabezado, redes, galería, foto de autor).
        if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
          res.status(409).json({ estado: "error", mensaje: "No se puede borrar esta imagen porque se usa en algún artículo o autor." });
          return;
        }
        throw e;
      }
      // Solo se borra el archivo de la carpeta de subidas; los originales de la muestra no se tocan.
      if (dirSubidas) await rm(join(dirSubidas, imagen.clave), { force: true });
      res.json({ estado: "ok" });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
