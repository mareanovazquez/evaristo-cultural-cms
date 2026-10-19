// Dependencias DE PRUEBA para lib/flujo-escribir.ts. Solo los tests importan este módulo: ningún archivo de producción lo conoce (T22).
// Estas dependencias nunca son "reales" (solo dependenciasReales() produce las reales), así que el flujo solo las acepta con DESTINO_PRUEBAS.
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConexionesVerificadas } from "../lib/conexiones.ts";
import { DESTINO_PRUEBAS } from "../lib/destinos.ts";
import { cargarDatosVersionados } from "../lib/entrada-snapshot.ts";
import type { ConexionEscritura } from "../lib/escribir.ts";
import type { Credenciales } from "../lib/credenciales.ts";
import type { DependenciasFlujo } from "../lib/flujo-escribir.ts";

export interface RastroDePrueba {
  deps: DependenciasFlujo;
  /** Cuántas veces el flujo pidió una conexión de lectura, una de escritura o la lectura de una línea. */
  llamadas: { lectura: number; escritura: number; linea: number };
  /** Lo que el flujo escribió por su salida. */
  log: string[];
  error: string[];
  /** Las preguntas que se mostraron. */
  preguntas: string[];
}

/**
 * Dependencias que NO se conectan a nada: abrirLectura y abrirEscritura fallan si el flujo llega a pedirlas (y lo cuentan). Con `cambios` se
 * reemplaza lo que haga falta: otro destino, otro valor del interruptor, otra terminal, conexiones de verdad, etc.
 */
export function dependenciasDePrueba(cambios: Partial<DependenciasFlujo> = {}, respuestas: string[] = []): RastroDePrueba {
  const llamadas = { lectura: 0, escritura: 0, linea: 0 };
  const log: string[] = [], error: string[] = [], preguntas: string[] = [];
  const deps: DependenciasFlujo = {
    destino: DESTINO_PRUEBAS,
    interruptor: true,
    terminalInteractiva: false,
    leerLinea: async (pregunta: string) => { llamadas.linea++; preguntas.push(pregunta); return respuestas.shift() ?? ""; },
    abrirLectura: async (): Promise<ConexionesVerificadas> => { llamadas.lectura++; throw new Error("el flujo no debía abrir una conexión de lectura"); },
    abrirEscritura: async (_destino: unknown, _credenciales: Credenciales): Promise<ConexionEscritura> => { llamadas.escritura++; throw new Error("el flujo no debía abrir una conexión de escritura"); },
    idsMuestra: cargarDatosVersionados().ids,
    carpetaInformes: join(tmpdir(), "flujo-escribir-pruebas"),
    salida: { log: (t) => { log.push(t); }, error: (t) => { error.push(t); } },
    ...cambios,
  };
  return { deps, llamadas, log, error, preguntas };
}
