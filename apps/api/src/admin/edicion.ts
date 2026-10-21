import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import type { JSONNode } from "@evaristo/compartido/schema";
import { textoPlanoDe } from "@evaristo/compartido/texto-plano";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { contarAltPendientes, cuerpoVacio, DatosSchema, erroresDelCuerpo, imagenIdsDelCuerpo, NuevoSchema, SlugSchema, type DatosArticulo } from "./datos-articulo.js";

// Leer, crear y editar artículos desde el panel.
//  - Un artículo en BORRADOR se guarda directo sobre su fila.
//  - Uno PUBLICADO o PROGRAMADO se guarda en su borrador de cambios (`articulos_borradores`): el sitio sigue mostrando lo publicado.
//    Aplicar esos cambios (publicar) es otro paso.
//  - Cada guardado manda la versión que se abrió; si otra persona guardó en el medio, responde 409 y no pisa nada.
// El estado y la fecha de publicación no se editan acá.

class Conflicto extends Error {}

const IdSchema = z.coerce.number().int().positive();
const GuardarSchema = z.object({ version: z.string().min(1).max(40), datos: z.unknown() }).strict();

const seleccion = {
  id: true,
  wpId: true,
  slug: true,
  estado: true,
  publicadoEn: true,
  actualizadoEn: true,
  titulo: true,
  bajada: true,
  cuerpo: true,
  seccionId: true,
  categoriaPrincipalId: true,
  categorias: { select: { categoriaId: true } },
  autores: { orderBy: { orden: "asc" as const }, select: { autorId: true } },
  imagenEncabezadoId: true,
  encabezadoAlt: true,
  encabezadoCredito: true,
  encabezadoPuntoFocalX: true,
  encabezadoPuntoFocalY: true,
  conCapital: true,
  novedadHasta: true,
  borrador: { select: { datos: true, baseVersion: true, actualizadoEn: true } },
} as const;

type FilaArticulo = NonNullable<Awaited<ReturnType<PrismaClient["articulo"]["findFirst"]>>> & {
  categorias: Array<{ categoriaId: number }>;
  autores: Array<{ autorId: number }>;
  borrador: { datos: unknown; baseVersion: Date; actualizadoEn: Date } | null;
};

const iso = (d: Date): string => d.toISOString();

function datosDeLaFila(a: FilaArticulo): DatosArticulo {
  return {
    titulo: a.titulo,
    bajada: a.bajada,
    cuerpo: a.cuerpo as unknown as JSONNode,
    seccionId: a.seccionId,
    categoriaIds: a.categorias.map((c) => c.categoriaId),
    categoriaPrincipalId: a.categoriaPrincipalId,
    autorIds: a.autores.map((x) => x.autorId),
    imagenEncabezadoId: a.imagenEncabezadoId,
    encabezadoAlt: a.encabezadoAlt,
    encabezadoCredito: a.encabezadoCredito,
    encabezadoPuntoFocalX: a.encabezadoPuntoFocalX,
    encabezadoPuntoFocalY: a.encabezadoPuntoFocalY,
    conCapital: a.conCapital,
    novedadHasta: a.novedadHasta ? iso(a.novedadHasta) : null,
    slug: a.slug,
  };
}

/** Versión que tiene que mandar el panel al guardar: la del borrador de cambios si existe, si no la del artículo. */
const versionVigente = (a: FilaArticulo): Date => (a.estado !== "BORRADOR" && a.borrador ? a.borrador.actualizadoEn : a.actualizadoEn);

const problemasDeZod = (error: z.ZodError): string[] => [...new Set(error.issues.map((i) => i.message))].slice(0, 10);

function sinProblemas(res: Response, problemas: string[]): void {
  res.status(422).json({ estado: "error", mensaje: "Revisá el artículo antes de guardar.", problemas: problemas.slice(0, 10) });
}

export function crearRutasAdminEdicion(prisma: PrismaClient): express.Router {
  const router = express.Router();

  /** Revisa lo que depende de la base: que existan la sección, las categorías, los autores y las imágenes. */
  async function problemasDeReferencias(d: DatosArticulo, seccionActual: number | null): Promise<string[]> {
    const problemas: string[] = [];
    const seccion = await prisma.seccion.findUnique({ where: { id: d.seccionId }, select: { id: true, interna: true } });
    if (!seccion) problemas.push("La sección elegida no existe.");
    else if (seccion.interna && seccion.id !== seccionActual) problemas.push("Elegí una sección de la lista.");

    if (new Set(d.categoriaIds).size !== d.categoriaIds.length) problemas.push("Hay categorías repetidas.");
    if (d.categoriaIds.length) {
      const hay = await prisma.categoria.count({ where: { id: { in: d.categoriaIds } } });
      if (hay !== new Set(d.categoriaIds).size) problemas.push("Alguna categoría elegida no existe.");
    }
    if (d.categoriaPrincipalId !== null && !d.categoriaIds.includes(d.categoriaPrincipalId)) problemas.push("La categoría principal tiene que ser una de las categorías del artículo.");

    if (new Set(d.autorIds).size !== d.autorIds.length) problemas.push("Hay autores repetidos.");
    if (d.autorIds.length && (await prisma.autor.count({ where: { id: { in: d.autorIds } } })) !== new Set(d.autorIds).size) problemas.push("Algún autor elegido no existe.");

    const idsImagenes = [...new Set([...imagenIdsDelCuerpo(d.cuerpo), ...(d.imagenEncabezadoId !== null ? [d.imagenEncabezadoId] : [])])];
    if (idsImagenes.length && (await prisma.imagen.count({ where: { id: { in: idsImagenes } } })) !== idsImagenes.length) problemas.push("Alguna imagen del artículo no está en la biblioteca.");
    return problemas;
  }

  // ---------- Catálogos para los desplegables ----------
  router.get("/catalogos", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [secciones, categorias, autores] = await Promise.all([
        prisma.seccion.findMany({ where: { interna: false }, orderBy: { id: "asc" }, select: { id: true, slug: true, nombre: true } }),
        prisma.categoria.findMany({ orderBy: { nombre: "asc" }, select: { id: true, slug: true, nombre: true } }),
        prisma.autor.findMany({ orderBy: { nombre: "asc" }, select: { id: true, nombre: true, soloTexto: true } }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", secciones, categorias, autores });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Leer ----------
  router.get("/articulos/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      if (!id.success) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
        return;
      }
      const a = (await prisma.articulo.findUnique({ where: { id: id.data }, select: seleccion })) as FilaArticulo | null;
      if (!a) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
        return;
      }
      const conBorrador = a.estado !== "BORRADOR" && a.borrador !== null;
      const ahora = new Date();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        articulo: {
          id: a.id,
          wpId: a.wpId,
          estado: a.estado,
          publicadoEn: a.publicadoEn,
          version: iso(versionVigente(a)),
          // Hay cambios sin publicar: los datos que se devuelven son los del borrador de cambios, no los publicados.
          conCambiosSinPublicar: conBorrador,
          ruta: a.estado === "PUBLICADO" && a.publicadoEn && a.publicadoEn <= ahora ? rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn }) : null,
          datos: conBorrador ? { ...(a.borrador!.datos as DatosArticulo), slug: a.slug } : datosDeLaFila(a),
        },
      });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Crear (siempre en BORRADOR) ----------
  router.post("/articulos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const nuevo = NuevoSchema.safeParse(req.body);
      if (!nuevo.success) {
        sinProblemas(res, problemasDeZod(nuevo.error));
        return;
      }
      const seccion = await prisma.seccion.findUnique({ where: { id: nuevo.data.seccionId }, select: { interna: true } });
      if (!seccion || seccion.interna) {
        sinProblemas(res, ["Elegí una sección de la lista."]);
        return;
      }
      const creado = await prisma.articulo.create({
        data: {
          // Dirección provisoria: la editora la define al publicar (no se puede publicar con una que empiece con "borrador-").
          slug: `borrador-${randomBytes(6).toString("hex")}`,
          titulo: nuevo.data.titulo,
          cuerpo: cuerpoVacio() as unknown as Prisma.InputJsonValue,
          textoPlano: "",
          estado: "BORRADOR",
          seccionId: nuevo.data.seccionId,
        },
        select: { id: true, actualizadoEn: true },
      });
      res.status(201).json({ estado: "ok", id: creado.id, version: iso(creado.actualizadoEn) });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Guardar ----------
  router.put("/articulos/:id", async (req: Request, res: Response, next: NextFunction) => {
    // true cuando se guarda sobre la fila del artículo (BORRADOR); false cuando va a la copia de trabajo.
    let directo = false;
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      const pedido = GuardarSchema.safeParse(req.body);
      if (!id.success) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
        return;
      }
      if (!pedido.success) {
        sinProblemas(res, ["El pedido no tiene el formato esperado."]);
        return;
      }
      const datosZod = DatosSchema.safeParse(pedido.data.datos);
      if (!datosZod.success) {
        sinProblemas(res, problemasDeZod(datosZod.error));
        return;
      }
      const datos = datosZod.data;

      const a = (await prisma.articulo.findUnique({ where: { id: id.data }, select: seleccion })) as FilaArticulo | null;
      if (!a) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
        return;
      }
      const esBorrador = a.estado === "BORRADOR";
      const vigente = versionVigente(a);
      const cambioElArticulo = !esBorrador && a.borrador !== null && a.actualizadoEn > a.borrador.baseVersion;
      if (iso(vigente) !== pedido.data.version || cambioElArticulo) {
        res.status(409).json({ estado: "conflicto", mensaje: "Este artículo cambió mientras lo editabas.", versionActual: iso(vigente) });
        return;
      }

      // La dirección de un artículo publicado es su URL pública: no se cambia desde acá.
      if (!esBorrador && datos.slug !== undefined && datos.slug !== a.slug) {
        sinProblemas(res, ["La dirección de un artículo publicado no se puede cambiar desde acá."]);
        return;
      }

      if (esBorrador && datos.slug !== undefined && datos.slug !== a.slug) {
        const formato = SlugSchema.safeParse(datos.slug);
        if (!formato.success) {
          sinProblemas(res, problemasDeZod(formato.error));
          return;
        }
        if (await prisma.articulo.findUnique({ where: { slug: datos.slug }, select: { id: true } })) {
          sinProblemas(res, ["Ya hay un artículo con esa dirección. Elegí otra."]);
          return;
        }
      }

      const anteriores = [a.cuerpo as unknown as JSONNode, ...(a.borrador ? [(a.borrador.datos as DatosArticulo).cuerpo] : [])];
      const problemas = [...(await problemasDeReferencias(datos, a.seccionId)), ...erroresDelCuerpo(datos.cuerpo, anteriores)];
      if (problemas.length) {
        sinProblemas(res, problemas);
        return;
      }

      directo = esBorrador;
      const usuarioId = req.usuario!.id;
      const { slug: _slug, ...datosSinSlug } = datos;
      let nuevaVersion: Date;

      if (esBorrador) {
        const galeriaPendientes = await prisma.galeriaItem.count({ where: { articuloId: a.id, OR: [{ alt: null }, { alt: "" }] } });
        nuevaVersion = await prisma.$transaction(async (tx) => {
          const r = await tx.articulo.updateMany({
            where: { id: a.id, actualizadoEn: a.actualizadoEn },
            data: {
              titulo: datos.titulo,
              bajada: datos.bajada,
              cuerpo: datos.cuerpo as unknown as Prisma.InputJsonValue,
              textoPlano: textoPlanoDe(datos.cuerpo as never),
              seccionId: datos.seccionId,
              categoriaPrincipalId: datos.categoriaPrincipalId,
              imagenEncabezadoId: datos.imagenEncabezadoId,
              encabezadoAlt: datos.encabezadoAlt,
              encabezadoCredito: datos.encabezadoCredito,
              encabezadoPuntoFocalX: datos.encabezadoPuntoFocalX,
              encabezadoPuntoFocalY: datos.encabezadoPuntoFocalY,
              conCapital: datos.conCapital,
              novedadHasta: datos.novedadHasta ? new Date(datos.novedadHasta) : null,
              altPendientes: contarAltPendientes(datos, galeriaPendientes),
              ...(datos.slug !== undefined ? { slug: datos.slug } : {}),
            },
          });
          if (r.count !== 1) throw new Conflicto();
          await tx.articuloCategoria.deleteMany({ where: { articuloId: a.id } });
          if (datos.categoriaIds.length) await tx.articuloCategoria.createMany({ data: datos.categoriaIds.map((categoriaId) => ({ articuloId: a.id, categoriaId })) });
          await tx.articuloAutor.deleteMany({ where: { articuloId: a.id } });
          if (datos.autorIds.length) await tx.articuloAutor.createMany({ data: datos.autorIds.map((autorId, orden) => ({ articuloId: a.id, autorId, orden })) });
          return (await tx.articulo.findUniqueOrThrow({ where: { id: a.id }, select: { actualizadoEn: true } })).actualizadoEn;
        });
      } else if (a.borrador) {
        const r = await prisma.articuloBorrador.updateMany({
          where: { articuloId: a.id, actualizadoEn: a.borrador.actualizadoEn },
          data: { datos: datosSinSlug as unknown as Prisma.InputJsonValue, usuarioId },
        });
        if (r.count !== 1) throw new Conflicto();
        nuevaVersion = (await prisma.articuloBorrador.findUniqueOrThrow({ where: { articuloId: a.id }, select: { actualizadoEn: true } })).actualizadoEn;
      } else {
        const creado = await prisma.articuloBorrador.create({
          data: { articuloId: a.id, datos: datosSinSlug as unknown as Prisma.InputJsonValue, baseVersion: a.actualizadoEn, usuarioId },
          select: { actualizadoEn: true },
        });
        nuevaVersion = creado.actualizadoEn;
      }

      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", version: iso(nuevaVersion), conCambiosSinPublicar: !esBorrador });
    } catch (e) {
      if (e instanceof Conflicto || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && !directo)) {
        res.status(409).json({ estado: "conflicto", mensaje: "Este artículo cambió mientras lo editabas." });
        return;
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        sinProblemas(res, ["Ya hay un artículo con esa dirección. Elegí otra."]);
        return;
      }
      next(e);
    }
  });

  // ---------- Descartar los cambios sin publicar ----------
  router.delete("/articulos/:id/borrador", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      if (!id.success) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
        return;
      }
      await prisma.articuloBorrador.deleteMany({ where: { articuloId: id.data } });
      res.json({ estado: "ok" });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
