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

// ---------------------------------------------------------------------------------------------------------------
// Dependencias de prueba EN VIVO: WordPress (3307) en solo lectura, el CMS de lectura = evaristo_cms_test (usuario evaristo, READ ONLY) y la
// escritura con las credenciales que reciba el flujo (las de evaristo_migracion) contra DESTINO_PRUEBAS.
// ---------------------------------------------------------------------------------------------------------------
import { leerDestinoServidor, verificarServidorWordPress } from "../lib/conexiones.ts";
import { abrirConexionEscritura, abrirConexionLectura } from "../lib/escribir.ts";
import { abrirSoloWordPress } from "../lib/leer-wordpress.ts";

export interface RastroEnVivo extends RastroDePrueba {
  /** CURRENT_USER() de cada conexión de escritura que abrió el flujo, y el error (textual) si alguna falló. */
  usuariosDeEscritura: string[];
  erroresDeApertura: string[];
}

export function dependenciasDePruebaEnVivo(cambios: Partial<DependenciasFlujo> = {}, respuestas: string[] = []): RastroEnVivo {
  const rastro = dependenciasDePrueba({}, respuestas) as RastroEnVivo;
  rastro.usuariosDeEscritura = [];
  rastro.erroresDeApertura = [];
  const base = rastro.deps;
  const deps: DependenciasFlujo = {
    ...base,
    abrirLectura: async (): Promise<ConexionesVerificadas> => {
      rastro.llamadas.lectura++;
      const wp = await abrirSoloWordPress();
      try {
        const cms = await abrirConexionLectura(DESTINO_PRUEBAS);
        try {
          const servidorWordPress = verificarServidorWordPress(await leerDestinoServidor(wp.wp));
          return {
            wp: wp.wp, bd: cms.bd, destino: { host: DESTINO_PRUEBAS.host, puerto: DESTINO_PRUEBAS.puerto, base: DESTINO_PRUEBAS.base },
            servidorCms: { puerto: cms.servidor.puerto, base: cms.servidor.base, readOnly: 0, version: cms.servidor.version }, servidorWordPress,
            cerrar: async () => { await wp.cerrar(); await cms.cerrar(); },
          };
        } catch (e) { await cms.cerrar(); throw e; }
      } catch (e) { await wp.cerrar(); throw e; }
    },
    abrirEscritura: async (destino: unknown, credenciales: Credenciales): Promise<ConexionEscritura> => {
      rastro.llamadas.escritura++;
      try {
        const c = await abrirConexionEscritura(destino, credenciales);
        const [f] = await c.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("SELECT CURRENT_USER() AS u");
        rastro.usuariosDeEscritura.push(String(f?.["u"]));
        return c;
      } catch (e) { rastro.erroresDeApertura.push(e instanceof Error ? e.message : String(e)); throw e; }
    },
    ...cambios,
  };
  rastro.deps = deps;
  return rastro;
}
