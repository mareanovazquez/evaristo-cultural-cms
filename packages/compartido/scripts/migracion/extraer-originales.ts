// Extrae los originales del paquete de `uploads` (fase 7, etapa 0b). SOLO LECTURA sobre el paquete y sobre la base de WordPress de la 3307
// (127.0.0.1, sesión READ ONLY, solo SELECT). No escribe en ninguna base. Ver lib/extraer-originales.ts para el criterio de emparejamiento, cómo
// se resuelven los archivos que comparten dos adjuntos (decisión 79) y los nombres del CMS (decisión 81, lib/claves-cms.ts).
//
// Uso: npm run extraer:originales -- --paquete=<uploads-completo.tar> --base=<base de WordPress> [--prefijo=wp_] [--destino=<carpeta> [--mapa=<archivo.csv>]]
//   Sin --destino: solo cruza el paquete con la base e informa (no escribe nada salvo el informe en out/descarga/).
//   Con --destino: además extrae un archivo por adjunto, nombrado con su clave en el CMS (la de WordPress salvo los renombrados), y escribe el mapa
//   (por defecto, `mapa-originales.csv` junto a la carpeta). También extrae las fotos de autor (decisión 80) como `avatar-<id de usuario>.<ext>`
//   y escribe `mapa-avatares.csv` junto al mapa. La carpeta tiene que estar vacía o no existir y los mapas no tienen que existir.
// Si algún adjunto no tiene archivo, tiene más de un candidato, un archivo compartido no se puede resolver o un nombre final no sirve o choca,
// no se extrae nada. Sale con 0 si todo está bien; con 1 si hay errores; con 2 si los argumentos son inválidos.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirWordPress, leerAdjuntos } from "./lib/adjuntos-wp.ts";
import {
  abrirTar, armarEscrituras, bmpAPng, emparejar, esBmp, marcarBmps, indexarTar, mapaAvataresCsv, mapaCsv, nombreLegible, parsearArgumentos, planAvatares, planificar, resolverCompartidos,
  type Coincidencia, type EntradaTar, type FilaMapa, type FilaMapaAvatar, type Medida,
} from "./lib/extraer-originales.ts";
import { dimensiones, tipoPorContenido } from "./lib/imagenes.ts";
import { esDerivadaPorNombre, type AdjuntoWp } from "./lib/verificar-descarga.ts";

const USO = "Uso: extraer-originales.ts --paquete=<uploads-completo.tar> --base=<base de WordPress> [--prefijo=wp_] [--destino=<carpeta> [--mapa=<archivo.csv>]]";

const miles = (n: number) => n.toLocaleString("es-AR");
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const muestra = (xs: readonly string[], n = 15) => xs.slice(0, n).map((x) => `    - ${x}`).join("\n") + (xs.length > n ? `\n    … y ${miles(xs.length - n)} más (están todos en el informe)` : "");
const carpetaLibre = (c: string) => !existsSync(c) || (statSync(c).isDirectory() && readdirSync(c).length === 0);

async function principal(): Promise<number> {
  const args = parsearArgumentos(process.argv.slice(2));
  if (typeof args === "string") { console.error(`Error en los argumentos: ${args}\n${USO}`); return 2; }
  if (!existsSync(args.paquete) || !statSync(args.paquete).isFile()) { console.error(`Error en los argumentos: no se puede leer el paquete ${args.paquete}\n${USO}`); return 2; }
  const destino = args.destino === null ? null : resolve(args.destino);
  const rutaMapa = destino === null ? null : resolve(args.mapa ?? join(dirname(destino), "mapa-originales.csv"));
  const rutaAvatares = rutaMapa === null ? null : join(dirname(rutaMapa), "mapa-avatares.csv");
  if (destino !== null) {
    if (!carpetaLibre(destino)) { console.error(`Error en los argumentos: ${destino} existe y no es una carpeta vacía (no se pisa nada)`); return 2; }
    if (existsSync(rutaMapa!)) { console.error(`Error en los argumentos: el mapa ${rutaMapa} ya existe (no se pisa)`); return 2; }
    if (existsSync(rutaAvatares!)) { console.error(`Error en los argumentos: el mapa ${rutaAvatares} ya existe (no se pisa)`); return 2; }
  }

  const { wp, cerrar } = await abrirWordPress(args.base).catch((e: unknown) => { throw new Error(`no se pudo leer WordPress en 127.0.0.1:3307/${args.base} (¿está arriba el 3307?): ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`); });
  let adjuntos: AdjuntoWp[];
  try { adjuntos = await leerAdjuntos(wp, args.prefijo); } finally { await cerrar(); }
  console.log(`Base ${args.base}: ${miles(adjuntos.length)} adjuntos con _wp_attached_file`);

  const tar = abrirTar(args.paquete);
  try {
    console.log(`Paquete: ${args.paquete} (${gb(tar.total)}); leyendo los encabezados…`);
    const indice = indexarTar(tar);
    console.log(`  ${miles(indice.archivos.length)} archivos, ${miles(indice.carpetas)} carpetas${indice.otros.length ? `, ${miles(indice.otros.length)} de otro tipo (enlaces u otros)` : ""}`);

    const emp = emparejar(adjuntos, indice.archivos);
    const plan = planificar(emp.emparejados);
    const porNivel = (n: Coincidencia) => emp.emparejados.filter((e) => e.coincidencia === n).length;
    console.log(`\n== Adjuntos ==`);
    console.log(`  exacto: ${miles(porNivel("exacto"))}`);
    console.log(`  CP850 (nombre en la codificación vieja): ${miles(porNivel("cp850"))}`);
    console.log(`  cola en la extensión (.jpg0, .png000): ${miles(porNivel("cola"))}`);
    console.log(`  solo difiere en mayúsculas: ${miles(porNivel("mayusculas"))}`);
    console.log(`  FALTANTES: ${miles(emp.faltantes.length)}`); if (emp.faltantes.length) console.log(muestra(emp.faltantes.map((a) => `${a.id}: ${a.clave}`)));
    console.log(`  AMBIGUOS: ${miles(emp.ambiguos.length)}`); if (emp.ambiguos.length) console.log(muestra(emp.ambiguos.map((a) => `${a.id}: ${a.clave} (${a.nivel}): ${a.candidatos.join(" | ")}`)));

    // Archivos compartidos (decisión 79): dueño por medidas; los demás, con su miniatura proporcional más grande.
    const grupos = plan.compartidos.map((a) => ({ archivo: a.nombreDestino, nombreEnPaquete: nombreLegible(a.entrada), ids: a.adjuntos.map((x) => x.id) }));
    const medir = (e: EntradaTar): Medida | null => { const b = tar.leer(e.inicio, e.bytes); return dimensiones(b, tipoPorContenido(b)); };
    const porNombre = new Map(indice.archivos.map((e) => [nombreLegible(e).normalize("NFC"), e] as const));
    const res = resolverCompartidos(plan, new Map(adjuntos.map((a) => [a.id, a])), medir, (n) => porNombre.get(n));
    // Nombres del CMS (decisión 81) y comprobación de los nombres finales.
    const esc = armarEscrituras(plan, res);
    console.log(`\n== Archivos a extraer: ${miles(esc.escrituras.length)} (${gb(esc.escrituras.reduce((s, e) => s + e.entrada.bytes, 0))}) ==`);
    console.log(`  compartidos por dos adjuntos: ${miles(grupos.length)}; resueltos con la miniatura del que perdió el original: ${miles(res.reemplazos.length)}`);
    if (res.reemplazos.length) console.log(muestra(res.reemplazos.map((x) => `${x.id} «${x.clave}» (${x.original.ancho}×${x.original.alto}) → ${x.miniatura} (${x.medida.ancho}×${x.medida.alto}); el archivo es de ${x.dueno.id} «${x.dueno.clave}»`), 3));
    console.log(`  SIN RESOLVER: ${miles(res.sinResolver.length)}`); if (res.sinResolver.length) console.log(muestra(res.sinResolver.map((x) => `${x.archivo} (${x.ids.join(", ")}): ${x.motivo}`)));
    console.log(`  claves que el CMS no distingue: ${miles(esc.grupos.length)} grupos; renombrados con -wp<id>: ${miles(esc.renombradas.size)}`);
    if (esc.renombradas.size) console.log(muestra([...esc.renombradas].map(([id, c]) => `${id} → ${c}`), 5));
    console.log(`  ERRORES EN LOS NOMBRES FINALES: ${miles(esc.errores.length)}`); if (esc.errores.length) console.log(muestra(esc.errores));
    // BMP a PNG (Etapa 1, punto 3): se miran los dos primeros bytes de cada original; los BMP pasan a .png.
    const bmps = marcarBmps(esc.escrituras, (e) => esBmp(tar.leer(e.inicio, Math.min(2, e.bytes))));
    console.log(`  BMP convertidos a PNG: ${miles(bmps.convertidas.length)}${bmps.convertidas.length ? ` (${bmps.convertidas.map((c) => `${c.de} → ${c.a}`).join(", ")})` : ""}; ERRORES: ${miles(bmps.errores.length)}`);
    if (bmps.errores.length) console.log(muestra(bmps.errores));
    // Fotos de autor (decisión 80): el avatar grande de cada usuario, como avatar-<id>.<ext>, en la misma carpeta.
    const av = planAvatares(indice.archivos, esc.escrituras.map((e) => e.nombre));
    console.log(`\n== Fotos de autor (avatares de BuddyPress) ==\n  ${miles(av.avatares.length)} usuarios con foto; ERRORES: ${miles(av.errores.length)}`);
    if (av.errores.length) console.log(muestra(av.errores));

    // Lo que queda en el paquete y ningún adjunto pide como original (se informa; no se extrae).
    const usadas = new Set(plan.archivos.map((a) => a.entrada));
    const declaradas = new Set(adjuntos.flatMap((a) => a.derivadas.map((d) => d.normalize("NFC"))));
    const sobrantes = { derivadas: 0, otros: [] as string[] };
    for (const e of indice.archivos) {
      if (usadas.has(e)) continue;
      const n = nombreLegible(e).normalize("NFC");
      if (declaradas.has(n) || esDerivadaPorNombre(n)) sobrantes.derivadas++; else sobrantes.otros.push(n);
    }
    console.log(`\n== En el paquete y sin adjunto (se quedan ahí) ==\n  miniaturas: ${miles(sobrantes.derivadas)}; otros: ${miles(sobrantes.otros.length)}`);

    const errores = emp.faltantes.length + emp.ambiguos.length + res.sinResolver.length + esc.errores.length + bmps.errores.length + av.errores.length;
    const informe = {
      generadoEn: new Date().toISOString(), paquete: args.paquete, base: args.base, destino, mapa: rutaMapa,
      adjuntos: adjuntos.length, archivosEnPaquete: indice.archivos.length, otrosTipos: indice.otros,
      porCoincidencia: Object.fromEntries((["exacto", "cp850", "cola", "mayusculas"] as const).map((n) => [n, porNivel(n)])),
      noExactos: emp.emparejados.filter((e) => e.coincidencia !== "exacto").map((e) => ({ id: e.id, clave: e.clave, nombreEnPaquete: e.nombreEnPaquete, coincidencia: e.coincidencia })),
      faltantes: emp.faltantes, ambiguos: emp.ambiguos, compartidos: grupos, sinResolver: res.sinResolver,
      reemplazos: res.reemplazos.map((x) => ({ id: x.id, clave: x.clave, miniatura: x.miniatura, medida: x.medida, original: x.original, dueno: x.dueno })),
      clavesCms: { grupos: esc.grupos, renombradas: Object.fromEntries(esc.renombradas), errores: esc.errores },
      bmpConvertidos: bmps.convertidas, erroresBmp: bmps.errores,
      avatares: { usuarios: av.avatares.map((a) => ({ wpUserId: a.wpUserId, nombre: a.nombre, nombreEnPaquete: a.nombreEnPaquete })), errores: av.errores },
      sobrantes,
      extraidos: null as null | { archivos: number; avatares: number; bytes: number },
    };

    if (errores === 0 && destino !== null) {
      console.log(`\nExtrayendo a ${destino}…`);
      mkdirSync(destino, { recursive: true });
      const filas: FilaMapa[] = [];
      let bytes = 0, hechos = 0;
      for (const e of esc.escrituras) {
        const crudo = tar.leer(e.entrada.inicio, e.entrada.bytes);
        const datos = e.convertirBmp ? bmpAPng(crudo) : crudo;
        writeFileSync(join(destino, e.nombre), datos, { flag: "wx" }); // wx: falla si ya existe, nunca pisa
        bytes += datos.length;
        const sha256 = createHash("sha256").update(datos).digest("hex");
        for (const f of e.filas) filas.push({ ...f, claveCms: e.nombre, bytes: datos.length, sha256 });
        if (++hechos % 1000 === 0) console.log(`  ${miles(hechos)} de ${miles(esc.escrituras.length)}`);
      }
      if (filas.length !== adjuntos.length) throw new Error(`el mapa tendría ${filas.length} filas y hay ${adjuntos.length} adjuntos`);
      writeFileSync(rutaMapa!, mapaCsv(filas), { encoding: "utf8", flag: "wx" });
      const filasAv: FilaMapaAvatar[] = [];
      for (const a of av.avatares) {
        const datos = tar.leer(a.entrada.inicio, a.entrada.bytes);
        writeFileSync(join(destino, a.nombre), datos, { flag: "wx" });
        bytes += datos.length;
        filasAv.push({ wpUserId: a.wpUserId, claveCms: a.nombre, nombreEnPaquete: a.nombreEnPaquete, bytes: datos.length, sha256: createHash("sha256").update(datos).digest("hex") });
      }
      writeFileSync(rutaAvatares!, mapaAvataresCsv(filasAv), { encoding: "utf8", flag: "wx" });
      informe.extraidos = { archivos: hechos, avatares: filasAv.length, bytes };
      console.log(`  ${miles(hechos)} originales y ${miles(filasAv.length)} fotos de autor (${gb(bytes)}); ${miles(filas.length)} filas en ${rutaMapa} y ${miles(filasAv.length)} en ${rutaAvatares}`);
    }

    const carpetaSalida = fileURLToPath(new URL("../../out/descarga/", import.meta.url));
    mkdirSync(carpetaSalida, { recursive: true });
    const fecha = new Date().toISOString().replace(/[:.]/g, "").replace(/\d{3}Z$/, "Z");
    const ruta = `${carpetaSalida}${fecha}-extraccion.json`;
    writeFileSync(ruta, JSON.stringify(informe, null, 2), "utf8");
    console.log(`\nInforme completo: ${ruta}`);
    if (errores) { console.log(`\nHAY ERRORES (${miles(errores)}): no se extrajo nada. Revisar las listas de arriba.`); return 1; }
    console.log(destino === null ? "\nOK: cada adjunto tiene su archivo. Para extraer, repetir con --destino=<carpeta>." : "\nOK: extracción completa.");
    return 0;
  } finally { tar.cerrar(); }
}

principal().then((c) => process.exit(c), (e: unknown) => {
  console.error("FALLÓ:", e instanceof Error ? e.message.replace(/(mysql|mariadb):\/\/\S+/g, "$1://[TACHADO]") : "error desconocido");
  process.exit(2);
});
