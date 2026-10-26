import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@evaristo/compartido/db";
import { enlaceValido, TOPBAR_ENLACE_MAX, TOPBAR_POR_DEFECTO, TOPBAR_TEXTO_MAX, type Topbar } from "@evaristo/compartido/sitio";

// Configuración del sitio (solo administrador). Hoy, el topbar: un interruptor, el texto y un enlace opcional (decisión del 26/10/2026).
// Una sola fila (id 1). Mientras no se guarda nada, el panel y el sitio muestran los valores por defecto de `compartido/sitio`.

const TopbarSchema = z
  .object({
    activo: z.boolean("Indicá si el topbar se muestra o no."),
    texto: z
      .string("Escribí el texto del topbar.")
      .transform((t) => t.replace(/\s+/g, " ").trim())
      .pipe(z.string().max(TOPBAR_TEXTO_MAX, `El texto es demasiado largo (máximo ${TOPBAR_TEXTO_MAX} caracteres).`)),
    enlace: z
      .string("El enlace no es válido.")
      .nullable()
      .transform((e) => (e === null || e.trim() === "" ? null : e.trim()))
      .pipe(
        z
          .string()
          .max(TOPBAR_ENLACE_MAX, "El enlace es demasiado largo.")
          .refine(enlaceValido, "El enlace tiene que empezar con https:// (o con / si es una página de este sitio) y no puede tener espacios.")
          .nullable(),
      ),
  })
  .strict()
  .refine((t) => !t.activo || t.texto !== "", { message: "Escribí el texto del topbar o apagalo.", path: ["texto"] });

export function crearRutasAdminSitio(prisma: PrismaClient): express.Router {
  const router = express.Router();

  const leer = async (): Promise<Topbar> => {
    const fila = await prisma.configuracionSitio.findUnique({ where: { id: 1 }, select: { topbarActivo: true, topbarTexto: true, topbarEnlace: true } });
    return fila ? { activo: fila.topbarActivo, texto: fila.topbarTexto, enlace: fila.topbarEnlace } : { ...TOPBAR_POR_DEFECTO };
  };

  router.get("/sitio", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", topbar: await leer() });
    } catch (e) {
      next(e);
    }
  });

  router.put("/sitio", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = TopbarSchema.safeParse((req.body as { topbar?: unknown } | undefined)?.topbar);
      if (!datos.success) {
        res.status(422).json({ estado: "error", mensaje: "Revisá los datos antes de guardar.", problemas: [...new Set(datos.error.issues.map((i) => i.message))].slice(0, 10) });
        return;
      }
      const { activo, texto, enlace } = datos.data;
      await prisma.configuracionSitio.upsert({
        where: { id: 1 },
        create: { id: 1, topbarActivo: activo, topbarTexto: texto, topbarEnlace: enlace },
        update: { topbarActivo: activo, topbarTexto: texto, topbarEnlace: enlace },
        select: { id: true },
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", topbar: await leer() });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
