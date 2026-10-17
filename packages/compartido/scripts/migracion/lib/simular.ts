// La simulación de la migración: lee, arma, mide, valida y cuenta lo que se haría, sin escribir en ninguna base.
// Recibe las conexiones ya abiertas (de solo lectura) y devuelve el informe; escribirlo en disco es cosa de quien llama.
import { DESTINO_PERMITIDO } from "./conexiones.ts";
import type { ConexionesVerificadas, OpcionesCli } from "./conexiones.ts";
import { EjecutorNulo } from "./ejecutor.ts";
import type { ResumenEjecucion } from "./ejecutor.ts";
import type { EntradaArmar } from "./armar.ts";
import { entradaEnVivo } from "./entrada-vivo.ts";
import { construirInforme } from "./informe.ts";
import type { Informe } from "./informe.ts";
import { leerCuentas } from "./leer-wordpress.ts";
import type { Consulta } from "./leer-wordpress.ts";
import { prepararPlan } from "./preparar.ts";
import type { OpcionesPreparar, Preparado } from "./preparar.ts";
import { leerLargosSchema, cuentasDeFilas } from "./validar.ts";

export interface DependenciasSimular {
  /** Cómo se lee la entrada de armar(). Por defecto, en vivo de WordPress y del CMS. */
  leerEntrada?: (wp: Consulta, bd: Consulta) => Promise<EntradaArmar>;
  largos?: ReadonlyMap<string, number>;
  medir?: OpcionesPreparar["medir"];
  ahora?: () => Date;
}

export interface ResultadoSimulacion { informe: Informe; preparado: Preparado; ejecucion: ResumenEjecucion }

export async function simular(
  opciones: OpcionesCli, conexiones: Pick<ConexionesVerificadas, "wp" | "bd" | "destino" | "servidorCms" | "servidorWordPress">, deps: DependenciasSimular = {},
): Promise<ResultadoSimulacion> {
  if (opciones.modo !== "simular") throw new Error("simular() solo corre en modo simular");
  if (opciones.originales === null) throw new Error("Falta --originales=<carpeta> para medir las imágenes");
  if (opciones.alcance.tipo === "todos") throw new Error("--todos: no implementado en este tramo");
  const { wp, bd } = conexiones;

  const entrada = await (deps.leerEntrada ?? entradaEnVivo)(wp, bd);
  const ids = opciones.alcance.tipo === "ids" ? entrada.ids.filter((id) => (opciones.alcance as { ids: number[] }).ids.includes(id)) : entrada.ids;
  entrada.ids = ids;

  const filasCuentasWp = cuentasDeFilas(await leerCuentas(wp, entrada.cuentas.map((c) => c.wpUserId)));
  const preparado = await prepararPlan({
    entrada, carpetaOriginales: opciones.originales, bd, largos: deps.largos ?? leerLargosSchema(), cuentas: entrada.cuentas, filasCuentasWp,
    destino: { host: conexiones.destino.host, puerto: conexiones.servidorCms.puerto, base: conexiones.servidorCms.base }, destinoPermitido: DESTINO_PERMITIDO,
    ...(deps.medir ? { medir: deps.medir } : {}),
  });
  const ejecucion = await new EjecutorNulo(bd).ejecutar(preparado.plan);
  const informe = construirInforme({ generadoEn: (deps.ahora?.() ?? new Date()).toISOString(), opciones, ids, conexiones, preparado, ejecucion });
  return { informe, preparado, ejecucion };
}
