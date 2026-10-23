import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { BIO_MAX, bioConTexto, largoDeBio, problemasDeFormaDeBio } from "@evaristo/compartido/bio";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import { tienePermiso, type Permiso } from "@evaristo/compartido/permisos";
import type { JSONNode } from "@evaristo/compartido/schema";
import { rutaAutor } from "@evaristo/compartido/urls";
import { SlugSchema } from "./datos-articulo.js";
import { slugLibreDeAutor } from "./usuarios.js";

// Autores (fichas) del panel. Decisiones del 23/10/2026:
//  - Editores y administradores crean y editan cualquier ficha; un Redactor edita solo la suya (nombre, bio, foto y redes).
//  - Eliminar y unir son del administrador. Eliminar solo si no tiene artículos ni usuario. Unir pasa los artículos al elegido, completa lo
//    que le falte (bio, foto y cada red) con lo del sobrante, deja la dirección vieja redirigiendo y borra al sobrante.
//  - Las redes se cargan con la dirección completa (http o https).
//  - La bio tiene hasta 500 caracteres; una bio migrada que se pasa puede seguir guardándose mientras no se toque.
//  - Si cambia la dirección (slug), la vieja pasa a redirigir (redirección AUTOR).
// select explícito en todo.

export const AUTORES_POR_PAGINA = 25;

const Id = z.coerce.number().int().positive();
const ISO = (d: Date): string => d.toISOString();
const REDES = ["instagram", "x", "facebook", "sitioWeb"] as const;
type Red = (typeof REDES)[number];

const seleccionFicha = {
  id: true,
  slug: true,
  nombre: true,
  soloTexto: true,
  bio: true,
  instagram: true,
  x: true,
  facebook: true,
  sitioWeb: true,
  fotoId: true,
  fotoAlt: true,
  fotoPuntoFocalX: true,
  fotoPuntoFocalY: true,
  actualizadoEn: true,
  usuarioId: true,
  foto: { select: { id: true, clave: true, nombreOriginal: true } },
  usuario: { select: { id: true, nombre: true } },
  _count: { select: { articulos: true } },
} as const;
type FilaFicha = Prisma.AutorGetPayload<{ select: typeof seleccionFicha }>;

const paraElPanel = (a: FilaFicha) => ({
  id: a.id,
  slug: a.slug,
  nombre: a.nombre,
  soloTexto: a.soloTexto,
  bio: a.bio as JSONNode | null,
  instagram: a.instagram,
  x: a.x,
  facebook: a.facebook,
  sitioWeb: a.sitioWeb,
  fotoId: a.fotoId,
  fotoAlt: a.fotoAlt,
  fotoPuntoFocalX: a.fotoPuntoFocalX,
  fotoPuntoFocalY: a.fotoPuntoFocalY,
  foto: a.foto,
  version: ISO(a.actualizadoEn),
  usuario: a.usuario,
  articulos: a._count.articulos,
});

/** JSON con las claves ordenadas: para comparar dos documentos sin importar el orden en que se guardaron. */
const canonico = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

const Url = (campo: string) =>
  z
    .string()
    .trim()
    .max(255, `La dirección de ${campo} es demasiado larga (máximo 255 caracteres).`)
    .nullable();

const DatosSchema = z
  .object({
    nombre: z.string().trim().min(1, "Escribí el nombre del autor.").max(255, "El nombre es demasiado largo (máximo 255 caracteres)."),
    slug: z.string().min(1, "La dirección del autor no puede quedar vacía.").max(255, "La dirección del autor es demasiado larga.").optional(),
    soloTexto: z.boolean().optional(),
    bio: z.unknown().nullable(),
    instagram: Url("Instagram"),
    x: Url("X"),
    facebook: Url("Facebook"),
    sitioWeb: Url("el sitio web"),
    fotoId: z.number().int().positive().nullable(),
    fotoAlt: z.string().trim().max(512, "El texto alternativo de la foto es demasiado largo (máximo 512 caracteres).").nullable(),
    fotoPuntoFocalX: z.number().min(0, "El punto focal tiene que estar entre 0 y 100.").max(1, "El punto focal tiene que estar entre 0 y 100."),
    fotoPuntoFocalY: z.number().min(0, "El punto focal tiene que estar entre 0 y 100.").max(1, "El punto focal tiene que estar entre 0 y 100."),
  })
  .strict();
const GuardarSchema = z.object({ version: z.string().min(1).max(40), datos: z.unknown() }).strict();
const NuevoSchema = z
  .object({ nombre: DatosSchema.shape.nombre, slug: SlugSchema.optional() })
  .strict();

const NOMBRE_DE_RED: Record<Red, string> = { instagram: "Instagram", x: "X", facebook: "Facebook", sitioWeb: "El sitio web" };
const esDireccionWeb = (v: string): boolean => {
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
};

class Rechazo extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly problemas: string[] = [],
  ) {
    super(mensaje);
  }
}

export function crearRutasAdminAutores(prisma: PrismaClient): express.Router {
  const router = express.Router();

  const puede = (req: Request, permiso: Permiso): boolean => tienePermiso(req.usuario!.rol, permiso);
  const noEncontrado = (res: Response): void => void res.status(404).json({ estado: "error", mensaje: "No encontramos a ese autor." });
  const prohibido = (res: Response): void => void res.status(403).json({ estado: "error", mensaje: "No tenés permiso para hacer esto." });
  const sinProblemas = (res: Response, problemas: string[], mensaje = "Revisá la ficha antes de guardar."): void => void res.status(422).json({ estado: "error", mensaje, problemas: [...new Set(problemas)].slice(0, 10) });
  const leer = (id: number) => prisma.autor.findUnique({ where: { id }, select: seleccionFicha });
  const manejar = (res: Response, next: NextFunction, e: unknown): void => {
    if (e instanceof Rechazo) {
      if (e.problemas.length) sinProblemas(res, e.problemas, e.message);
      else res.status(e.estado).json({ estado: "error", mensaje: e.message });
      return;
    }
    next(e);
  };
  /** Carga la ficha si la persona puede verla: con permiso sobre las ajenas, o si es la suya. Si no, responde y devuelve null. */
  async function fichaVisible(req: Request, res: Response): Promise<FilaFicha | null> {
    const id = Id.safeParse(req.params["id"]);
    const ficha = id.success ? await leer(id.data) : null;
    if (!ficha || (!puede(req, "autores.editar.ajenos") && ficha.usuarioId !== req.usuario!.id)) {
      noEncontrado(res);
      return null;
    }
    return ficha;
  }

  // ---------- Listado con búsqueda y filtros ----------
  const ConsultaSchema = z.object({
    q: z.string().trim().max(100).optional(),
    filtro: z.enum(["sin-bio", "sin-foto", "sin-alt", "solo-texto", "con-usuario"]).optional(),
    pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  });
  router.get("/autores", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!puede(req, "autores.editar.ajenos")) return void prohibido(res);
      const consulta = ConsultaSchema.safeParse(req.query);
      if (!consulta.success) return void res.status(400).json({ estado: "error", mensaje: "Los filtros del listado no son válidos." });
      const { q, filtro, pagina } = consulta.data;
      const donde: Prisma.AutorWhereInput = {
        ...(q ? { OR: [{ nombre: { contains: q } }, { slug: { contains: q } }] } : {}),
        ...(filtro === "sin-bio" ? { soloTexto: false, bio: { equals: Prisma.DbNull } } : {}),
        ...(filtro === "sin-foto" ? { soloTexto: false, fotoId: null } : {}),
        ...(filtro === "sin-alt" ? { fotoId: { not: null }, OR: [{ fotoAlt: null }, { fotoAlt: "" }] } : {}),
        ...(filtro === "solo-texto" ? { soloTexto: true } : {}),
        ...(filtro === "con-usuario" ? { usuarioId: { not: null } } : {}),
      };
      const [total, filas] = await Promise.all([
        prisma.autor.count({ where: donde }),
        prisma.autor.findMany({
          where: donde,
          orderBy: [{ nombre: "asc" }, { id: "asc" }],
          skip: (pagina - 1) * AUTORES_POR_PAGINA,
          take: AUTORES_POR_PAGINA,
          select: { id: true, slug: true, nombre: true, soloTexto: true, bio: true, fotoId: true, fotoAlt: true, usuario: { select: { id: true, nombre: true } }, _count: { select: { articulos: true } } },
        }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        total,
        pagina,
        paginas: Math.max(1, Math.ceil(total / AUTORES_POR_PAGINA)),
        autores: filas.map((a) => ({
          id: a.id,
          slug: a.slug,
          nombre: a.nombre,
          soloTexto: a.soloTexto,
          conBio: a.bio !== null,
          conFoto: a.fotoId !== null,
          fotoSinAlt: a.fotoId !== null && !a.fotoAlt?.trim(),
          usuario: a.usuario,
          articulos: a._count.articulos,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Mi ficha (la del usuario que ingresó) ----------
  router.get("/autores/mia", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ficha = await prisma.autor.findUnique({ where: { usuarioId: req.usuario!.id }, select: { id: true } });
      if (!ficha) return void res.status(404).json({ estado: "error", mensaje: "Tu usuario todavía no tiene una ficha de autor." });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", id: ficha.id });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Leer una ficha ----------
  router.get("/autores/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ficha = await fichaVisible(req, res);
      if (!ficha) return;
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", autor: paraElPanel(ficha), puedeEditarTodo: puede(req, "autores.editar.ajenos"), bioMax: BIO_MAX });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Crear ----------
  router.post("/autores", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!puede(req, "autores.crear")) return void prohibido(res);
      const datos = NuevoSchema.safeParse(req.body);
      if (!datos.success) return void sinProblemas(res, datos.error.issues.map((i) => i.message));
      const creado = await prisma.$transaction(async (tx) => {
        let slug = datos.data.slug;
        if (slug) {
          const ocupado = (await tx.autor.findUnique({ where: { slug }, select: { id: true } })) ?? (await tx.redireccion.findFirst({ where: { origen: rutaAutor(slug) }, select: { id: true } }));
          if (ocupado) throw new Rechazo(422, "Ya hay un autor con esa dirección. Elegí otra.");
        } else {
          slug = await slugLibreDeAutor(tx, datos.data.nombre);
        }
        return tx.autor.create({ data: { nombre: datos.data.nombre, slug }, select: { id: true } });
      });
      res.status(201).json({ estado: "ok", id: creado.id });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // ---------- Guardar ----------
  router.put("/autores/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ficha = await fichaVisible(req, res);
      if (!ficha) return;
      const pedido = GuardarSchema.safeParse(req.body);
      if (!pedido.success) return void sinProblemas(res, ["El pedido no tiene el formato esperado."]);
      const zod = DatosSchema.safeParse(pedido.data.datos);
      if (!zod.success) return void sinProblemas(res, zod.error.issues.map((i) => i.message));
      const d = zod.data;
      const todo = puede(req, "autores.editar.ajenos");
      if (ISO(ficha.actualizadoEn) !== pedido.data.version) return void res.status(409).json({ estado: "conflicto", mensaje: "Esta ficha cambió mientras la editabas.", versionActual: ISO(ficha.actualizadoEn) });

      const problemas: string[] = [];
      const slug = d.slug ?? ficha.slug;
      const soloTexto = d.soloTexto ?? ficha.soloTexto;
      // La dirección y «no es una persona» los cambia quien administra los autores, no el propio autor.
      if (!todo && (slug !== ficha.slug || soloTexto !== ficha.soloTexto)) problemas.push("La dirección y el tipo de autor los cambia un editor.");
      if (slug !== ficha.slug) {
        const formato = SlugSchema.safeParse(slug);
        if (!formato.success) problemas.push(...formato.error.issues.map((i) => i.message));
        else {
          const otro = (await prisma.autor.findUnique({ where: { slug }, select: { id: true } })) ?? null;
          const redirige = await prisma.redireccion.findFirst({ where: { origen: rutaAutor(slug), NOT: { autorId: ficha.id } }, select: { id: true } });
          if (otro || redirige) problemas.push("Ya hay un autor con esa dirección. Elegí otra.");
        }
      }

      // Redes: dirección completa. Una que ya estaba guardada de otra forma (viene de la migración) puede seguir así si no se toca.
      for (const red of REDES) {
        const nuevo = d[red]?.trim() || null;
        if (nuevo !== null && nuevo !== ficha[red] && !esDireccionWeb(nuevo)) problemas.push(`${NOMBRE_DE_RED[red]}: pegá la dirección completa, que empiece con http:// o https://.`);
      }

      // Bio: forma y largo. Una bio migrada que se pasa de largo puede seguir guardándose mientras no se cambie.
      let bio: JSONNode | null = null;
      if (d.bio !== null && d.bio !== undefined) {
        const forma = problemasDeFormaDeBio(d.bio);
        problemas.push(...forma);
        if (!forma.length) {
          bio = bioConTexto(d.bio as JSONNode) ? (d.bio as JSONNode) : null;
          const sinCambios = canonico(bio) === canonico(ficha.bio);
          if (bio && !sinCambios && largoDeBio(bio) > BIO_MAX) problemas.push(`La bio tiene ${largoDeBio(bio)} caracteres y el máximo es ${BIO_MAX}. Acortala.`);
        }
      }

      if (d.fotoId !== null && !(await prisma.imagen.findUnique({ where: { id: d.fotoId }, select: { id: true } }))) problemas.push("La foto elegida no está en la biblioteca.");
      if (problemas.length) return void sinProblemas(res, problemas);

      await prisma.$transaction(async (tx) => {
        const r = await tx.autor.updateMany({
          where: { id: ficha.id, actualizadoEn: ficha.actualizadoEn },
          data: {
            nombre: d.nombre,
            slug,
            soloTexto,
            bio: bio === null ? Prisma.DbNull : (bio as unknown as Prisma.InputJsonValue),
            instagram: d.instagram?.trim() || null,
            x: d.x?.trim() || null,
            facebook: d.facebook?.trim() || null,
            sitioWeb: d.sitioWeb?.trim() || null,
            fotoId: d.fotoId,
            fotoAlt: d.fotoId === null ? null : d.fotoAlt?.trim() || null,
            fotoPuntoFocalX: d.fotoPuntoFocalX,
            fotoPuntoFocalY: d.fotoPuntoFocalY,
          },
        });
        if (r.count !== 1) throw new Rechazo(409, "Esta ficha cambió mientras la editabas.");
        if (slug !== ficha.slug) {
          // La dirección vieja pasa a redirigir a la ficha; si la nueva era una redirección vieja de esta misma ficha, ya no hace falta.
          const origen = rutaAutor(ficha.slug);
          await tx.redireccion.upsert({
            where: { origen },
            create: { origen, tipo: "AUTOR", codigo: 301, autorId: ficha.id },
            update: { tipo: "AUTOR", codigo: 301, autorId: ficha.id, articuloId: null, destino: null },
          });
          await tx.redireccion.deleteMany({ where: { origen: rutaAutor(slug), autorId: ficha.id } });
        }
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", autor: paraElPanel((await leer(ficha.id))!) });
    } catch (e) {
      if (e instanceof Rechazo && e.estado === 409) return void res.status(409).json({ estado: "conflicto", mensaje: e.message });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return void sinProblemas(res, ["Ya hay un autor con esa dirección. Elegí otra."]);
      manejar(res, next, e);
    }
  });

  // ---------- Eliminar (solo sin artículos, sin usuario y sin cambios pendientes que lo nombren) ----------
  const autorEnBorradores = async (id: number): Promise<boolean> => {
    const filas = await prisma.articuloBorrador.findMany({ select: { datos: true } });
    return filas.some((f) => ((f.datos as { autorIds?: number[] } | null)?.autorIds ?? []).includes(id));
  };
  router.delete("/autores/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!puede(req, "autores.eliminar")) return void prohibido(res);
      const id = Id.safeParse(req.params["id"]);
      const ficha = id.success ? await leer(id.data) : null;
      if (!ficha) return void noEncontrado(res);
      if (ficha._count.articulos > 0) return void res.status(409).json({ estado: "error", mensaje: `${ficha.nombre} tiene ${ficha._count.articulos} ${ficha._count.articulos === 1 ? "artículo" : "artículos"}: no se puede eliminar. Si es un duplicado, unilo con el otro.` });
      if (ficha.usuarioId !== null) return void res.status(409).json({ estado: "error", mensaje: `${ficha.nombre} es la ficha de un usuario del panel: no se puede eliminar.` });
      if (await autorEnBorradores(ficha.id)) return void res.status(409).json({ estado: "error", mensaje: `${ficha.nombre} figura en cambios sin publicar de algún artículo: publicalos o descartalos antes.` });
      await prisma.autor.delete({ where: { id: ficha.id } });
      res.json({ estado: "ok" });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // ---------- Unir con otro ----------
  /** Qué se le completaría al elegido con lo del sobrante. */
  const faltantes = (sobrante: FilaFicha, elegido: FilaFicha): string[] => {
    const lista: string[] = [];
    if (sobrante.bio !== null && elegido.bio === null) lista.push("la bio");
    if (sobrante.fotoId !== null && elegido.fotoId === null) lista.push("la foto");
    for (const red of REDES) if (sobrante[red] && !elegido[red]) lista.push(red === "sitioWeb" ? "el sitio web" : `la dirección de ${NOMBRE_DE_RED[red]}`);
    return lista;
  };

  async function cargarPar(req: Request, res: Response): Promise<{ sobrante: FilaFicha; elegido: FilaFicha } | null> {
    if (!puede(req, "autores.eliminar")) {
      prohibido(res);
      return null;
    }
    const id = Id.safeParse(req.params["id"]);
    const destino = Id.safeParse(req.method === "GET" ? req.query["destinoId"] : (req.body as { destinoId?: unknown } | undefined)?.destinoId);
    const sobrante = id.success ? await leer(id.data) : null;
    if (!sobrante) {
      noEncontrado(res);
      return null;
    }
    if (!destino.success) {
      sinProblemas(res, ["Elegí con qué autor unirlo."]);
      return null;
    }
    if (destino.data === sobrante.id) {
      sinProblemas(res, ["Elegí un autor distinto del que querés unir."]);
      return null;
    }
    const elegido = await leer(destino.data);
    if (!elegido) {
      sinProblemas(res, ["El autor elegido no existe."]);
      return null;
    }
    if (sobrante.usuarioId !== null) {
      res.status(409).json({ estado: "error", mensaje: `${sobrante.nombre} es la ficha de un usuario del panel: no se puede unir con otra.` });
      return null;
    }
    return { sobrante, elegido };
  }

  router.get("/autores/:id/unir", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const par = await cargarPar(req, res);
      if (!par) return;
      const { sobrante, elegido } = par;
      const articulos = await prisma.articulo.findMany({ where: { autores: { some: { autorId: sobrante.id } } }, orderBy: { id: "desc" }, take: 20, select: { id: true, titulo: true, autores: { where: { autorId: elegido.id }, select: { autorId: true } } } });
      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        sobrante: { id: sobrante.id, nombre: sobrante.nombre, slug: sobrante.slug },
        elegido: { id: elegido.id, nombre: elegido.nombre, slug: elegido.slug },
        articulos: sobrante._count.articulos,
        // Los primeros 20, marcando los que ya tienen a los dos (ahí queda uno solo).
        muestra: articulos.map((a) => ({ id: a.id, titulo: a.titulo, yaTieneAlElegido: a.autores.length > 0 })),
        seCompleta: faltantes(sobrante, elegido),
        redireccion: `${rutaAutor(sobrante.slug)} → ${rutaAutor(elegido.slug)}`,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post("/autores/:id/unir", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const par = await cargarPar(req, res);
      if (!par) return;
      const { sobrante, elegido } = par;
      const mover = await prisma.$transaction(async (tx) => {
        // Artículos: los que ya tienen al elegido quedan con uno solo; el resto pasa al elegido en el mismo lugar de la firma.
        const filas = await tx.articuloAutor.findMany({ where: { autorId: sobrante.id }, select: { articuloId: true, orden: true } });
        const conAmbos = new Set((await tx.articuloAutor.findMany({ where: { autorId: elegido.id, articuloId: { in: filas.map((f) => f.articuloId) } }, select: { articuloId: true } })).map((f) => f.articuloId));
        for (const f of filas) {
          if (conAmbos.has(f.articuloId)) await tx.articuloAutor.delete({ where: { articuloId_autorId: { articuloId: f.articuloId, autorId: sobrante.id } } });
          else await tx.articuloAutor.update({ where: { articuloId_autorId: { articuloId: f.articuloId, autorId: sobrante.id } }, data: { autorId: elegido.id } });
        }
        // Cambios sin publicar que nombran al sobrante: pasan al elegido (sin repetirlo).
        for (const b of await tx.articuloBorrador.findMany({ select: { articuloId: true, datos: true } })) {
          const datos = b.datos as { autorIds?: number[] } | null;
          if (!datos?.autorIds?.includes(sobrante.id)) continue;
          const ids = datos.autorIds.map((x) => (x === sobrante.id ? elegido.id : x));
          await tx.articuloBorrador.update({ where: { articuloId: b.articuloId }, data: { datos: { ...datos, autorIds: ids.filter((x, i) => ids.indexOf(x) === i) } as unknown as Prisma.InputJsonValue } });
        }
        // Se completa lo que le falte al elegido.
        const completar: Prisma.AutorUncheckedUpdateInput = {};
        if (elegido.bio === null && sobrante.bio !== null) completar.bio = sobrante.bio as unknown as Prisma.InputJsonValue;
        if (elegido.fotoId === null && sobrante.fotoId !== null) Object.assign(completar, { fotoId: sobrante.fotoId, fotoAlt: sobrante.fotoAlt, fotoPuntoFocalX: sobrante.fotoPuntoFocalX, fotoPuntoFocalY: sobrante.fotoPuntoFocalY });
        for (const red of REDES) if (!elegido[red] && sobrante[red]) completar[red] = sobrante[red];
        if (Object.keys(completar).length) await tx.autor.update({ where: { id: elegido.id }, data: completar, select: { id: true } });
        // Direcciones: las redirecciones del sobrante pasan al elegido y su dirección también redirige.
        await tx.redireccion.updateMany({ where: { autorId: sobrante.id }, data: { autorId: elegido.id } });
        await tx.redireccion.upsert({
          where: { origen: rutaAutor(sobrante.slug) },
          create: { origen: rutaAutor(sobrante.slug), tipo: "AUTOR", codigo: 301, autorId: elegido.id },
          update: { tipo: "AUTOR", codigo: 301, autorId: elegido.id, articuloId: null, destino: null },
        });
        // La redirección que apuntara a la dirección del elegido ya no hace falta.
        await tx.redireccion.deleteMany({ where: { origen: rutaAutor(elegido.slug), autorId: elegido.id } });
        await tx.autor.delete({ where: { id: sobrante.id } });
        return filas.length;
      });
      res.json({ estado: "ok", movidos: mover, autor: paraElPanel((await leer(elegido.id))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  return router;
}
