// Prueba de humo del sitio completo: levanta crearApp (puerto efímero en 127.0.0.1) con el sitio compilado y la base real
// (evaristo_cms, 3308, solo lectura) y recorre lo esencial: API, portada, artículos, autores, redirecciones, 404, estáticos e imágenes.
//
// Requiere: npm run build:sitio y la carpeta de originales (MEDIA_DIR o --originales=<carpeta>).
// Uso: npm run test:humo -- --originales="C:\ruta\a\originales"
import { existsSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { crearApp } from "../app.js";

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

const arg = process.argv.find((a) => a.startsWith("--originales="))?.slice("--originales=".length);
const dirMedia = arg ?? process.env["MEDIA_DIR"];
if (!dirMedia) fallar("falta la carpeta de originales: --originales=<carpeta> o MEDIA_DIR");
if (!existsSync(fileURLToPath(new URL("../../../sitio/dist/server/entry.mjs", import.meta.url)))) fallar("falta compilar el sitio: corré npm run build:sitio");
const url = process.env["DATABASE_URL"] ? new URL(process.env["DATABASE_URL"]) : undefined;
if (!url) fallar("falta DATABASE_URL en el .env");
if (url.port !== "3308" || decodeURIComponent(url.pathname.slice(1)) !== "evaristo_cms") {
  fallar(`DATABASE_URL apunta a ${url.hostname}:${url.port}${url.pathname}; esta prueba solo corre contra evaristo_cms en el 3308`);
}

const dos = (n: number) => String(n).padStart(2, "0");
const canonica = (slug: string, d: Date) => `/${d.getUTCFullYear()}/${dos(d.getUTCMonth() + 1)}/${dos(d.getUTCDate())}/${encodeURIComponent(slug)}/`;
const contar = (texto: string, re: RegExp) => texto.match(re)?.length ?? 0;

const prisma = obtenerClientePrisma();
let server: Server | undefined;
const problemas: string[] = [];
try {
  let articulos;
  try {
    articulos = await prisma.articulo.findMany({ select: { slug: true, estado: true, publicadoEn: true }, orderBy: { publicadoEn: "desc" } });
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
  const ahora = new Date();
  const publicados = articulos.filter((a) => a.estado === "PUBLICADO" && a.publicadoEn && a.publicadoEn <= ahora);
  const noPublicados = articulos.filter((a) => !publicados.includes(a));

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, { dirMedia }).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (ruta: string, metodo = "GET") =>
    new Promise<{ estado: number; cabeceras: Record<string, string | string[] | undefined>; cuerpo: string }>((resolver, rechazar) => {
      const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => resolver({ estado: res.statusCode ?? 0, cabeceras: res.headers, cuerpo: Buffer.concat(partes).toString("utf8") }));
      });
      req.on("error", rechazar);
      req.end();
    });
  const falla = (donde: string, m: string) => problemas.push(`${donde}: ${m}`);

  // Revisiones comunes a toda página HTML
  const revisarHtml = (donde: string, r: { estado: number; cabeceras: Record<string, string | string[] | undefined>; cuerpo: string }, estadoEsperado: number) => {
    if (r.estado !== estadoEsperado) falla(donde, `estado ${r.estado}, se esperaba ${estadoEsperado}`);
    const tipo = String(r.cabeceras["content-type"] ?? "").toLowerCase();
    if (!tipo.startsWith("text/html") || !tipo.includes("charset=utf-8")) falla(donde, `content-type ${tipo}`);
    if (r.cabeceras["x-powered-by"]) falla(donde, "anuncia X-Powered-By");
    const h = r.cuerpo;
    if (!h.includes('<html lang="es"')) falla(donde, "falta lang=es");
    if (!h.includes('name="viewport"')) falla(donde, "falta viewport");
    if (!/<title>[^<]+<\/title>/.test(h)) falla(donde, "título vacío");
    if (contar(h, /<h1[\s>]/g) !== 1) falla(donde, `${contar(h, /<h1[\s>]/g)} h1`);
    if (!h.includes('id="i-corner-up-left"') || !h.includes('class="salto-contenido"')) falla(donde, "falta el sprite o el salto al contenido");
    if (/>\s*(undefined|null|NaN|\[object Object\])\s*</.test(h) || /="(undefined|null|NaN|\[object Object\])"/.test(h)) falla(donde, "texto 'undefined', 'null' o '[object Object]'");
  };

  // 1) API
  const salud = await pedir("/api/salud");
  if (salud.estado !== 200 || !salud.cuerpo.includes('"estado":"ok"')) falla("/api/salud", `dio ${salud.estado} ${salud.cuerpo.slice(0, 60)}`);

  // 2) Portada provisoria: los últimos 12 artículos
  const portada = await pedir("/");
  revisarHtml("/", portada, 200);
  const tarjetasPortada = contar(portada.cuerpo, /<article class="tarjeta"/g);
  if (tarjetasPortada !== Math.min(12, publicados.length)) falla("/", `${tarjetasPortada} tarjetas, se esperaban ${Math.min(12, publicados.length)}`);
  const primerosHrefs = [...portada.cuerpo.matchAll(/<h3><a href="([^"]+)"/g)].map((m) => m[1]);
  const esperadosPortada = publicados.slice(0, 12).map((a) => canonica(a.slug, a.publicadoEn!));
  if (JSON.stringify(primerosHrefs) !== JSON.stringify(esperadosPortada)) falla("/", "los artículos de la portada no son los 12 más nuevos, en orden");

  // 3) Hoja de estilos y tipografías
  const css = /<link[^>]+rel="stylesheet"[^>]+href="(\/_astro\/[^"]+\.css)"/.exec(portada.cuerpo)?.[1] ?? /href="(\/_astro\/[^"]+\.css)"/.exec(portada.cuerpo)?.[1];
  if (!css) falla("/", "no enlaza una hoja de estilos de /_astro/");
  else {
    const r = await pedir(css);
    if (r.estado !== 200 || !String(r.cabeceras["content-type"]).startsWith("text/css")) falla(css, `dio ${r.estado} ${String(r.cabeceras["content-type"])}`);
  }
  if (!portada.cuerpo.includes("fonts.googleapis.com/css2?family=Fraunces")) falla("/", "falta la carga de Fraunces");

  // 4) Artículos publicados: 200 en su URL canónica; también HEAD
  for (const a of publicados) {
    const ruta = canonica(a.slug, a.publicadoEn!);
    revisarHtml(ruta, await pedir(ruta), 200);
  }
  const head = await pedir(canonica(publicados[0]!.slug, publicados[0]!.publicadoEn!), "HEAD");
  if (head.estado !== 200 || head.cuerpo.length) falla("HEAD de un artículo", `estado ${head.estado}, cuerpo ${head.cuerpo.length} bytes`);

  // 5) No publicados: 404 con la página 404 del sitio
  for (const a of noPublicados) {
    const ruta = a.publicadoEn ? canonica(a.slug, a.publicadoEn) : `/2000/01/01/${encodeURIComponent(a.slug)}/`;
    const r = await pedir(ruta);
    revisarHtml(`no publicado ${ruta}`, r, 404);
    if (!r.cuerpo.includes("No encontramos esa página")) falla(`no publicado ${ruta}`, "no muestra la página 404 del sitio");
  }

  // 6) Rutas que no existen: 404 del sitio (artículo, autor, ruta cualquiera, método no GET)
  for (const ruta of ["/2020/01/01/no-existe/", "/author/no-existe/", "/author/", "/no/existe/", "/seccion-inexistente", "/wp-login.php", "/%E0%A4%A"]) {
    const r = await pedir(ruta);
    if (r.estado !== 404 && r.estado !== 400) falla(ruta, `dio ${r.estado}`);
    else if (r.estado === 404) revisarHtml(ruta, r, 404);
  }
  const post = await pedir("/no/existe/", "POST");
  if (post.estado !== 404) falla("POST /no/existe/", `dio ${post.estado}`);
  if (/Cannot (GET|POST)/.test((await pedir("/no/existe/")).cuerpo)) falla("/no/existe/", "responde el 404 de Express en vez del del sitio");

  // 7) Autores
  const autores = await pedir("/autores/");
  revisarHtml("/autores/", autores, 200);

  // 8) Redirecciones de la muestra y el panel
  const slugAnterior = await pedir("/2017/06/19/culpables/");
  if (slugAnterior.estado !== 301) falla("/2017/06/19/culpables/", `dio ${slugAnterior.estado}, se esperaba 301`);
  const panel = existsSync(fileURLToPath(new URL("../../../panel/dist/index.html", import.meta.url)));
  if (panel) {
    const adm = await pedir("/admin/");
    if (adm.estado !== 200 || !String(adm.cabeceras["x-robots-tag"]).includes("noindex")) falla("/admin/", `dio ${adm.estado}, x-robots-tag ${String(adm.cabeceras["x-robots-tag"])}`);
  } else {
    console.log("Panel: omitido porque no está compilado (npm run build:panel); no es parte del sitio público.");
  }

  // 9) Enlaces internos y imágenes de lo recorrido: todo resuelve. Las páginas de sección todavía no existen (no está especificada).
  const paginas = [portada, autores, ...(await Promise.all(publicados.slice(0, 12).map((a) => pedir(canonica(a.slug, a.publicadoEn!)))))];
  const enlaces = new Set<string>();
  const imagenes = new Set<string>();
  for (const p of paginas) {
    for (const m of p.cuerpo.matchAll(/\shref="(\/[^"#]*)"/g)) if (!m[1]!.startsWith("//")) enlaces.add(m[1]!.replace(/&amp;/g, "&"));
    for (const m of p.cuerpo.matchAll(/\ssrc="(\/media\/[^"]+)"/g)) imagenes.add(m[1]!);
  }
  const sinPagina = [...enlaces].filter((e) => e.startsWith("/seccion/"));
  let resueltos = 0;
  for (const e of [...enlaces].filter((x) => !x.startsWith("/seccion/") && !x.startsWith("/_astro/"))) {
    let r = await pedir(e);
    if (r.estado === 301 && typeof r.cabeceras["location"] === "string") r = await pedir(r.cabeceras["location"]);
    if (r.estado !== 200) falla(`enlace ${e}`, `dio ${r.estado}`);
    else resueltos++;
  }
  let imgOk = 0;
  for (const i of imagenes) {
    const r = await pedir(i);
    if (r.estado !== 200 || !String(r.cabeceras["content-type"]).startsWith("image/")) falla(`imagen ${i}`, `dio ${r.estado} ${String(r.cabeceras["content-type"])}`);
    else imgOk++;
  }

  console.log(`API: /api/salud ok. Portada: ${tarjetasPortada} artículos, hoja de estilos 200.`);
  console.log(`Artículos: ${publicados.length} publicados con 200 y ${noPublicados.length} no publicado(s) con la página 404 del sitio.`);
  console.log(`Enlaces internos de ${paginas.length} páginas: ${resueltos} resuelven. Imágenes de /media: ${imgOk} de ${imagenes.size} con 200.`);
  if (sinPagina.length) console.log(`PENDIENTE conocido: ${sinPagina.length} enlaces a páginas de sección (/seccion/<slug>/) que todavía no existen (por ejemplo ${sinPagina[0]}).`);
  if (problemas.length) fallar(`${problemas.length} problemas:\n  - ${problemas.slice(0, 40).join("\n  - ")}`);
  console.log("\nOK: el sitio responde bien de punta a punta.");
} finally {
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
