// Ayudas de los tests con base (test:migracion-db). Solo escriben en evaristo_cms_test, siempre a través de abrirConexionEscritura(DESTINO_PRUEBAS)
// de lib/escribir.ts. Sobre evaristo_cms (el real) solo hacen SELECT, por una sesión READ ONLY, para comprobar que nada lo cambió.
// No dependen de WordPress (3307) ni de la carpeta de originales: arman el plan desde el snapshot con mediciones sintéticas.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { PrismaClient } from "../../../src/generated/prisma/client.js";
import { SECCIONES } from "../../../src/secciones.ts";
import { DESTINO_PRUEBAS } from "../lib/destinos.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
import { abrirConexionEscritura } from "../lib/escribir.ts";
import type { ConexionEscritura } from "../lib/escribir.ts";
import type { Medicion } from "../lib/imagenes.ts";
import { abrirSoloCms, consultar } from "../lib/leer-wordpress.ts";
import type { Consulta } from "../lib/leer-wordpress.ts";
import { prepararPlan } from "../lib/preparar.ts";
import type { Preparado } from "../lib/preparar.ts";
import { leerLargosSchema } from "../lib/validar.ts";
import { num, str } from "../lib/utilidades.ts";

config({ path: fileURLToPath(new URL("../../../../../.env", import.meta.url)), quiet: true });

// ---------------------------------------------------------------------------------------------------------------
// Vaciar y sembrar la base de pruebas
// ---------------------------------------------------------------------------------------------------------------
/** Orden de borrado: primero las tablas que apuntan a otras (claves foráneas). _prisma_migrations nunca se toca. */
export const TABLAS_A_VACIAR: ReadonlyArray<readonly [string, string]> = [
  ["articulos_galeria", "galeriaItem"], ["fichas_tecnicas", "fichaTecnica"], ["articulos_categorias", "articuloCategoria"], ["articulos_autores", "articuloAutor"],
  ["redirecciones", "redireccion"], ["articulos", "articulo"], ["autores", "autor"], ["categorias", "categoria"], ["imagenes", "imagen"],
  ["secciones", "seccion"], ["usuarios", "usuario"], ["pruebaconexion", "pruebaConexion"],
];

async function baseActual(prisma: PrismaClient): Promise<string> {
  const [f] = await prisma.$queryRaw<Array<{ base: string | null }>>`SELECT DATABASE() AS base`;
  return f?.base ?? "";
}

/**
 * Vacía todas las tablas salvo _prisma_migrations (con DELETE, no TRUNCATE) y siembra las 9 secciones desde SECCIONES
 * (src/secciones.ts, la misma lista que usa db:sembrar). ANTES de cada DELETE comprueba que DATABASE() sea evaristo_cms_test; si no, aborta.
 */
export async function vaciarYSembrarPruebas(prisma: PrismaClient): Promise<void> {
  const delegados = prisma as unknown as Record<string, { deleteMany: () => Promise<unknown> }>;
  for (const [tabla, modelo] of TABLAS_A_VACIAR) {
    const base = await baseActual(prisma);
    if (base !== DESTINO_PRUEBAS.base) throw new Error(`vaciarYSembrarPruebas: DATABASE() = ${base || "NULL"}, no ${DESTINO_PRUEBAS.base}: se aborta sin borrar ${tabla}`);
    await delegados[modelo]!.deleteMany();
  }
  const base = await baseActual(prisma);
  if (base !== DESTINO_PRUEBAS.base) throw new Error(`vaciarYSembrarPruebas: DATABASE() = ${base || "NULL"}: se aborta sin sembrar`);
  await prisma.seccion.createMany({ data: SECCIONES.map((s, i) => ({ slug: s.slug, nombre: s.nombre, interna: s.interna, orden: i + 1 })) });
}

// ---------------------------------------------------------------------------------------------------------------
// Conexiones y consultas
// ---------------------------------------------------------------------------------------------------------------
export const abrirPruebas = (): Promise<ConexionEscritura> => abrirConexionEscritura(DESTINO_PRUEBAS);

/** Una consulta de solo SELECT sobre el cliente de pruebas (la que usa la validación). */
export const consultaDe = (prisma: PrismaClient): Consulta => (sql, ...p) => consultar(prisma, sql, ...p);

// ---------------------------------------------------------------------------------------------------------------
// Comprobar que evaristo_cms (el real) no cambió: conteo de todas sus tablas, solo lectura
// ---------------------------------------------------------------------------------------------------------------
export async function contarCmsReal(): Promise<Record<string, number>> {
  const { bd, cerrar } = await abrirSoloCms();
  try {
    const [{ base }] = (await bd("SELECT DATABASE() AS base")) as [{ base: unknown }];
    assert.equal(str(base), "evaristo_cms");
    const tablas = await bd("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    const conteos: Record<string, number> = {};
    for (const f of tablas) {
      const t = str(f["t"]);
      assert.match(t, /^[A-Za-z0-9_]+$/);
      conteos[t] = num(((await bd(`SELECT COUNT(*) AS n FROM \`${t}\``)) as [{ n: unknown }])[0].n);
    }
    return conteos;
  } finally { await cerrar(); }
}

/** Un test con base: antes y después comprueba que los conteos de evaristo_cms no cambiaron. */
export function crearEjecutor() {
  let ok = 0;
  const ta = async (nombre: string, fn: () => Promise<void>) => {
    const antes = await contarCmsReal();
    await fn();
    assert.deepEqual(await contarCmsReal(), antes, `${nombre}: evaristo_cms cambió`);
    ok++;
    console.log("ok", nombre);
  };
  return { ta, cantidad: () => ok };
}

// ---------------------------------------------------------------------------------------------------------------
// Mediciones sintéticas y plan de pruebas
// ---------------------------------------------------------------------------------------------------------------
/** Los originales que no existen (los de los artículos 2462 y 22546). */
export const ORIGINALES_FALTANTES: readonly string[] = ["escanear0006.jpg", "mankell.jpg"];

/** Medición determinística a partir del hash de la clave: no lee el disco. */
export function medirSintetico(_carpeta: string, claves: Iterable<string>): Map<string, Medicion> {
  const res = new Map<string, Medicion>();
  for (const c of claves) {
    const k = c.normalize("NFC");
    if (ORIGINALES_FALTANTES.includes(k)) {
      res.set(k, { estado: "original faltante", archivo: null, diferenciaDeNombre: null, bytes: null, sha256: null, mime: null, ancho: null, alto: null });
      continue;
    }
    const h = createHash("sha256").update(k).digest("hex");
    const mime = /\.png$/i.test(k) ? "image/png" : /\.gif$/i.test(k) ? "image/gif" : "image/jpeg";
    res.set(k, {
      estado: "medida", archivo: k, diferenciaDeNombre: null, bytes: 1000 + (parseInt(h.slice(0, 6), 16) % 400000), sha256: h, mime,
      ancho: 400 + (parseInt(h.slice(6, 10), 16) % 2000), alto: 300 + (parseInt(h.slice(10, 14), 16) % 1500),
    });
  }
  return res;
}

/**
 * El plan desde el snapshot, validado contra la base de pruebas. Sin `ids`, los 35 de la muestra; con `ids`, solo esos artículos (el subconjunto
 * que arma el comando con --ids). No usa WordPress ni la carpeta de originales.
 */
export async function planDePruebas(prisma: PrismaClient, ids?: readonly number[]): Promise<Preparado> {
  const entrada = entradaDesdeSnapshot();
  if (ids) entrada.ids = entrada.ids.filter((id) => ids.includes(id));
  return prepararPlan({
    entrada, carpetaOriginales: "(sin carpeta: mediciones sintéticas)", bd: consultaDe(prisma), largos: leerLargosSchema(), cuentas: entrada.cuentas,
    filasCuentasWp: entrada.cuentas.map((c) => ({ id: c.wpUserId, login: c.user_login, nombre: c.nombre })),
    destino: { host: DESTINO_PRUEBAS.host, puerto: DESTINO_PRUEBAS.puerto, base: DESTINO_PRUEBAS.base }, destinoPermitido: DESTINO_PRUEBAS, medir: medirSintetico,
  });
}
