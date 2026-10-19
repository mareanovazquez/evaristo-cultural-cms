// Las decisiones del comando de escritura (migrar-escribir.ts) que no necesitan ninguna conexión: funciones PURAS, sin base, sin disco y sin
// terminal. Este módulo NO importa escribir.ts ni correr-escritura.ts: el único que los alcanza es migrar-escribir.ts.
// El destino es siempre DESTINO_REAL (no hay opción de destino) y las credenciales salen SOLO de DATABASE_URL_MIGRACION, sin respaldo a otra variable.
import { ErrorDeArgumentos, parsearArgumentos } from "./conexiones.ts";
import type { OpcionesCli } from "./conexiones.ts";
import { credencialesDeUrl, ErrorDeCredenciales } from "./credenciales.ts";
import type { Credenciales } from "./credenciales.ts";
import { DESTINO_REAL, ESCRITURA_REAL_HABILITADA } from "./destinos.ts";
import type { Informe } from "./informe.ts";
import { ocultarCorreos } from "./utilidades.ts";

export const USO = [
  "Uso: migrar-escribir.ts (--muestra | --ids=a,b) --esperar-articulos=N --originales=<carpeta> [--abortar-al-primer-error]",
  "                        [--sobrescribir --esperar-sobrescribir=N]   (N = total de filas que se reescribirían: artículos + autores + imágenes)",
].join("\n");

export type DecisionComando =
  | { ok: false; codigoDeSalida: 2; mensaje: string }
  | { ok: true; opciones: OpcionesCli; credenciales: Credenciales };

const rechazo = (mensaje: string): DecisionComando => ({ ok: false, codigoDeSalida: 2, mensaje });

/**
 * Lo que se decide ANTES de abrir ninguna conexión, en este orden: 1) argumentos válidos, 2) el interruptor de la escritura real,
 * 3) las credenciales de DATABASE_URL_MIGRACION. La primera que falla gana (con el interruptor en false el mensaje es el del interruptor, falten
 * o no las credenciales). `interruptor` es solo para probar la función: el comando le pasa siempre la constante ESCRITURA_REAL_HABILITADA.
 */
export function evaluarComando(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, idsMuestra: readonly number[], interruptor: boolean = ESCRITURA_REAL_HABILITADA): DecisionComando {
  // 1. argumentos: se reutiliza el parseador; este comando siempre escribe, así que --escribir va implícito (y se acepta repetido a mano)
  if (argv.includes("--simular")) return rechazo(`Error en los argumentos: este comando no acepta --simular (la simulación es migrar.ts)\n${USO}`);
  let opciones: OpcionesCli;
  try {
    opciones = parsearArgumentos(argv.includes("--escribir") ? argv : ["--escribir", ...argv], idsMuestra);
    if (opciones.originales === null) throw new ErrorDeArgumentos("--originales=<carpeta> es obligatorio para medir las imágenes");
  } catch (e) {
    if (!(e instanceof ErrorDeArgumentos)) throw e;
    return rechazo(`Error en los argumentos: ${e.message}\n${USO}`);
  }
  // 2. el interruptor
  if (!interruptor) {
    return rechazo(`migrar-escribir: la escritura en el destino real (${DESTINO_REAL.host}:${DESTINO_REAL.puerto}/${DESTINO_REAL.base}) está deshabilitada (ESCRITURA_REAL_HABILITADA = false en lib/destinos.ts). No se abrió ninguna conexión y no se escribió nada.`);
  }
  // 3. las credenciales: solo DATABASE_URL_MIGRACION
  let credenciales: Credenciales;
  try { credenciales = credencialesDeUrl(env["DATABASE_URL_MIGRACION"], "DATABASE_URL_MIGRACION"); } catch (e) {
    if (!(e instanceof ErrorDeCredenciales)) throw e;
    return rechazo(`migrar-escribir: ${e.message}. No se abrió ninguna conexión y no se escribió nada.`);
  }
  return { ok: true, opciones, credenciales };
}

/**
 * El resumen del plan que el comando muestra siempre antes de confirmar: destino, ids, filas por tabla a crear y a omitir, categorías a crear,
 * imágenes y bytes, originales faltantes, redirecciones por tipo, conflictos y avisos por código. Sin correos ni bios.
 */
export function resumenDelPlan(i: Informe, destino: { host: string; puerto: number; base: string } = DESTINO_REAL): string[] {
  const l: string[] = [];
  l.push(`Destino: ${destino.host}:${destino.puerto}/${destino.base} (MySQL ${i.destino.servidorCms.version}); origen WordPress ${i.destino.servidorWordPress.puerto}/${i.destino.servidorWordPress.base}`);
  l.push(`Artículos del plan: ${i.resumen.articulosEnElPlan} de ${i.resumen.articulosEnLaMuestra} pedidos (ids ${i.articulos.map((a) => a.wpId).join(", ") || "ninguno"}); estados ${JSON.stringify(i.resumen.estados)}`);
  l.push(`Filas por tabla (a crear / a omitir porque ya existen): ${i.tablas.map((t) => `${t.tabla} ${t.insertar}/${t.yaExisteSinComparar ?? "—"}`).join(", ")}`);
  l.push(`Categorías a crear (${i.categoriasACrear.length}): ${i.categoriasACrear.map((c) => c.slug).join(", ") || "ninguna"}`);
  l.push(`Imágenes: ${i.imagenes.referenciadas} referenciadas, ${i.imagenes.conFila} con fila (${i.imagenes.bytesTotales} bytes)`);
  l.push(`Originales faltantes (${i.imagenes.originalesFaltantes.length}): adjuntos ${i.imagenes.originalesFaltantes.map((x) => x.adjuntoWpId).join(", ") || "ninguno"}; imágenes sin medir: ${i.imagenes.sinMedir.length}`);
  l.push(`Redirecciones: ${i.redirecciones.total} ${JSON.stringify(i.redirecciones.porTipo)}`);
  l.push(`Conflictos: ${i.conflictos.length}${i.conflictos.length ? ` (${i.conflictos.map((c) => `${c.tabla}:${c.clave}`).join(", ")})` : ""}`);
  l.push(`Problemas de artículo: ${i.problemasDeArticulo.length ? i.problemasDeArticulo.map((p) => `${p.wpId}:${p.codigo}`).join(", ") : "ninguno"}`);
  l.push(`Bloqueantes: ${i.bloqueantes.length ? i.bloqueantes.map((b) => b.codigo).join(", ") : "ninguno"}`);
  l.push(`Avisos por código (artículos): ${JSON.stringify(Object.fromEntries(Object.entries(i.avisosPorCodigo).map(([k, v]) => [k, v.articulos])))}`);
  return l.map(ocultarCorreos);
}
