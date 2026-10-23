import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import { rutaCategoria, rutaSeccion } from "@evaristo/compartido/urls";
import { SlugSchema } from "./datos-articulo.js";
import { slugDesdeTitulo } from "./publicacion.js";

// Secciones y categorías (solo administrador). Decisiones del 23/10/2026:
//  - Se crean, se renombran, se les cambia la dirección, se unen con otra y se eliminan solo si están vacías.
//  - Las secciones además se ordenan (el orden del menú del sitio).
//  - No se ocultan: una sección con artículos no se saca del menú sin pasarlos antes a otra (unir).
//  - Si cambia la dirección, la vieja redirige a la nueva (redirección MANUAL 301). Al unir, la del sobrante redirige al elegido.
//  - La sección interna «sin-asignar» no se toca.
// Los cambios sin publicar de un artículo (`articulos_borradores.datos`) también se tienen en cuenta al unir y al eliminar.

const Id = z.coerce.number().int().positive();

class Rechazo extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly problemas: string[] = [],
  ) {
    super(mensaje);
  }
}

type Tx = Prisma.TransactionClient;
type Datos = Record<string, unknown>;

/** Dirección vieja → nueva: la vieja redirige, las redirecciones que apuntaban a la vieja apuntan a la nueva y se evitan los ciclos. */
async function redirigir(tx: Tx, rutaVieja: string, rutaNueva: string): Promise<void> {
  await tx.redireccion.updateMany({ where: { tipo: "MANUAL", destino: rutaVieja }, data: { destino: rutaNueva } });
  // Una redirección que salía de la dirección nueva (de una vez en que se llamó así) ya no hace falta: sería un ciclo.
  await tx.redireccion.deleteMany({ where: { origen: rutaNueva, tipo: "MANUAL" } });
  await tx.redireccion.upsert({
    where: { origen: rutaVieja },
    create: { origen: rutaVieja, tipo: "MANUAL", codigo: 301, destino: rutaNueva },
    update: { tipo: "MANUAL", codigo: 301, destino: rutaNueva, articuloId: null, autorId: null },
  });
}

/** ¿La dirección nueva está libre? Ocupa el lugar una redirección que no es una de las nuestras hacia la dirección vieja. */
async function rutaOcupada(tx: Tx | PrismaClient, rutaNueva: string, rutaVieja: string | null): Promise<boolean> {
  const r = await tx.redireccion.findUnique({ where: { origen: rutaNueva }, select: { tipo: true, destino: true } });
  if (!r) return false;
  return !(r.tipo === "MANUAL" && rutaVieja !== null && r.destino === rutaVieja);
}

const eliminarRedireccionesHacia = (tx: Tx, ruta: string) => tx.redireccion.deleteMany({ where: { tipo: "MANUAL", destino: ruta } });

export function crearRutasAdminClasificacion(prisma: PrismaClient): express.Router {
  const router = express.Router();

  const sinProblemas = (res: Response, problemas: string[], mensaje = "Revisá los datos antes de guardar."): void => void res.status(422).json({ estado: "error", mensaje, problemas: [...new Set(problemas)].slice(0, 10) });
  const manejar = (res: Response, next: NextFunction, e: unknown): void => {
    if (e instanceof Rechazo) {
      if (e.problemas.length) sinProblemas(res, e.problemas, e.message);
      else res.status(e.estado).json({ estado: "error", mensaje: e.message });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      sinProblemas(res, ["Ya hay otra con esa dirección. Elegí otra."]);
      return;
    }
    next(e);
  };
  const zodAProblemas = (e: z.ZodError): string[] => e.issues.map((i) => i.message);

  /** Cambios sin publicar: todos los `datos`, para revisar o reescribir lo que nombra una sección o una categoría. */
  const borradores = () => prisma.articuloBorrador.findMany({ select: { articuloId: true, datos: true } });

  // =====================================================================================================================
  // Secciones
  // =====================================================================================================================
  const NombreSeccion = z.string().trim().min(1, "Escribí el nombre de la sección.").max(100, "El nombre es demasiado largo (máximo 100 caracteres).");
  const SeccionSchema = z.object({ nombre: NombreSeccion, slug: SlugSchema.max(100, "La dirección es demasiado larga (máximo 100 caracteres).") }).strict();
  const SeccionNuevaSchema = z.object({ nombre: NombreSeccion, slug: SlugSchema.max(100).optional() }).strict();

  const leerSeccion = (id: number) => prisma.seccion.findUnique({ where: { id }, select: { id: true, slug: true, nombre: true, interna: true, orden: true, _count: { select: { articulos: true } } } });
  const seccionEditable = async (idTexto: unknown) => {
    const id = Id.safeParse(idTexto);
    const s = id.success ? await leerSeccion(id.data) : null;
    if (!s) throw new Rechazo(404, "No encontramos esa sección.");
    if (s.interna) throw new Rechazo(409, "La sección «Sin asignar» es interna: no se cambia desde acá.");
    return s;
  };
  const seccionParaElPanel = (s: NonNullable<Awaited<ReturnType<typeof leerSeccion>>>) => ({ id: s.id, slug: s.slug, nombre: s.nombre, interna: s.interna, orden: s.orden, articulos: s._count.articulos });
  const borradoresConSeccion = async (id: number) => (await borradores()).filter((b) => (b.datos as Datos | null)?.["seccionId"] === id);

  router.get("/secciones", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const filas = await prisma.seccion.findMany({ orderBy: [{ interna: "asc" }, { orden: "asc" }, { id: "asc" }], select: { id: true, slug: true, nombre: true, interna: true, orden: true, _count: { select: { articulos: true } } } });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", secciones: filas.map(seccionParaElPanel) });
    } catch (e) {
      next(e);
    }
  });

  router.post("/secciones", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = SeccionNuevaSchema.safeParse(req.body);
      if (!datos.success) return void sinProblemas(res, zodAProblemas(datos.error));
      const creada = await prisma.$transaction(async (tx) => {
        let slug = datos.data.slug;
        if (slug) {
          if ((await tx.seccion.findUnique({ where: { slug }, select: { id: true } })) || (await rutaOcupada(tx, rutaSeccion(slug), null))) throw new Rechazo(422, "Ya hay una sección con esa dirección. Elegí otra.");
        } else {
          const base = slugDesdeTitulo(datos.data.nombre).slice(0, 90);
          slug = base;
          for (let n = 2; (await tx.seccion.findUnique({ where: { slug }, select: { id: true } })) || (await rutaOcupada(tx, rutaSeccion(slug), null)); n++) slug = `${base}-${n}`;
        }
        const ultimo = await tx.seccion.aggregate({ where: { interna: false }, _max: { orden: true } });
        return tx.seccion.create({ data: { nombre: datos.data.nombre, slug, orden: (ultimo._max.orden ?? 0) + 1 }, select: { id: true } });
      });
      res.status(201).json({ estado: "ok", seccion: seccionParaElPanel((await leerSeccion(creada.id))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // El orden completo de las secciones del menú: tiene que nombrar a todas las no internas, una vez cada una.
  router.post("/secciones/orden", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = z.object({ ids: z.array(z.number().int().positive()).max(500) }).strict().safeParse(req.body);
      if (!datos.success) return void sinProblemas(res, ["No pudimos leer el orden enviado. Recargá la pantalla y probá de nuevo."]);
      await prisma.$transaction(async (tx) => {
        const actuales = (await tx.seccion.findMany({ where: { interna: false }, select: { id: true } })).map((s) => s.id).sort((a, b) => a - b);
        const pedidas = [...datos.data.ids].sort((a, b) => a - b);
        if (actuales.length !== pedidas.length || actuales.some((id, i) => id !== pedidas[i])) throw new Rechazo(409, "La lista de secciones cambió mientras la ordenabas. Volvé a abrirla.");
        for (const [i, id] of datos.data.ids.entries()) await tx.seccion.update({ where: { id }, data: { orden: i + 1 }, select: { id: true } });
      });
      res.json({ estado: "ok" });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  router.put("/secciones/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actual = await seccionEditable(req.params["id"]);
      const datos = SeccionSchema.safeParse(req.body);
      if (!datos.success) return void sinProblemas(res, zodAProblemas(datos.error));
      await prisma.$transaction(async (tx) => {
        if (datos.data.slug !== actual.slug) {
          if (await tx.seccion.findUnique({ where: { slug: datos.data.slug }, select: { id: true } })) throw new Rechazo(422, "Ya hay una sección con esa dirección. Elegí otra.");
          if (await rutaOcupada(tx, rutaSeccion(datos.data.slug), rutaSeccion(actual.slug))) throw new Rechazo(422, "Esa dirección está reservada por una redirección. Elegí otra.");
        }
        await tx.seccion.update({ where: { id: actual.id }, data: { nombre: datos.data.nombre, slug: datos.data.slug }, select: { id: true } });
        if (datos.data.slug !== actual.slug) await redirigir(tx, rutaSeccion(actual.slug), rutaSeccion(datos.data.slug));
      });
      res.json({ estado: "ok", seccion: seccionParaElPanel((await leerSeccion(actual.id))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  router.delete("/secciones/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const s = await seccionEditable(req.params["id"]);
      if (s._count.articulos > 0) return void res.status(409).json({ estado: "error", mensaje: `La sección «${s.nombre}» tiene ${s._count.articulos} ${s._count.articulos === 1 ? "artículo" : "artículos"}: pasalos a otra (unir) antes de eliminarla.` });
      if ((await borradoresConSeccion(s.id)).length) return void res.status(409).json({ estado: "error", mensaje: `La sección «${s.nombre}» figura en cambios sin publicar de algún artículo: publicalos o descartalos antes.` });
      await prisma.$transaction(async (tx) => {
        await eliminarRedireccionesHacia(tx, rutaSeccion(s.slug));
        await tx.seccion.delete({ where: { id: s.id } });
      });
      res.json({ estado: "ok" });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // Unir: los artículos de la sobrante pasan a la elegida.
  async function parDeSecciones(req: Request) {
    const sobrante = await seccionEditable(req.params["id"]);
    const destino = Id.safeParse(req.method === "GET" ? req.query["destinoId"] : (req.body as { destinoId?: unknown } | undefined)?.destinoId);
    if (!destino.success) throw new Rechazo(422, "Elegí con qué sección unirla.", ["Elegí con qué sección unirla."]);
    if (destino.data === sobrante.id) throw new Rechazo(422, "Elegí una sección distinta.", ["Elegí una sección distinta."]);
    const elegida = await leerSeccion(destino.data);
    if (!elegida || elegida.interna) throw new Rechazo(422, "La sección elegida no existe.", ["La sección elegida no existe."]);
    return { sobrante, elegida };
  }
  router.get("/secciones/:id/unir", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sobrante, elegida } = await parDeSecciones(req);
      const enBorradores = (await borradoresConSeccion(sobrante.id)).length;
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", sobrante: { id: sobrante.id, nombre: sobrante.nombre }, elegida: { id: elegida.id, nombre: elegida.nombre }, articulos: sobrante._count.articulos, enBorradores, redireccion: `${rutaSeccion(sobrante.slug)} → ${rutaSeccion(elegida.slug)}` });
    } catch (e) {
      manejar(res, next, e);
    }
  });
  router.post("/secciones/:id/unir", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sobrante, elegida } = await parDeSecciones(req);
      const movidos = await prisma.$transaction(async (tx) => {
        const r = await tx.articulo.updateMany({ where: { seccionId: sobrante.id }, data: { seccionId: elegida.id } });
        for (const b of await tx.articuloBorrador.findMany({ select: { articuloId: true, datos: true } })) {
          const datos = b.datos as Datos | null;
          if (datos?.["seccionId"] === sobrante.id) await tx.articuloBorrador.update({ where: { articuloId: b.articuloId }, data: { datos: { ...datos, seccionId: elegida.id } as unknown as Prisma.InputJsonValue } });
        }
        await redirigir(tx, rutaSeccion(sobrante.slug), rutaSeccion(elegida.slug));
        await tx.seccion.delete({ where: { id: sobrante.id } });
        return r.count;
      });
      res.json({ estado: "ok", movidos });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // =====================================================================================================================
  // Categorías
  // =====================================================================================================================
  const NombreCategoria = z.string().trim().min(1, "Escribí el nombre de la categoría.").max(150, "El nombre es demasiado largo (máximo 150 caracteres).");
  const CategoriaSchema = z.object({ nombre: NombreCategoria, slug: SlugSchema.max(150, "La dirección es demasiado larga (máximo 150 caracteres).") }).strict();
  const CategoriaNuevaSchema = z.object({ nombre: NombreCategoria, slug: SlugSchema.max(150).optional() }).strict();

  const leerCategoria = (id: number) => prisma.categoria.findUnique({ where: { id }, select: { id: true, slug: true, nombre: true, _count: { select: { articulos: true, principalDe: true } } } });
  const categoriaExistente = async (idTexto: unknown) => {
    const id = Id.safeParse(idTexto);
    const c = id.success ? await leerCategoria(id.data) : null;
    if (!c) throw new Rechazo(404, "No encontramos esa categoría.");
    return c;
  };
  const categoriaParaElPanel = (c: NonNullable<Awaited<ReturnType<typeof leerCategoria>>>) => ({ id: c.id, slug: c.slug, nombre: c.nombre, articulos: c._count.articulos, comoPrincipal: c._count.principalDe });
  const borradoresConCategoria = async (id: number) =>
    (await borradores()).filter((b) => {
      const d = b.datos as Datos | null;
      return ((d?.["categoriaIds"] as number[] | undefined) ?? []).includes(id) || d?.["categoriaPrincipalId"] === id;
    });

  router.get("/categorias", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const filas = await prisma.categoria.findMany({ orderBy: [{ nombre: "asc" }, { id: "asc" }], select: { id: true, slug: true, nombre: true, _count: { select: { articulos: true, principalDe: true } } } });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", categorias: filas.map(categoriaParaElPanel) });
    } catch (e) {
      next(e);
    }
  });

  router.post("/categorias", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = CategoriaNuevaSchema.safeParse(req.body);
      if (!datos.success) return void sinProblemas(res, zodAProblemas(datos.error));
      const creada = await prisma.$transaction(async (tx) => {
        let slug = datos.data.slug;
        if (slug) {
          if ((await tx.categoria.findUnique({ where: { slug }, select: { id: true } })) || (await rutaOcupada(tx, rutaCategoria(slug), null))) throw new Rechazo(422, "Ya hay una categoría con esa dirección. Elegí otra.");
        } else {
          const base = slugDesdeTitulo(datos.data.nombre).slice(0, 140);
          slug = base;
          for (let n = 2; (await tx.categoria.findUnique({ where: { slug }, select: { id: true } })) || (await rutaOcupada(tx, rutaCategoria(slug), null)); n++) slug = `${base}-${n}`;
        }
        return tx.categoria.create({ data: { nombre: datos.data.nombre, slug }, select: { id: true } });
      });
      res.status(201).json({ estado: "ok", categoria: categoriaParaElPanel((await leerCategoria(creada.id))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  router.put("/categorias/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actual = await categoriaExistente(req.params["id"]);
      const datos = CategoriaSchema.safeParse(req.body);
      if (!datos.success) return void sinProblemas(res, zodAProblemas(datos.error));
      await prisma.$transaction(async (tx) => {
        if (datos.data.slug !== actual.slug) {
          if (await tx.categoria.findUnique({ where: { slug: datos.data.slug }, select: { id: true } })) throw new Rechazo(422, "Ya hay una categoría con esa dirección. Elegí otra.");
          if (await rutaOcupada(tx, rutaCategoria(datos.data.slug), rutaCategoria(actual.slug))) throw new Rechazo(422, "Esa dirección está reservada por una redirección. Elegí otra.");
        }
        await tx.categoria.update({ where: { id: actual.id }, data: { nombre: datos.data.nombre, slug: datos.data.slug }, select: { id: true } });
        if (datos.data.slug !== actual.slug) await redirigir(tx, rutaCategoria(actual.slug), rutaCategoria(datos.data.slug));
      });
      res.json({ estado: "ok", categoria: categoriaParaElPanel((await leerCategoria(actual.id))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  router.delete("/categorias/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = await categoriaExistente(req.params["id"]);
      if (c._count.articulos > 0 || c._count.principalDe > 0) return void res.status(409).json({ estado: "error", mensaje: `La categoría «${c.nombre}» tiene ${c._count.articulos} ${c._count.articulos === 1 ? "artículo" : "artículos"}: pasalos a otra (unir) antes de eliminarla.` });
      if ((await borradoresConCategoria(c.id)).length) return void res.status(409).json({ estado: "error", mensaje: `La categoría «${c.nombre}» figura en cambios sin publicar de algún artículo: publicalos o descartalos antes.` });
      await prisma.$transaction(async (tx) => {
        await eliminarRedireccionesHacia(tx, rutaCategoria(c.slug));
        await tx.categoria.delete({ where: { id: c.id } });
      });
      res.json({ estado: "ok" });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  async function parDeCategorias(req: Request) {
    const sobrante = await categoriaExistente(req.params["id"]);
    const destino = Id.safeParse(req.method === "GET" ? req.query["destinoId"] : (req.body as { destinoId?: unknown } | undefined)?.destinoId);
    if (!destino.success) throw new Rechazo(422, "Elegí con qué categoría unirla.", ["Elegí con qué categoría unirla."]);
    if (destino.data === sobrante.id) throw new Rechazo(422, "Elegí una categoría distinta.", ["Elegí una categoría distinta."]);
    const elegida = await leerCategoria(destino.data);
    if (!elegida) throw new Rechazo(422, "La categoría elegida no existe.", ["La categoría elegida no existe."]);
    return { sobrante, elegida };
  }
  router.get("/categorias/:id/unir", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sobrante, elegida } = await parDeCategorias(req);
      const idsSobrante = (await prisma.articuloCategoria.findMany({ where: { categoriaId: sobrante.id }, select: { articuloId: true } })).map((f) => f.articuloId);
      const conAmbas = idsSobrante.length ? await prisma.articuloCategoria.count({ where: { categoriaId: elegida.id, articuloId: { in: idsSobrante } } }) : 0;
      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        sobrante: { id: sobrante.id, nombre: sobrante.nombre },
        elegida: { id: elegida.id, nombre: elegida.nombre },
        articulos: sobrante._count.articulos,
        yaConAmbas: conAmbas,
        comoPrincipal: sobrante._count.principalDe,
        enBorradores: (await borradoresConCategoria(sobrante.id)).length,
        redireccion: `${rutaCategoria(sobrante.slug)} → ${rutaCategoria(elegida.slug)}`,
      });
    } catch (e) {
      manejar(res, next, e);
    }
  });
  router.post("/categorias/:id/unir", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sobrante, elegida } = await parDeCategorias(req);
      const movidos = await prisma.$transaction(async (tx) => {
        // Artículos: los que ya tienen las dos quedan con una sola; el resto pasa a la elegida.
        const filas = await tx.articuloCategoria.findMany({ where: { categoriaId: sobrante.id }, select: { articuloId: true } });
        const conAmbas = new Set((await tx.articuloCategoria.findMany({ where: { categoriaId: elegida.id, articuloId: { in: filas.map((f) => f.articuloId) } }, select: { articuloId: true } })).map((f) => f.articuloId));
        for (const f of filas) {
          if (conAmbas.has(f.articuloId)) await tx.articuloCategoria.delete({ where: { articuloId_categoriaId: { articuloId: f.articuloId, categoriaId: sobrante.id } } });
          else await tx.articuloCategoria.update({ where: { articuloId_categoriaId: { articuloId: f.articuloId, categoriaId: sobrante.id } }, data: { categoriaId: elegida.id } });
        }
        // La categoría principal (la volanta) también pasa a la elegida: así no queda una volanta que no es una de las categorías del artículo.
        await tx.articulo.updateMany({ where: { categoriaPrincipalId: sobrante.id }, data: { categoriaPrincipalId: elegida.id } });
        // Cambios sin publicar que las nombran.
        for (const b of await tx.articuloBorrador.findMany({ select: { articuloId: true, datos: true } })) {
          const d = b.datos as Datos | null;
          const ids = (d?.["categoriaIds"] as number[] | undefined) ?? [];
          if (!ids.includes(sobrante.id) && d?.["categoriaPrincipalId"] !== sobrante.id) continue;
          const nuevas = ids.map((x) => (x === sobrante.id ? elegida.id : x));
          await tx.articuloBorrador.update({
            where: { articuloId: b.articuloId },
            data: { datos: { ...d, categoriaIds: nuevas.filter((x, i) => nuevas.indexOf(x) === i), ...(d?.["categoriaPrincipalId"] === sobrante.id ? { categoriaPrincipalId: elegida.id } : {}) } as unknown as Prisma.InputJsonValue },
          });
        }
        await redirigir(tx, rutaCategoria(sobrante.slug), rutaCategoria(elegida.slug));
        await tx.categoria.delete({ where: { id: sobrante.id } });
        return filas.length;
      });
      res.json({ estado: "ok", movidos });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  return router;
}
