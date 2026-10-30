// Genera una página HTML por artículo (wpId.html) y un index.html para mirar los 35 en el navegador.
// Lee evaristo_cms (3308) en solo lectura. CSS mínimo y neutro: el aspecto final es de un paso posterior.
//
// Uso: npm run render:preview-35 -- --originales="C:\ruta\a\originales" [--salida="C:\ruta\de\salida"]
//   --originales  reescribe /media/<clave> a file:/// + carpeta + clave, para ver las imágenes sin servidor
//                 (solo acá: el renderizador no hace esa reescritura).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderArticleBody, escapeHtml, SPRITE_ICONO_VOLVER } from "../../src/render/render.ts";
import { leerArticulosYDimensiones } from "./lib/leer-articulos.ts";

const SALIDA_POR_DEFECTO = fileURLToPath(new URL("../../../../../CMS-EVARISTO(ASSETS)/previews-fase3", import.meta.url));
// Artículos que se generan también con letra capital (variante -capital.html).
const CON_VARIANTE_CAPITAL = new Set([620, 4265, 5287, 5296, 15027, 19660, 3306]);

const opcion = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const salida = opcion("salida") ?? SALIDA_POR_DEFECTO;
const originales = opcion("originales");
if (originales && !existsSync(originales)) {
  console.error(`FALLÓ: la carpeta de originales no existe: ${originales}`);
  process.exit(1);
}
// Prefijo file:/// + carpeta (la clave de /media/<clave> ya viene codificada en el HTML).
const prefijoOriginales = originales ? `${pathToFileURL(originales).href.replace(/\/?$/, "/")}` : undefined;

const CSS = `
body { margin: 0; padding: 24px 16px 64px; font: 18px/1.6 system-ui, sans-serif; color: #222; background: #fff; }
main { max-width: 680px; margin: 0 auto; }
h1 { font-size: 1.8em; line-height: 1.2; }
.alin-centro { text-align: center; }
.alin-justificado { text-align: justify; }
.con-capital::first-letter { float: left; font-size: 3.4em; line-height: 0.85; padding: 0.06em 0.08em 0 0; font-weight: 700; }
.cuerpo-img { max-width: 100%; max-height: 80vh; height: auto; }
figure { margin: 1.5em 0; }
figcaption { font-size: 0.85em; color: #555; }
.nota-ref { font-size: 0.75em; line-height: 0; }
.nota-ref a { text-decoration: none; }
.notas-al-pie { margin-top: 3em; border-top: 1px solid #ccc; font-size: 0.9em; }
.notas-al-pie ol { padding-left: 1.5em; }
.nw { white-space: nowrap; }
.nota-volver { margin-left: 0.25em; color: inherit; }
.icon { width: 0.9em; height: 0.9em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: -0.1em; }
blockquote.cita { margin: 1.5em 0; padding: 0.5em 1em; border-left: 4px solid #999; background: #f3f3f3; font-style: italic; }
blockquote.cita cite { display: block; font-size: 0.85em; font-style: normal; }
.video iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; }
.tabla-scroll { overflow-x: auto; }
table { border-collapse: collapse; }
th, td { border: 1px solid #ccc; padding: 4px 8px; }
.barra { max-width: 680px; margin: 0 auto 24px; font-size: 14px; }
`;

function pagina(titulo: string, cuerpo: string, notas: string, variante: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titulo)}</title>
<style>${CSS}</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${SPRITE_ICONO_VOLVER}</svg>
<div class="barra"><a href="index.html">← Índice</a> · ${escapeHtml(variante)}</div>
<main>
<h1>${escapeHtml(titulo)}</h1>
${cuerpo}
${notas}
</main>
</body>
</html>
`;
}

const { articulos, dimensiones } = await leerArticulosYDimensiones();
mkdirSync(salida, { recursive: true });

const reescribir = (html: string) => (prefijoOriginales ? html.replaceAll('src="/media/', `src="${prefijoOriginales}`) : html);
const filas: string[] = [];
let paginas = 0;
let imagenes = 0;
const faltantes: string[] = [];

for (const a of articulos) {
  const variantes = CON_VARIANTE_CAPITAL.has(a.wpId) ? [false, true] : [false];
  const enlaces: string[] = [];
  for (const conCapital of variantes) {
    const r = renderArticleBody(a.cuerpo, { conCapital, dimensionesImagenes: dimensiones });
    const html = reescribir(r.html);
    const archivo = `${a.wpId}${conCapital ? "-capital" : ""}.html`;
    writeFileSync(join(salida, archivo), pagina(a.titulo, html, r.notesHtml, conCapital ? "con letra capital" : "sin letra capital"), "utf8");
    paginas++;
    enlaces.push(`<a href="${archivo}">${conCapital ? "con capital" : "sin capital"}</a>`);
    if (!conCapital && prefijoOriginales && originales) {
      for (const m of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/g)) {
        imagenes++;
        const clave = decodeURIComponent((m[1] ?? "").slice(prefijoOriginales.length));
        if (!existsSync(join(originales, clave))) faltantes.push(`${a.wpId}: ${clave}`);
      }
    }
  }
  filas.push(`<tr><td>${a.wpId}</td><td>${escapeHtml(a.titulo)}</td><td>${enlaces.join(" · ")}</td></tr>`);
}

const indice = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vista previa de los ${articulos.length} artículos</title>
<style>${CSS} table { width: 100%; font-size: 15px; } td { vertical-align: top; }</style>
</head>
<body>
<main>
<h1>Vista previa de los ${articulos.length} artículos</h1>
<p>Generada ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. CSS neutro de prueba: no es el diseño final.</p>
<table>
<tr><th>wpId</th><th>Título</th><th>Versión</th></tr>
${filas.join("\n")}
</table>
</main>
</body>
</html>
`;
writeFileSync(join(salida, "index.html"), indice, "utf8");

console.log(`Generadas ${paginas} páginas y el índice en ${salida}`);
if (prefijoOriginales) {
  console.log(`Imágenes reescritas a ${prefijoOriginales}: ${imagenes} en las páginas sin capital, ${faltantes.length} sin archivo en la carpeta.`);
  faltantes.forEach((f) => console.log("  - falta", f));
} else {
  console.log("Sin --originales: las imágenes apuntan a /media/... y no se van a ver.");
}
