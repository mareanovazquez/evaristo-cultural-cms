import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@evaristo/compartido/db";
import { BANNER_ALT_MAX, BANNER_MAX_IMAGENES, enlaceValido, problemaDeImagenDeBanner, TOPBAR_ENLACE_MAX, TOPBAR_POR_DEFECTO } from "@evaristo/compartido/sitio";
import { borrarImagenSinUso } from "./imagenes.js";

// Banner de la portada (solo administrador; decisión 77). El interruptor se guarda solo (PATCH) y las imágenes, todas juntas y en orden,
// con el botón Guardar (PUT): el orden del array es el orden de rotación. Las imágenes se suben antes con la biblioteca (POST /imagenes).
// Al guardar, las imágenes que dejaron de estar en el banner y no se usan en ningún otro lado se borran (la fila y el archivo subido).

const SlideSchema = z
  .object({
    imagenId: z.number("Elegí una imagen.").int("Elegí una imagen.").positive("Elegí una imagen."),
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
    alt: z
      .string("Escribí qué dice la imagen.")
      .transform((t) => t.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1, "Escribí qué dice la imagen (es lo que escucha quien usa un lector de pantalla).").max(BANNER_ALT_MAX, `El texto de la imagen es demasiado largo (máximo ${BANNER_ALT_MAX} caracteres).`)),
  })
  .strict();

const CuerpoSchema = z.object({ slides: z.array(SlideSchema).max(BANNER_MAX_IMAGENES, `El banner admite hasta ${BANNER_MAX_IMAGENES} imágenes.`) }).strict();

export interface OpcionesBanner {
  /** Carpeta de las imágenes subidas: de ahí se borran las que quedan sin uso. */
  dirSubidas?: string | undefined;
}

export function crearRutasAdminBanner(prisma: PrismaClient, opciones: OpcionesBanner = {}): express.Router {
  const router = express.Router();

  const leer = async () => {
    const [config, filas] = await Promise.all([
      prisma.configuracionSitio.findUnique({ where: { id: 1 }, select: { bannerActivo: true } }),
      prisma.bannerImagen.findMany({
        orderBy: [{ orden: "asc" }, { id: "asc" }],
        select: { imagenId: true, enlace: true, alt: true, imagen: { select: { id: true, clave: true, nombreOriginal: true, ancho: true, alto: true } } },
      }),
    ]);
    return { activo: config?.bannerActivo ?? false, max: BANNER_MAX_IMAGENES, slides: filas.map((f) => ({ imagenId: f.imagenId, imagen: f.imagen, enlace: f.enlace, alt: f.alt })) };
  };

  router.get("/banner", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", ...(await leer()) });
    } catch (e) {
      next(e);
    }
  });

  router.patch("/banner/activo", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = z.object({ activo: z.boolean("Indicá si el banner se muestra o no.") }).strict().safeParse(req.body);
      if (!datos.success) {
        res.status(422).json({ estado: "error", mensaje: "Revisá los datos antes de guardar.", problemas: [...new Set(datos.error.issues.map((i) => i.message))] });
        return;
      }
      // Si la fila todavía no existe, nace con el topbar que ya mostraba el sitio: los de la columna no son esos.
      await prisma.configuracionSitio.upsert({
        where: { id: 1 },
        create: { id: 1, bannerActivo: datos.data.activo, topbarActivo: TOPBAR_POR_DEFECTO.activo, topbarTexto: TOPBAR_POR_DEFECTO.texto, topbarEnlace: TOPBAR_POR_DEFECTO.enlace },
        update: { bannerActivo: datos.data.activo },
        select: { id: true },
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", activo: datos.data.activo });
    } catch (e) {
      next(e);
    }
  });

  router.put("/banner", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const problemas = (lista: string[]) => void res.status(422).json({ estado: "error", mensaje: "Revisá los datos antes de guardar.", problemas: [...new Set(lista)].slice(0, 10) });
      const datos = CuerpoSchema.safeParse(req.body);
      if (!datos.success) {
        return problemas(datos.error.issues.map((i) => (i.path[0] === "slides" && typeof i.path[1] === "number" ? `Imagen ${i.path[1] + 1}: ${i.message}` : i.message)));
      }
      const { slides } = datos.data;

      const imagenes = new Map((await prisma.imagen.findMany({ where: { id: { in: slides.map((s) => s.imagenId) } }, select: { id: true, tipoMime: true, bytes: true, ancho: true, alto: true } })).map((i) => [i.id, i]));
      const faltan: string[] = [];
      slides.forEach((s, i) => {
        const imagen = imagenes.get(s.imagenId);
        const motivo = imagen ? problemaDeImagenDeBanner(imagen) : "No encontramos la imagen. Subila de nuevo.";
        if (motivo) faltan.push(`Imagen ${i + 1}: ${motivo}`);
      });
      if (faltan.length) return problemas(faltan);

      const previas = await prisma.$transaction(async (tx) => {
        const antes = (await tx.bannerImagen.findMany({ select: { imagenId: true } })).map((f) => f.imagenId);
        await tx.bannerImagen.deleteMany();
        if (slides.length) await tx.bannerImagen.createMany({ data: slides.map((s, i) => ({ orden: i + 1, imagenId: s.imagenId, enlace: s.enlace, alt: s.alt })) });
        return antes;
      });

      const siguen = new Set(slides.map((s) => s.imagenId));
      let borradas = 0;
      for (const id of new Set(previas)) if (!siguen.has(id) && (await borrarImagenSinUso(prisma, id, opciones.dirSubidas))) borradas++;

      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", borradas, ...(await leer()) });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
