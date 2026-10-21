// Prueba de las páginas de sección (/seccion/<slug>/) contra la base real (evaristo_cms, 3308, solo lectura)
// y el sitio compilado. Levanta crearApp en 127.0.0.1 con puerto efímero.
//
// Requiere: npm run build:sitio y MEDIA_DIR (o --originales=<carpeta>).
// Uso: npm run test:secciones -- --originales="C:\ruta\a\originales"
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
  let secciones;
  try {
    secciones = await prisma.seccion.findMany({
      select: { slug: true, nombre: true, interna: true, articulos: { select: { slug: true, estado: true, publicadoEn: true } } },
      orderBy: { id: "asc" },
    });
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
  const ahora = new Date();
  const visibles = (s: (typeof secciones)[number]) =>
    s.articulos.filter((a) => a.estado === "PUBLICADO" && a.publicadoEn && a.publicadoEn <= ahora).sort((p, q) => q.publicadoEn!.getTime() - p.publicadoEn!.getTime());

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

  let conPagina = 0;
  let paginasRecorridas = 0;
  let totalNotasVistas = 0;
  for (const s of secciones) {
    const falla = (m: string) => problemas.push(`${s.slug}: ${m}`);
    const ruta = `/seccion/${encodeURIComponent(s.slug)}/`;
    if (s.interna) {
      if ((await pedir(ruta)).estado !== 404) falla("sección interna debería dar 404");
      continue;
    }
    conPagina++;
    const notas = visibles(s);
    const paginas = Math.max(1, Math.ceil(notas.length / NOTAS_POR_PAGINA));

    // Todas las páginas: la unión, en orden, son exactamente las notas visibles
    const vistas: string[] = [];
    for (let p = 1; p <= paginas; p++) {
      const r = await pedir(p === 1 ? ruta : `${ruta}?pagina=${p}`);
      paginasRecorridas++;
      if (r.estado !== 200) {
        falla(`página ${p} dio ${r.estado}`);
        continue;
      }
      const html = r.cuerpo;
      if (contar(html, /<h1[\s>]/g) !== 1 || !html.includes(`<h1 class="titulo-pagina">${escapar(s.nombre)}</h1>`)) falla(`página ${p}: el h1 no es el nombre de la sección`);
      const cuenta = notas.length === 1 ? "1 nota" : `${notas.length} notas`;
      if (!html.includes(`<p class="cuenta-listado">${cuenta}</p>`)) falla(`página ${p}: no dice "${cuenta}"`);
      if ((paginas > 1) !== html.includes('class="paginacion"')) falla(`página ${p}: la paginación no coincide con la cantidad de notas`);
      if (paginas > 1 && !html.includes(`Página ${p} de ${paginas}`)) falla(`página ${p}: no dice "Página ${p} de ${paginas}"`);
      if (notas.length === 0 && !html.includes("Todavía no hay notas publicadas en esta sección")) falla("sin notas debería avisarlo");
      // Las tarjetas de una sección no repiten el cintillo
      if (/<article class="tarjeta"[\s\S]*?class="etiqueta"/.test(html.split('class="paginacion"')[0] ?? "")) falla(`página ${p}: las tarjetas repiten el cintillo`);
      vistas.push(...[...html.matchAll(/<article class="tarjeta">[\s\S]*?<h3><a href="([^"]+)"/g)].map((m) => m[1]!));
    }
    const esperadas = notas.map((a) => canonica(a.slug, a.publicadoEn!));
    totalNotasVistas += vistas.length;
    if (JSON.stringify(vistas) !== JSON.stringify(esperadas)) falla(`las notas de todas las páginas no son las ${notas.length} visibles en orden (${vistas.length} vistas)`);

    // Sin barra final, página 1 explícita, página inexistente, página inválida
    const sinBarra = await pedir(ruta.slice(0, -1));
    if (sinBarra.estado !== 301 || sinBarra.cabeceras["location"] !== ruta) falla(`sin barra final: ${sinBarra.estado} → ${String(sinBarra.cabeceras["location"])}`);
    if ((await pedir(`${ruta}?pagina=1`)).estado !== 200) falla("?pagina=1 no da 200");
    if ((await pedir(`${ruta}?pagina=abc`)).estado !== 200) falla("?pagina=abc debería valer 1");
    if ((await pedir(`${ruta}?pagina=${paginas + 1}`)).estado !== 404) falla(`?pagina=${paginas + 1} debería dar 404`);
  }

  for (const ruta of ["/seccion/no-existe/", "/seccion/", "/seccion/x%2fy/"]) {
    const r = await pedir(ruta);
    if (r.estado !== 404) problemas.push(`${ruta} debería dar 404 y dio ${r.estado}`);
  }

  console.log(`Secciones con página: ${conPagina} (200); internas: ${secciones.length - conPagina} (404). ${paginasRecorridas} páginas recorridas con ${totalNotasVistas} notas, en orden.`);
  const masLarga = secciones.filter((s) => !s.interna).sort((a, b) => visibles(b).length - visibles(a).length)[0];
  if (masLarga) console.log(`La más larga: ${masLarga.slug} con ${visibles(masLarga).length} notas en ${Math.ceil(visibles(masLarga).length / NOTAS_POR_PAGINA)} página(s).`);
  if (problemas.length) fallar(`${problemas.length} problemas:\n  - ${problemas.slice(0, 40).join("\n  - ")}`);
  console.log("\nOK: las páginas de sección responden bien para todas las secciones de la base.");
} finally {
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
