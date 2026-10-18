// Una corrida de escritura de punta a punta: confirmar -> abrir la conexión -> (confirmar la sobrescritura) -> escribir -> informe.
// Este módulo importa escribir.ts, así que migrar.ts NO lo alcanza: hoy solo lo usan los tests, contra DESTINO_PRUEBAS.
// Las confirmaciones que no necesitan la base van ANTES de abrir ninguna conexión, y la de la sobrescritura antes de escribir la primera fila.
import { confirmarAntesDeConectar, confirmarSobrescritura, totalSobrescritura } from "./confirmaciones.ts";
import { abrirConexionEscritura, calcularSobrescrituras, escribirPlan } from "./escribir.ts";
import type { ConexionEscritura, PlanEscribible, ResultadoEscritura, Sobrescritura } from "./escribir.ts";
import { codigoDeSalida, construirInformeEscritura, escribirInformeEscritura } from "./informe-escritura.ts";
import type { InformeEscritura } from "./informe-escritura.ts";

export interface OpcionesCorrida {
  /** Una de las constantes de destinos.ts. */
  destino: unknown;
  plan: PlanEscribible;
  esperarArticulos: number | null;
  sobrescribir: boolean;
  esperarSobrescribir: number | null;
  abortarAlPrimerError: boolean;
  terminalInteractiva: boolean;
  baseTipeada: string | null;
  /** Si se pasa, el informe se escribe ahí (<fecha>-escribir.json y .md). */
  carpetaInformes?: string;
  ahora?: () => Date;
  /** Para los tests: reemplaza la apertura de la conexión (por defecto, abrirConexionEscritura). */
  abrir?: (destino: unknown) => Promise<ConexionEscritura>;
}

export type ResultadoCorrida =
  | { rechazada: true; motivos: string[]; codigoDeSalida: 2 }
  | { rechazada: false; resultado: ResultadoEscritura; informe: InformeEscritura; rutas: { json: string; md: string } | null; codigoDeSalida: number };

export async function correrEscritura(o: OpcionesCorrida): Promise<ResultadoCorrida> {
  // 1. lo que se confirma sin base: si falla, no se abre ninguna conexión
  const previa = confirmarAntesDeConectar({
    destino: o.destino, articulosEnElPlan: o.plan.articulos.length, esperarArticulos: o.esperarArticulos, sobrescribir: o.sobrescribir,
    esperarSobrescribir: o.esperarSobrescribir, terminalInteractiva: o.terminalInteractiva, baseTipeada: o.baseTipeada,
  });
  if (!previa.ok) return { rechazada: true, motivos: previa.motivos, codigoDeSalida: 2 };

  const conexion = await (o.abrir ?? abrirConexionEscritura)(o.destino);
  try {
    // 2. la sobrescritura se confirma contra la base, todavía sin escribir
    let sobrescribir: Sobrescritura | null = null;
    if (o.sobrescribir) {
      const calculados = await calcularSobrescrituras(conexion.prisma, o.plan);
      const c = confirmarSobrescritura(o.esperarSobrescribir, calculados);
      if (!c.ok) return { rechazada: true, motivos: c.motivos, codigoDeSalida: 2 };
      sobrescribir = { cantidad: totalSobrescritura(calculados), articulos: calculados.articulos, autores: calculados.autores, imagenes: calculados.imagenes };
    }
    // 3. escribir
    const resultado = await escribirPlan(conexion.prisma, o.plan, { abortarAlPrimerError: o.abortarAlPrimerError, sobrescribir });
    const informe = construirInformeEscritura({
      generadoEn: (o.ahora?.() ?? new Date()).toISOString(), destino: { host: conexion.destino.host, puerto: conexion.destino.puerto, base: conexion.destino.base }, servidor: conexion.servidor,
      opciones: { abortarAlPrimerError: o.abortarAlPrimerError, sobrescribir: o.sobrescribir, esperarArticulos: o.esperarArticulos, esperarSobrescribir: o.esperarSobrescribir },
      plan: o.plan, resultado,
    });
    const rutas = o.carpetaInformes ? escribirInformeEscritura(o.carpetaInformes, informe) : null;
    return { rechazada: false, resultado, informe, rutas, codigoDeSalida: codigoDeSalida(resultado) };
  } finally {
    await conexion.cerrar();
  }
}
