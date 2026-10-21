// Prueba de las páginas de categoría (/categoria/<slug>/) y de la volanta como enlace, contra la base real
// (evaristo_cms, 3308, solo lectura) y el sitio compilado. Levanta crearApp en 127.0.0.1 con puerto efímero.
//
// Requiere: npm run build:sitio y MEDIA_DIR (o --originales=<carpeta>).
// Uso: npm run test:categorias -- --originales="C:\ruta\a\originales"
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

const NOTAS_POR_PAGINA = 12; // el mismo valor que apps/sitio/src/lib/paginacion.ts
const dos = (n: number) => String(n).padStart(2, "0");
const canonica = (slug: string, d: Date) => `/${d.getUTCFullYear()}/${dos(d.getUTCMonth() + 1)}/${dos(d.getUTCDate())}/${encodeURIComponent(slug)}/`;
const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const contar = (texto: string, re: RegExp) => texto.match(re)?.length ?? 0;

const prisma = obtenerClientePrisma();
let server: Server | undefined;
const problemas: string[] = [];
try {
  let categorias;
  let articulos;
  try {
    categorias = await prisma.categoria.findMany({
      select: { slug: true, nombre: true, articulos: { select: { articulo: { select: { slug: true, estado: true, publicadoEn: true } } } } },
      orderBy: { id: "asc" },
    });
    articulos = await prisma.articulo.findMany({
      select: { slug: true, estado: true, publicadoEn: true, categoriaPrincipal: { select: { slug: true, nombre: true } }, categorias: { select: { categoria: { select: { slug: true } } } } },
    });
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
  const ahora = new Date();
  const esVisible = (a: { estado: string; publicadoEn: Date | null }) => a.estado === "PUBLICADO" && a.publicadoEn !== null && a.publicadoEn <= ahora;

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, { dirMedia }).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (ruta: string) =>
    new Promise<{ estado: number; cabeceras: Record<string, string | string[] | undefined>; cuerpo: string }>((resolver, rechazar) => {
      const req = request({ host: "127.0.0.1", port: puerto, path: ruta }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => resolver({ estado: res.statusCode ?? 0, cabeceras: res.headers, cuerpo: Buffer.concat(partes).toString("utf8") }));
      });
      req.on("error", rechazar);
      req.end();
    });

  // 1) Cada categoría
  let paginasRecorridas = 0;
  for (const c of categorias) {
    const falla = (m: string) => problemas.push(`categoría ${c.slug}: ${m}`);
    const ruta = `/categoria/${encodeURIComponent(c.slug)}/`;
    const notas = c.articulos
      .map((x) => x.articulo)
      .filter(esVisible)
      .sort((p, q) => q.publicadoEn!.getTime() - p.publicadoEn!.getTime());
    const paginas = Math.max(1, Math.ceil(notas.length / NOTAS_POR_PAGINA));
    const vistas: string[] = [];
    for (let p = 1; p <= paginas; p++) {
      const r = await pedir(p === 1 ? ruta : `${ruta}?pagina=${p}`);
      paginasRecorridas++;
      if (r.estado !== 200) {
        falla(`página ${p} dio ${r.estado}`);
        continue;
      }
      const html = r.cuerpo;
      if (contar(html, /<h1[\s>]/g) !== 1 || !html.includes(`<h1 class="titulo-pagina">${escapar(c.nombre)}</h1>`)) falla("el h1 no es el nombre de la categoría");
      const cuenta = notas.length === 1 ? "1 nota" : `${notas.length} notas`;
      if (!html.includes(`<p class="cuenta-listado">${cuenta}</p>`)) falla(`no dice "${cuenta}"`);
      if (notas.length === 0 && !html.includes("Todavía no hay notas publicadas en esta categoría")) falla("sin notas debería avisarlo");
      if ((paginas > 1) !== html.includes('class="paginacion"')) falla("la paginación no coincide con la cantidad de notas");
      vistas.push(...[...html.matchAll(/<article class="tarjeta">[\s\S]*?<h3><a href="([^"]+)"/g)].map((m) => m[1]!));
    }
    const esperadas = notas.map((a) => canonica(a.slug, a.publicadoEn!));
    if (JSON.stringify(vistas) !== JSON.stringify(esperadas)) falla(`las notas no son las ${notas.length} visibles en orden (${vistas.length} vistas)`);
    const sinBarra = await pedir(ruta.slice(0, -1));
    if (sinBarra.estado !== 301 || sinBarra.cabeceras["location"] !== ruta) falla(`sin barra final: ${sinBarra.estado} → ${String(sinBarra.cabeceras["location"])}`);
    if ((await pedir(`${ruta}?pagina=${paginas + 1}`)).estado !== 404) falla(`?pagina=${paginas + 1} debería dar 404`);
    if ((await pedir(`${ruta}?pagina=abc`)).estado !== 200) falla("?pagina=abc debería valer 1");
  }
  for (const ruta of ["/categoria/no-existe/", "/categoria/", "/categoria/x%2fy/"]) {
    const r = await pedir(ruta);
    if (r.estado !== 404) problemas.push(`${ruta} debería dar 404 y dio ${r.estado}`);
  }

  // 2) La volanta: enlace a la categoría principal, que incluye al artículo
  let conVolanta = 0;
  let sinVolanta = 0;
  for (const a of articulos.filter(esVisible)) {
    const falla = (m: string) => problemas.push(`artículo ${a.slug}: ${m}`);
    const html = (await pedir(canonica(a.slug, a.publicadoEn!))).cuerpo;
    const principal = a.categoriaPrincipal;
    if (!principal) {
      sinVolanta++;
      if (html.includes('class="volanta"')) falla("no tiene categoría principal y muestra una volanta");
      continue;
    }
    conVolanta++;
    const esperado = `<p class="volanta"><a href="/categoria/${encodeURIComponent(principal.slug)}/">${escapar(principal.nombre)}</a></p>`;
    if (!html.includes(esperado)) falla(`la volanta no es el enlace ${esperado}`);
    if (!a.categorias.some((x) => x.categoria.slug === principal.slug)) falla("la categoría principal no está entre sus categorías");
    // La volanta va entre el cintillo y el título
    const orden = html.indexOf('class="volanta"') < html.indexOf("<h1>") && html.indexOf('class="volanta"') > html.indexOf('class="etiqueta"') - 1;
    if (!orden) falla("la volanta no está sobre el título");
  }

  console.log(`Categorías: ${categorias.length} con 200 (${paginasRecorridas} páginas recorridas), las notas de cada una en orden.`);
  console.log(`Volanta: ${conVolanta} artículos con volanta como enlace a su categoría y ${sinVolanta} sin volanta.`);
  if (problemas.length) fallar(`${problemas.length} problemas:\n  - ${problemas.slice(0, 40).join("\n  - ")}`);
  console.log("\nOK: las páginas de categoría y la volanta funcionan para todos los datos de la base.");
} finally {
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
