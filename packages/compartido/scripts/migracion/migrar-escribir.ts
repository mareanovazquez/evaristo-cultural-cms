// Comando de ESCRITURA de la migración: el ÚNICO programa que alcanza correr-escritura.ts y escribir.ts. migrar.ts sigue siendo solo simulación.
// El destino es siempre DESTINO_REAL (127.0.0.1:3308/evaristo_cms); no hay opción de destino. Mientras ESCRITURA_REAL_HABILITADA sea false
// (lib/destinos.ts) este comando se niega con salida 2 ANTES de abrir ninguna conexión, de lectura o de escritura.
//
// Uso: npm run migrar:escribir -w @evaristo/compartido -- (--muestra | --ids=a,b) --esperar-articulos=N --originales=<carpeta> [--abortar-al-primer-error]
//                                                           [--sobrescribir --esperar-sobrescribir=N]
// Credenciales: usuario y clave de DATABASE_URL_MIGRACION (host, puerto y base salen de la constante del destino). Nunca se imprime la clave.
// Informe: packages/compartido/out/migracion/<fecha>-escribir.json y .md (ignorados por git)
import { readdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { abrirConexionesVerificadas } from "./lib/conexiones.ts";
import { evaluarComando, resumenDelPlan } from "./lib/comando-escribir.ts";
import { correrEscritura } from "./lib/correr-escritura.ts";
import { DESTINO_REAL } from "./lib/destinos.ts";
import { cargarDatosVersionados } from "./lib/entrada-snapshot.ts";
import { abrirConexionEscritura } from "./lib/escribir.ts";
import { simular } from "./lib/simular.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
const CARPETA_INFORMES = fileURLToPath(new URL("../../out/migracion", import.meta.url));

// 1-3. argumentos, interruptor y credenciales: todo antes de abrir cualquier conexión
const decision = evaluarComando(process.argv.slice(2), process.env, cargarDatosVersionados().ids);
if (!decision.ok) {
  console.error(decision.mensaje);
  process.exit(2);
}
const { opciones, credenciales } = decision;
try { readdirSync(opciones.originales!); } catch {
  console.error(`Error en los argumentos: --originales: no se puede leer la carpeta ${opciones.originales}`);
  process.exit(2);
}

// El plan se arma con las conexiones de SOLO LECTURA (WordPress y el CMS), como en la simulación
const lectura = await abrirConexionesVerificadas();
let resultadoPlan;
try {
  resultadoPlan = await simular({ ...opciones, modo: "simular" }, lectura);
} finally {
  await lectura.cerrar();
}
const { informe, preparado } = resultadoPlan;
const plan = preparado.plan;

// El resumen se muestra siempre, antes de cualquier confirmación
console.log(`Plan de escritura (se armó con conexiones de solo lectura; todavía no se escribió nada):`);
for (const linea of resumenDelPlan(informe)) console.log(`  ${linea}`);

if (informe.bloqueantes.length || plan.articulos.length === 0) {
  console.error(`No se escribe: ${informe.bloqueantes.length ? `hay ${informe.bloqueantes.length} bloqueante(s)` : "el plan no tiene artículos"}.`);
  process.exit(1);
}
if (opciones.abortarAlPrimerError && informe.problemasDeArticulo.length) {
  console.error(`--abortar-al-primer-error: hay ${informe.problemasDeArticulo.length} problema(s) de artículo en el plan; no se escribe.`);
  process.exit(1);
}
if (opciones.esperarArticulos !== plan.articulos.length) {
  console.error(`--esperar-articulos=${opciones.esperarArticulos} no coincide con los ${plan.articulos.length} artículos del plan. No se abrió ninguna conexión de escritura y no se escribió nada.`);
  process.exit(2);
}

// Para el destino real: terminal interactiva y tipear el nombre de la base
const terminalInteractiva = Boolean(process.stdin.isTTY && process.stdout.isTTY);
let baseTipeada: string | null = null;
if (terminalInteractiva) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { baseTipeada = (await terminal.question(`Para escribir en ${DESTINO_REAL.host}:${DESTINO_REAL.puerto} tipeá el nombre de la base (${DESTINO_REAL.base}): `)).trim(); } finally { terminal.close(); }
}

const corrida = await correrEscritura({
  destino: DESTINO_REAL, plan, esperarArticulos: opciones.esperarArticulos, sobrescribir: opciones.sobrescribir, esperarSobrescribir: opciones.esperarSobrescribir,
  abortarAlPrimerError: opciones.abortarAlPrimerError, terminalInteractiva, baseTipeada, carpetaInformes: CARPETA_INFORMES,
  abrir: (destino) => abrirConexionEscritura(destino, credenciales),
});
if (corrida.rechazada) {
  console.error(`No se escribió nada: ${corrida.motivos.join("; ")}`);
  process.exit(corrida.codigoDeSalida);
}
const r = corrida.resultado;
console.log(`Escritura en ${corrida.informe.destino.host}:${corrida.informe.destino.puerto}/${corrida.informe.destino.base}: estado ${r.estado}${r.abortado ? " (abortada al primer error)" : ""}`);
console.log(`Artículos: ${JSON.stringify(r.conteos)} | redirecciones: ${JSON.stringify(r.redirecciones)} | conflictos: ${r.conflictos.length}`);
console.log(`Sobrescritura (solo ids): ${JSON.stringify(r.idsSobrescritos)}`);
if (corrida.rutas) console.log(`Informe: ${corrida.rutas.md}`);
process.exitCode = corrida.codigoDeSalida;
