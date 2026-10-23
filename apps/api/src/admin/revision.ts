import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import { tienePermiso } from "@evaristo/compartido/permisos";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { estadoEfectivo } from "./estado.js";

// Herramientas para revisar lo que dejó la migración desde WordPress (editores y administradores). Decisiones del 23/10/2026:
//  - Un aviso se marca como «revisado» guardando quién y cuándo (`articulos.avisosRevisados`); el aviso original no se borra, así que se puede
//    deshacer. Los avisos revisados salen de la cola; los de imágenes sin texto alternativo no se marcan: dejan de contar cuando se completan.
//  - Asignar la sección a un artículo de «Sin asignar» se hace desde la lista, sin abrirlo.
//  - Solo el administrador elimina un borrador migrado.
// Ninguna de estas acciones cambia la versión (`actualizadoEn`) del artículo: quien lo está editando no tiene un conflicto por esto.

export const ARTICULOS_REVISION_POR_PAGINA = 25;

const ETIQUETAS: Record<string, string> = {
  palabra_ambigua: "Palabra ambigua en el título",
  palabra_desconocida: "Palabra desconocida en el título",
  revisar_autor_en_titulo: "Posible autor dentro del título",
  titulo_vacio: "Título vacío",
  marca_sin_nota: "Marca de nota al pie sin su nota",
  nota_sin_marca: "Nota al pie sin su marca en el texto",
  nota_duplicada: "Nota al pie repetida",
  imagen_cuerpo_inconsistente: "Imagen del texto con datos inconsistentes",
  bio_con_correo: "Bio con un correo electrónico",
  original_faltante: "Imagen cuyo original falta",
  imagen_sin_medir: "Imagen sin medidas",
  origen_privado: "Era privado en WordPress",
  fecha_borrador: "Borrador sin fecha de WordPress",
  u200e_removido: "Se quitó una marca invisible del texto",
  validador: "El validador del texto marcó algo",
};
export const etiquetaDeAviso = (codigo: string): string => ETIQUETAS[codigo] ?? codigo;

/** Los códigos de aviso de un artículo, sin repetir. Las cuatro listas de `avisosMigracion` tienen formas distintas. */
export function codigosDeAvisos(avisos: unknown): string[] {
  if (typeof avisos !== "object" || avisos === null) return [];
  const a = avisos as Record<string, unknown>;
  const codigos = new Set<string>();
  const deObjetos = (lista: unknown) => {
    for (const e of Array.isArray(lista) ? lista : []) if (typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string") codigos.add((e as { code: string }).code);
  };
  deObjetos(a["cuerpo"]);
  deObjetos(a["migracion"]);
  // titulo: "codigo:detalle" (por ejemplo "palabra_ambigua:SEDA")
  for (const e of Array.isArray(a["titulo"]) ? a["titulo"] : []) if (typeof e === "string" && e) codigos.add(e.split(":")[0]!);
  if (Array.isArray(a["validador"]) && a["validador"].length > 0) codigos.add("validador");
  return [...codigos];
}

type Revisados = Record<string, { por: number; nombre: string; en: string }>;
const revisadosDe = (valor: unknown): Revisados => (typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Revisados) : {});

const Id = z.coerce.number().int().positive();

export function crearRutasAdminRevision(prisma: PrismaClient): express.Router {
  const router = express.Router();
  const noEncontrado = (res: Response): void => void res.status(404).json({ estado: "error", mensaje: "No encontramos ese artículo." });

  /** Todos los artículos con avisos: id, códigos y cuáles ya se revisaron. Son pocos miles de filas chicas. */
  async function artículosConAvisos() {
    const filas = await prisma.articulo.findMany({ where: { avisosMigracion: { not: Prisma.DbNull } }, select: { id: true, avisosMigracion: true, avisosRevisados: true } });
    return filas.map((f) => {
      const revisados = revisadosDe(f.avisosRevisados);
      const codigos = codigosDeAvisos(f.avisosMigracion);
      return { id: f.id, pendientes: codigos.filter((c) => !revisados[c]), revisados: codigos.filter((c) => revisados[c]) };
    });
  }

  // ---------- Tablero: cuánto hay por revisar ----------
  router.get("/revision/resumen", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [conAvisos, altPendientes, sinAsignar, sinAutor, borradoresMigrados, secciones] = await Promise.all([
        artículosConAvisos(),
        prisma.articulo.count({ where: { altPendientes: { gt: 0 } } }),
        prisma.articulo.count({ where: { seccion: { interna: true } } }),
        prisma.articulo.count({ where: { autores: { none: {} } } }),
        prisma.articulo.count({ where: { wpId: { not: null }, estado: "BORRADOR" } }),
        prisma.seccion.findMany({ orderBy: [{ interna: "asc" }, { orden: "asc" }, { id: "asc" }], select: { id: true, nombre: true, interna: true, _count: { select: { articulos: true } } } }),
      ]);
      const porCodigo = new Map<string, { pendientes: number; revisados: number }>();
      for (const a of conAvisos) {
        for (const c of a.pendientes) porCodigo.set(c, { pendientes: (porCodigo.get(c)?.pendientes ?? 0) + 1, revisados: porCodigo.get(c)?.revisados ?? 0 });
        for (const c of a.revisados) porCodigo.set(c, { pendientes: porCodigo.get(c)?.pendientes ?? 0, revisados: (porCodigo.get(c)?.revisados ?? 0) + 1 });
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        avisos: [...porCodigo.entries()].map(([codigo, n]) => ({ codigo, etiqueta: etiquetaDeAviso(codigo), ...n })).sort((a, b) => b.pendientes - a.pendientes || a.codigo.localeCompare(b.codigo)),
        altPendientes,
        sinAsignar,
        sinAutor,
        borradoresMigrados,
        secciones: secciones.map((s) => ({ id: s.id, nombre: s.nombre, interna: s.interna, articulos: s._count.articulos })),
      });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Lista de artículos a revisar, con filtros ----------
  const ConsultaSchema = z.object({
    filtro: z
      .string()
      .max(80)
      .regex(/^(alt|sin-asignar|sin-autor|borrador-migrado|(aviso|revisado):[a-z0-9_]+|(seccion|autor):\d+)$/, "El filtro no es válido.")
      .optional(),
    q: z.string().trim().max(100).optional(),
    pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  });

  router.get("/revision/articulos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const consulta = ConsultaSchema.safeParse(req.query);
      if (!consulta.success) return void res.status(400).json({ estado: "error", mensaje: "Los filtros de la lista no son válidos." });
      const { filtro, q, pagina } = consulta.data;
      let donde: Prisma.ArticuloWhereInput = {};
      if (filtro === "alt") donde = { altPendientes: { gt: 0 } };
      else if (filtro === "sin-asignar") donde = { seccion: { interna: true } };
      else if (filtro === "sin-autor") donde = { autores: { none: {} } };
      else if (filtro === "borrador-migrado") donde = { wpId: { not: null }, estado: "BORRADOR" };
      else if (filtro?.startsWith("seccion:")) donde = { seccionId: Number(filtro.slice(8)) };
      else if (filtro?.startsWith("autor:")) donde = { autores: { some: { autorId: Number(filtro.slice(6)) } } };
      else if (filtro?.startsWith("aviso:") || filtro?.startsWith("revisado:")) {
        const [tipo, codigo] = filtro.split(":") as ["aviso" | "revisado", string];
        const ids = (await artículosConAvisos()).filter((a) => (tipo === "aviso" ? a.pendientes : a.revisados).includes(codigo)).map((a) => a.id);
        donde = { id: { in: ids } };
      }
      if (q) donde = { AND: [donde, { titulo: { contains: q } }] };

      const ahora = new Date();
      const [total, filas] = await Promise.all([
        prisma.articulo.count({ where: donde }),
        prisma.articulo.findMany({
          where: donde,
          orderBy: [{ id: "asc" }],
          skip: (pagina - 1) * ARTICULOS_REVISION_POR_PAGINA,
          take: ARTICULOS_REVISION_POR_PAGINA,
          select: {
            id: true,
            wpId: true,
            slug: true,
            titulo: true,
            estado: true,
            publicadoEn: true,
            altPendientes: true,
            avisosMigracion: true,
            avisosRevisados: true,
            seccion: { select: { id: true, nombre: true, interna: true } },
            autores: { orderBy: { orden: "asc" }, select: { autor: { select: { nombre: true } } } },
          },
        }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        estado: "ok",
        total,
        pagina,
        paginas: Math.max(1, Math.ceil(total / ARTICULOS_REVISION_POR_PAGINA)),
        articulos: filas.map((a) => {
          const revisados = revisadosDe(a.avisosRevisados);
          return {
            id: a.id,
            wpId: a.wpId,
            titulo: a.titulo,
            estado: estadoEfectivo(a.estado, a.publicadoEn, ahora),
            publicadoEn: a.publicadoEn,
            altPendientes: a.altPendientes,
            seccion: a.seccion,
            autores: a.autores.map((x) => x.autor.nombre),
            avisos: codigosDeAvisos(a.avisosMigracion).map((codigo) => ({ codigo, etiqueta: etiquetaDeAviso(codigo), revisado: !!revisados[codigo], por: revisados[codigo]?.nombre ?? null, en: revisados[codigo]?.en ?? null })),
            ruta: a.estado === "PUBLICADO" && a.publicadoEn && a.publicadoEn <= ahora ? rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn }) : null,
          };
        }),
      });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Marcar (o desmarcar) un aviso como revisado ----------
  const RevisarSchema = z.object({ codigo: z.string().min(1).max(80), revisado: z.boolean() }).strict();
  router.post("/articulos/:id/avisos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!tienePermiso(req.usuario!.rol, "revision.usar")) return void res.status(403).json({ estado: "error", mensaje: "No tenés permiso para hacer esto." });
      const id = Id.safeParse(req.params["id"]);
      const cuerpo = RevisarSchema.safeParse(req.body);
      if (!cuerpo.success) return void res.status(422).json({ estado: "error", mensaje: "Elegí el aviso que querés marcar." });
      const a = id.success ? await prisma.articulo.findUnique({ where: { id: id.data }, select: { id: true, avisosMigracion: true, avisosRevisados: true } }) : null;
      if (!a) return void noEncontrado(res);
      if (!codigosDeAvisos(a.avisosMigracion).includes(cuerpo.data.codigo)) return void res.status(422).json({ estado: "error", mensaje: "Ese aviso no corresponde a este artículo." });
      const revisados = { ...revisadosDe(a.avisosRevisados) };
      if (cuerpo.data.revisado) revisados[cuerpo.data.codigo] = { por: req.usuario!.id, nombre: req.usuario!.nombre, en: new Date().toISOString() };
      else delete revisados[cuerpo.data.codigo];
      const json = Object.keys(revisados).length ? JSON.stringify(revisados) : null;
      // UPDATE directo con `actualizadoEn = actualizadoEn`: marcar un aviso no cambia la versión del artículo (nadie tiene un conflicto por esto).
      await prisma.$executeRaw`UPDATE articulos SET avisosRevisados = CAST(${json} AS JSON), actualizadoEn = actualizadoEn WHERE id = ${a.id}`;
      res.json({ estado: "ok", revisado: cuerpo.data.revisado, por: cuerpo.data.revisado ? req.usuario!.nombre : null });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Asignar la sección a un artículo de «Sin asignar» ----------
  const SeccionSchema = z.object({ seccionId: z.number().int().positive() }).strict();
  router.post("/articulos/:id/seccion", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!tienePermiso(req.usuario!.rol, "revision.usar")) return void res.status(403).json({ estado: "error", mensaje: "No tenés permiso para hacer esto." });
      const id = Id.safeParse(req.params["id"]);
      const cuerpo = SeccionSchema.safeParse(req.body);
      if (!cuerpo.success) return void res.status(422).json({ estado: "error", mensaje: "Elegí una sección." });
      const a = id.success ? await prisma.articulo.findUnique({ where: { id: id.data }, select: { id: true, seccion: { select: { interna: true } }, borrador: { select: { datos: true } } } }) : null;
      if (!a) return void noEncontrado(res);
      if (!a.seccion.interna) return void res.status(409).json({ estado: "error", mensaje: "Este artículo ya tiene una sección. Para cambiarla, abrilo y editalo." });
      const destino = await prisma.seccion.findUnique({ where: { id: cuerpo.data.seccionId }, select: { id: true, nombre: true, interna: true } });
      if (!destino || destino.interna) return void res.status(422).json({ estado: "error", mensaje: "Elegí una sección de la lista." });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE articulos SET seccionId = ${destino.id}, actualizadoEn = actualizadoEn WHERE id = ${a.id}`;
        // Si tiene cambios sin publicar que todavía dicen «Sin asignar», también los pone en la sección elegida.
        const datos = a.borrador?.datos as Record<string, unknown> | null | undefined;
        if (datos && typeof datos["seccionId"] === "number" && datos["seccionId"] !== destino.id) await tx.articuloBorrador.updateMany({ where: { articuloId: a.id }, data: { datos: { ...datos, seccionId: destino.id } as unknown as Prisma.InputJsonValue } });
      });
      res.json({ estado: "ok", seccion: { id: destino.id, nombre: destino.nombre, interna: false } });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Eliminar un borrador (solo administrador) ----------
  router.delete("/articulos/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!tienePermiso(req.usuario!.rol, "articulos.eliminar")) return void res.status(403).json({ estado: "error", mensaje: "No tenés permiso para hacer esto." });
      const id = Id.safeParse(req.params["id"]);
      const a = id.success ? await prisma.articulo.findUnique({ where: { id: id.data }, select: { id: true, titulo: true, estado: true } }) : null;
      if (!a) return void noEncontrado(res);
      if (a.estado !== "BORRADOR") return void res.status(409).json({ estado: "error", mensaje: "Solo se pueden eliminar borradores. Un artículo publicado se despublica primero." });
      // Las imágenes quedan en la biblioteca; la galería, la ficha, los cambios sin publicar y las redirecciones del artículo se borran con él.
      await prisma.articulo.delete({ where: { id: a.id } });
      res.json({ estado: "ok" });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
