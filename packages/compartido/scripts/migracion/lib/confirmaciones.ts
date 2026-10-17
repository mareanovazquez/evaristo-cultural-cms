// Confirmaciones de la escritura: funciones PURAS (sin base, sin disco, sin terminal) que deciden si una corrida de escritura puede seguir.
// Este módulo solo importa destinos.ts: migrar.ts lo usa y NO alcanza escribir.ts. Quien escribe (correr-escritura.ts) las llama ANTES de
// abrir ninguna conexión de escritura y, para la sobrescritura, antes de escribir la primera fila.
import { DESTINO_REAL, ESCRITURA_REAL_HABILITADA } from "./destinos.ts";

export type ResultadoConfirmacion = { ok: true } | { ok: false; motivos: string[] };

const resultado = (motivos: string[]): ResultadoConfirmacion => (motivos.length ? { ok: false, motivos } : { ok: true });

/** Qué hace el CLI cuando se le pide --escribir. Con el interruptor en false se niega siempre, antes de abrir ninguna conexión. */
export function decidirEscrituraCli(): { permitido: boolean; mensaje: string } {
  if (!ESCRITURA_REAL_HABILITADA) {
    return {
      permitido: false,
      mensaje: "--escribir: la escritura en el destino real está deshabilitada (ESCRITURA_REAL_HABILITADA = false en lib/destinos.ts). No se abrió ninguna conexión de escritura y no se escribió nada.",
    };
  }
  return { permitido: false, mensaje: "--escribir: la ejecución de la escritura desde el CLI todavía no está cableada. No se abrió ninguna conexión de escritura y no se escribió nada." };
}

export interface EntradaConfirmacion {
  /** El destino de la corrida: una de las constantes de destinos.ts. */
  destino: unknown;
  articulosEnElPlan: number;
  /** El N de --esperar-articulos. */
  esperarArticulos: number | null;
  sobrescribir: boolean;
  /** El N de --esperar-sobrescribir. */
  esperarSobrescribir: number | null;
  /** ¿La terminal es interactiva (stdin y stdout son TTY)? */
  terminalInteractiva: boolean;
  /** Lo que la persona tipeó cuando se le pidió el nombre de la base (solo se pide para el destino real). */
  baseTipeada: string | null;
}

/**
 * Lo que se puede confirmar sin tocar la base: el N de --esperar-articulos tiene que ser igual a la cantidad de artículos del plan, las opciones
 * de sobrescritura tienen que ser coherentes y, para el destino real, hace falta que el interruptor esté habilitado, una terminal interactiva
 * y que se haya tipeado el nombre exacto de la base. Sin terminal interactiva el destino real se niega.
 */
export function confirmarAntesDeConectar(e: EntradaConfirmacion): ResultadoConfirmacion {
  const motivos: string[] = [];
  if (e.esperarArticulos === null) motivos.push("falta --esperar-articulos=N");
  else if (e.esperarArticulos !== e.articulosEnElPlan) motivos.push(`--esperar-articulos=${e.esperarArticulos} no coincide con los ${e.articulosEnElPlan} artículos del plan`);
  if (e.sobrescribir && e.esperarSobrescribir === null) motivos.push("falta --esperar-sobrescribir=N");
  if (!e.sobrescribir && e.esperarSobrescribir !== null) motivos.push("--esperar-sobrescribir solo se usa con --sobrescribir");
  if (e.destino === DESTINO_REAL) {
    if (!ESCRITURA_REAL_HABILITADA) motivos.push("la escritura en el destino real está deshabilitada (ESCRITURA_REAL_HABILITADA = false)");
    if (!e.terminalInteractiva) motivos.push("el destino real exige una terminal interactiva: sin ella se niega");
    else if (e.baseTipeada !== DESTINO_REAL.base) motivos.push(`para escribir en el destino real hay que tipear el nombre de la base (${DESTINO_REAL.base})`);
  }
  return resultado(motivos);
}

/**
 * La cantidad de --esperar-sobrescribir tiene que ser igual a la de artículos que se reescribirían (los que ya existen y difieren del plan).
 * Si no coincide no se escribe nada.
 */
export function confirmarSobrescritura(esperar: number | null, calculados: readonly number[]): ResultadoConfirmacion {
  if (esperar === null) return resultado(["falta --esperar-sobrescribir=N"]);
  if (esperar !== calculados.length) return resultado([`--esperar-sobrescribir=${esperar} no coincide con los ${calculados.length} artículos que se reescribirían (${calculados.join(", ") || "ninguno"})`]);
  return { ok: true };
}
