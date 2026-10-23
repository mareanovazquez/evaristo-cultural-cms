import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import type { JSONNode } from "@evaristo/compartido/schema";
import { textoPlanoDe } from "@evaristo/compartido/texto-plano";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { DatosSchema, erroresDelCuerpo, SlugSchema, type DatosArticulo } from "./datos-articulo.js";
import { Conflicto, datosDeLaFila, datosDelBorrador, escribirDatos, type FilaArticulo, IdSchema, iso, problemasDeReferencias, problemasDeZod, seleccion, sinProblemas, versionVigente } from "./edicion.js";
import { estadoEfectivo } from "./estado.js";

// Publicar: pasar un borrador a PUBLICADO (ya, o con una fecha futura que lo programa), publicar los cambios de uno publicado
// y despublicar. Lo pueden hacer editores y administradores. Decisiones del 22/10/2026:
//  - Programar = PUBLICADO con fecha futura (ver estado.ts).
//  - Despublicar deja el artículo en BORRADOR conservando su dirección y su fecha, para volver a publicarlo en la misma URL.
//    No se puede despublicar uno con cambios sin publicar (publicarlos o descartarlos antes): así no se pierde nada.
//  - Cada operación manda la versión que se vio; si otra persona guardó en el medio, 409 y no se cambia nada.
// Reglas al publicar: sección elegida (no una interna), imagen de encabezado con su texto alternativo, texto en el artículo, texto alternativo
// en cada imagen de la galería,
// dirección válida y libre (si todavía es "borrador-…", se genera desde el título) y fecha razonable.
// Si la URL pública cambia respecto de una anterior, se crea la redirección 301 (SLUG_ANTERIOR).

const MAX_SLUG = 80;

/** Dirección (slug) a partir de un título: minúsculas, sin tildes, letras y números separados por guiones. */
export function slugDesdeTitulo(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return "articulo";
  if (base.length <= MAX_SLUG) return base;
  // Se corta en un guion para no partir una palabra.
  const corte = base.slice(0, MAX_SLUG);
  const guion = corte.lastIndexOf("-");
  return (guion > 20 ? corte.slice(0, guion) : corte).replace(/-+$/g, "");
}

const esProvisoria = (slug: string): boolean => slug === "" || slug.startsWith("borrador-");

async function slugLibre(prisma: PrismaClient, base: string, articuloId: number): Promise<string> {
  for (let n = 1; n < 200; n++) {
    const candidato = n === 1 ? base : `${base.slice(0, MAX_SLUG - String(n).length - 1)}-${n}`;
    const otro = await prisma.articulo.findUnique({ where: { slug: candidato }, select: { id: true } });
    if (!otro || otro.id === articuloId) return candidato;
  }
  return `${base.slice(0, MAX_SLUG - 7)}-${Date.now().toString(36)}`;
}

/** ¿El texto tiene algo que mostrar? Texto, o una imagen, un video o una tabla. */
function cuerpoConContenido(doc: JSONNode): boolean {
  if (textoPlanoDe(doc as never).trim() !== "") return true;
  const recorrer = (n: JSONNode): boolean => n.type === "imagen" || n.type === "video" || n.type === "table" || (n.content ?? []).some(recorrer);
  return recorrer(doc);
}

interface OpcionesReglas {
  /** Un borrador que se publica por primera vez: se exige todo. En uno ya publicado solo lo que cambia. */
  esNuevo: boolean;
}

/** Lo que falta para poder publicar (en lenguaje común). Vacío si se puede. */
async function problemasParaPublicar(prisma: PrismaClient, a: FilaArticulo, datos: DatosArticulo, { esNuevo }: OpcionesReglas): Promise<string[]> {
  const problemas: string[] = [];
  const seccion = await prisma.seccion.findUnique({ where: { id: datos.seccionId }, select: { interna: true } });
  if (!seccion || seccion.interna) problemas.push("Elegí una sección del artículo antes de publicarlo.");

  if (datos.imagenEncabezadoId === null) {
    problemas.push("Falta la imagen principal del artículo (la foto grande que va arriba, debajo del título).");
  } else if (!datos.encabezadoAlt?.trim()) {
    // En uno ya publicado, el texto alternativo puede seguir vacío solo si la imagen es la misma y ya lo estaba (viene de la migración).
    const igualYVacio = !esNuevo && datos.imagenEncabezadoId === a.imagenEncabezadoId && !a.encabezadoAlt?.trim();
    if (!igualYVacio) problemas.push("Falta el texto alternativo de la imagen principal (describe la foto para quien no puede verla).");
  }
  if (!cuerpoConContenido(datos.cuerpo)) problemas.push("El artículo todavía no tiene texto.");

  // Cada imagen de la galería lleva su texto alternativo. En uno ya publicado puede seguir vacío solo en las que ya estaban así (vienen de la migración).
  const sinTextoAlt = datos.galeria.filter((g) => !g.alt?.trim());
  if (sinTextoAlt.length > 0) {
    const yaVacias = new Set(esNuevo ? [] : a.galeria.filter((g) => !g.alt?.trim()).map((g) => g.imagenId));
    const faltan = sinTextoAlt.filter((g) => !yaVacias.has(g.imagenId)).length;
    if (faltan > 0) problemas.push(faltan === 1 ? "Falta el texto alternativo de una imagen de la galería (describe la foto para quien no puede verla)." : `Falta el texto alternativo de ${faltan} imágenes de la galería (describen cada foto para quien no puede verla).`);
  }

  problemas.push(...(await problemasDeReferencias(prisma, datos, a.seccionId)));
  problemas.push(...erroresDelCuerpo(datos.cuerpo, [a.cuerpo as unknown as JSONNode]));
  return problemas;
}

/** Problema si la URL nueva ya la usó otro artículo (una redirección suya la apunta): esa redirección le robaría el pedido. */
async function problemaDeRuta(prisma: PrismaClient, ruta: string, articuloId: number): Promise<string | null> {
  const ocupada = await prisma.redireccion.findFirst({ where: { origen: ruta, NOT: { articuloId } }, select: { origen: true } });
  return ocupada ? "Esa dirección, con esa fecha, la usó antes otro artículo (que ahora redirige ahí). Elegí otra dirección u otra fecha." : null;
}

const CuerpoPublicarSchema = z
  .object({
    version: z.string().min(1).max(40),
    slug: z.string().max(255).optional(),
    // undefined: se mantiene la fecha original si el artículo ya estuvo publicado, y si no, ahora. null: ahora. Texto: esa fecha.
    publicadoEn: z.string().datetime({ message: "La fecha de publicación no es válida." }).nullable().optional(),
  })
  .strict();
const CuerpoVersionSchema = z.object({ version: z.string().min(1).max(40) }).strict();

const MIN_FECHA = new Date("2000-01-01T00:00:00Z");

export function crearRutasAdminPublicacion(prisma: PrismaClient): express.Router {
  const router = express.Router();

  const cargar = (id: number) => prisma.articulo.findUnique({ where: { id }, select: seleccion }) as Promise<FilaArticulo | null>;
  const noEncontrado = (res: Response) => res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });
  const conflicto = (res: Response, vigente?: Date) => res.status(409).json({ estado: "conflicto", mensaje: "Este artículo cambió mientras lo editabas.", ...(vigente ? { versionActual: iso(vigente) } : {}) });

  /** La dirección con la que saldría: la que se pidió, la actual si es válida o una generada desde el título. */
  async function resolverSlug(a: FilaArticulo, pedido: string | undefined, titulo: string): Promise<{ slug: string; problemas: string[] }> {
    const problemas: string[] = [];
    const candidato = (pedido ?? a.slug).trim();
    if (esProvisoria(candidato)) return { slug: await slugLibre(prisma, slugDesdeTitulo(titulo), a.id), problemas };
    if (candidato !== a.slug) {
      const formato = SlugSchema.safeParse(candidato);
      if (!formato.success) problemas.push(...problemasDeZod(formato.error));
      else if (await prisma.articulo.findUnique({ where: { slug: candidato }, select: { id: true } })) problemas.push("Ya hay un artículo con esa dirección. Elegí otra.");
    }
    return { slug: candidato, problemas };
  }

  // ---------- Revisión: qué falta y qué se propone (solo lectura) ----------
  router.get("/articulos/:id/publicacion", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      const a = id.success ? await cargar(id.data) : null;
      if (!a) return void noEncontrado(res);
      res.setHeader("Cache-Control", "no-store");
      const ahora = new Date();
      if (a.estado === "BORRADOR") {
        const datos = datosDeLaFila(a);
        const { slug } = await resolverSlug(a, undefined, datos.titulo);
        const problemas = await problemasParaPublicar(prisma, a, datos, { esNuevo: true });
        res.json({
          estado: "ok",
          accion: "publicar",
          problemas,
          slugPropuesto: slug,
          // Si ya estuvo publicado, se propone mantener su fecha (y con ella su URL).
          publicadoOriginal: a.publicadoEn ? iso(a.publicadoEn) : null,
          ahora: iso(ahora),
        });
        return;
      }
      if (a.borrador) {
        const parseo = DatosSchema.safeParse(datosDelBorrador(a));
        const problemas = parseo.success ? await problemasParaPublicar(prisma, a, parseo.data, { esNuevo: false }) : problemasDeZod(parseo.error);
        res.json({ estado: "ok", accion: "cambios", problemas });
        return;
      }
      res.json({ estado: "ok", accion: "ninguna", problemas: [] });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Publicar un borrador (ahora o programado) ----------
  router.post("/articulos/:id/publicar", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      const cuerpo = CuerpoPublicarSchema.safeParse(req.body);
      if (!id.success) return void noEncontrado(res);
      if (!cuerpo.success) return void sinProblemas(res, problemasDeZod(cuerpo.error));
      const a = await cargar(id.data);
      if (!a) return void noEncontrado(res);
      if (a.estado !== "BORRADOR") return void res.status(409).json({ estado: "error", mensaje: "Este artículo ya está publicado." });
      if (iso(a.actualizadoEn) !== cuerpo.data.version) return void conflicto(res, a.actualizadoEn);

      const datos = datosDeLaFila(a);
      const problemas = await problemasParaPublicar(prisma, a, datos, { esNuevo: true });
      const { slug, problemas: deSlug } = await resolverSlug(a, cuerpo.data.slug, datos.titulo);
      problemas.push(...deSlug);

      const ahora = new Date();
      const publicadoEn = cuerpo.data.publicadoEn === undefined ? (a.publicadoEn ?? ahora) : cuerpo.data.publicadoEn === null ? ahora : new Date(cuerpo.data.publicadoEn);
      if (publicadoEn < MIN_FECHA) problemas.push("La fecha de publicación es demasiado antigua.");
      if (publicadoEn.getTime() > ahora.getTime() + 5 * 365 * 24 * 3600 * 1000) problemas.push("La fecha de publicación es demasiado lejana.");

      const ruta = rutaArticulo({ slug, publicadoEn });
      if (problemas.length === 0) {
        const choque = await problemaDeRuta(prisma, ruta, a.id);
        if (choque) problemas.push(choque);
      }
      if (problemas.length > 0) return void sinProblemas(res, problemas);

      // La URL que tenía (si ya estuvo publicado y la cambia) pasa a redirigir a la nueva.
      const rutaAnterior = a.publicadoEn && !esProvisoria(a.slug) ? rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn }) : null;
      const nuevaVersion = await prisma.$transaction(async (tx) => {
        const version = await escribirDatos(tx, a.id, a.actualizadoEn, { ...datos, slug }, { estado: "PUBLICADO", publicadoEn, publicadoPorId: req.usuario!.id });
        // Una redirección vieja que apuntaba a esta misma URL ya no hace falta.
        await tx.redireccion.deleteMany({ where: { origen: ruta, articuloId: a.id } });
        if (rutaAnterior && rutaAnterior !== ruta) {
          await tx.redireccion.upsert({
            where: { origen: rutaAnterior },
            create: { origen: rutaAnterior, tipo: "SLUG_ANTERIOR", codigo: 301, articuloId: a.id },
            update: { tipo: "SLUG_ANTERIOR", codigo: 301, articuloId: a.id, autorId: null, destino: null },
          });
        }
        return version;
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", version: iso(nuevaVersion), articuloEstado: estadoEfectivo("PUBLICADO", publicadoEn, new Date()), publicadoEn: iso(publicadoEn), slug, ruta });
    } catch (e) {
      if (e instanceof Conflicto) return void conflicto(res);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return void sinProblemas(res, ["Ya hay un artículo con esa dirección. Elegí otra."]);
      next(e);
    }
  });

  // ---------- Publicar los cambios de uno publicado ----------
  router.post("/articulos/:id/publicar-cambios", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      const cuerpo = CuerpoVersionSchema.safeParse(req.body);
      if (!id.success) return void noEncontrado(res);
      if (!cuerpo.success) return void sinProblemas(res, problemasDeZod(cuerpo.error));
      const a = await cargar(id.data);
      if (!a) return void noEncontrado(res);
      if (a.estado === "BORRADOR") return void res.status(409).json({ estado: "error", mensaje: "Este artículo es un borrador: se publica entero, no por cambios." });
      if (!a.borrador) return void res.status(409).json({ estado: "error", mensaje: "No hay cambios sin publicar." });
      const cambioElArticulo = a.actualizadoEn > a.borrador.baseVersion;
      if (iso(versionVigente(a)) !== cuerpo.data.version || cambioElArticulo) return void conflicto(res, versionVigente(a));

      const parseo = DatosSchema.safeParse(datosDelBorrador(a));
      if (!parseo.success) return void sinProblemas(res, problemasDeZod(parseo.error));
      const datos = parseo.data;
      const problemas = await problemasParaPublicar(prisma, a, datos, { esNuevo: false });
      if (problemas.length > 0) return void sinProblemas(res, problemas);

      const nuevaVersion = await prisma.$transaction(async (tx) => {
        // La dirección y la fecha no cambian con los cambios (no se editan en un publicado).
        const { slug: _slug, ...sinSlug } = datos;
        // Lo editó quien hizo los cambios sin publicar (si se sabe); lo publica quien aprieta el botón.
        const version = await escribirDatos(tx, a.id, a.actualizadoEn, sinSlug, { editadoPorId: a.borrador?.usuarioId ?? req.usuario!.id, publicadoPorId: req.usuario!.id });
        await tx.articuloBorrador.deleteMany({ where: { articuloId: a.id } });
        return version;
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", version: iso(nuevaVersion) });
    } catch (e) {
      if (e instanceof Conflicto) return void conflicto(res);
      next(e);
    }
  });

  // ---------- Despublicar (o cancelar la programación) ----------
  router.post("/articulos/:id/despublicar", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = IdSchema.safeParse(req.params["id"]);
      const cuerpo = CuerpoVersionSchema.safeParse(req.body);
      if (!id.success) return void noEncontrado(res);
      if (!cuerpo.success) return void sinProblemas(res, problemasDeZod(cuerpo.error));
      const a = await cargar(id.data);
      if (!a) return void noEncontrado(res);
      if (a.estado === "BORRADOR") return void res.status(409).json({ estado: "error", mensaje: "Este artículo no está publicado." });
      if (a.borrador) return void sinProblemas(res, ["Este artículo tiene cambios sin publicar. Publicalos o descartalos antes de despublicarlo."]);
      if (iso(a.actualizadoEn) !== cuerpo.data.version) return void conflicto(res, a.actualizadoEn);

      // Se conservan la dirección y la fecha: al volver a publicarlo sale en la misma URL.
      const r = await prisma.articulo.updateMany({ where: { id: a.id, actualizadoEn: a.actualizadoEn }, data: { estado: "BORRADOR" } });
      if (r.count !== 1) return void conflicto(res);
      const { actualizadoEn } = await prisma.articulo.findUniqueOrThrow({ where: { id: a.id }, select: { actualizadoEn: true } });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", version: iso(actualizadoEn) });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
