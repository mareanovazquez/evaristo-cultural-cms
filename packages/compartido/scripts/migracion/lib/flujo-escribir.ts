// El flujo completo del comando de escritura (migrar-escribir.ts): comprobaciones previas, plan con conexiones de solo lectura, resumen,
// confirmación y escritura. Es UN solo código: el comando real y los tests lo ejecutan igual; lo único que cambia son las DEPENDENCIAS.
//
// Las dependencias reales (destino DESTINO_REAL, el interruptor ESCRITURA_REAL_HABILITADA, la terminal y las conexiones de verdad) solo las
// construye dependenciasReales(), y las registra en un WeakSet que no se exporta: un objeto armado desde afuera no puede hacerse pasar por real.
// Si las dependencias NO son reales, el flujo se niega, antes de leer credenciales y de conectar, salvo que el destino sea DESTINO_PRUEBAS
// (comparación por identidad de objeto): con dependencias inyectadas nunca puede llegar al destino real ni a un destino que no sea constante.
import { readdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { abrirConexionesVerificadas } from "./conexiones.ts";
import type { ConexionesVerificadas } from "./conexiones.ts";
import { evaluarComando, resumenDelPlan } from "./comando-escribir.ts";
import { correrEscritura } from "./correr-escritura.ts";
import type { Credenciales } from "./credenciales.ts";
import { DESTINO_PRUEBAS, DESTINO_REAL, ESCRITURA_REAL_HABILITADA } from "./destinos.ts";
import { cargarDatosVersionados } from "./entrada-snapshot.ts";
import { abrirConexionEscritura } from "./escribir.ts";
import type { ConexionEscritura } from "./escribir.ts";
import { simular } from "./simular.ts";

export interface DependenciasFlujo {
  /** Una de las constantes de destinos.ts. Se compara por identidad de objeto. */
  readonly destino: unknown;
  /** El valor del interruptor de la escritura real. */
  readonly interruptor: boolean;
  readonly terminalInteractiva: boolean;
  /** Muestra la pregunta y devuelve lo que la persona tipeó. */
  readonly leerLinea: (pregunta: string) => Promise<string>;
  /** Las conexiones de SOLO LECTURA con las que se arma el plan. */
  readonly abrirLectura: () => Promise<ConexionesVerificadas>;
  /** La conexión de escritura (con las credenciales de migración). */
  readonly abrirEscritura: (destino: unknown, credenciales: Credenciales) => Promise<ConexionEscritura>;
  readonly idsMuestra: readonly number[];
  readonly carpetaInformes: string;
  readonly salida: { log: (texto: string) => void; error: (texto: string) => void };
}

/** Las dependencias que armó dependenciasReales(). No se exporta: es lo que las distingue de cualquier objeto armado afuera. */
const REALES = new WeakSet<object>();

/** Las dependencias del comando real: siempre las constantes, el interruptor de destinos.ts, la terminal y las conexiones de verdad. */
export function dependenciasReales(): DependenciasFlujo {
  const deps: DependenciasFlujo = Object.freeze({
    destino: DESTINO_REAL,
    interruptor: ESCRITURA_REAL_HABILITADA,
    terminalInteractiva: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    leerLinea: async (pregunta: string) => {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { return await terminal.question(pregunta); } finally { terminal.close(); }
    },
    abrirLectura: () => abrirConexionesVerificadas(),
    abrirEscritura: (destino: unknown, credenciales: Credenciales) => abrirConexionEscritura(destino, credenciales),
    idsMuestra: cargarDatosVersionados().ids,
    carpetaInformes: fileURLToPath(new URL("../../../out/migracion", import.meta.url)),
    salida: { log: (t: string) => console.log(t), error: (t: string) => console.error(t) },
  });
  REALES.add(deps);
  return deps;
}

/**
 * Pide el nombre de la base (lo que se exige para el destino real) y devuelve lo tipeado, sin espacios en los extremos.
 * Función aparte para probar el tipeo con una lectura de línea inyectada, sin conectar a nada.
 */
export async function pedirNombreDeBase(destino: { host: string; puerto: number; base: string }, leerLinea: (pregunta: string) => Promise<string>): Promise<string> {
  return (await leerLinea(`Para escribir en ${destino.host}:${destino.puerto} tipeá el nombre de la base (${destino.base}): `)).trim();
}

/**
 * El flujo del comando de escritura. Devuelve el código de salida (no llama a process.exit ni escribe en la consola: todo sale por deps.salida).
 * Orden: guarda de las dependencias, argumentos, interruptor, credenciales, carpeta de originales, plan (solo lectura), resumen, bloqueantes,
 * N de artículos, nombre de la base (si hay terminal interactiva) y recién entonces la conexión de escritura.
 */
export async function correrFlujoEscribir(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, deps: DependenciasFlujo): Promise<number> {
  const { log, error } = deps.salida;

  // 0. la guarda de las dependencias: antes de leer credenciales y de abrir cualquier conexión
  const real = REALES.has(deps);
  if (!real && (deps.destino === DESTINO_REAL || deps.destino !== DESTINO_PRUEBAS)) {
    error("flujo-escribir: con dependencias que no son las reales solo se admite DESTINO_PRUEBAS (por identidad); el destino real y cualquier otro se niegan. No se abrió ninguna conexión y no se escribió nada.");
    return 2;
  }
  const destino = deps.destino as typeof DESTINO_REAL | typeof DESTINO_PRUEBAS;

  // 1-3. argumentos, interruptor y credenciales: todo antes de abrir cualquier conexión
  const decision = evaluarComando(argv, env, deps.idsMuestra, deps.interruptor);
  if (!decision.ok) { error(decision.mensaje); return 2; }
  const { opciones, credenciales } = decision;
  try { readdirSync(opciones.originales!); } catch {
    error(`Error en los argumentos: --originales: no se puede leer la carpeta ${opciones.originales}`);
    return 2;
  }

  // El plan se arma con las conexiones de SOLO LECTURA (WordPress y el CMS), como en la simulación
  const lectura = await deps.abrirLectura();
  let resultadoPlan;
  try {
    resultadoPlan = await simular({ ...opciones, modo: "simular" }, lectura, { destinoPermitido: destino });
  } finally {
    await lectura.cerrar();
  }
  const { informe, preparado } = resultadoPlan;
  const plan = preparado.plan;

  // El resumen se muestra siempre, antes de cualquier confirmación
  log("Plan de escritura (se armó con conexiones de solo lectura; todavía no se escribió nada):");
  for (const linea of resumenDelPlan(informe, destino)) log(`  ${linea}`);

  if (informe.bloqueantes.length || plan.articulos.length === 0) {
    error(`No se escribe: ${informe.bloqueantes.length ? `hay ${informe.bloqueantes.length} bloqueante(s)` : "el plan no tiene artículos"}.`);
    return 1;
  }
  if (opciones.abortarAlPrimerError && informe.problemasDeArticulo.length) {
    error(`--abortar-al-primer-error: hay ${informe.problemasDeArticulo.length} problema(s) de artículo en el plan; no se escribe.`);
    return 1;
  }
  if (opciones.esperarArticulos !== plan.articulos.length) {
    error(`--esperar-articulos=${opciones.esperarArticulos} no coincide con los ${plan.articulos.length} artículos del plan. No se abrió ninguna conexión de escritura y no se escribió nada.`);
    return 2;
  }

  // Para el destino real: terminal interactiva y tipear el nombre de la base
  const baseTipeada = deps.terminalInteractiva ? await pedirNombreDeBase(destino, deps.leerLinea) : null;

  const corrida = await correrEscritura({
    destino, plan, esperarArticulos: opciones.esperarArticulos, sobrescribir: opciones.sobrescribir, esperarSobrescribir: opciones.esperarSobrescribir,
    abortarAlPrimerError: opciones.abortarAlPrimerError, terminalInteractiva: deps.terminalInteractiva, baseTipeada, carpetaInformes: deps.carpetaInformes,
    abrir: (d) => deps.abrirEscritura(d, credenciales),
  });
  if (corrida.rechazada) {
    error(`No se escribió nada: ${corrida.motivos.join("; ")}`);
    return corrida.codigoDeSalida;
  }
  const r = corrida.resultado;
  log(`Escritura en ${corrida.informe.destino.host}:${corrida.informe.destino.puerto}/${corrida.informe.destino.base}: estado ${r.estado}${r.abortado ? " (abortada al primer error)" : ""}`);
  log(`Artículos: ${JSON.stringify(r.conteos)} | redirecciones: ${JSON.stringify(r.redirecciones)} | conflictos: ${r.conflictos.length}`);
  log(`Sobrescritura (solo ids): ${JSON.stringify(r.idsSobrescritos)}`);
  if (corrida.rutas) log(`Informe: ${corrida.rutas.md}`);
  return corrida.codigoDeSalida;
}
