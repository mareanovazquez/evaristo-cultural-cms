// Migración de la muestra de WordPress al CMS. En este tramo SOLO SIMULA (--escribir se acepta pero se niega, sin abrir ninguna conexión): lee WordPress (127.0.0.1:3307) y el CMS (127.0.0.1:3308),
// arma y valida el plan, mide las imágenes originales y escribe un informe. No escribe en ninguna base: las dos conexiones abren la
// sesión en READ ONLY, todo pasa por consultar() (solo SELECT) y este programa no importa ningún cliente con permiso de escritura.
//
// Uso: npm run migrar -w @evaristo/compartido -- --muestra --simular --originales=<carpeta de originales>
// Informe: packages/compartido/out/migracion/<fecha>-simular.json y .md (ignorados por git)
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { cargarDatosVersionados } from "./lib/entrada-snapshot.ts";
import { abrirConexionesVerificadas, ErrorDeArgumentos, parsearArgumentos } from "./lib/conexiones.ts";
import { decidirEscrituraCli } from "./lib/confirmaciones.ts";
import { escribirInforme } from "./lib/informe.ts";
import { simular } from "./lib/simular.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
const CARPETA_INFORMES = fileURLToPath(new URL("../../out/migracion", import.meta.url));

let opciones;
try {
  opciones = parsearArgumentos(process.argv.slice(2), cargarDatosVersionados().ids);
  // --escribir se acepta al parsear, pero este programa no escribe: se niega ANTES de abrir ninguna conexión (ni siquiera de lectura)
  if (opciones.modo === "escribir") {
    console.error(decidirEscrituraCli().mensaje);
    process.exit(2);
  }
  if (opciones.originales === null) throw new ErrorDeArgumentos("--originales=<carpeta> es obligatorio para medir las imágenes");
  try { readdirSync(opciones.originales); } catch { throw new ErrorDeArgumentos(`--originales: no se puede leer la carpeta ${opciones.originales}`); }
} catch (e) {
  if (!(e instanceof ErrorDeArgumentos)) throw e;
  console.error(`Error en los argumentos: ${e.message}`);
  console.error("Uso: migrar.ts (--muestra | --ids=a,b) [--simular] --originales=<carpeta> [--abortar-al-primer-error]");
  console.error("     migrar.ts (--muestra | --ids=a,b) --escribir --esperar-articulos=N [--sobrescribir --esperar-sobrescribir=N] --originales=<carpeta>   (hoy se niega)");
  process.exit(2);
}

const conexiones = await abrirConexionesVerificadas();
try {
  const { informe, preparado } = await simular(opciones, conexiones);
  const rutas = escribirInforme(CARPETA_INFORMES, informe);
  const r = informe.resumen;
  console.log(`Simulación (solo lectura) contra ${informe.destino.url.host}:${informe.destino.url.puerto}/${informe.destino.url.base}, MySQL ${informe.destino.servidorCms.version}`);
  console.log(`Artículos: ${r.convertidos} convertidos, ${r.invalidos} inválidos, ${r.excluidos} excluidos; estados ${JSON.stringify(r.estados)}`);
  console.log(`Redirecciones: ${informe.redirecciones.total} ${JSON.stringify(informe.redirecciones.porTipo)} | categorías a crear: ${informe.categoriasACrear.length}`);
  console.log(`Imágenes: ${informe.imagenes.referenciadas} referenciadas, ${informe.imagenes.conFila} con fila (${informe.imagenes.bytesTotales} bytes), ${informe.imagenes.originalesFaltantes.length} original_faltante, ${informe.imagenes.sinMedir.length} imagen_sin_medir`);
  console.log(`Avisos: ${JSON.stringify(informe.avisosPorCodigo)}`);
  console.log(`Bios con correo (sin el correo): ${JSON.stringify(informe.biosConCorreo)}`);
  console.log(`Intercalación: ${informe.intercalaciones.map((c) => `${c.tabla}.${c.columna}=${c.real}`).join(", ")}`);
  console.log(`Filas por tabla (a insertar / ya existen): ${informe.tablas.map((t) => `${t.tabla} ${t.insertar}/${t.yaExisteSinComparar ?? "—"}`).join(", ")}`);
  console.log(`Conflictos: ${informe.conflictos.length} | problemas de artículo: ${JSON.stringify(informe.problemasDeArticulo.map((p) => `${p.wpId}:${p.codigo}`))}`);
  if (informe.bloqueantes.length) {
    console.error(`BLOQUEANTES (${informe.bloqueantes.length}): ${JSON.stringify(informe.bloqueantes)}`);
    process.exitCode = 1;
  }
  if (preparado.plan.articulos.length === 0) process.exitCode = 1;
  // En una simulación "abortar al primer error" se traduce en no dar por buena una corrida con artículos excluidos
  if (opciones.abortarAlPrimerError && informe.problemasDeArticulo.length) {
    console.error(`--abortar-al-primer-error: hay ${informe.problemasDeArticulo.length} problema(s) de artículo; una escritura real se habría detenido en el primero.`);
    process.exitCode = 1;
  }
  console.log(`Informe: ${rutas.md}`);
} finally {
  await conexiones.cerrar();
}
