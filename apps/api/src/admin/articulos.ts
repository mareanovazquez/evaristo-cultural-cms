import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@evaristo/compartido/db";
import { rutaArticulo } from "@evaristo/compartido/urls";

// Listado de artículos del panel (solo lectura). Lo ven los editores y los administradores.
// select explícito: no se devuelve el cuerpo ni visitasWp ni nada que la pantalla no use.

export const ARTICULOS_POR_PAGINA = 25;
const ESTADOS = ["BORRADOR", "PUBLICADO", "PROGRAMADO"] as const;

const ConsultaSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
});

export function crearRutasAdminArticulos(prisma: PrismaClient): express.Router {
  const router = express.Router();

  router.get("/articulos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const consulta = ConsultaSchema.safeParse(req.query);
      if (!consulta.success) {
        res.status(400).json({ estado: "error", mensaje: "Los filtros del listado no son válidos." });
        return;
      }
      const { estado, q, pagina } = consulta.data;
      const donde = { ...(estado ? { estado } : {}), ...(q ? { titulo: { contains: q } } : {}) };

      const [total, filas, porEstado] = await Promise.all([
        prisma.articulo.count({ where: donde }),
        prisma.articulo.findMany({
          where: donde,
          orderBy: [{ actualizadoEn: "desc" }, { id: "desc" }],
          skip: (pagina - 1) * ARTICULOS_POR_PAGINA,
          take: ARTICULOS_POR_PAGINA,
          select: {
            id: true,
            wpId: true,
            slug: true,
            titulo: true,
            estado: true,
            publicadoEn: true,
            actualizadoEn: true,
            altPendientes: true,
            seccion: { select: { nombre: true } },
            autores: { orderBy: { orden: "asc" }, select: { autor: { select: { nombre: true } } } },
          },
        }),
        // Cantidad por estado, con la búsqueda aplicada, para las solapas del listado.
        prisma.articulo.groupBy({ by: ["estado"], where: q ? { titulo: { contains: q } } : {}, _count: { _all: true } }),
      ]);

      const ahora = new Date();
      const conteos = { BORRADOR: 0, PUBLICADO: 0, PROGRAMADO: 0 };
      for (const g of porEstado) conteos[g.estado] = g._count._all;

      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        total,
        pagina,
        paginas: Math.max(1, Math.ceil(total / ARTICULOS_POR_PAGINA)),
        conteos,
        articulos: filas.map((a) => ({
          id: a.id,
          wpId: a.wpId,
          titulo: a.titulo,
          estado: a.estado,
          publicadoEn: a.publicadoEn,
          actualizadoEn: a.actualizadoEn,
          altPendientes: a.altPendientes,
          seccion: a.seccion.nombre,
          autores: a.autores.map((x) => x.autor.nombre),
          // Dirección pública, solo si el artículo ya se ve en el sitio
          ruta: a.estado === "PUBLICADO" && a.publicadoEn && a.publicadoEn <= ahora ? rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn }) : null,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
