// Renderiza los 35 artículos de evaristo_cms (3308, solo lectura) con conCapital=false y true, y verifica el HTML.
// Falla (código 1) si no hay conexión; no se saltea en silencio.
//
// Uso: npm run test:render-35
import { performance } from "node:perf_hooks";
import { renderArticleBody, isAllowedImageSrc, type JSONNode } from "../../src/render/render.ts";
import { validateArticleBodyDetallado } from "../../src/schema/validate.ts";
import { leerArticulosYDimensiones } from "./lib/leer-articulos.ts";
import { problemasDeEtiquetas } from "./lib/html-balanceado.ts";

// Inventario del reconocimiento de la fase 3.
const ESPERADO = { articulos: 35, notas: 178, imagenes: 172, videos: 15, tablas: 1, altPendiente: 25 };

interface Conteo {
  notas: number;
  imagenes: number;
  imagenesConId: number;
  sinId: number;
  videos: number;
  tablas: number;
  saltos: number;
  pendientes: number;
  noPermitidas: number;
}
const CLAVES: Array<keyof Conteo> = ["notas", "imagenes", "imagenesConId", "sinId", "videos", "tablas", "saltos", "pendientes", "noPermitidas"];
const vacio = (): Conteo => ({ notas: 0, imagenes: 0, imagenesConId: 0, sinId: 0, videos: 0, tablas: 0, saltos: 0, pendientes: 0, noPermitidas: 0 });

// Cuenta en el JSON lo que el renderizador debería emitir. Los saltos se cuentan en cuerpo y notas; una nota dentro de una nota no se emite.
function contar(doc: JSONNode): Conteo {
  const c = vacio();
  const recorrer = (n: JSONNode | undefined, enNota: boolean) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "footnote") {
      if (!enNota) {
        c.notas++;
        recorrer(n.attrs?.["content"] as JSONNode | undefined, true);
      }
      return;
    }
    if (n.type === "hardBreak") c.saltos++;
    if (!enNota) {
      if (n.type === "imagen") {
        if (!isAllowedImageSrc(n.attrs?.["src"])) c.noPermitidas++;
        else {
          c.imagenes++;
          if (n.attrs?.["imagenId"] !== undefined) c.imagenesConId++;
          else c.sinId++;
          if (n.attrs?.["altPendiente"] === true) c.pendientes++;
        }
      }
      if (n.type === "video") c.videos++;
      if (n.type === "table") c.tablas++;
    }
    n.content?.forEach((h) => recorrer(h, enNota));
  };
  recorrer(doc, false);
  return c;
}

const cuantos = (texto: string, re: RegExp) => texto.match(re)?.length ?? 0;
// Quita la clase con-capital para comparar con el HTML sin capital.
const sinCapital = (html: string) => html.replace(/ class="con-capital"/, "").replace(/ con-capital"/, '"');

const { articulos, dimensiones } = await leerArticulosYDimensiones();
console.log(`Leídos ${articulos.length} artículos y ${dimensiones.size} medidas de imágenes (sesión READ ONLY).\n`);

const fallos: string[] = [];
const avisos: string[] = [];
const total = vacio();
let htmlImg = 0;
let htmlIframe = 0;
let htmlTabla = 0;
let htmlBr = 0;
let htmlNotas = 0;
let conCapitalN = 0;
let tiempoTotal = 0;
const tiempos = new Map<number, number>();

for (const a of articulos) {
  const id = a.wpId;
  const falla = (m: string) => fallos.push(`${id}: ${m}`);
  const esperado = contar(a.cuerpo);
  for (const k of CLAVES) total[k] += esperado[k];

  const v = validateArticleBodyDetallado(a.cuerpo, { modo: "migracion" });
  if (v.errores.length) falla(`el validador (modo migración) da ${v.errores.length} errores: ${v.errores[0]}`);
  if (v.avisos.length) {
    const tipos = [...new Set(v.avisos.map((x) => x.split(" en doc")[0]))].join("; ");
    avisos.push(`${id}: ${v.avisos.length} avisos del validador (${tipos})`);
  }

  let sinC;
  let conC;
  const t0 = performance.now();
  try {
    sinC = renderArticleBody(a.cuerpo, { dimensionesImagenes: dimensiones });
    tiempos.set(id, performance.now() - t0);
    conC = renderArticleBody(a.cuerpo, { dimensionesImagenes: dimensiones, conCapital: true });
    tiempoTotal += performance.now() - t0;
  } catch (e) {
    falla(`el renderizador lanzó: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }

  for (const [nombre, r] of [["sin capital", sinC], ["con capital", conC]] as const) {
    for (const p of problemasDeEtiquetas(r.html)) falla(`HTML (${nombre}): ${p}`);
    for (const p of problemasDeEtiquetas(r.notesHtml)) falla(`notas (${nombre}): ${p}`);
  }
  if (sinCapital(conC.html) !== sinC.html) falla("con capital el HTML difiere en algo más que la clase");
  if (conC.notesHtml !== sinC.notesHtml) falla("las notas cambian con conCapital");
  if (cuantos(sinC.html, /con-capital/g) !== 0) falla("sin capital aparece con-capital");
  if (cuantos(conC.html, /con-capital/g) > 1) falla("con-capital aparece más de una vez");
  conCapitalN += cuantos(conC.html, /con-capital/g);

  // Notas: llamadas = nodos footnote; cada href interno tiene su id
  const llamadas = cuantos(sinC.html, /<sup class="nota-ref" id="ref-\d+">/g);
  if (llamadas !== esperado.notas || sinC.footnoteCount !== esperado.notas) {
    falla(`llamadas a notas: HTML ${llamadas}, footnoteCount ${sinC.footnoteCount}, JSON ${esperado.notas}`);
  }
  const todo = sinC.html + sinC.notesHtml;
  const ids = new Set([...todo.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  if (ids.size !== cuantos(todo, /\bid="/g)) falla("ids repetidos");
  // El <use href="#i-corner-up-left"> apunta al sprite que incluye el layout, no a un id del artículo.
  for (const m of todo.matchAll(/(?<!<use )href="#([^"]+)"/g)) if (!ids.has(m[1])) falla(`href="#${m[1]}" sin id`);
  for (const m of todo.matchAll(/<use href="([^"]+)"/g)) if (m[1] !== "#i-corner-up-left") falla(`<use> apunta a ${m[1]}`);
  for (let n = 1; n <= esperado.notas; n++) {
    for (const x of [`ref-${n}`, `nota-${n}`]) if (!ids.has(x)) falla(`falta el id ${x}`);
    if (!todo.includes(`href="#nota-${n}"`) || !todo.includes(`href="#ref-${n}"`)) falla(`falta el vínculo de ida o de vuelta de la nota ${n}`);
  }
  htmlNotas += llamadas;

  // Imágenes, en orden de documento
  const imgs = [...sinC.html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  htmlImg += imgs.length;
  if (imgs.length !== esperado.imagenes) falla(`img en el HTML ${imgs.length}, en el JSON ${esperado.imagenes}`);
  const nodos: JSONNode[] = [];
  const reunir = (n: JSONNode) => {
    if (n.type === "imagen") {
      if (isAllowedImageSrc(n.attrs?.["src"])) nodos.push(n);
    } else if (n.type !== "footnote") n.content?.forEach(reunir);
  };
  reunir(a.cuerpo);
  imgs.forEach((tag, i) => {
    const nodo = nodos[i];
    const src = /\ssrc="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (!src.startsWith("/media/")) falla(`img con src que no empieza con /media/: ${src}`);
    if (/javascript:|data:/i.test(tag)) falla(`img con javascript: o data: (${src})`);
    if (/\sstyle=|aspect-ratio|object-fit/i.test(tag)) falla("img con estilo");
    const imagenId = nodo?.attrs?.["imagenId"];
    if (imagenId !== undefined) {
      if (!dimensiones.has(Number(imagenId))) falla(`imagenId ${String(imagenId)} sin medidas en la tabla imagenes`);
      else if (!/\swidth="\d+" height="\d+"/.test(tag)) falla(`img con imagenId ${String(imagenId)} sin width y height`);
    }
    if (nodo?.attrs?.["altPendiente"] === true && !/\salt=""/.test(tag)) falla(`img con altPendiente sin alt="" (${src})`);
  });

  // Videos, tablas, saltos de línea
  const iframes = cuantos(sinC.html, /<iframe\b/g);
  htmlIframe += iframes;
  if (iframes !== esperado.videos) falla(`iframes ${iframes}, videos en el JSON ${esperado.videos}`);
  const tablas = cuantos(sinC.html, /<table>/g);
  htmlTabla += tablas;
  if (tablas !== esperado.tablas) falla(`tablas ${tablas}, en el JSON ${esperado.tablas}`);
  const br = cuantos(todo, /<br>/g);
  htmlBr += br;
  if (br !== esperado.saltos) falla(`br ${br}, hardBreak en el JSON ${esperado.saltos}`);

  if (/javascript:|\sstyle=|\sonerror=|<script/i.test(todo)) falla("el HTML contiene javascript:, style=, onerror= o <script");
}

// Casos puntuales
const por = new Map(articulos.map((a) => [a.wpId, a]));
const render = (id: number) => {
  const a = por.get(id);
  if (!a) {
    fallos.push(`${id}: no está entre los artículos leídos`);
    return undefined;
  }
  return renderArticleBody(a.cuerpo, { dimensionesImagenes: dimensiones });
};
const r4265 = render(4265);
if (r4265) {
  if (r4265.footnoteCount !== 1) fallos.push(`4265: footnoteCount ${r4265.footnoteCount}, se esperaba 1`);
  if (!/\[\d+\]/.test(r4265.html)) fallos.push("4265: no aparecen marcas [n] como texto");
  console.log(`4265: ${r4265.footnoteCount} nodo footnote y ${cuantos(r4265.html, /\[\d+\]/g)} marcas [n] como texto en el HTML.`);
}
const r5287 = render(5287);
if (r5287 && r5287.footnoteCount !== 44) fallos.push(`5287: footnoteCount ${r5287.footnoteCount}, se esperaban 44`);
const kb = (id: number) => Math.round(JSON.stringify(por.get(id)?.cuerpo).length / 1024);
console.log(`3306: ${kb(3306)} KB de JSON, render en ${tiempos.get(3306)?.toFixed(1)} ms.`);
console.log(`5287: ${r5287?.footnoteCount} notas, render en ${tiempos.get(5287)?.toFixed(1)} ms.`);

// Totales contra el inventario
const comparar = (nombre: string, real: number, esperado: number) => {
  if (real !== esperado) fallos.push(`total de ${nombre}: ${real}, se esperaban ${esperado}`);
};
comparar("artículos", articulos.length, ESPERADO.articulos);
comparar("notas (HTML)", htmlNotas, ESPERADO.notas);
comparar("notas (JSON)", total.notas, ESPERADO.notas);
comparar("imágenes (HTML)", htmlImg, ESPERADO.imagenes);
comparar("imágenes (JSON)", total.imagenes, ESPERADO.imagenes);
comparar("videos (iframe)", htmlIframe, ESPERADO.videos);
comparar("tablas", htmlTabla, ESPERADO.tablas);
comparar("imágenes con altPendiente", total.pendientes, ESPERADO.altPendiente);
comparar("br contra hardBreak del JSON", htmlBr, total.saltos);
if (total.noPermitidas) fallos.push(`hay ${total.noPermitidas} imágenes con src no permitido en los cuerpos`);
if (total.sinId) avisos.push(`${total.sinId} imágenes sin imagenId (salen sin width ni height)`);

console.log(
  `\nTotales (${articulos.length} artículos): ${htmlNotas} notas, ${htmlImg} imágenes (${total.imagenesConId} con imagenId, ${total.pendientes} con altPendiente), ` +
    `${htmlIframe} videos, ${htmlTabla} tabla, ${htmlBr} br (hardBreak en el JSON: ${total.saltos}).`,
);
console.log(`Con conCapital=true, ${conCapitalN} de ${articulos.length} artículos reciben letra capital.`);
const lento = [...tiempos].sort((x, y) => y[1] - x[1])[0];
console.log(`Tiempo de render de los ${articulos.length} (ambas variantes): ${tiempoTotal.toFixed(0)} ms; el más lento (una variante): ${lento?.[0]} (${lento?.[1].toFixed(1)} ms).`);
if (avisos.length) {
  console.log(`\nAvisos (${avisos.length}):`);
  avisos.forEach((x) => console.log("  -", x));
}

if (fallos.length) {
  console.error(`\nFALLÓ (${fallos.length}):`);
  fallos.slice(0, 60).forEach((x) => console.error("  -", x));
  process.exit(1);
}
console.log("\nOK: los artículos renderizan y cumplen todas las verificaciones.");
