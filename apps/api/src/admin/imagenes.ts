import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@evaristo/compartido/db";

// Biblioteca de imágenes del panel (solo lectura): el selector del encabezado y el diálogo de imagen del cuerpo eligen de acá.
// select explícito: solo lo que la pantalla necesita. La subida de imágenes nuevas llega en el paso 5.

export const IMAGENES_POR_PAGINA = 24;

const ConsultaSchema = z.object({
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
});

export function crearRutasAdminImagenes(prisma: PrismaClient): express.Router {
  const router = express.Router();

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
          select: { id: true, clave: true, nombreOriginal: true, ancho: true, alto: true },
        }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", total, pagina, paginas: Math.max(1, Math.ceil(total / IMAGENES_POR_PAGINA)), imagenes: filas });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
