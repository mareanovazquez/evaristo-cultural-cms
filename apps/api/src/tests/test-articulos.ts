// Prueba de la vista pública del artículo contra la base real (evaristo_cms, 3308, solo lectura) y el sitio compilado.
// Levanta crearApp en 127.0.0.1 con puerto efímero y recorre las URLs canónicas /AAAA/MM/DD/slug/.
//
// Requiere: npm run build:sitio y MEDIA_DIR (o --originales=<carpeta>).
// Uso: npm run test:articulos -- --originales="C:\ruta\a\originales"
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
const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const contar = (texto: string, re: RegExp) => texto.match(re)?.length ?? 0;

const prisma = obtenerClientePrisma();
let server: Server | undefined;
const problemas: string[] = [];
try {
  let filas;
  try {
    filas = await prisma.articulo.findMany({
      select: { wpId: true, slug: true, titulo: true, estado: true, publicadoEn: true, cuerpo: true, imagenEncabezadoId: true },
      orderBy: { wpId: "asc" },
    });
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }

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

  const nodos = (n: unknown, tipo: string): number => {
    const x = n as { type?: string; content?: unknown[] } | undefined;
    if (!x || typeof x !== "object") return 0;
    return (x.type === tipo ? 1 : 0) + (x.content ?? []).reduce<number>((s, h) => s + nodos(h, tipo), 0);
  };

  let publicados = 0;
  let conEncabezado = 0;
  let imagenesCuerpo = 0;
  for (const a of filas) {
    const falla = (m: string) => problemas.push(`${a.wpId}: ${m}`);
    if (a.estado !== "PUBLICADO" || !a.publicadoEn) {
      const r = await pedir(a.publicadoEn ? canonica(a.slug, a.publicadoEn) : `/2000/01/01/${encodeURIComponent(a.slug)}/`);
      if (r.estado !== 404) falla(`no publicado (${a.estado}) debería dar 404 y dio ${r.estado}`);
      continue;
    }
    publicados++;
    const ruta = canonica(a.slug, a.publicadoEn);
    const r = await pedir(ruta);
    if (r.estado !== 200) {
      falla(`${ruta} dio ${r.estado}`);
      continue;
    }
    const html = r.cuerpo;
    if (!String(r.cabeceras["content-type"]).toLowerCase().includes("charset=utf-8")) falla("sin charset utf-8");
    if (contar(html, /<h1[\s>]/g) !== 1) falla(`hay ${contar(html, /<h1[\s>]/g)} h1`);
    if (!html.includes(`<h1>${escapar(a.titulo)}</h1>`) && !html.includes(`<h1>${escapar(a.titulo).replace(/&#039;/g, "&#39;")}</h1>`)) falla("el h1 no es el título");
    if (!html.includes('<html lang="es"')) falla("falta lang=es");
    if (/visitasWp|visitas_wp|cb_visit/i.test(html)) falla("aparece el contador de visitas de WordPress");
    if (/javascript:/i.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) falla("aparece javascript:");

    const imgsCuerpo = contar(html, /<img class="cuerpo-img"/g);
    const esperadasImg = nodos(a.cuerpo, "imagen");
    imagenesCuerpo += imgsCuerpo;
    if (imgsCuerpo !== esperadasImg) falla(`imágenes del cuerpo: ${imgsCuerpo} en el HTML, ${esperadasImg} en el JSON`);
    const heroes = contar(html, /<img class="hero-img"/g);
    if (heroes !== (a.imagenEncabezadoId ? 1 : 0)) falla(`imagen de encabezado: ${heroes}, se esperaba ${a.imagenEncabezadoId ? 1 : 0}`);
    conEncabezado += heroes;
    if (contar(html, /class="nota-ref"/g) !== nodos(a.cuerpo, "footnote")) falla("las llamadas a notas no coinciden con el JSON");
    for (const m of html.matchAll(/<img class="(?:hero-img|cuerpo-img)"[^>]*? src="([^"]+)"/g)) {
      if (!m[1]?.startsWith("/media/")) falla(`imagen fuera de /media/: ${m[1]}`);
    }
    // Relacionados: hasta 3 y ninguno es el propio artículo
    const rel = html.split('id="rel-titulo"')[1] ?? "";
    const tarjetas = contar(rel, /<article class="tarjeta"/g);
    if (tarjetas > 3) falla(`${tarjetas} relacionados`);
    if (rel.includes(`href="${ruta}"`)) falla("se relaciona consigo mismo");

    // Redirecciones a la canónica: día equivocado y sin la barra final
    const d = a.publicadoEn;
    const otroDia = `/${d.getUTCFullYear()}/${dos(d.getUTCMonth() + 1)}/${dos(d.getUTCDate() === 28 ? 27 : 28)}/${encodeURIComponent(a.slug)}/`;
    const rd = await pedir(otroDia);
    if (rd.estado !== 301 || rd.cabeceras["location"] !== ruta) falla(`día equivocado: ${rd.estado} → ${String(rd.cabeceras["location"])}`);
    const rb = await pedir(ruta.slice(0, -1));
    if (rb.estado !== 301 || rb.cabeceras["location"] !== ruta) falla(`sin barra final: ${rb.estado} → ${String(rb.cabeceras["location"])}`);
  }

  // Muestra de imágenes de encabezado a través de /media
  const muestra = await pedir((await pedir(canonica(filas.find((f) => f.estado === "PUBLICADO" && f.imagenEncabezadoId)!.slug, filas.find((f) => f.estado === "PUBLICADO" && f.imagenEncabezadoId)!.publicadoEn!))).cuerpo.match(/<img class="hero-img"[^>]*? src="([^"]+)"/)?.[1] ?? "/media/x");
  if (muestra.estado !== 200) problemas.push(`la imagen de encabezado de muestra dio ${muestra.estado}`);

  // Casos sueltos
  for (const ruta of ["/2020/01/01/no-existe/", "/20/01/01/algo/", "/abcd/01/01/algo/", "/2020/1/1/algo/"]) {
    const r = await pedir(ruta);
    if (r.estado !== 404) problemas.push(`${ruta} debería dar 404 y dio ${r.estado}`);
  }

  console.log(`Publicados: ${publicados} con 200 en su URL canónica; ${conEncabezado} con imagen de encabezado; ${imagenesCuerpo} imágenes en los cuerpos.`);
  console.log(`No publicados: ${filas.length - publicados} dan 404. Fecha equivocada y sin barra final: 301 a la canónica.`);
  if (problemas.length) fallar(`${problemas.length} problemas:\n  - ${problemas.slice(0, 40).join("\n  - ")}`);
  console.log("\nOK: la vista del artículo responde bien para todos los artículos de la base.");
} finally {
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
