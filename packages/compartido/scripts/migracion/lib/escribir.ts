// Escritura de la migración en el CMS. Este es el ÚNICO archivo que crea un cliente de Prisma con permiso de escritura, y migrar.ts no lo
// importa (ni directa ni indirectamente): en este tramo el CLI no puede escribir. Solo los tests lo usan, y solo contra DESTINO_PRUEBAS.
//
// La conexión de escritura se abre con abrirConexionEscritura(destino), que recibe uno de los dos destinos constantes de destinos.ts (la
// identidad del objeto, no una copia con los mismos valores). De la variable DATABASE_URL solo se toman el usuario y la clave.
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "../../../src/generated/prisma/client.js";
import type { Plan } from "./armar.ts";
import { DESTINO_PRUEBAS, DESTINO_REAL, ESCRITURA_REAL_HABILITADA } from "./destinos.ts";
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
