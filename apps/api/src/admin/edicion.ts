import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import { tienePermiso } from "@evaristo/compartido/permisos";
import type { JSONNode } from "@evaristo/compartido/schema";
import { textoPlanoDe } from "@evaristo/compartido/texto-plano";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { estadoEfectivo } from "./estado.js";
import { contarAltPendientes, cuerpoVacio, DatosSchema, erroresDelCuerpo, imagenIdsDelCuerpo, normalizarFicha, NuevoSchema, SlugSchema, type DatosArticulo } from "./datos-articulo.js";

// Leer, crear y editar artículos desde el panel.
//  - Un artículo en BORRADOR se guarda directo sobre su fila.
//  - Uno PUBLICADO o PROGRAMADO se guarda en su borrador de cambios (`articulos_borradores`): el sitio sigue mostrando lo publicado.
//    Aplicar esos cambios (publicar) es otro paso.
//  - Cada guardado manda la versión que se abrió; si otra persona guardó en el medio, responde 409 y no pisa nada.
// El estado y la fecha de publicación no se editan acá.

export class Conflicto extends Error {}

export const IdSchema = z.coerce.number().int().positive();
const GuardarSchema = z.object({ version: z.string().min(1).max(40), datos: z.unknown() }).strict();

export const seleccion = {
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
  galeria: { orderBy: { orden: "asc" as const }, select: { imagenId: true, alt: true, epigrafe: true } },
  fichaTecnica: { select: { titulo: true, autor: true, traductor: true, editorial: true, coleccion: true, anio: true, paginas: true, isbn: true, precio: true } },
  borrador: { select: { datos: true, baseVersion: true, actualizadoEn: true } },
  creadoPor: { select: { id: true, nombre: true } },
} as const;

export type FilaArticulo = NonNullable<Awaited<ReturnType<PrismaClient["articulo"]["findFirst"]>>> & {
  categorias: Array<{ categoriaId: number }>;
  autores: Array<{ autorId: number }>;
  galeria: Array<{ imagenId: number; alt: string | null; epigrafe: string | null }>;
  fichaTecnica: DatosArticulo["ficha"];
  borrador: { datos: unknown; baseVersion: Date; actualizadoEn: Date } | null;
  creadoPor: { id: number; nombre: string } | null;
};

export const iso = (d: Date): string => d.toISOString();

export function datosDeLaFila(a: FilaArticulo): DatosArticulo {
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
    galeria: a.galeria.map((g) => ({ imagenId: g.imagenId, alt: g.alt, epigrafe: g.epigrafe })),
    ficha: a.fichaTecnica,
    conCapital: a.conCapital,
    novedadHasta: a.novedadHasta ? iso(a.novedadHasta) : null,
    slug: a.slug,
  };
}

/**
 * Los datos del borrador de cambios, completos: lo que no esté en él (por ejemplo, la galería y la ficha en un borrador guardado antes
 * de que existieran) se toma de la fila del artículo, para que publicarlo no borre nada.
 */
export function datosDelBorrador(a: FilaArticulo): Record<string, unknown> {
  return { ...datosDeLaFila(a), ...((a.borrador?.datos ?? {}) as Record<string, unknown>) };
}

/** Versión que tiene que mandar el panel al guardar: la del borrador de cambios si existe, si no la del artículo. */
export const versionVigente = (a: FilaArticulo): Date => (a.estado !== "BORRADOR" && a.borrador ? a.borrador.actualizadoEn : a.actualizadoEn);

export const problemasDeZod = (error: z.ZodError): string[] => [...new Set(error.issues.map((i) => i.message))].slice(0, 10);

export function sinProblemas(res: Response, problemas: string[]): void {
  res.status(422).json({ estado: "error", mensaje: "Revisá el artículo antes de guardar.", problemas: problemas.slice(0, 10) });
}

/** Revisa lo que depende de la base: que existan la sección, las categorías, los autores y las imágenes. */
export async function problemasDeReferencias(prisma: PrismaClient, d: DatosArticulo, seccionActual: number | null): Promise<string[]> {
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

  const idsGaleria = d.galeria.map((g) => g.imagenId);
  if (new Set(idsGaleria).size !== idsGaleria.length) problemas.push("Hay una imagen repetida en la galería.");
  const idsImagenes = [...new Set([...imagenIdsDelCuerpo(d.cuerpo), ...idsGaleria, ...(d.imagenEncabezadoId !== null ? [d.imagenEncabezadoId] : [])])];
  if (idsImagenes.length && (await prisma.imagen.count({ where: { id: { in: idsImagenes } } })) !== idsImagenes.length) problemas.push("Alguna imagen del artículo no está en la biblioteca.");
  return problemas;
}


/**
 * Escribe los datos editables sobre la fila de un artículo (y sus categorías y autores en orden), dentro de una transacción.
 * Solo escribe si el artículo sigue en la versión que se leyó (`actualizadoEn`); si no, lanza Conflicto. `extra` suma otros campos
 * (por ejemplo, el estado o la fecha al publicar). Devuelve la versión nueva.
 */
export async function escribirDatos(
  tx: Prisma.TransactionClient,
  id: number,
  actualizadoEnEsperado: Date,
  datos: DatosArticulo,
  extra: Prisma.ArticuloUncheckedUpdateManyInput = {},
): Promise<Date> {
  const r = await tx.articulo.updateMany({
    where: { id, actualizadoEn: actualizadoEnEsperado },
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
      altPendientes: contarAltPendientes(datos),
      ...(datos.slug !== undefined ? { slug: datos.slug } : {}),
      ...extra,
    },
  });
  if (r.count !== 1) throw new Conflicto();
  await tx.articuloCategoria.deleteMany({ where: { articuloId: id } });
  if (datos.categoriaIds.length) await tx.articuloCategoria.createMany({ data: datos.categoriaIds.map((categoriaId) => ({ articuloId: id, categoriaId })) });
  await tx.articuloAutor.deleteMany({ where: { articuloId: id } });
  if (datos.autorIds.length) await tx.articuloAutor.createMany({ data: datos.autorIds.map((autorId, orden) => ({ articuloId: id, autorId, orden })) });
  await tx.galeriaItem.deleteMany({ where: { articuloId: id } });
  if (datos.galeria.length) await tx.galeriaItem.createMany({ data: datos.galeria.map((g, orden) => ({ articuloId: id, imagenId: g.imagenId, orden, alt: g.alt, epigrafe: g.epigrafe })) });
  const ficha = normalizarFicha(datos.ficha);
  if (ficha) await tx.fichaTecnica.upsert({ where: { articuloId: id }, create: { articuloId: id, ...ficha }, update: ficha });
  else await tx.fichaTecnica.deleteMany({ where: { articuloId: id } });
  return (await tx.articulo.findUniqueOrThrow({ where: { id }, select: { actualizadoEn: true } })).actualizadoEn;
}

export function crearRutasAdminEdicion(prisma: PrismaClient): express.Router {
  const router = express.Router();

  /** La ficha de autor del usuario (con la que firma un Redactor), o null. */
  const fichaDe = async (usuarioId: number): Promise<number | null> => (await prisma.autor.findUnique({ where: { usuarioId }, select: { id: true } }))?.id ?? null;

  // ---------- Catálogos para los desplegables ----------
  router.get("/catalogos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rol = req.usuario!.rol;
      const [secciones, categorias, autores, usuarios] = await Promise.all([
        prisma.seccion.findMany({ where: { interna: false }, orderBy: { id: "asc" }, select: { id: true, slug: true, nombre: true } }),
        prisma.categoria.findMany({ orderBy: { nombre: "asc" }, select: { id: true, slug: true, nombre: true } }),
        // Un Redactor solo puede firmar con su propia ficha.
        prisma.autor.findMany({ where: tienePermiso(rol, "autores.elegir.cualquiera") ? {} : { usuarioId: req.usuario!.id }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, soloTexto: true } }),
        // Para pasarle un artículo a otra persona.
        tienePermiso(rol, "articulos.reasignar") ? prisma.usuario.findMany({ where: { activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, rol: true } }) : Promise.resolve([]),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", secciones, categorias, autores, usuarios });
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
      const datos = (conBorrador ? { ...datosDelBorrador(a), slug: a.slug } : datosDeLaFila(a)) as DatosArticulo;
      // Para mostrar la miniatura del encabezado (el borrador de cambios puede tener otra imagen que el artículo).
      const imagenEncabezado = datos.imagenEncabezadoId !== null ? await prisma.imagen.findUnique({ where: { id: datos.imagenEncabezadoId }, select: { id: true, clave: true, nombreOriginal: true } }) : null;
      // Y las de la galería, en el mismo orden que los datos.
      const idsGaleria = datos.galeria.map((g) => g.imagenId);
      const filasGaleria = idsGaleria.length ? await prisma.imagen.findMany({ where: { id: { in: idsGaleria } }, select: { id: true, clave: true, nombreOriginal: true } }) : [];
      const imagenesGaleria = idsGaleria.flatMap((id) => filasGaleria.filter((f) => f.id === id));
      const ahora = new Date();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        articulo: {
          id: a.id,
          wpId: a.wpId,
          // El estado que ve el panel: programado = publicado con fecha futura (ver estado.ts).
          estado: estadoEfectivo(a.estado, a.publicadoEn, ahora),
          publicadoEn: a.publicadoEn,
          version: iso(versionVigente(a)),
          // Hay cambios sin publicar: los datos que se devuelven son los del borrador de cambios, no los publicados.
          conCambiosSinPublicar: conBorrador,
          // Quién lo creó en el panel (los migrados no tienen).
          creadoPor: a.creadoPor,
          ruta: a.estado === "PUBLICADO" && a.publicadoEn && a.publicadoEn <= ahora ? rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn }) : null,
          datos,
          imagenEncabezado,
          imagenesGaleria,
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
      // Un Redactor solo firma con su ficha: el artículo nuevo sale con ella. Sin ficha no puede crear.
      const puedeElegirAutores = tienePermiso(req.usuario!.rol, "autores.elegir.cualquiera");
      const ficha = puedeElegirAutores ? null : await fichaDe(req.usuario!.id);
      if (!puedeElegirAutores && ficha === null) {
        res.status(409).json({ estado: "error", mensaje: "Tu usuario todavía no tiene una ficha de autor. Pedile a un administrador que te la asigne." });
        return;
      }
      const creado = await prisma.articulo.create({
        data: {
          creadoPorId: req.usuario!.id,
          ...(ficha !== null ? { autores: { create: { autorId: ficha, orden: 0 } } } : {}),
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
      // Una ficha sin ningún campo es lo mismo que no tener ficha.
      const datos: DatosArticulo = { ...datosZod.data, ficha: normalizarFicha(datosZod.data.ficha) };

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

      // Un Redactor firma solo con su ficha: se acepta [su ficha] o, si otra persona ya armó la firma, que no la toque.
      if (!tienePermiso(req.usuario!.rol, "autores.elegir.cualquiera")) {
        const suya = await fichaDe(req.usuario!.id);
        const vigentes = ((esBorrador || !a.borrador ? a.autores.map((x) => x.autorId) : (datosDelBorrador(a)["autorIds"] as number[] | undefined)) ?? []).join(",");
        const pedidos = datos.autorIds.join(",");
        if (pedidos !== vigentes && (suya === null || pedidos !== String(suya))) {
          sinProblemas(res, ["Solo podés firmar con tu propia ficha de autor. Si el artículo lleva otra firma, lo arma un editor."]);
          return;
        }
      }

      const anteriores = [a.cuerpo as unknown as JSONNode, ...(a.borrador ? [(a.borrador.datos as DatosArticulo).cuerpo] : [])];
      const problemas = [...(await problemasDeReferencias(prisma, datos, a.seccionId)), ...erroresDelCuerpo(datos.cuerpo, anteriores)];
      if (problemas.length) {
        sinProblemas(res, problemas);
        return;
      }

      directo = esBorrador;
      const usuarioId = req.usuario!.id;
      const { slug: _slug, ...datosSinSlug } = datos;
      let nuevaVersion: Date;

      if (esBorrador) {
        nuevaVersion = await prisma.$transaction(async (tx) => {
          const version = await escribirDatos(tx, a.id, a.actualizadoEn, datos);
          // Un borrador que ya estuvo publicado (se despublicó) y cambia de dirección: la URL que tenía pasa a redirigir a la nueva.
          // Se anota ahora porque después, al volver a publicarlo, la fila ya no recuerda cuál fue la pública. Mientras el artículo sea
          // un borrador la redirección no se aplica (el sitio solo redirige a lo que se ve).
          if (datos.slug !== undefined && datos.slug !== a.slug && a.publicadoEn && !a.slug.startsWith("borrador-")) {
            const origen = rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn });
            await tx.redireccion.upsert({
              where: { origen },
              create: { origen, tipo: "SLUG_ANTERIOR", codigo: 301, articuloId: a.id },
              update: { tipo: "SLUG_ANTERIOR", codigo: 301, articuloId: a.id, autorId: null, destino: null },
            });
          }
          return version;
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

  // ---------- Pasar el artículo a otra persona (cambiar su creador) ----------
  router.post("/articulos/:id/pasar", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!tienePermiso(req.usuario!.rol, "articulos.reasignar")) {
        res.status(403).json({ estado: "error", mensaje: "No tenés permiso para hacer esto." });
        return;
      }
      const id = IdSchema.safeParse(req.params["id"]);
      const cuerpo = z.object({ usuarioId: z.number().int().positive() }).strict().safeParse(req.body);
      if (!id.success) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
        return;
      }
      if (!cuerpo.success) {
        sinProblemas(res, ["Elegí a quién pasarle el artículo."]);
        return;
      }
      const destino = await prisma.usuario.findFirst({ where: { id: cuerpo.data.usuarioId, activo: true }, select: { id: true, nombre: true } });
      if (!destino) {
        sinProblemas(res, ["Esa persona no existe o no tiene acceso."]);
        return;
      }
      // No se toca `actualizadoEn`: quien edita el texto no tiene por qué perder su lugar por un cambio de dueño.
      const r = await prisma.$executeRaw`UPDATE articulos SET creadoPorId = ${destino.id}, actualizadoEn = actualizadoEn WHERE id = ${id.data}`;
      if (r !== 1) {
        res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
        return;
      }
      res.json({ estado: "ok", creadoPor: destino });
    } catch (e) {
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
