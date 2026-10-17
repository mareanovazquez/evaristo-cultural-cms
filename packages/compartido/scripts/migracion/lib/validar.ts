// Validaciones del Plan antes de escribir. Dos clases de problema:
//  - BLOQUEANTES (bloqueante: true, wpId null): frenan toda la corrida. Destino distinto del permitido, intercalación incorrecta de las
//    columnas únicas, cuentas de cuentas.json que no coinciden con wp_users, sección faltante y categoría a crear sin nombre.
//  - de ARTÍCULO (bloqueante: false): excluyen solo a ese artículo; los demás siguen.
// Lo que depende de la intercalación del CMS lo decide MySQL 8.4 (puerto 3308), nunca JavaScript: se pregunta con SELECT por consultar().
// Este módulo no escribe nada: ni siquiera tablas temporales.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CuentaSoloTexto, Plan, Problema } from "./armar.ts";
import { COLACION, leerArticulosPorSlug, leerAutoresPorSlugOWpUserId } from "./leer-wordpress.ts";
import type { Consulta, Fila } from "./leer-wordpress.ts";
import { num, str } from "./utilidades.ts";

export const RUTA_SCHEMA = fileURLToPath(new URL("../../../prisma/schema.prisma", import.meta.url));

// ---------------------------------------------------------------------------------------------------------------
// Largos de las columnas: se leen de schema.prisma (@db.VarChar(N)), no se escriben acá
// ---------------------------------------------------------------------------------------------------------------
/** "Modelo.campo" -> N de cada columna @db.VarChar(N) del schema de Prisma. */
export function largosDeSchema(texto: string): Map<string, number> {
  const largos = new Map<string, number>();
  let modelo: string | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^model\s+(\w+)\s*\{/);
    if (m) { modelo = m[1]!; continue; }
    if (/^\}/.test(linea)) { modelo = null; continue; }
    const c = modelo ? linea.match(/^\s+(\w+)\s+\S+.*@db\.VarChar\((\d+)\)/) : null;
    if (c) largos.set(`${modelo}.${c[1]}`, Number(c[2]));
  }
  return largos;
}
export const leerLargosSchema = (ruta = RUTA_SCHEMA) => largosDeSchema(readFileSync(ruta, "utf8"));

/** Largo en caracteres (puntos de código), no en unidades UTF-16: es lo que cuenta VARCHAR(N) en utf8mb4. */
export const largoEnCaracteres = (s: string) => [...s].length;

function largoDe(largos: ReadonlyMap<string, number>, campo: string): number {
  const n = largos.get(campo);
  if (n === undefined) throw new Error(`schema.prisma no declara @db.VarChar para ${campo}`);
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Bloqueantes
// ---------------------------------------------------------------------------------------------------------------
const bloqueante = (codigo: string, detalle?: unknown): Problema => ({ wpId: null, codigo, detalle, bloqueante: true });

export interface DestinoReal { host: string; puerto: number; base: string }

/** El destino de la corrida tiene que ser exactamente el permitido. */
export function validarDestino(real: DestinoReal, permitido: DestinoReal): Problema | null {
  return real.host === permitido.host && real.puerto === permitido.puerto && real.base === permitido.base
    ? null : bloqueante("destino_no_permitido", { real, permitido });
}

/** Columnas únicas cuya comparación tiene que ser la intercalación del CMS. */
export const COLUMNAS_CON_INTERCALACION: ReadonlyArray<readonly [string, string]> = [["articulos", "slug"], ["redirecciones", "origen"], ["imagenes", "clave"]];

export interface ColumnaIntercalacion { tabla: string; columna: string; real: string | null; esperada: string; ok: boolean }

/** Intercalación real de cada columna, leída de information_schema en la conexión del CMS. */
export async function leerIntercalaciones(bd: Consulta): Promise<ColumnaIntercalacion[]> {
  const filas = await bd(
    `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLLATION_NAME AS colacion FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND (${COLUMNAS_CON_INTERCALACION.map(() => "(TABLE_NAME = ? AND COLUMN_NAME = ?)").join(" OR ")})`,
    ...COLUMNAS_CON_INTERCALACION.flatMap(([t, c]) => [t, c]));
  return COLUMNAS_CON_INTERCALACION.map(([tabla, columna]) => {
    const f = filas.find((x) => str(x["tabla"]) === tabla && str(x["columna"]) === columna);
    const real = f ? str(f["colacion"]) : null;
    return { tabla, columna, real, esperada: COLACION, ok: real === COLACION };
  });
}

export function validarIntercalaciones(columnas: readonly ColumnaIntercalacion[]): Problema[] {
  return columnas.filter((c) => !c.ok).map((c) => bloqueante("intercalacion_incorrecta", { columna: `${c.tabla}.${c.columna}`, real: c.real, esperada: c.esperada }));
}

/** Las cuentas de datos/migracion/cuentas.json tienen que existir en wp_users con el mismo id, user_login y display_name. */
export function validarCuentas(cuentas: readonly CuentaSoloTexto[], filasWp: ReadonlyArray<{ id: number; login: string; nombre: string }>): Problema | null {
  const noCoinciden = cuentas.map((c) => {
    const f = filasWp.find((x) => x.id === c.wpUserId);
    return { wpUserId: c.wpUserId, enJson: { login: c.user_login, nombre: c.nombre }, enWp: f ? { login: f.login, nombre: f.nombre } : null, coincide: !!f && f.login === c.user_login && f.nombre === c.nombre };
  }).filter((x) => !x.coincide);
  return noCoinciden.length ? bloqueante("cuentas_no_coinciden", noCoinciden) : null;
}

export const cuentasDeFilas = (filas: readonly Fila[]) => filas.map((f) => ({ id: num(f["id"]), login: str(f["login"]), nombre: str(f["nombre"]) }));

/** Bloqueantes que salen del propio Plan: las secciones que faltan en el CMS y los que ya registró armar() (categoría sin nombre). */
export function bloqueantesDelPlan(plan: Plan): Problema[] {
  return [
    ...plan.problemas.filter((p) => p.bloqueante),
    ...plan.seccionesFaltantes.map((s) => bloqueante("seccion_faltante", { slug: s })),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Por artículo (puras): excluyen solo al artículo
// ---------------------------------------------------------------------------------------------------------------
export function validarArticulos(plan: Plan, largos: ReadonlyMap<string, number>): Problema[] {
  const maxSlug = largoDe(largos, "Articulo.slug"), maxTitulo = largoDe(largos, "Articulo.titulo"), maxOrigen = largoDe(largos, "Redireccion.origen");
  const problemas: Problema[] = [];
  for (const a of plan.articulos) {
    const p = (codigo: string, detalle?: unknown) => problemas.push({ wpId: a.wpId, codigo, detalle, bloqueante: false });
    if (a.slug.trim() === "") p("slug_vacio", { slugWp: a.slugWp, estado: a.estado });
    else if (largoEnCaracteres(a.slug) > maxSlug) p("slug_demasiado_largo", { largo: largoEnCaracteres(a.slug), maximo: maxSlug });
    if (a.titulo.trim() === "") p("titulo_vacio");
    else if (largoEnCaracteres(a.titulo) > maxTitulo) p("titulo_demasiado_largo", { largo: largoEnCaracteres(a.titulo), maximo: maxTitulo });
    if (a.estado === "PUBLICADO" && a.publicadoEn === null) p("publicado_sin_fecha", { postDateGmt: a.postDateGmt });
    if (a.validacion.errores.length) p("cuerpo_invalido", { errores: a.validacion.errores.slice(0, 5), cantidad: a.validacion.errores.length });
    const largos512 = a.redirecciones.filter((r) => largoEnCaracteres(r.origen) > maxOrigen);
    if (largos512.length) p("origen_demasiado_largo", { maximo: maxOrigen, origenes: largos512.map((r) => r.origen) });
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------
// Colisiones: las decide la base (MySQL 8.4, COLLATE utf8mb4_es_0900_ai_ci). Solo SELECT.
// ---------------------------------------------------------------------------------------------------------------
/**
 * Agrupa en la base los valores que la intercalación considera iguales y devuelve solo los grupos de más de uno (índices en `valores`).
 * Una sola consulta con una tabla de valores (VALUES ROW(...)) y DENSE_RANK(): no crea tablas.
 */
export async function gruposIgualesEnBd(bd: Consulta, valores: readonly string[]): Promise<number[][]> {
  if (valores.length < 2) return [];
  const sql = `SELECT t.i AS i, DENSE_RANK() OVER (ORDER BY t.s COLLATE ${COLACION}) AS g FROM (VALUES ${valores.map(() => "ROW(?, ?)").join(",")}) AS t(i, s)`;
  const filas = await bd(sql, ...valores.flatMap((v, i) => [i, v]));
  const porGrupo = new Map<number, number[]>();
  for (const f of filas) { const g = num(f["g"]); const l = porGrupo.get(g) ?? []; l.push(num(f["i"])); porGrupo.set(g, l); }
  return [...porGrupo.values()].filter((l) => l.length > 1).map((l) => l.sort((a, b) => a - b));
}

export interface Conflicto { tabla: string; clave: string; detalle: unknown }

export interface ResultadoColisiones { problemas: Problema[]; conflictos: Conflicto[] }

/**
 * Colisiones de articulos.slug entre las filas del plan y contra las que ya existen en el CMS (sin contar la propia fila, por wpId).
 *  - Un borrador-<id> que choca con un slug real se excluye (gana el real).
 *  - Dos artículos reales que chocan entre sí se excluyen los dos: no hay criterio para elegir uno.
 *  - Un artículo cuyo slug ya tiene otra fila en el CMS se excluye.
 * Además informa (sin excluir) los choques de autores.slug, redirecciones.origen e imagenes.clave dentro del plan y el de autores.slug con filas existentes.
 */
export async function validarColisiones(plan: Plan, bd: Consulta): Promise<ResultadoColisiones> {
  const problemas: Problema[] = [];
  const conflictos: Conflicto[] = [];
  const excluidos = new Set<number>();
  const excluir = (wpId: number, codigo: string, detalle: unknown) => { if (!excluidos.has(wpId)) { excluidos.add(wpId); problemas.push({ wpId, codigo, detalle, bloqueante: false }); } };

  // (a) entre las filas del plan
  const arts = plan.articulos;
  for (const grupo of await gruposIgualesEnBd(bd, arts.map((a) => a.slug))) {
    const miembros = grupo.map((i) => arts[i]!);
    const borradores = miembros.filter((a) => a.estado === "BORRADOR"), reales = miembros.filter((a) => a.estado !== "BORRADOR");
    if (reales.length && borradores.length) for (const b of borradores) excluir(b.wpId, "borrador_choca_con_slug_real", { slug: b.slug, conWpId: reales.map((r) => r.wpId) });
    if (reales.length > 1 || (!reales.length && borradores.length > 1)) {
      for (const m of miembros.filter((x) => (reales.length ? x.estado !== "BORRADOR" : true))) excluir(m.wpId, "slug_duplicado_en_el_plan", { slug: m.slug, conWpId: miembros.filter((x) => x !== m).map((x) => x.wpId) });
    }
  }

  // (b) contra lo que ya hay en articulos (menos la propia fila)
  for (const a of arts) {
    if (excluidos.has(a.wpId)) continue;
    const ajenas = (await leerArticulosPorSlug(bd, a.slug)).filter((f) => f["wpId"] === null || f["wpId"] === undefined || num(f["wpId"]) !== a.wpId);
    if (ajenas.length) excluir(a.wpId, a.estado === "BORRADOR" ? "borrador_choca_con_slug_real" : "slug_choca_con_articulo_existente", {
      slug: a.slug, existentes: ajenas.map((f) => ({ id: num(f["id"]), slug: str(f["slug"]), wpId: f["wpId"] === null || f["wpId"] === undefined ? null : num(f["wpId"]) })),
    });
  }

  // (c) informativos: no excluyen
  const dentroDelPlan = async (tabla: string, valores: string[]) => {
    for (const grupo of await gruposIgualesEnBd(bd, valores)) conflictos.push({ tabla, clave: valores[grupo[0]!]!, detalle: { iguales: grupo.map((i) => valores[i]) } });
  };
  await dentroDelPlan("autores.slug", plan.autores.map((x) => x.slug));
  await dentroDelPlan("redirecciones.origen", plan.redirecciones.map((r) => r.origen));
  await dentroDelPlan("imagenes.clave", plan.imagenes.map((i) => i.clave));
  for (const au of plan.autores) {
    const ajenos = (await leerAutoresPorSlugOWpUserId(bd, au.slug, au.wpUserId)).filter((f) => f["wpUserId"] === null || f["wpUserId"] === undefined || num(f["wpUserId"]) !== au.wpUserId);
    if (ajenos.length) conflictos.push({ tabla: "autores", clave: au.slug, detalle: { wpUserId: au.wpUserId, existentes: ajenos.map((f) => ({ id: num(f["id"]), slug: str(f["slug"]), wpUserId: f["wpUserId"] === null || f["wpUserId"] === undefined ? null : num(f["wpUserId"]) })) } });
  }
  return { problemas, conflictos };
}

// ---------------------------------------------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------------------------------------------
export interface ResultadoValidacion {
  intercalaciones: ColumnaIntercalacion[];
  /** Frenan la corrida entera. */
  bloqueantes: Problema[];
  /** Excluyen a un artículo (incluye los que ya registró armar(): categoría principal, destino único, estado desconocido). */
  deArticulo: Problema[];
  /** Ids de los artículos excluidos por esta validación (los que armar() ya dejó afuera no están en el plan). */
  excluidos: Set<number>;
  conflictos: Conflicto[];
}

export interface OpcionesValidar {
  plan: Plan; bd: Consulta; largos: ReadonlyMap<string, number>;
  cuentas: readonly CuentaSoloTexto[]; filasCuentasWp: ReadonlyArray<{ id: number; login: string; nombre: string }>;
  destino: DestinoReal; destinoPermitido: DestinoReal;
}

export async function validarPlan(o: OpcionesValidar): Promise<ResultadoValidacion> {
  const intercalaciones = await leerIntercalaciones(o.bd);
  const bloqueantes = [
    validarDestino(o.destino, o.destinoPermitido),
    ...validarIntercalaciones(intercalaciones),
    validarCuentas(o.cuentas, o.filasCuentasWp),
    ...bloqueantesDelPlan(o.plan),
  ].filter((p): p is Problema => p !== null);
  const propios = validarArticulos(o.plan, o.largos);
  // Las colisiones solo tienen sentido si la intercalación es la esperada: si no, la base respondería otra cosa
  const colisiones = intercalaciones.every((c) => c.ok) ? await validarColisiones({ ...o.plan, articulos: o.plan.articulos.filter((a) => !propios.some((p) => p.wpId === a.wpId)) }, o.bd) : { problemas: [], conflictos: [] };
  const deArticulo = [...o.plan.problemas.filter((p) => !p.bloqueante), ...propios, ...colisiones.problemas];
  return { intercalaciones, bloqueantes, deArticulo, excluidos: new Set([...propios, ...colisiones.problemas].map((p) => p.wpId as number)), conflictos: colisiones.conflictos };
}
