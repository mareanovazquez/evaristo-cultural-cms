// Prueba de las páginas de autores (/author/<slug>/ y /autores/) contra la base real (evaristo_cms, 3308, solo lectura)
// y el sitio compilado. Levanta crearApp en 127.0.0.1 con puerto efímero.
//
// Requiere: npm run build:sitio y MEDIA_DIR (o --originales=<carpeta>).
// Uso: npm run test:autores -- --originales="C:\ruta\a\originales"
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

const NOTAS_POR_PAGINA = 12; // el mismo valor que apps/sitio/src/lib/autores.ts
const dos = (n: number) => String(n).padStart(2, "0");
const canonica = (slug: string, d: Date) => `/${d.getUTCFullYear()}/${dos(d.getUTCMonth() + 1)}/${dos(d.getUTCDate())}/${encodeURIComponent(slug)}/`;
const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const contar = (texto: string, re: RegExp) => texto.match(re)?.length ?? 0;
const CORREO = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

const prisma = obtenerClientePrisma();
let server: Server | undefined;
const problemas: string[] = [];
try {
  let autores;
  try {
    autores = await prisma.autor.findMany({
      select: {
        id: true,
        slug: true,
        nombre: true,
        soloTexto: true,
        bio: true,
        articulos: { select: { articulo: { select: { slug: true, estado: true, publicadoEn: true } } } },
      },
    });
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
  const filas = autores;
  type AutorFila = (typeof filas)[number];
  const ahora = new Date();
  const visibles = (a: AutorFila) =>
    a.articulos
      .map((x) => x.articulo)
      .filter((x) => x.estado === "PUBLICADO" && x.publicadoEn && x.publicadoEn <= ahora)
      .sort((p, q) => q.publicadoEn!.getTime() - p.publicadoEn!.getTime());

  const app = crearApp(prisma, { dirMedia });
  server = await new Promise<Server>((listo) => {
    const s = app.listen(0, "127.0.0.1", () => listo(s));
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
  for (const a of filas) {
    const falla = (m: string) => problemas.push(`${a.slug}: ${m}`);
    const ruta = `/author/${encodeURIComponent(a.slug)}/`;
    if (a.soloTexto) {
      const r = await pedir(ruta);
      if (r.estado !== 404) falla(`solo texto debería dar 404 y dio ${r.estado}`);
      continue;
    }
    conPagina++;
    const r = await pedir(ruta);
    if (r.estado !== 200) {
      falla(`${ruta} dio ${r.estado}`);
      continue;
    }
    const html = r.cuerpo;
    if (contar(html, /<h1[\s>]/g) !== 1 || !html.includes(`<h1>${escapar(a.nombre)}</h1>`)) falla("el h1 no es el nombre del autor");
    if (CORREO.test(html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ""))) falla("la página contiene un correo");
    if (a.bio !== null && !html.includes('class="autor-bio"')) falla("tiene bio y no se muestra");
    if (a.bio === null && html.includes('class="autor-bio"')) falla("no tiene bio y se muestra un bloque vacío");

    // Notas: las visibles, de la más nueva a la más vieja, hasta NOTAS_POR_PAGINA
    const esperadas = visibles(a).slice(0, NOTAS_POR_PAGINA).map((x) => canonica(x.slug, x.publicadoEn!));
    const reales = [...html.matchAll(/<article class="tarjeta">[\s\S]*?<h3><a href="([^"]+)"/g)].map((m) => m[1]);
    if (JSON.stringify(reales) !== JSON.stringify(esperadas)) falla(`notas: ${JSON.stringify(reales)} en vez de ${JSON.stringify(esperadas)}`);
    if (esperadas.length === 0 && !html.includes("Todavía no hay notas")) falla("sin notas debería avisarlo");
    const paginas = Math.max(1, Math.ceil(visibles(a).length / NOTAS_POR_PAGINA));
    if ((paginas > 1) !== html.includes('class="paginacion"')) falla("la paginación no coincide con la cantidad de notas");

    // Redirección sin barra final, página 1 explícita, página inexistente, página inválida
    const sinBarra = await pedir(ruta.slice(0, -1));
    if (sinBarra.estado !== 301 || sinBarra.cabeceras["location"] !== ruta) falla(`sin barra final: ${sinBarra.estado} → ${String(sinBarra.cabeceras["location"])}`);
    if ((await pedir(`${ruta}?pagina=1`)).estado !== 200) falla("?pagina=1 no da 200");
    if ((await pedir(`${ruta}?pagina=abc`)).estado !== 200) falla("?pagina=abc debería valer 1");
    if ((await pedir(`${ruta}?pagina=${paginas + 1}`)).estado !== 404) falla(`?pagina=${paginas + 1} debería dar 404`);
  }

  // Listado
  const lista = await pedir("/autores/");
  if (lista.estado !== 200) problemas.push(`/autores/ dio ${lista.estado}`);
  else {
    const esperadosLista = filas
      .filter((a) => !a.soloTexto && visibles(a).length > 0)
      .sort((p, q) => p.nombre.localeCompare(q.nombre, "es"))
      .map((a) => `${a.slug}|${a.nombre}|${visibles(a).length === 1 ? "1 nota" : `${visibles(a).length} notas`}`);
    const realesLista = [...lista.cuerpo.matchAll(/<a href="\/author\/([^"/]+)\/"[^>]*>[\s\S]*?<span class="nombre">([^<]*)<\/span><span class="cuenta">([^<]*)<\/span>/g)].map(
      (m) => `${decodeURIComponent(m[1] ?? "")}|${(m[2] ?? "").replace(/&#039;/g, "'")}|${m[3]}`,
    );
    if (JSON.stringify(realesLista) !== JSON.stringify(esperadosLista)) problemas.push(`listado: ${JSON.stringify(realesLista.slice(0, 3))}… en vez de ${JSON.stringify(esperadosLista.slice(0, 3))}…`);
    if (contar(lista.cuerpo, /<h1[\s>]/g) !== 1) problemas.push("/autores/ no tiene un único h1");
    if (CORREO.test(lista.cuerpo.replace(/<(script|style)[\s\S]*?<\/\1>/g, ""))) problemas.push("/autores/ contiene un correo");
    console.log(`Listado: ${realesLista.length} autores en orden alfabético con su cantidad de notas.`);
  }

  // Casos sueltos
  for (const ruta of ["/author/no-existe/", "/author/", "/author/x%2fy/", "/author/x%5cy/"]) {
    const r = await pedir(ruta);
    if (r.estado !== 404) problemas.push(`${ruta} debería dar 404 y dio ${r.estado}`);
  }

  // Los enlaces de autor de las notas publicadas resuelven (con página) o no existen (solo texto)
  let enlaces = 0;
  const soloTexto = new Set(filas.filter((a) => a.soloTexto).map((a) => a.slug));
  for (const a of filas) {
    for (const x of visibles(a).slice(0, 1)) {
      const art = await pedir(canonica(x.slug, x.publicadoEn!));
      for (const m of art.cuerpo.matchAll(/href="(\/author\/[^"]+)"/g)) {
        enlaces++;
        const r = await pedir(m[1]!);
        if (r.estado !== 200) problemas.push(`enlace de autor ${m[1]} desde ${x.slug} dio ${r.estado}`);
      }
      if (soloTexto.has(a.slug) && art.cuerpo.includes(`href="/author/${a.slug}/"`)) problemas.push(`${a.slug}: autor de solo texto con enlace`);
    }
  }

  console.log(`Autores con página: ${conPagina} con 200; autores de solo texto: ${soloTexto.size} con 404. Enlaces de autor desde las notas: ${enlaces} resuelven.`);
  if (problemas.length) fallar(`${problemas.length} problemas:\n  - ${problemas.slice(0, 40).join("\n  - ")}`);
  console.log("\nOK: las páginas de autores responden bien para todos los autores de la base.");
} finally {
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
