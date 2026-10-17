// Escritura de la migración en el CMS. Este es el ÚNICO archivo que crea un cliente de Prisma con permiso de escritura, y migrar.ts no lo
// importa (ni directa ni indirectamente): en este tramo el CLI no puede escribir. Solo los tests lo usan, y solo contra DESTINO_PRUEBAS.
//
// La conexión de escritura se abre con abrirConexionEscritura(destino), que recibe uno de los dos destinos constantes de destinos.ts (la
// identidad del objeto, no una copia con los mismos valores). De la variable DATABASE_URL solo se toman el usuario y la clave.
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "../../../src/generated/prisma/client.js";
import type { DocNode } from "../../../src/conversor/types.ts";
import { validateArticleBodyDetallado } from "../../../src/schema/validate.ts";
import { validarDestinoUnico } from "./armar.ts";
import type { Plan, RedirecionPlan, RegistroArticulo } from "./armar.ts";
import { DESTINO_PRUEBAS, DESTINO_REAL, ESCRITURA_REAL_HABILITADA } from "./destinos.ts";
import { nodosImagen, reescribirImagenes } from "./enlaces-imagenes.ts";
import { num, str } from "./utilidades.ts";

export type DestinoEscritura = typeof DESTINO_REAL | typeof DESTINO_PRUEBAS;

/** Versión mayor.menor que tiene que informar el servidor. */
const VERSION_SERVIDOR = "8.4";

/**
 * Decide si se puede abrir una conexión de escritura contra `destino`. Solo acepta las dos constantes de destinos.ts (por identidad):
 * un objeto con los mismos valores, un texto o una URL se rechazan. El destino real se niega mientras ESCRITURA_REAL_HABILITADA sea false.
 */
export function elegirDestinoEscritura(destino: unknown): DestinoEscritura {
  if (destino !== DESTINO_REAL && destino !== DESTINO_PRUEBAS) throw new Error("Destino de escritura no permitido: solo se aceptan DESTINO_REAL y DESTINO_PRUEBAS");
  if (destino === DESTINO_REAL && !ESCRITURA_REAL_HABILITADA) throw new Error("La escritura en el destino real está deshabilitada (ESCRITURA_REAL_HABILITADA = false)");
  return destino as DestinoEscritura;
}

/** Usuario y clave de DATABASE_URL. El host, el puerto y la base no se leen de ahí. */
function credenciales(): { user: string; password: string } {
  const texto = process.env["DATABASE_URL"];
  if (!texto) throw new Error("Falta DATABASE_URL en el entorno (de ahí se toman el usuario y la clave)");
  let u: URL;
  try { u = new URL(texto); } catch { throw new Error("DATABASE_URL no es una URL válida"); }
  if (u.protocol !== "mysql:" || !u.username) throw new Error("DATABASE_URL no trae un usuario de MySQL");
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

export interface ServidorEscritura { puerto: number; base: string; version: string; soloLectura: number }

export interface ConexionEscritura {
  prisma: PrismaClient;
  destino: DestinoEscritura;
  servidor: ServidorEscritura;
  cerrar: () => Promise<void>;
}

/** Comprueba lo que dice el servidor: puerto, base, MySQL 8.4.x y sesión escribible. Lanza si algo no coincide. */
export function verificarServidorEscritura(s: ServidorEscritura, destino: DestinoEscritura): ServidorEscritura {
  const problemas: string[] = [];
  if (s.puerto !== destino.puerto) problemas.push(`@@port = ${s.puerto}`);
  if (s.base !== destino.base) problemas.push(`DATABASE() = ${s.base || "NULL"}`);
  if (s.version !== VERSION_SERVIDOR && !s.version.startsWith(`${VERSION_SERVIDOR}.`)) problemas.push(`@@version = ${s.version}`);
  if (s.soloLectura !== 0) problemas.push(`@@session.transaction_read_only = ${s.soloLectura}`);
  if (problemas.length) throw new Error(`El servidor de escritura no es el esperado (${problemas.join("; ")}): se aborta`);
  return s;
}

/** Abre el cliente con escritura. Tras conectar comprueba @@port, DATABASE(), la versión y @@session.transaction_read_only = 0. */
export async function abrirConexionEscritura(destino: unknown): Promise<ConexionEscritura> {
  const elegido = elegirDestinoEscritura(destino);
  const { user, password } = credenciales();
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb({ host: elegido.host, port: elegido.puerto, user, password, database: elegido.base, connectionLimit: 3 }) });
  try {
    const [f] = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT @@port AS puerto, DATABASE() AS base, @@version AS version, @@session.transaction_read_only AS ro`;
    const servidor = verificarServidorEscritura({ puerto: num(f?.["puerto"]), base: str(f?.["base"]), version: str(f?.["version"]), soloLectura: num(f?.["ro"]) }, elegido);
    return { prisma, destino: elegido, servidor, cerrar: () => prisma.$disconnect() };
  } catch (e) {
    await prisma.$disconnect();
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Base de la escritura: categorías, autores e imágenes (en ese orden)
// ---------------------------------------------------------------------------------------------------------------
export interface ConflictoEscritura { tabla: string; clave: string; detalle: unknown }

export interface ResultadoBase {
  categorias: { enElPlan: number; creadas: number; existentes: number };
  autores: { enElPlan: number; creados: number; existentes: number; conflictos: number };
  imagenes: { enElPlan: number; creadas: number; existentes: number; conflictos: number };
  conflictos: ConflictoEscritura[];
  /** Artículos que no se escriben porque dependen de algo en conflicto (wpId -> motivo). */
  fallidos: Map<number, string>;
  /** id de la fila por clave natural, de lo que se escribió (o ya existía con esa clave). */
  idsCategorias: Map<string, number>;
  idsAutores: Map<number, number>;
  idsImagenes: Map<number, number>;
}

/**
 * Escribe categorías (upsert por slug con update vacío), autores (upsert por wpUserId) e imágenes (upsert por wpId).
 * `bioConCorreo` del plan no es una columna: no se escribe. Una clave de imagen o un slug de autor que ya pertenecen a otra fila no se pisan:
 * se reportan como conflicto y los artículos que dependen de eso quedan como fallidos.
 */
export async function escribirBase(prisma: PrismaClient, plan: Plan): Promise<ResultadoBase> {
  const r: ResultadoBase = {
    categorias: { enElPlan: plan.categoriasACrear.length, creadas: 0, existentes: 0 },
    autores: { enElPlan: plan.autores.length, creados: 0, existentes: 0, conflictos: 0 },
    imagenes: { enElPlan: plan.imagenes.length, creadas: 0, existentes: 0, conflictos: 0 },
    conflictos: [], fallidos: new Map(), idsCategorias: new Map(), idsAutores: new Map(), idsImagenes: new Map(),
  };

  // 1. categorías (el nombre sale del mapeo; sin nombre no hay categoría: el plan lo marca como bloqueante)
  for (const c of plan.categoriasACrear) {
    if (c.nombre === null) throw new Error(`La categoría ${c.slug} no tiene nombre en el mapeo`);
    const existia = (await prisma.categoria.findUnique({ where: { slug: c.slug }, select: { id: true } })) !== null;
    const fila = await prisma.categoria.upsert({ where: { slug: c.slug }, update: {}, create: { slug: c.slug, nombre: c.nombre }, select: { id: true } });
    r.idsCategorias.set(c.slug, fila.id);
    if (existia) r.categorias.existentes++; else r.categorias.creadas++;
  }

  // 2. autores
  for (const a of plan.autores) {
    const mismoSlug = await prisma.autor.findUnique({ where: { slug: a.slug }, select: { id: true, wpUserId: true } });
    if (mismoSlug && mismoSlug.wpUserId !== a.wpUserId) {
      r.autores.conflictos++;
      r.conflictos.push({ tabla: "autores", clave: a.slug, detalle: { wpUserId: a.wpUserId, existente: { id: mismoSlug.id, wpUserId: mismoSlug.wpUserId } } });
      for (const wpId of a.articulosEnMuestra) r.fallidos.set(wpId, `el slug de autor "${a.slug}" ya pertenece a otra fila`);
      continue;
    }
    const existia = (await prisma.autor.findUnique({ where: { wpUserId: a.wpUserId }, select: { id: true } })) !== null;
    const bio = a.bio === null || a.bio === undefined ? Prisma.DbNull : (a.bio as Prisma.InputJsonValue);
    const datos = { slug: a.slug, nombre: a.nombre, soloTexto: a.soloTexto, bio };
    const fila = await prisma.autor.upsert({ where: { wpUserId: a.wpUserId }, update: datos, create: { wpUserId: a.wpUserId, ...datos }, select: { id: true } });
    r.idsAutores.set(a.wpUserId, fila.id);
    if (existia) r.autores.existentes++; else r.autores.creados++;
  }

  // 3. imágenes
  for (const i of plan.imagenes) {
    const mismaClave = await prisma.imagen.findUnique({ where: { clave: i.clave }, select: { id: true, wpId: true } });
    if (mismaClave && mismaClave.wpId !== i.wpId) {
      r.imagenes.conflictos++;
      r.conflictos.push({ tabla: "imagenes", clave: i.clave, detalle: { wpId: i.wpId, existente: { id: mismaClave.id, wpId: mismaClave.wpId } } });
      for (const wpId of i.articulos) r.fallidos.set(wpId, `la clave de imagen "${i.clave}" ya pertenece a otro wpId (${mismaClave.wpId ?? "ninguno"})`);
      continue;
    }
    const existia = (await prisma.imagen.findUnique({ where: { wpId: i.wpId }, select: { id: true } })) !== null;
    const datos = { clave: i.clave, nombreOriginal: i.nombreOriginal, tipoMime: i.tipoMime, ancho: i.ancho, alto: i.alto, bytes: i.bytes, hash: i.hash };
    const fila = await prisma.imagen.upsert({ where: { wpId: i.wpId }, update: datos, create: { wpId: i.wpId, ...datos }, select: { id: true } });
    r.idsImagenes.set(i.wpId, fila.id);
    if (existia) r.imagenes.existentes++; else r.imagenes.creadas++;
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Artículos, relaciones y redirecciones
// ---------------------------------------------------------------------------------------------------------------
/** Tiempo máximo de la transacción de un artículo. */
export const TIMEOUT_ARTICULO_MS = 30_000;

export interface OpcionesEscritura {
  /** Corta en el primer artículo que falla (no se escriben los siguientes ni las redirecciones de autor). */
  abortarAlPrimerError: boolean;
}

/** Solo para los tests: se llama dentro de la transacción del artículo, después de escribir todo y antes de confirmar. */
export interface DependenciasEscritura {
  alFinalDelArticulo?: (wpId: number, tx: Prisma.TransactionClient) => Promise<void> | void;
}

export interface ResultadoArticulo {
  wpId: number;
  slug: string;
  resultado: "escrito" | "omitido" | "fallido";
  /** "ya existe (sin comparar)" para los omitidos; el motivo del error para los fallidos. */
  motivo?: string;
}

export interface ResultadoEscritura {
  /** "error" si algún artículo falló (se deshizo solo ese artículo); "ok" si no. Los conflictos de redirección no cambian el estado: se listan aparte. */
  estado: "ok" | "error";
  abortado: boolean;
  base: ResultadoBase;
  articulos: ResultadoArticulo[];
  conteos: { escritos: number; omitidos: number; fallidos: number };
  redirecciones: { creadas: number; conflictos: number };
  conflictos: ConflictoEscritura[];
}

/**
 * Reemplaza `imagenWpId` por `imagenId` (id de la fila de imagenes con ese wpId) en cada nodo imagen del cuerpo y quita `imagenWpId`.
 * Un nodo que apunta a un adjunto sin fila es un error del artículo. Los nodos sin `imagenWpId` (sin original) quedan como están.
 */
export function enlazarImagenesDelCuerpo(cuerpo: DocNode, idDe: (wpId: number) => number | undefined): DocNode {
  return reescribirImagenes(cuerpo, (attrs) => {
    if (!("imagenWpId" in attrs)) return attrs;
    const { imagenWpId, ...resto } = attrs;
    const id = typeof imagenWpId === "number" ? idDe(imagenWpId) : undefined;
    if (id === undefined) throw new Error(`el cuerpo apunta al adjunto ${JSON.stringify(imagenWpId)}, que no tiene fila en imagenes`);
    return { ...resto, imagenId: id };
  });
}

/** El cuerpo que se guarda: sin ningún imagenWpId y válido para el validador en modo migración. Lanza si no. */
export function cuerpoParaGuardar(cuerpo: DocNode, idDe: (wpId: number) => number | undefined): DocNode {
  const enlazado = enlazarImagenesDelCuerpo(cuerpo, idDe);
  if (nodosImagen(enlazado).some((n) => "imagenWpId" in (n.attrs ?? {}))) throw new Error("el cuerpo conserva un imagenWpId");
  const { errores } = validateArticleBodyDetallado(enlazado as never, { modo: "migracion" });
  if (errores.length) throw new Error(`el cuerpo no valida (${errores.length}): ${errores.slice(0, 3).join(" | ")}`);
  return enlazado;
}

const json = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));
const fecha = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

async function crearRedireccion(tx: Prisma.TransactionClient, r: RedirecionPlan, destino: { articuloId?: number; autorId?: number }, conflictos: ConflictoEscritura[]): Promise<boolean> {
  const motivo = validarDestinoUnico({ articuloId: destino.articuloId, autorId: destino.autorId, destino: r.destino });
  if (motivo) throw new Error(`${r.origen}: ${motivo}`);
  const existente = await tx.redireccion.findUnique({ where: { origen: r.origen }, select: { id: true, tipo: true, articuloId: true, autorId: true, destino: true } });
  if (existente) {
    conflictos.push({ tabla: "redirecciones", clave: r.origen, detalle: { tipoDelPlan: r.tipo, existente } });
    return false;
  }
  await tx.redireccion.create({ data: { origen: r.origen, tipo: r.tipo, codigo: r.codigo, articuloId: destino.articuloId ?? null, autorId: destino.autorId ?? null, destino: r.destino } });
  return true;
}

/** Una transacción por artículo. Devuelve el resultado y lo que dejó por reportar (solo si la transacción se confirmó). */
async function escribirArticulo(prisma: PrismaClient, a: RegistroArticulo, base: ResultadoBase, deps: DependenciasEscritura) {
  const conflictos: ConflictoEscritura[] = [];
  let creadas = 0;
  const resultado = await prisma.$transaction(async (tx) => {
    if ((await tx.articulo.findUnique({ where: { wpId: a.wpId }, select: { id: true } })) !== null) return "omitido" as const;

    const seccion = await tx.seccion.findUnique({ where: { slug: a.seccion }, select: { id: true } });
    if (!seccion) throw new Error(`la sección "${a.seccion}" no existe`);
    const idCategoria = async (slug: string) => {
      const id = base.idsCategorias.get(slug) ?? (await tx.categoria.findUnique({ where: { slug }, select: { id: true } }))?.id;
      if (id === undefined) throw new Error(`la categoría "${slug}" no existe`);
      return id;
    };
    const categoriaIds = [...new Set(await Promise.all(a.categorias.map(idCategoria)))];
    const categoriaPrincipalId = a.categoriaPrincipal === null ? null : await idCategoria(a.categoriaPrincipal);
    const autorIds = await Promise.all(a.autores.map(async (x) => {
      const id = base.idsAutores.get(x.wpUserId) ?? (await tx.autor.findUnique({ where: { wpUserId: x.wpUserId }, select: { id: true } }))?.id;
      if (id === undefined) throw new Error(`el autor ${x.wpUserId} no tiene fila`);
      return { autorId: id, orden: x.orden };
    }));

    // imágenes: los ids salen de las filas de imagenes (por wpId), nunca se inventan
    const idsImagen = new Map<number, number>();
    const wpIds = new Set<number>([
      ...(a.encabezadoAdjuntoWpId !== null ? [a.encabezadoAdjuntoWpId] : []),
      ...(a.redesImagenWpId !== null ? [a.redesImagenWpId] : []),
      ...nodosImagen(a.cuerpo).flatMap((n) => (typeof n.attrs?.["imagenWpId"] === "number" ? [n.attrs["imagenWpId"] as number] : [])),
    ]);
    for (const wpId of wpIds) {
      const id = base.idsImagenes.get(wpId) ?? (await tx.imagen.findUnique({ where: { wpId }, select: { id: true } }))?.id;
      if (id !== undefined) idsImagen.set(wpId, id);
    }
    const cuerpo = cuerpoParaGuardar(a.cuerpo as DocNode, (wpId) => idsImagen.get(wpId));

    const creado = await tx.articulo.create({
      data: {
        wpId: a.wpId, slug: a.slug, titulo: a.titulo, bajada: a.bajada, cuerpo: cuerpo as unknown as Prisma.InputJsonValue, schemaVersion: a.schemaVersion, textoPlano: a.textoPlano,
        estado: a.estado as "PUBLICADO" | "BORRADOR", publicadoEn: fecha(a.publicadoEn), novedadHasta: fecha(a.novedadHasta),
        seccionId: seccion.id, categoriaPrincipalId, etiquetasWp: json(a.etiquetasWp), avisosMigracion: json(a.avisosMigracion), visitasWp: a.visitasWp,
        imagenEncabezadoId: a.encabezadoAdjuntoWpId === null ? null : idsImagen.get(a.encabezadoAdjuntoWpId) ?? null,
        encabezadoAlt: a.encabezadoAlt, encabezadoCredito: a.encabezadoCredito, encabezadoPuntoFocalX: a.encabezadoPuntoFocalX, encabezadoPuntoFocalY: a.encabezadoPuntoFocalY,
        redesDescripcion: a.redesDescripcion, redesImagenId: a.redesImagenWpId === null ? null : idsImagen.get(a.redesImagenWpId) ?? null,
        altPendientes: a.altPendientes,
      },
      select: { id: true },
    });

    // relaciones: se sincronizan con lo que dice el plan (en un artículo nuevo no hay nada que borrar)
    await tx.articuloCategoria.deleteMany({ where: { articuloId: creado.id } });
    await tx.articuloCategoria.createMany({ data: categoriaIds.map((categoriaId) => ({ articuloId: creado.id, categoriaId })) });
    await tx.articuloAutor.deleteMany({ where: { articuloId: creado.id } });
    await tx.articuloAutor.createMany({ data: autorIds.map((x) => ({ articuloId: creado.id, ...x })) });
    await tx.galeriaItem.deleteMany({ where: { articuloId: creado.id } });
    await tx.galeriaItem.createMany({ data: [] });

    for (const r of a.redirecciones) if (await crearRedireccion(tx, r, { articuloId: creado.id }, conflictos)) creadas++;
    await deps.alFinalDelArticulo?.(a.wpId, tx);
    return "escrito" as const;
  }, { timeout: TIMEOUT_ARTICULO_MS, maxWait: TIMEOUT_ARTICULO_MS });
  return { resultado, conflictos, creadas };
}

/**
 * Escribe todo el plan: categorías, autores e imágenes (escribirBase), después una transacción por artículo y al final las redirecciones
 * de autor. En este tramo, un artículo cuyo wpId ya existe se omite ("ya existe (sin comparar)"). Si un artículo falla se deshace solo
 * ese artículo, se reporta y la corrida sigue; con `abortarAlPrimerError` corta ahí. El estado devuelto es "error" si hubo algún fallido.
 */
export async function escribirPlan(prisma: PrismaClient, plan: Plan, opciones: OpcionesEscritura, deps: DependenciasEscritura = {}): Promise<ResultadoEscritura> {
  const base = await escribirBase(prisma, plan);
  const articulos: ResultadoArticulo[] = [];
  const conflictos: ConflictoEscritura[] = [...base.conflictos];
  const redirecciones = { creadas: 0, conflictos: 0 };
  let abortado = false;

  for (const a of plan.articulos) {
    const dependencia = base.fallidos.get(a.wpId);
    if (dependencia !== undefined) {
      articulos.push({ wpId: a.wpId, slug: a.slug, resultado: "fallido", motivo: dependencia });
    } else {
      try {
        const r = await escribirArticulo(prisma, a, base, deps);
        conflictos.push(...r.conflictos);
        redirecciones.creadas += r.creadas;
        redirecciones.conflictos += r.conflictos.length;
        articulos.push({ wpId: a.wpId, slug: a.slug, resultado: r.resultado, ...(r.resultado === "omitido" ? { motivo: "ya existe (sin comparar)" } : {}) });
        continue;
      } catch (e) {
        articulos.push({ wpId: a.wpId, slug: a.slug, resultado: "fallido", motivo: e instanceof Error ? e.message : String(e) });
      }
    }
    if (opciones.abortarAlPrimerError) { abortado = true; break; }
  }

  // redirecciones de autor, al final (no se escriben si se abortó)
  if (!abortado) {
    for (const r of plan.redirecciones.filter((x) => x.tipo === "AUTOR")) {
      const autorId = r.autorWpUserId === null ? undefined : base.idsAutores.get(r.autorWpUserId);
      if (autorId === undefined) {
        conflictos.push({ tabla: "redirecciones", clave: r.origen, detalle: { motivo: "el autor no tiene fila (en conflicto o sin escribir)", autorWpUserId: r.autorWpUserId } });
        redirecciones.conflictos++;
        continue;
      }
      const delAutor: ConflictoEscritura[] = [];
      if (await prisma.$transaction((tx) => crearRedireccion(tx, r, { autorId }, delAutor), { timeout: TIMEOUT_ARTICULO_MS })) redirecciones.creadas++;
      conflictos.push(...delAutor);
      redirecciones.conflictos += delAutor.length;
    }
  }

  const conteos = {
    escritos: articulos.filter((x) => x.resultado === "escrito").length,
    omitidos: articulos.filter((x) => x.resultado === "omitido").length,
    fallidos: articulos.filter((x) => x.resultado === "fallido").length,
  };
  return { estado: conteos.fallidos > 0 ? "error" : "ok", abortado, base, articulos, conteos, redirecciones, conflictos };
}
