// Extrae los originales del paquete de `uploads` (fase 7, etapa 0b). SOLO LECTURA sobre el paquete y sobre la base de WordPress de la 3307
// (127.0.0.1, sesión READ ONLY, solo SELECT). No escribe en ninguna base. Ver lib/extraer-originales.ts para el criterio de emparejamiento y para
// cómo se resuelven los archivos que comparten dos adjuntos.
//
// Uso: npm run extraer:originales -- --paquete=<uploads-completo.tar> --base=<base de WordPress> [--prefijo=wp_]
//        [--destino=<carpeta> [--reemplazos=<carpeta>] [--mapa=<archivo.csv>]]
//   Sin --destino: solo cruza el paquete con la base e informa (no escribe nada salvo el informe en out/descarga/).
//   Con --destino: además extrae cada original con el nombre de su `_wp_attached_file`; las miniaturas que reemplazan originales perdidos van a
//   --reemplazos (por defecto, `reemplazos` junto al destino), y el mapa a --mapa (por defecto, `mapa-originales.csv` junto al destino).
//   Las carpetas tienen que estar vacías o no existir y el mapa no tiene que existir: no se pisa nada.
// Si algún adjunto no tiene archivo, tiene más de un candidato, su nombre no sirve en Windows o un archivo compartido no se puede resolver, no se
// extrae nada. Sale con 0 si todo está bien; con 1 si hay errores; con 2 si los argumentos son inválidos.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirWordPress, leerAdjuntos } from "./lib/adjuntos-wp.ts";
import {
  abrirTar, emparejar, indexarTar, mapaCsv, nombreLegible, parsearArgumentos, planificar, resolverCompartidos,
  type Coincidencia, type EntradaTar, type FilaMapa, type Medida,
} from "./lib/extraer-originales.ts";
import { dimensiones, tipoPorContenido } from "./lib/imagenes.ts";
import { esDerivadaPorNombre, type AdjuntoWp } from "./lib/verificar-descarga.ts";

const USO = "Uso: extraer-originales.ts --paquete=<uploads-completo.tar> --base=<base de WordPress> [--prefijo=wp_] [--destino=<carpeta> [--reemplazos=<carpeta>] [--mapa=<archivo.csv>]]";

const miles = (n: number) => n.toLocaleString("es-AR");
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const muestra = (xs: readonly string[], n = 15) => xs.slice(0, n).map((x) => `    - ${x}`).join("\n") + (xs.length > n ? `\n    … y ${miles(xs.length - n)} más (están todos en el informe)` : "");
const carpetaLibre = (c: string) => !existsSync(c) || (statSync(c).isDirectory() && readdirSync(c).length === 0);

async function principal(): Promise<number> {
  const args = parsearArgumentos(process.argv.slice(2));
  if (typeof args === "string") { console.error(`Error en los argumentos: ${args}\n${USO}`); return 2; }
  if (!existsSync(args.paquete) || !statSync(args.paquete).isFile()) { console.error(`Error en los argumentos: no se puede leer el paquete ${args.paquete}\n${USO}`); return 2; }
  const destino = args.destino === null ? null : resolve(args.destino);
  const carpetaReemplazos = destino === null ? null : resolve(args.reemplazos ?? join(dirname(destino), "reemplazos"));
  const rutaMapa = destino === null ? null : resolve(args.mapa ?? join(dirname(destino), "mapa-originales.csv"));
  if (destino !== null) {
    if (resolve(destino).toLowerCase() === carpetaReemplazos!.toLowerCase()) { console.error("Error en los argumentos: --destino y --reemplazos tienen que ser carpetas distintas"); return 2; }
    for (const c of [destino, carpetaReemplazos!]) if (!carpetaLibre(c)) { console.error(`Error en los argumentos: ${c} existe y no es una carpeta vacía (no se pisa nada)`); return 2; }
    if (existsSync(rutaMapa!)) { console.error(`Error en los argumentos: el mapa ${rutaMapa} ya existe (no se pisa)`); return 2; }
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

    // Archivos compartidos: dueño por medidas; los demás, con su miniatura proporcional más grande.
    const grupos = plan.compartidos.map((a) => ({ archivo: a.nombreDestino, nombreEnPaquete: nombreLegible(a.entrada), ids: a.adjuntos.map((x) => x.id) }));
    const medir = (e: EntradaTar): Medida | null => { const b = tar.leer(e.inicio, e.bytes); return dimensiones(b, tipoPorContenido(b)); };
    const porNombre = new Map(indice.archivos.map((e) => [nombreLegible(e).normalize("NFC"), e] as const));
    const res = resolverCompartidos(plan, new Map(adjuntos.map((a) => [a.id, a])), medir, (n) => porNombre.get(n));
    console.log(`\n== Archivos a extraer: ${miles(plan.archivos.length)} (${gb(plan.archivos.reduce((s, a) => s + a.entrada.bytes, 0))}) ==`);
    console.log(`  compartidos por dos adjuntos: ${miles(grupos.length)}; resueltos con la miniatura del que perdió el original: ${miles(res.reemplazos.length)}`);
    if (res.reemplazos.length) console.log(muestra(res.reemplazos.map((x) => `${x.id} «${x.clave}» (${x.original.ancho}×${x.original.alto}) → ${x.miniatura} (${x.medida.ancho}×${x.medida.alto}); el archivo es de ${x.dueno.id} «${x.dueno.clave}»`), 5));
    console.log(`  SIN RESOLVER: ${miles(res.sinResolver.length)}`); if (res.sinResolver.length) console.log(muestra(res.sinResolver.map((x) => `${x.archivo} (${x.ids.join(", ")}): ${x.motivo}`)));
    console.log(`  NOMBRES QUE NO SIRVEN EN WINDOWS: ${miles(plan.nombresInvalidos.length)}`); if (plan.nombresInvalidos.length) console.log(muestra(plan.nombresInvalidos.map((x) => `${x.id}: «${x.clave}» ${x.motivo}`)));
    console.log(`  CHOCAN EN EL DESTINO (mismo nombre salvo mayúsculas): ${miles(plan.chocanEnDestino.length)}`); if (plan.chocanEnDestino.length) console.log(muestra(plan.chocanEnDestino.map((l) => l.join(" | "))));

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

    const errores = emp.faltantes.length + emp.ambiguos.length + plan.nombresInvalidos.length + plan.chocanEnDestino.length + res.sinResolver.length;
    const informe = {
      generadoEn: new Date().toISOString(), paquete: args.paquete, base: args.base, destino, carpetaReemplazos, mapa: rutaMapa,
      adjuntos: adjuntos.length, archivosEnPaquete: indice.archivos.length, otrosTipos: indice.otros,
      porCoincidencia: Object.fromEntries((["exacto", "cp850", "cola", "mayusculas"] as const).map((n) => [n, porNivel(n)])),
      noExactos: emp.emparejados.filter((e) => e.coincidencia !== "exacto").map((e) => ({ id: e.id, clave: e.clave, nombreEnPaquete: e.nombreEnPaquete, coincidencia: e.coincidencia })),
      faltantes: emp.faltantes, ambiguos: emp.ambiguos, nombresInvalidos: plan.nombresInvalidos, chocanEnDestino: plan.chocanEnDestino,
      compartidos: grupos, sinResolver: res.sinResolver,
      reemplazos: res.reemplazos.map((x) => ({ id: x.id, clave: x.clave, miniatura: x.miniatura, medida: x.medida, original: x.original, dueno: x.dueno })),
      sobrantes,
      extraidos: null as null | { originales: number; reemplazos: number; bytes: number },
    };

    if (errores === 0 && destino !== null) {
      console.log(`\nExtrayendo a ${destino}…`);
      mkdirSync(destino, { recursive: true });
      const filas: FilaMapa[] = [];
      let bytes = 0, hechos = 0;
      const escribir = (carpeta: string, nombre: string, e: EntradaTar) => {
        const datos = tar.leer(e.inicio, e.bytes);
        writeFileSync(join(carpeta, nombre), datos, { flag: "wx" }); // wx: falla si ya existe, nunca pisa
        bytes += datos.length;
        return { bytes: datos.length, sha256: createHash("sha256").update(datos).digest("hex") };
      };
      const reemplazoDe = new Map(res.reemplazos.map((x) => [x.dueno.id, x.clave]));
      for (const a of plan.archivos) {
        const x = a.adjuntos[0]!, h = escribir(destino, a.nombreDestino, a.entrada);
        filas.push({ id: x.id, clave: x.clave, nombreEnPaquete: x.nombreEnPaquete, coincidencia: x.coincidencia, carpeta: "originales", archivo: a.nombreDestino, comparteCon: reemplazoDe.get(x.id) ?? "", ...h });
        if (++hechos % 1000 === 0) console.log(`  ${miles(hechos)} de ${miles(plan.archivos.length)}`);
      }
      if (res.reemplazos.length) mkdirSync(carpetaReemplazos!, { recursive: true });
      for (const x of res.reemplazos) {
        const h = escribir(carpetaReemplazos!, x.nombreDestino, x.entrada);
        filas.push({ id: x.id, clave: x.clave, nombreEnPaquete: x.miniatura, coincidencia: "miniatura", carpeta: "reemplazos", archivo: x.nombreDestino, comparteCon: x.dueno.clave, ...h });
      }
      writeFileSync(rutaMapa!, mapaCsv(filas), { encoding: "utf8", flag: "wx" });
      informe.extraidos = { originales: hechos, reemplazos: res.reemplazos.length, bytes };
      console.log(`  ${miles(hechos)} originales y ${miles(res.reemplazos.length)} reemplazos (${gb(bytes)}); ${miles(filas.length)} filas en ${rutaMapa}`);
      if (filas.length !== adjuntos.length) throw new Error(`el mapa tiene ${filas.length} filas y hay ${adjuntos.length} adjuntos`);
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
