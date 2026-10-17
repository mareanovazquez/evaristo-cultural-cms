// Guarda del destino de la migración y verificación de las conexiones. El destino permitido son constantes de este módulo: ningún
// flag ni variable de entorno las cambia (DATABASE_URL solo se COMPARA contra ellas; si no coincide, la corrida se niega).
// No crea ningún cliente por su cuenta: abre las conexiones con abrirConexiones() de leer-wordpress.ts (sesiones READ ONLY, solo SELECT).
import { DESTINO_REAL, guardaDestino } from "./destinos.ts";
import type { DestinoUrl } from "./destinos.ts";
import { abrirConexiones } from "./leer-wordpress.ts";
import type { Conexiones, Consulta, Fila } from "./leer-wordpress.ts";
import { num, str } from "./utilidades.ts";

export { DESTINO_REAL, guardaDestino };
export type { DestinoUrl };
export const ORIGEN_WORDPRESS = Object.freeze({ host: "127.0.0.1", puerto: 3307, base: "evaristo_lectura" });
/** Versión mayor.menor que tiene que informar el servidor del CMS. */
export const VERSION_CMS = "8.4";

export interface DestinoServidor { puerto: number; base: string; readOnly: number; version: string }

/** Lo que el servidor dice de sí mismo: @@port, DATABASE(), @@read_only y @@version. */
export async function leerDestinoServidor(consulta: Consulta): Promise<DestinoServidor> {
  const [f] = (await consulta("SELECT @@port AS puerto, DATABASE() AS base, @@read_only AS ro, @@version AS version")) as [Fila];
  return { puerto: num(f["puerto"]), base: str(f["base"]), readOnly: num(f["ro"]), version: str(f["version"]) };
}

/** El servidor del CMS tiene que ser el esperado: puerto 3308, base evaristo_cms, escribible (@@read_only = 0) y MySQL 8.4.x. Lanza si no. */
export function verificarServidorCms(s: DestinoServidor): DestinoServidor {
  const problemas: string[] = [];
  if (s.puerto !== DESTINO_REAL.puerto) problemas.push(`@@port = ${s.puerto}`);
  if (s.base !== DESTINO_REAL.base) problemas.push(`DATABASE() = ${s.base || "NULL"}`);
  if (s.readOnly !== 0) problemas.push(`@@read_only = ${s.readOnly}`);
  if (s.version !== VERSION_CMS && !s.version.startsWith(`${VERSION_CMS}.`)) problemas.push(`@@version = ${s.version}`);
  if (problemas.length) throw new Error(`El servidor del CMS no es el esperado (${problemas.join("; ")}): la corrida se niega a seguir.`);
  return s;
}

/** WordPress tiene que ser 127.0.0.1:3307, base evaristo_lectura. */
export function verificarServidorWordPress(s: DestinoServidor): DestinoServidor {
  if (s.puerto !== ORIGEN_WORDPRESS.puerto || s.base !== ORIGEN_WORDPRESS.base) {
    throw new Error(`El servidor de WordPress no es el esperado (@@port = ${s.puerto}, DATABASE() = ${s.base || "NULL"}): la corrida se niega a seguir.`);
  }
  return s;
}

export interface ConexionesVerificadas extends Conexiones {
  destino: DestinoUrl;
  servidorCms: DestinoServidor;
  servidorWordPress: DestinoServidor;
}

/**
 * Abre las dos conexiones de solo lectura y verifica los destinos. El orden importa: primero la guarda sobre DATABASE_URL (sin abrir nada),
 * después abrirConexiones() (que comprueba que las sesiones estén en READ ONLY) y por último lo que dicen los servidores.
 */
export async function abrirConexionesVerificadas(databaseUrl: string | undefined = process.env["DATABASE_URL"]): Promise<ConexionesVerificadas> {
  const destino = guardaDestino(databaseUrl);
  const conexiones = await abrirConexiones();
  try {
    const servidorCms = verificarServidorCms(await leerDestinoServidor(conexiones.bd));
    const servidorWordPress = verificarServidorWordPress(await leerDestinoServidor(conexiones.wp));
    return { ...conexiones, destino, servidorCms, servidorWordPress };
  } catch (e) {
    await conexiones.cerrar();
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Argumentos del CLI (función pura)
// ---------------------------------------------------------------------------------------------------------------
export type Alcance = { tipo: "ids"; ids: number[] } | { tipo: "muestra" } | { tipo: "todos" };

export interface OpcionesCli {
  alcance: Alcance;
  modo: "simular" | "escribir";
  esperarArticulos: number | null;
  abortarAlPrimerError: boolean;
  sobrescribir: boolean;
  originales: string | null;
}

export class ErrorDeArgumentos extends Error {}

/** Lo que este tramo todavía no implementa. */
export const NO_IMPLEMENTADO: readonly string[] = ["--escribir", "--todos"];

/**
 * Interpreta los argumentos. `idsMuestra` son los 35 ids de la muestra, en el orden en que se arman.
 * Exactamente uno de --ids=a,b | --muestra | --todos; --simular (por defecto) o --escribir con --esperar-articulos=N;
 * --abortar-al-primer-error; --sobrescribir (solo con --escribir); --originales=<carpeta>. Todo lo demás se rechaza.
 */
export function parsearArgumentos(argv: readonly string[], idsMuestra: readonly number[]): OpcionesCli {
  const rechazar = (m: string): never => { throw new ErrorDeArgumentos(m); };
  const vistos = new Set<string>();
  const valor = (arg: string, nombre: string): string => {
    const v = arg.slice(nombre.length + 1);
    return v === "" ? rechazar(`${nombre} necesita un valor (${nombre}=...)`) : v;
  };
  let ids: string | null = null, muestra = false, todos = false, simular = false, escribir = false, esperar: string | null = null;
  let abortar = false, sobrescribir = false, originales: string | null = null;
  for (const arg of argv) {
    const nombre = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!arg.startsWith("--")) rechazar(`argumento desconocido: ${arg}`);
    if (vistos.has(nombre)) rechazar(`${nombre} está repetido`);
    vistos.add(nombre);
    const conValor = arg.includes("=");
    const sinValor = (n: string) => { if (conValor) rechazar(`${n} no lleva valor`); };
    switch (nombre) {
      case "--ids": if (!conValor) rechazar("--ids necesita un valor (--ids=1,2)"); ids = valor(arg, nombre); break;
      case "--muestra": sinValor(nombre); muestra = true; break;
      case "--todos": sinValor(nombre); todos = true; break;
      case "--simular": sinValor(nombre); simular = true; break;
      case "--escribir": sinValor(nombre); escribir = true; break;
      case "--esperar-articulos": if (!conValor) rechazar("--esperar-articulos necesita un valor (--esperar-articulos=N)"); esperar = valor(arg, nombre); break;
      case "--abortar-al-primer-error": sinValor(nombre); abortar = true; break;
      case "--sobrescribir": sinValor(nombre); sobrescribir = true; break;
      case "--originales": if (!conValor) rechazar("--originales necesita un valor (--originales=<carpeta>)"); originales = valor(arg, nombre); break;
      default: rechazar(`argumento desconocido: ${arg}`);
    }
  }

  const alcances = [ids !== null, muestra, todos].filter(Boolean).length;
  if (alcances !== 1) rechazar("hay que indicar exactamente uno de --ids=a,b | --muestra | --todos");
  if (simular && escribir) rechazar("--simular y --escribir no se pueden usar juntos");
  if (esperar !== null && !escribir) rechazar("--esperar-articulos solo se usa con --escribir");
  if (sobrescribir && !escribir) rechazar("--sobrescribir solo se usa con --escribir");
  let esperarArticulos: number | null = null;
  if (esperar !== null) {
    if (!/^\d+$/.test(esperar) || Number(esperar) < 1) rechazar(`--esperar-articulos tiene que ser un entero positivo (se recibió "${esperar}")`);
    esperarArticulos = Number(esperar);
  }
  if (escribir && esperarArticulos === null) rechazar("--escribir necesita --esperar-articulos=N");

  let alcance: Alcance;
  if (ids !== null) {
    const pedidos = ids.split(",").map((x) => x.trim());
    if (pedidos.some((x) => !/^\d+$/.test(x))) rechazar(`--ids tiene que ser una lista de números separados por coma (se recibió "${ids}")`);
    const numeros = pedidos.map(Number);
    const fuera = numeros.filter((n) => !idsMuestra.includes(n));
    if (fuera.length) rechazar(`--ids tiene ids que no son de la muestra de ${idsMuestra.length} artículos: ${[...new Set(fuera)].join(", ")}`);
    alcance = { tipo: "ids", ids: idsMuestra.filter((id) => numeros.includes(id)) };
  } else alcance = muestra ? { tipo: "muestra" } : { tipo: "todos" };

  // Los argumentos son válidos, pero estas opciones todavía no hacen nada en este tramo
  const pedidosSinImplementar = NO_IMPLEMENTADO.filter((n) => (n === "--escribir" ? escribir : todos));
  if (pedidosSinImplementar.length) rechazar(`${pedidosSinImplementar.join(" y ")}: no implementado en este tramo`);

  return { alcance, modo: escribir ? "escribir" : "simular", esperarArticulos, abortarAlPrimerError: abortar, sobrescribir, originales };
}
