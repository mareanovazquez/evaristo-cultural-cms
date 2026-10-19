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
import { totalSobrescritura } from "./confirmaciones.ts";
import type { IdsSobrescritura } from "./confirmaciones.ts";
import { credencialesDeUrl } from "./credenciales.ts";
import type { Credenciales } from "./credenciales.ts";
import { DESTINO_PRUEBAS, DESTINO_REAL, ESCRITURA_REAL_HABILITADA } from "./destinos.ts";
import { nodosImagen, reescribirImagenes } from "./enlaces-imagenes.ts";
import { SOLO_LECTURA, consultar } from "./leer-wordpress.ts";
import type { Consulta } from "./leer-wordpress.ts";
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

/** Usuario y clave de DATABASE_URL: las credenciales de los tests, contra la base de pruebas. El host, el puerto y la base no se leen de ahí. */
const credencialesDePruebas = (): Credenciales => credencialesDeUrl(process.env["DATABASE_URL"], "DATABASE_URL", false);

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

/**
 * Abre el cliente con escritura. Tras conectar comprueba @@port, DATABASE(), la versión y @@session.transaction_read_only = 0.
 * Sin `credenciales` usa las de DATABASE_URL (las de los tests); el comando de escritura pasa siempre las suyas y nunca cae en esas.
 */
export async function abrirConexionEscritura(destino: unknown, credenciales?: Credenciales): Promise<ConexionEscritura> {
  const elegido = elegirDestinoEscritura(destino);
  const { user, password } = credenciales ?? credencialesDePruebas();
  // allowPublicKeyRetrieval SOLO en esta conexión de escritura: con la caché de autenticación fría de caching_sha2_password (MySQL 8.4) la primera
  // conexión de un usuario necesita la clave pública RSA del servidor y, sin esto, falla con "RSA public key is not available client side". Es aceptable
  // porque el host es la constante 127.0.0.1 (elegirDestinoEscritura solo admite DESTINO_REAL y DESTINO_PRUEBAS): el pedido de la clave pública no sale de esta máquina.
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb({ host: elegido.host, port: elegido.puerto, user, password, database: elegido.base, connectionLimit: 3, allowPublicKeyRetrieval: true }) });
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
// Conexión de LECTURA a la base de pruebas (sesión READ ONLY): para probar la simulación contra evaristo_cms_test
// ---------------------------------------------------------------------------------------------------------------
/** Solo acepta la constante DESTINO_PRUEBAS (por identidad). La lectura del destino real sigue siendo la de leer-wordpress.ts. */
export function elegirDestinoLectura(destino: unknown): typeof DESTINO_PRUEBAS {
  if (destino !== DESTINO_PRUEBAS) throw new Error("Destino de lectura no permitido: esta conexión solo se abre con DESTINO_PRUEBAS");
  return destino as typeof DESTINO_PRUEBAS;
}

export interface ConexionLectura {
  /** Consulta de solo SELECT (pasa por consultar()). */
  bd: Consulta;
  destino: typeof DESTINO_PRUEBAS;
  servidor: ServidorEscritura;
  cerrar: () => Promise<void>;
}

/** Abre el cliente con la sesión en READ ONLY y comprueba @@port, DATABASE(), la versión y @@session.transaction_read_only = 1. */
export async function abrirConexionLectura(destino: unknown): Promise<ConexionLectura> {
  const elegido = elegirDestinoLectura(destino);
  const { user, password } = credencialesDePruebas();
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb({ host: elegido.host, port: elegido.puerto, user, password, database: elegido.base, connectionLimit: 2, initSql: SOLO_LECTURA }) });
  const bd: Consulta = (sql, ...p) => consultar(prisma, sql, ...p);
  try {
    const [f] = await bd("SELECT @@port AS puerto, DATABASE() AS base, @@version AS version, @@session.transaction_read_only AS ro");
    const servidor = verificarServidorEscritura({ puerto: num(f?.["puerto"]), base: str(f?.["base"]), version: str(f?.["version"]), soloLectura: 0 }, elegido);
    if (num(f?.["ro"]) !== 1) throw new Error("La sesión de lectura no está en solo lectura: se aborta");
    return { bd, destino: elegido, servidor: { ...servidor, soloLectura: 1 }, cerrar: () => prisma.$disconnect() };
  } catch (e) {
    await prisma.$disconnect();
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Comparaciones (nunca se informan valores, solo nombres de campos)
// ---------------------------------------------------------------------------------------------------------------
const ordenar = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, ordenar(x)]));
  return v;
};
/** Forma comparable de un valor: los JSON sin importar el orden de las claves, las fechas por su instante, undefined como null. */
export const comparable = (v: unknown): string => JSON.stringify(v instanceof Date ? v.getTime() : ordenar(v ?? null));
const camposDistintos = (plan: Record<string, unknown>, fila: Record<string, unknown>): string[] => Object.keys(plan).filter((k) => comparable(plan[k]) !== comparable(fila[k]));

// ---------------------------------------------------------------------------------------------------------------
// Base de la escritura: categorías, autores e imágenes (en ese orden)
// ---------------------------------------------------------------------------------------------------------------
export interface ConflictoEscritura { tabla: string; clave: string; detalle: unknown }

/** Una fila de autores o imagenes que ya existe y difiere del plan: solo los nombres de los campos. */
export interface FilaQueDifiere { tabla: "autores" | "imagenes"; clave: string; campos: string[]; sobrescrita: boolean }

export interface ResultadoBase {
  categorias: { enElPlan: number; creadas: number; existentes: number };
  autores: { enElPlan: number; creados: number; sinCambios: number; difieren: number; sobrescritos: number; conflictos: number };
  imagenes: { enElPlan: number; creadas: number; sinCambios: number; difieren: number; sobrescritas: number; conflictos: number };
  difieren: FilaQueDifiere[];
  conflictos: ConflictoEscritura[];
  /** Artículos que no se escriben porque dependen de algo en conflicto (wpId -> motivo). */
  fallidos: Map<number, string>;
  /** id de la fila por clave natural, de lo que se escribió (o ya existía con esa clave). */
  idsCategorias: Map<string, number>;
  idsAutores: Map<number, number>;
  idsImagenes: Map<number, number>;
}

const datosDeAutor = (a: Plan["autores"][number]) => ({ slug: a.slug, nombre: a.nombre, soloTexto: a.soloTexto, bio: a.bio ?? null });
const datosDeImagen = (i: Plan["imagenes"][number]) => ({ clave: i.clave, nombreOriginal: i.nombreOriginal, tipoMime: i.tipoMime, ancho: i.ancho, alto: i.alto, bytes: i.bytes, hash: i.hash });

/**
 * Escribe categorías (upsert por slug con update vacío), autores (por wpUserId) e imágenes (por wpId). `bioConCorreo` del plan no es una columna.
 * Una fila de autor o de imagen que ya existe se compara con el plan: igual, no se toca (ni siquiera se llama a update, para no cambiar
 * actualizadoEn); distinta, NO se pisa y se informan los nombres de los campos que difieren. Solo se reescribe la fila cuyo id está en `permitidos`
 * (los ids que la sobrescritura confirmada calculó); sin `permitidos` no se reescribe ninguna.
 * Una clave de imagen o un slug de autor que ya pertenecen a otra fila son conflicto siempre, también con sobrescritura: no se pisan y los
 * artículos que dependen de eso quedan como fallidos.
 */
export async function escribirBase(prisma: PrismaClient, plan: Plan, opciones: { permitidos?: { autores: ReadonlySet<number>; imagenes: ReadonlySet<number> } } = {}): Promise<ResultadoBase> {
  const permitidos = opciones.permitidos ?? { autores: new Set<number>(), imagenes: new Set<number>() };
  const r: ResultadoBase = {
    categorias: { enElPlan: plan.categoriasACrear.length, creadas: 0, existentes: 0 },
    autores: { enElPlan: plan.autores.length, creados: 0, sinCambios: 0, difieren: 0, sobrescritos: 0, conflictos: 0 },
    imagenes: { enElPlan: plan.imagenes.length, creadas: 0, sinCambios: 0, difieren: 0, sobrescritas: 0, conflictos: 0 },
    difieren: [], conflictos: [], fallidos: new Map(), idsCategorias: new Map(), idsAutores: new Map(), idsImagenes: new Map(),
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
    const datos = datosDeAutor(a);
    const existente = await prisma.autor.findUnique({ where: { wpUserId: a.wpUserId } });
    const bio = datos.bio === null ? Prisma.DbNull : (datos.bio as Prisma.InputJsonValue);
    if (!existente) {
      const fila = await prisma.autor.upsert({ where: { wpUserId: a.wpUserId }, update: {}, create: { wpUserId: a.wpUserId, ...datos, bio }, select: { id: true } });
      r.idsAutores.set(a.wpUserId, fila.id);
      r.autores.creados++;
      continue;
    }
    r.idsAutores.set(a.wpUserId, existente.id);
    const campos = camposDistintos(datos, existente);
    if (!campos.length) { r.autores.sinCambios++; continue; }
    const reescribir = permitidos.autores.has(a.wpUserId);
    if (reescribir) {
      await prisma.autor.update({ where: { id: existente.id }, data: { ...datos, bio } });
      r.autores.sobrescritos++;
    } else r.autores.difieren++;
    r.difieren.push({ tabla: "autores", clave: String(a.wpUserId), campos, sobrescrita: reescribir });
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
    const datos = datosDeImagen(i);
    const existente = await prisma.imagen.findUnique({ where: { wpId: i.wpId } });
    if (!existente) {
      const fila = await prisma.imagen.upsert({ where: { wpId: i.wpId }, update: {}, create: { wpId: i.wpId, ...datos }, select: { id: true } });
      r.idsImagenes.set(i.wpId, fila.id);
      r.imagenes.creadas++;
      continue;
    }
    r.idsImagenes.set(i.wpId, existente.id);
    const campos = camposDistintos(datos, existente);
    if (!campos.length) { r.imagenes.sinCambios++; continue; }
    const reescribir = permitidos.imagenes.has(i.wpId);
    if (reescribir) {
      await prisma.imagen.update({ where: { id: existente.id }, data: datos });
      r.imagenes.sobrescritas++;
    } else r.imagenes.difieren++;
    r.difieren.push({ tabla: "imagenes", clave: String(i.wpId), campos, sobrescrita: reescribir });
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Artículos, relaciones, galería y redirecciones
// ---------------------------------------------------------------------------------------------------------------
/** Tiempo máximo de la transacción de un artículo. */
export const TIMEOUT_ARTICULO_MS = 30_000;

/** Una imagen de la galería de un artículo. Los 35 de la muestra no tienen galería: se usa con datos sintéticos en los tests. */
export interface GaleriaPlan { imagenWpId: number; orden: number; alt: string | null; epigrafe: string | null }
export type ArticuloEscribible = RegistroArticulo & { galeria?: readonly GaleriaPlan[] };
export type PlanEscribible = Omit<Plan, "articulos"> & { articulos: ArticuloEscribible[] };

/**
 * Lo que el usuario confirmó para reescribir filas que ya existen y difieren: el TOTAL exacto (artículos + autores + imágenes) y la lista de ids
 * por tipo (wpId de artículos, wpUserId de autores, wpId de imágenes).
 */
export interface Sobrescritura { cantidad: number; articulos: readonly number[]; autores: readonly number[]; imagenes: readonly number[] }

export interface OpcionesEscritura {
  /** Corta en el primer artículo que falla (no se escriben los siguientes ni las redirecciones de autor). */
  abortarAlPrimerError: boolean;
  /** Sin esto no se reescribe ninguna fila de ningún tipo. Si el total o alguna lista no coinciden con lo calculado, no se escribe nada. */
  sobrescribir?: Sobrescritura | null;
}

/** Solo para los tests: se llama dentro de la transacción del artículo, después de escribir todo y antes de confirmar. */
export interface DependenciasEscritura {
  alFinalDelArticulo?: (wpId: number, tx: Prisma.TransactionClient) => Promise<void> | void;
}

export type EstadoArticulo = "escrito" | "sin_cambios" | "difiere" | "sobrescrito" | "fallido";

export interface ResultadoArticulo {
  wpId: number;
  slug: string;
  resultado: EstadoArticulo;
  /** Nombres de las columnas o conjuntos que difieren (solo para "difiere" y "sobrescrito"). Nunca valores. */
  campos?: string[];
  /** El motivo del error para los fallidos. */
  motivo?: string;
}

export interface ResultadoEscritura {
  /** "error" si algún artículo falló (se deshizo solo ese artículo); "ok" si no. Los conflictos y las diferencias se listan aparte. */
  estado: "ok" | "error";
  abortado: boolean;
  base: ResultadoBase;
  articulos: ResultadoArticulo[];
  conteos: { escritos: number; sinCambios: number; difieren: number; sobrescritos: number; fallidos: number };
  redirecciones: { creadas: number; sinCambios: number; conflictos: number };
  conflictos: ConflictoEscritura[];
  /** Ids de las filas que la sobrescritura reescribió, por tipo. */
  idsSobrescritos: IdsSobrescritura;
}

/** El total o las listas de la sobrescritura no coinciden con lo calculado: no se escribió nada. */
export class ErrorDeSobrescritura extends Error {
  constructor(readonly pedidos: Sobrescritura, readonly calculados: IdsSobrescritura) {
    const lista = (n: string, ids: readonly number[]) => `${n} ${ids.length} (${ids.join(", ") || "ninguno"})`;
    super(`La sobrescritura no coincide: se pidieron ${pedidos.cantidad} filas (${lista("artículos", pedidos.articulos)}; ${lista("autores", pedidos.autores)}; ${lista("imágenes", pedidos.imagenes)}) y se reescribirían ${totalSobrescritura(calculados)} (${lista("artículos", calculados.articulos)}; ${lista("autores", calculados.autores)}; ${lista("imágenes", calculados.imagenes)}). No se escribió nada.`);
  }
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
const viaJson = <T>(v: T): T => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Cómo se resuelven las claves naturales del plan a ids de filas. Devuelve undefined si no hay fila. */
interface Resolvedor {
  seccion: (slug: string) => Promise<number | undefined>;
  categoria: (slug: string) => Promise<number | undefined>;
  autor: (wpUserId: number) => Promise<number | undefined>;
  imagen: (wpId: number) => Promise<number | undefined>;
}

function resolvedorDe(c: Prisma.TransactionClient, base?: ResultadoBase): Resolvedor {
  return {
    seccion: async (slug) => (await c.seccion.findUnique({ where: { slug }, select: { id: true } }))?.id,
    categoria: async (slug) => base?.idsCategorias.get(slug) ?? (await c.categoria.findUnique({ where: { slug }, select: { id: true } }))?.id,
    autor: async (wpUserId) => base?.idsAutores.get(wpUserId) ?? (await c.autor.findUnique({ where: { wpUserId }, select: { id: true } }))?.id,
    imagen: async (wpId) => base?.idsImagenes.get(wpId) ?? (await c.imagen.findUnique({ where: { wpId }, select: { id: true } }))?.id,
  };
}

/** Todo lo que el script escribiría para un artículo, con los ids ya resueltos. */
interface Produccion {
  /** Las columnas del artículo (valores planos: los JSON sin envolver en Prisma.DbNull). */
  columnas: Record<string, unknown>;
  categoriaIds: number[];
  autores: Array<{ autorId: number; orden: number }>;
  galeria: Array<{ imagenId: number; orden: number; alt: string | null; epigrafe: string | null }>;
}

/** Arma la producción de un artículo. Si falta alguna fila de la que depende, devuelve los nombres de lo que falta (y no produce nada). */
async function producir(a: ArticuloEscribible, res: Resolvedor): Promise<{ produccion: Produccion | null; faltan: string[] }> {
  const faltan: string[] = [];
  const seccionId = await res.seccion(a.seccion);
  if (seccionId === undefined) faltan.push("seccionId");
  const categoriaIds: number[] = [];
  for (const slug of a.categorias) { const id = await res.categoria(slug); if (id === undefined) faltan.push("categorias"); else if (!categoriaIds.includes(id)) categoriaIds.push(id); }
  const categoriaPrincipalId = a.categoriaPrincipal === null ? null : (await res.categoria(a.categoriaPrincipal)) ?? null;
  if (a.categoriaPrincipal !== null && categoriaPrincipalId === null) faltan.push("categoriaPrincipalId");
  const autores: Produccion["autores"] = [];
  for (const x of a.autores) { const id = await res.autor(x.wpUserId); if (id === undefined) faltan.push("autores"); else autores.push({ autorId: id, orden: x.orden }); }

  // imágenes: los ids salen de las filas de imagenes (por wpId), nunca se inventan
  const idsImagen = new Map<number, number>();
  const wpIds = new Set<number>([
    ...(a.encabezadoAdjuntoWpId !== null ? [a.encabezadoAdjuntoWpId] : []),
    ...(a.redesImagenWpId !== null ? [a.redesImagenWpId] : []),
    ...nodosImagen(a.cuerpo).flatMap((n) => (typeof n.attrs?.["imagenWpId"] === "number" ? [n.attrs["imagenWpId"] as number] : [])),
  ]);
  for (const wpId of wpIds) { const id = await res.imagen(wpId); if (id !== undefined) idsImagen.set(wpId, id); }
  const cuerpoSinFila = nodosImagen(a.cuerpo).some((n) => typeof n.attrs?.["imagenWpId"] === "number" && !idsImagen.has(n.attrs["imagenWpId"] as number));
  if (cuerpoSinFila) faltan.push("cuerpo");
  const galeria: Produccion["galeria"] = [];
  for (const g of a.galeria ?? []) { const id = await res.imagen(g.imagenWpId); if (id === undefined) faltan.push("galeria"); else galeria.push({ imagenId: id, orden: g.orden, alt: g.alt, epigrafe: g.epigrafe }); }
  if (faltan.length) return { produccion: null, faltan: [...new Set(faltan)] };

  const cuerpo = viaJson(cuerpoParaGuardar(a.cuerpo as DocNode, (wpId) => idsImagen.get(wpId)));
  const columnas: Record<string, unknown> = {
    wpId: a.wpId, slug: a.slug, titulo: a.titulo, bajada: a.bajada, cuerpo, schemaVersion: a.schemaVersion, textoPlano: a.textoPlano,
    estado: a.estado, publicadoEn: fecha(a.publicadoEn), novedadHasta: fecha(a.novedadHasta),
    seccionId, categoriaPrincipalId, etiquetasWp: viaJson(a.etiquetasWp ?? null), avisosMigracion: viaJson(a.avisosMigracion ?? null), visitasWp: a.visitasWp,
    imagenEncabezadoId: a.encabezadoAdjuntoWpId === null ? null : idsImagen.get(a.encabezadoAdjuntoWpId) ?? null,
    encabezadoAlt: a.encabezadoAlt, encabezadoCredito: a.encabezadoCredito, encabezadoPuntoFocalX: a.encabezadoPuntoFocalX, encabezadoPuntoFocalY: a.encabezadoPuntoFocalY,
    redesDescripcion: a.redesDescripcion, redesImagenId: a.redesImagenWpId === null ? null : idsImagen.get(a.redesImagenWpId) ?? null,
    altPendientes: a.altPendientes,
  };
  return { produccion: { columnas, categoriaIds, autores, galeria }, faltan: [] };
}

/** Las columnas tal como se pasan a Prisma: los JSON nulos como DbNull. */
const datosDeColumnas = (c: Record<string, unknown>) => ({ ...c, etiquetasWp: json(c["etiquetasWp"]), avisosMigracion: json(c["avisosMigracion"]) }) as unknown as Prisma.ArticuloUncheckedCreateInput;

type FilaArticulo = Prisma.ArticuloGetPayload<{ include: { categorias: true; autores: true; galeria: true } }>;
const leerFila = (c: Prisma.TransactionClient, wpId: number) => c.articulo.findUnique({ where: { wpId }, include: { categorias: true, autores: true, galeria: true } });

/** Nombres de las columnas y de los conjuntos (categorias, autores, galeria) en los que la fila difiere de lo que produciría el script. */
function diferencias(p: Produccion, fila: FilaArticulo): string[] {
  const campos = camposDistintos(p.columnas, fila as unknown as Record<string, unknown>);
  const ordenCat = (xs: number[]) => [...xs].sort((a, b) => a - b);
  if (comparable(ordenCat(p.categoriaIds)) !== comparable(ordenCat(fila.categorias.map((x) => x.categoriaId)))) campos.push("categorias");
  const aut = (xs: Array<{ autorId: number; orden: number }>) => [...xs].sort((a, b) => a.autorId - b.autorId).map((x) => [x.autorId, x.orden]);
  if (comparable(aut(p.autores)) !== comparable(aut(fila.autores))) campos.push("autores");
  const gal = (xs: Array<{ imagenId: number; orden: number; alt: string | null; epigrafe: string | null }>) =>
    [...xs].sort((a, b) => a.orden - b.orden || a.imagenId - b.imagenId).map((x) => [x.imagenId, x.orden, x.alt ?? null, x.epigrafe ?? null]);
  if (comparable(gal(p.galeria)) !== comparable(gal(fila.galeria))) campos.push("galeria");
  return campos;
}

/**
 * Filas de `plan` que ya existen y difieren de lo que escribiría el script: las que una sobrescritura reescribiría (artículos, autores e imágenes).
 * Un slug de autor o una clave de imagen que pertenecen a otra fila son conflicto y nunca entran. Solo lectura.
 */
export async function calcularSobrescrituras(prisma: PrismaClient, plan: PlanEscribible): Promise<IdsSobrescritura> {
  const res = resolvedorDe(prisma);
  const ids: IdsSobrescritura = { articulos: [], autores: [], imagenes: [] };
  for (const a of plan.autores) {
    const mismoSlug = await prisma.autor.findUnique({ where: { slug: a.slug }, select: { wpUserId: true } });
    if (mismoSlug && mismoSlug.wpUserId !== a.wpUserId) continue;
    const existente = await prisma.autor.findUnique({ where: { wpUserId: a.wpUserId } });
    if (existente && camposDistintos(datosDeAutor(a), existente).length) ids.autores.push(a.wpUserId);
  }
  for (const i of plan.imagenes) {
    const mismaClave = await prisma.imagen.findUnique({ where: { clave: i.clave }, select: { wpId: true } });
    if (mismaClave && mismaClave.wpId !== i.wpId) continue;
    const existente = await prisma.imagen.findUnique({ where: { wpId: i.wpId } });
    if (existente && camposDistintos(datosDeImagen(i), existente).length) ids.imagenes.push(i.wpId);
  }
  for (const a of plan.articulos) {
    const fila = await leerFila(prisma, a.wpId);
    if (!fila) continue;
    let campos: string[];
    try {
      const { produccion, faltan } = await producir(a, res);
      campos = produccion ? diferencias(produccion, fila) : faltan;
    } catch { continue; }   // un artículo que no se puede armar falla al escribir; no es una sobrescritura
    if (campos.length) ids.articulos.push(a.wpId);
  }
  return ids;
}

type Redireccion = "creada" | "sin_cambios" | "conflicto";

/** Una redirección: igual (mismo origen y mismo destino) no es conflicto; mismo origen y otro destino sí, y no se pisa nunca. */
async function crearRedireccion(tx: Prisma.TransactionClient, r: RedirecionPlan, destino: { articuloId?: number; autorId?: number }, conflictos: ConflictoEscritura[]): Promise<Redireccion> {
  const motivo = validarDestinoUnico({ articuloId: destino.articuloId, autorId: destino.autorId, destino: r.destino });
  if (motivo) throw new Error(`${r.origen}: ${motivo}`);
  const existente = await tx.redireccion.findUnique({ where: { origen: r.origen }, select: { id: true, tipo: true, articuloId: true, autorId: true, destino: true } });
  if (existente) {
    const mismoDestino = existente.articuloId === (destino.articuloId ?? null) && existente.autorId === (destino.autorId ?? null) && existente.destino === (r.destino ?? null);
    if (mismoDestino) return "sin_cambios";
    conflictos.push({ tabla: "redirecciones", clave: r.origen, detalle: { tipoDelPlan: r.tipo, existente } });
    return "conflicto";
  }
  await tx.redireccion.create({ data: { origen: r.origen, tipo: r.tipo, codigo: r.codigo, articuloId: destino.articuloId ?? null, autorId: destino.autorId ?? null, destino: r.destino } });
  return "creada";
}

/** Una transacción por artículo. Devuelve el resultado y lo que dejó por reportar (solo si la transacción se confirmó). */
async function escribirArticulo(prisma: PrismaClient, a: ArticuloEscribible, base: ResultadoBase, permitidos: ReadonlySet<number>, deps: DependenciasEscritura) {
  const conflictos: ConflictoEscritura[] = [];
  const redirecciones = { creadas: 0, sinCambios: 0 };
  const salida = await prisma.$transaction(async (tx) => {
    const { produccion, faltan } = await producir(a, resolvedorDe(tx, base));
    const fila = await leerFila(tx, a.wpId);
    let resultado: EstadoArticulo;
    let campos: string[] | undefined;
    let articuloId: number;

    if (!fila) {
      if (!produccion) throw new Error(`faltan filas de las que depende el artículo (${faltan.join(", ")})`);
      const creado = await tx.articulo.create({ data: datosDeColumnas(produccion.columnas), select: { id: true } });
      articuloId = creado.id;
      resultado = "escrito";
    } else {
      articuloId = fila.id;
      campos = produccion ? diferencias(produccion, fila) : faltan;
      if (!campos.length) resultado = "sin_cambios";
      else if (!produccion || !permitidos.has(a.wpId)) resultado = "difiere";
      else {
        // se reescribe conservando id y creadoEn (actualizadoEn lo mueve Prisma)
        await tx.articulo.update({ where: { id: fila.id }, data: datosDeColumnas(produccion.columnas) });
        resultado = "sobrescrito";
      }
    }

    // relaciones y galería: solo cuando se escribió el artículo (nuevo o reescrito). Se sincronizan con el plan.
    if ((resultado === "escrito" || resultado === "sobrescrito") && produccion) {
      await tx.articuloCategoria.deleteMany({ where: { articuloId } });
      await tx.articuloCategoria.createMany({ data: produccion.categoriaIds.map((categoriaId) => ({ articuloId, categoriaId })) });
      await tx.articuloAutor.deleteMany({ where: { articuloId } });
      await tx.articuloAutor.createMany({ data: produccion.autores.map((x) => ({ articuloId, ...x })) });
      await tx.galeriaItem.deleteMany({ where: { articuloId } });
      await tx.galeriaItem.createMany({ data: produccion.galeria.map((g) => ({ articuloId, ...g })) });
    }

    // redirecciones del artículo: las que faltan se crean; las iguales no cuentan como conflicto; las que apuntan a otro lado no se pisan
    for (const r of a.redirecciones) {
      const x = await crearRedireccion(tx, r, { articuloId }, conflictos);
      if (x === "creada") redirecciones.creadas++; else if (x === "sin_cambios") redirecciones.sinCambios++;
    }
    if (resultado === "escrito" || resultado === "sobrescrito") await deps.alFinalDelArticulo?.(a.wpId, tx);
    return { resultado, campos };
  }, { timeout: TIMEOUT_ARTICULO_MS, maxWait: TIMEOUT_ARTICULO_MS });
  return { ...salida, conflictos, redirecciones };
}

const mismoConjunto = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((x, i) => x === [...b].sort((p, q) => p - q)[i]);

/**
 * Escribe todo el plan: categorías, autores e imágenes (escribirBase), después una transacción por artículo y al final las redirecciones
 * de autor. Un artículo que ya existe se compara con lo que escribiría el script: igual, "sin cambios"; distinto, se omite y se informan los
 * nombres de los campos que difieren; solo con `sobrescribir` (cantidad y lista exactas) se reescribe. Si un artículo falla se deshace solo
 * ese artículo, se reporta y la corrida sigue; con `abortarAlPrimerError` corta ahí. El estado devuelto es "error" si hubo algún fallido.
 * Con `sobrescribir`, si la cantidad o la lista no coinciden con el cálculo no se escribe NADA (lanza ErrorDeSobrescritura antes de empezar).
 */
export async function escribirPlan(prisma: PrismaClient, plan: PlanEscribible, opciones: OpcionesEscritura, deps: DependenciasEscritura = {}): Promise<ResultadoEscritura> {
  let permitidos: ReadonlySet<number> = new Set();
  let permitidosBase = { autores: new Set<number>(), imagenes: new Set<number>() };
  if (opciones.sobrescribir) {
    const pedidos = opciones.sobrescribir;
    const calculados = await calcularSobrescrituras(prisma, plan);
    if (pedidos.cantidad !== totalSobrescritura(calculados) || !mismoConjunto(pedidos.articulos, calculados.articulos)
      || !mismoConjunto(pedidos.autores, calculados.autores) || !mismoConjunto(pedidos.imagenes, calculados.imagenes)) throw new ErrorDeSobrescritura(pedidos, calculados);
    permitidos = new Set(calculados.articulos);
    permitidosBase = { autores: new Set(calculados.autores), imagenes: new Set(calculados.imagenes) };
  }

  const base = await escribirBase(prisma, plan, { permitidos: permitidosBase });
  const articulos: ResultadoArticulo[] = [];
  const conflictos: ConflictoEscritura[] = [...base.conflictos];
  const redirecciones = { creadas: 0, sinCambios: 0, conflictos: 0 };
  let abortado = false;

  for (const a of plan.articulos) {
    const dependencia = base.fallidos.get(a.wpId);
    if (dependencia !== undefined) {
      articulos.push({ wpId: a.wpId, slug: a.slug, resultado: "fallido", motivo: dependencia });
    } else {
      try {
        const r = await escribirArticulo(prisma, a, base, permitidos, deps);
        conflictos.push(...r.conflictos);
        redirecciones.creadas += r.redirecciones.creadas;
        redirecciones.sinCambios += r.redirecciones.sinCambios;
        redirecciones.conflictos += r.conflictos.length;
        articulos.push({ wpId: a.wpId, slug: a.slug, resultado: r.resultado, ...(r.resultado === "difiere" || r.resultado === "sobrescrito" ? { campos: r.campos } : {}) });
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
      const x = await prisma.$transaction((tx) => crearRedireccion(tx, r, { autorId }, delAutor), { timeout: TIMEOUT_ARTICULO_MS });
      if (x === "creada") redirecciones.creadas++; else if (x === "sin_cambios") redirecciones.sinCambios++;
      conflictos.push(...delAutor);
      redirecciones.conflictos += delAutor.length;
    }
  }

  const cuenta = (e: EstadoArticulo) => articulos.filter((x) => x.resultado === e).length;
  const conteos = { escritos: cuenta("escrito"), sinCambios: cuenta("sin_cambios"), difieren: cuenta("difiere"), sobrescritos: cuenta("sobrescrito"), fallidos: cuenta("fallido") };
  return {
    estado: conteos.fallidos > 0 ? "error" : "ok", abortado, base, articulos, conteos, redirecciones, conflictos,
    idsSobrescritos: {
      articulos: articulos.filter((x) => x.resultado === "sobrescrito").map((x) => x.wpId),
      autores: base.difieren.filter((d) => d.tabla === "autores" && d.sobrescrita).map((d) => Number(d.clave)),
      imagenes: base.difieren.filter((d) => d.tabla === "imagenes" && d.sobrescrita).map((d) => Number(d.clave)),
    },
  };
}
