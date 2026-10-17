// De la entrada ya leída al Plan validado: armar -> medir las imágenes -> armar con las mediciones -> validar -> armar sin los excluidos.
// Las partes impuras entran por parámetro (la base como `bd`, la medición del disco como `medir`): con dobles de prueba no toca nada.
import { armar } from "./armar.ts";
import type { EntradaArmar, Plan } from "./armar.ts";
import { medirImagenes } from "./imagenes.ts";
import type { Medicion } from "./imagenes.ts";
import type { Consulta } from "./leer-wordpress.ts";
import { validarPlan } from "./validar.ts";
import type { DestinoReal, ResultadoValidacion } from "./validar.ts";
import type { CuentaSoloTexto } from "./armar.ts";

export interface OpcionesPreparar {
  entrada: EntradaArmar;
  carpetaOriginales: string;
  bd: Consulta;
  largos: ReadonlyMap<string, number>;
  cuentas: readonly CuentaSoloTexto[];
  filasCuentasWp: ReadonlyArray<{ id: number; login: string; nombre: string }>;
  destino: DestinoReal;
  destinoPermitido: DestinoReal;
  /** Para los tests: reemplaza la lectura del disco. */
  medir?: (carpeta: string, claves: Iterable<string>) => Map<string, Medicion>;
}

export interface Preparado {
  /** El plan final: sin los artículos que la validación excluyó. */
  plan: Plan;
  /** El plan antes de excluir (con todos los artículos que armar() pudo armar). */
  planCompleto: Plan;
  validacion: ResultadoValidacion;
  mediciones: ReadonlyMap<string, Medicion>;
}

export async function prepararPlan(o: OpcionesPreparar): Promise<Preparado> {
  // 1. sin mediciones: solo para saber qué imágenes referencia el plan
  const primera = armar(o.entrada);
  const claves = primera.imagenesReferenciadas.map((i) => i.claveAdjunto).filter((c): c is string => c !== null);
  const mediciones = (o.medir ?? medirImagenes)(o.carpetaOriginales, claves);
  // 2. con las mediciones: encabezados, filas de imagen y cuerpo enlazado
  const planCompleto = armar({ ...o.entrada, mediciones });
  // 3. validación (bloqueantes, exclusiones por artículo, colisiones decididas por la base)
  const validacion = await validarPlan({
    plan: planCompleto, bd: o.bd, largos: o.largos, cuentas: o.cuentas, filasCuentasWp: o.filasCuentasWp, destino: o.destino, destinoPermitido: o.destinoPermitido,
  });
  // 4. sin los excluidos, para que redirecciones, autores, categorías e imágenes queden coherentes con lo que migra
  const plan = validacion.excluidos.size ? armar({ ...o.entrada, mediciones, excluidos: validacion.excluidos }) : planCompleto;
  return { plan, planCompleto, validacion, mediciones };
}
