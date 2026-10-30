// Verifica la descarga de `wp-content/uploads` (fase 7, etapa 0). SOLO LECTURA: lee la carpeta descargada y, para la comparación con la base,
// la base de WordPress de la 3307 (127.0.0.1, sesión READ ONLY, solo SELECT, como el resto de la migración). No escribe en ninguna base.
//
// Uso: npm run verificar:descarga -w @evaristo/compartido -- --uploads=<carpeta> [--lista-servidor=<archivo>] [--apartados=<archivo>] [--base=evaristo_lectura] [--prefijo=wp_] [--sin-base]
//   --uploads          carpeta descargada (la que tiene los archivos adentro, no su carpeta padre).
//   --lista-servidor   lista hecha en el servidor con `find . -type f -printf '%s\t%P\n'`: compara nombres y tamaños contra lo que había.
//   --apartados        lista (una ruta por línea, como `colisiones.txt`) de originales que se dejaron aparte a propósito: no cuentan como faltantes.
//   --base, --prefijo  base de WordPress en la 3307 y prefijo de sus tablas (por defecto evaristo_lectura y wp_).
//   --sin-base         no consulta la base (solo se compara con la lista del servidor).
// Sale con 0 si no hay faltantes, nombres alterados, archivos vacíos ni tamaños distintos; con 1 si los hay; con 2 si los argumentos son inválidos.
// El informe completo queda en out/descarga/<fecha>-verificacion.json (ignorado por git).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { consultar, metadatosAdjunto, SOLO_LECTURA, type Consulta, type Fila } from "./lib/leer-wordpress.ts";
import { num, str } from "./lib/utilidades.ts";
import {
  compararConBase, compararConServidor, derivadasDeMetadatos, leerListaDeRutas, leerListaDelServidor, listarCarpeta, parsearArgumentos,
  type AdjuntoWp, type ResultadoContraBase, type ResultadoContraServidor,
} from "./lib/verificar-descarga.ts";

const USO = "Uso: verificar-descarga.ts --uploads=<carpeta> [--lista-servidor=<archivo>] [--apartados=<archivo>] [--base=evaristo_lectura] [--prefijo=wp_] [--sin-base]";

/** Los adjuntos de WordPress con su `_wp_attached_file`, el tamaño declarado y las derivadas que declara. */
async function leerAdjuntos(wp: Consulta, prefijo: string): Promise<AdjuntoWp[]> {
  const filas: Fila[] = await wp(`SELECT post_id AS id, meta_key AS k, meta_value AS v FROM \`${prefijo}postmeta\` WHERE meta_key IN ('_wp_attached_file','_wp_attachment_metadata')`);
  const claves = new Map<number, string>(), metas = new Map<number, string>();
  for (const f of filas) (str(f["k"]) === "_wp_attached_file" ? claves : metas).set(num(f["id"]), str(f["v"]));
  const adjuntos: AdjuntoWp[] = [];
  for (const [id, clave] of claves) {
    if (!clave.trim()) continue;
    const meta = metas.get(id);
    adjuntos.push({ id, clave, bytesDeclarados: meta ? metadatosAdjunto(meta).bytes : null, derivadas: meta ? derivadasDeMetadatos(meta, clave) : [] });
  }
  return adjuntos.sort((a, b) => a.id - b.id);
}

async function abrirWordPress(base: string): Promise<{ wp: Consulta; cerrar: () => Promise<void> }> {
  const cliente = new PrismaClient({ adapter: new PrismaMariaDb({ host: "127.0.0.1", port: 3307, user: "root", database: base, connectionLimit: 2, initSql: SOLO_LECTURA }) });
  const wp: Consulta = (sql, ...p) => consultar(cliente, sql, ...p);
  const [{ ro }] = (await wp("SELECT @@session.transaction_read_only AS ro")) as [Fila];
  if (num(ro) !== 1) { await cliente.$disconnect(); throw new Error("La sesión no está en solo lectura: se aborta"); }
  return { wp, cerrar: () => cliente.$disconnect() };
}

const miles = (n: number) => n.toLocaleString("es-AR");
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const muestra = (xs: readonly unknown[], n = 15) => xs.slice(0, n).map((x) => `    - ${typeof x === "string" ? x : JSON.stringify(x)}`).join("\n") + (xs.length > n ? `\n    … y ${miles(xs.length - n)} más (están todos en el informe)` : "");

function imprimirBase(r: ResultadoContraBase) {
  console.log(`\n== Contra la base de WordPress (lo que la migración va a buscar) ==`);
  console.log(`Adjuntos con _wp_attached_file: ${miles(r.adjuntos)}`);
  const porMayus = r.colisiones.filter((g) => g.tipo === "mayusculas"), porTildes = r.colisiones.filter((g) => g.tipo === "tildes");
  if (porMayus.length) console.log(`  AVISO: ${miles(porMayus.length)} grupos de nombres que solo difieren en mayúsculas (${miles(porMayus.reduce((s, g) => s + g.claves.length, 0))} archivos, p. ej. «${porMayus[0]!.claves.join("» y «")}»): en Windows no pueden estar todos en la carpeta y en la base del CMS chocan en imagenes.clave.`);
  if (porTildes.length) console.log(`  AVISO: ${miles(porTildes.length)} grupos de nombres que difieren en una tilde (p. ej. «${porTildes[0]!.claves.join("» y «")}»): en Windows conviven, pero en la base del CMS chocan en imagenes.clave.`);
  console.log(`  con el archivo y un nombre que la migración reconoce: ${miles(r.exactos)} (${gb(r.bytesTotales)})`);
  if (r.normalizados.length) console.log(`    (aviso, no es un problema: ${miles(r.normalizados.length)} difieren solo en la normalización Unicode de la tilde; la migración los encuentra)`);
  const choque = (otras?: string[]) => (otras ? ` [choca por mayúsculas con ${otras.map((o) => `«${o}»`).join(", ")}]` : "");
  if (r.apartados.length) console.log(`  Apartados a propósito (están en el paquete de colisiones, no cuentan como faltantes): ${miles(r.apartados.length)}`);
  if (r.apartadosSinAdjunto.length) { console.log(`  APARTADOS QUE NO SON DE ESTA BASE (la lista es de otra descarga o tiene un error): ${miles(r.apartadosSinAdjunto.length)}`); console.log(muestra(r.apartadosSinAdjunto)); }
  console.log(`  FALTANTES: ${miles(r.faltantes.length)}`); if (r.faltantes.length) console.log(muestra(r.faltantes.map((f) => `${f.id}: ${f.clave}${choque(f.colisionaCon)}`)));
  console.log(`  NOMBRE ALTERADO en mayúsculas o tildes (la migración los vería como faltantes): ${miles(r.alterados.length)}`); if (r.alterados.length) console.log(muestra(r.alterados.map((a) => `${a.id}: pide «${a.clave}», hay «${a.archivo}» (${a.alteracion})${choque(a.colisionaCon)}`)));
  console.log(`  TAMAÑO CERO: ${miles(r.tamanoCero.length)}`); if (r.tamanoCero.length) console.log(muestra(r.tamanoCero.map((f) => `${f.id}: ${f.clave}`)));
  console.log(`  TAMAÑO DISTINTO del que declara WordPress: ${miles(r.tamanoDistinto.length)} de ${miles(r.conTamanoDeclarado)} que lo declaran`); if (r.tamanoDistinto.length) console.log(muestra(r.tamanoDistinto.map((f) => `${f.id}: ${f.clave} declara ${f.declarado} B, hay ${f.enDisco} B`)));
  console.log(`  Sobrantes en la carpeta: ${miles(r.sobrantes.derivadas)} derivadas (miniaturas, esperables) y ${miles(r.sobrantes.otros.length)} otros`); if (r.sobrantes.otros.length) console.log(muestra(r.sobrantes.otros));
}

function imprimirServidor(r: ResultadoContraServidor) {
  console.log(`\n== Contra la lista del servidor (¿llegó todo, igual?) ==`);
  console.log(`Archivos en el servidor: ${miles(r.enServidor)} (${gb(r.bytesServidor)}); en la carpeta: ${gb(r.bytesEnDisco)}`);
  console.log(`  iguales (nombre y tamaño): ${miles(r.exactos - r.tamanoDistinto.length)}`);
  console.log(`  FALTANTES: ${miles(r.faltantes.length)}`); if (r.faltantes.length) console.log(muestra(r.faltantes));
  console.log(`  NOMBRE ALTERADO en mayúsculas o tildes: ${miles(r.alterados.length)}`);
  if (r.normalizados.length) console.log(`    (aviso, no es un problema: ${miles(r.normalizados.length)} llegaron con otra normalización Unicode de la tilde)`); if (r.alterados.length) console.log(muestra(r.alterados.map((a) => `«${a.ruta}» llegó como «${a.archivo}» (${a.alteracion})`)));
  console.log(`  TAMAÑO DISTINTO (descarga cortada): ${miles(r.tamanoDistinto.length)}`); if (r.tamanoDistinto.length) console.log(muestra(r.tamanoDistinto.map((f) => `${f.ruta}: servidor ${f.servidor} B, acá ${f.enDisco} B`)));
  console.log(`  Sobrantes (acá y no en el servidor): ${miles(r.sobrantes.length)}`); if (r.sobrantes.length) console.log(muestra(r.sobrantes));
}

async function principal(): Promise<number> {
  const args = parsearArgumentos(process.argv.slice(2));
  if (typeof args === "string") { console.error(`Error en los argumentos: ${args}\n${USO}`); return 2; }
  if (!existsSync(args.uploads) || !statSync(args.uploads).isDirectory()) { console.error(`Error en los argumentos: no se puede leer la carpeta ${args.uploads}\n${USO}`); return 2; }
  if (args.apartados !== null && !existsSync(args.apartados)) { console.error(`Error en los argumentos: no existe la lista de apartados ${args.apartados}\n${USO}`); return 2; }
  if (args.listaServidor !== null && !existsSync(args.listaServidor)) { console.error(`Error en los argumentos: no existe la lista del servidor ${args.listaServidor}\n${USO}`); return 2; }

  console.log(`Carpeta: ${args.uploads}`);
  const archivos = listarCarpeta(args.uploads);
  console.log(`Archivos en la carpeta: ${miles(archivos.length)} (${gb(archivos.reduce((s, a) => s + a.bytes, 0))})`);

  let contraBase: ResultadoContraBase | null = null, contraServidor: ResultadoContraServidor | null = null;
  if (!args.sinBase) {
    const { wp, cerrar } = await abrirWordPress(args.base).catch((e: unknown) => { throw new Error(`no se pudo leer WordPress en 127.0.0.1:3307/${args.base} (¿está arriba el 3307?): ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`); });
    try { contraBase = compararConBase(await leerAdjuntos(wp, args.prefijo), archivos, new Set(args.apartados === null ? [] : leerListaDeRutas(readFileSync(args.apartados, "utf8")))); } finally { await cerrar(); }
    imprimirBase(contraBase);
  }
  if (args.listaServidor !== null) {
    contraServidor = compararConServidor(leerListaDelServidor(readFileSync(args.listaServidor, "utf8")), archivos);
    imprimirServidor(contraServidor);
  }

  const carpetaSalida = fileURLToPath(new URL("../../out/descarga/", import.meta.url));
  mkdirSync(carpetaSalida, { recursive: true });
  const fecha = new Date().toISOString().replace(/[:.]/g, "").replace(/\d{3}Z$/, "Z");
  const ruta = `${carpetaSalida}${fecha}-verificacion.json`;
  writeFileSync(ruta, JSON.stringify({ generadoEn: new Date().toISOString(), carpeta: args.uploads, contraBase, contraServidor }, null, 2), "utf8");

  const problemas = (contraBase ? contraBase.apartadosSinAdjunto.length + contraBase.faltantes.length + contraBase.alterados.length + contraBase.tamanoCero.length + contraBase.tamanoDistinto.length : 0)
    + (contraServidor ? contraServidor.faltantes.length + contraServidor.alterados.length + contraServidor.tamanoDistinto.length : 0);
  console.log(`\nInforme completo: ${ruta}`);
  console.log(problemas === 0 ? "\nOK: no hay faltantes, nombres alterados, archivos vacíos ni tamaños distintos." : `\nHAY PROBLEMAS (${miles(problemas)}): revisar las listas de arriba antes de seguir.`);
  return problemas === 0 ? 0 : 1;
}

principal().then((c) => process.exit(c), (e: unknown) => {
  console.error("FALLÓ:", e instanceof Error ? e.message.replace(/(mysql|mariadb):\/\/\S+/g, "$1://[TACHADO]") : "error desconocido");
  process.exit(2);
});
