// Prueba de las novedades del sitio (campo `novedadHasta` del artículo) con la base de desarrollo y el sitio compilado (`npm run build:sitio`).
// Crea artículos temporales y los borra al terminar. Comprueba: la página /novedades/ (solo las vigentes y publicadas, paginada), la etiqueta
// «Novedad» en las tarjetas, en la nota y en los resultados del buscador, el bloque «Novedades» de la portada, y los enlaces del menú y del pie.
//
// Uso: npm run test:novedades
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { crearApp } from "../app.js";
import { elegirBase } from "../entorno.js";

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}
try {
  if (elegirBase(["--base-dev"]) !== "dev") fallar("no se pudo elegir la base de desarrollo");
} catch (e) {
  fallar(e instanceof Error ? e.message : String(e));
}
const url = new URL(process.env["DATABASE_URL"]!);
if (url.port !== "3308" || decodeURIComponent(url.pathname.slice(1)) !== "evaristo_cms_dev") fallar("esta prueba solo corre contra evaristo_cms_dev en el 3308");
if (!existsSync(fileURLToPath(new URL("../../../sitio/dist/server/entry.mjs", import.meta.url)))) fallar("falta compilar el sitio: npm run build:sitio");

const prisma = obtenerClientePrisma();
const sufijo = Date.now().toString(36).replace(/[^a-z0-9]/g, "");
const servidor = crearApp(prisma, {}).listen(0, "127.0.0.1");
await new Promise((r) => servidor.once("listening", r));
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const pedir = async (ruta: string) => {
  const r = await fetch(`${base}${ruta}`);
  return { estado: r.status, html: await r.text() };
};
const DIA = 24 * 3600 * 1000;
const titulosEn = (html: string) => [...html.matchAll(/<h3><a href="[^"]+">([^<]*)<\/a><\/h3>/g)].map((m) => m[1]!);
/** Las tarjetas de una página: título → si lleva la etiqueta «Novedad». */
const etiquetaPorTarjeta = (html: string): Map<string, boolean> =>
  new Map([...html.matchAll(/<article class="tarjeta">([\s\S]*?)<\/article>/g)].map((m) => [/<h3><a href="[^"]+">([^<]*)<\/a>/.exec(m[1]!)?.[1] ?? "", m[1]!.includes("etiqueta-novedad")]));

try {
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { interna: false }, orderBy: { orden: "asc" }, select: { id: true } });
  const nota = (titulo: string, novedadHasta: Date | null, extra: { publicadoEn?: Date | null; estado?: "PUBLICADO" | "BORRADOR"; texto?: string } = {}) =>
    prisma.articulo.create({
      data: {
        slug: `novtest-${sufijo}-${titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 200),
        titulo,
        cuerpo: { type: "doc", content: [] },
        textoPlano: extra.texto ?? "",
        estado: extra.estado ?? "PUBLICADO",
        publicadoEn: extra.publicadoEn === undefined ? new Date(Date.now() - 2 * 60_000) : extra.publicadoEn,
        novedadHasta,
        seccionId: seccion.id,
      },
      select: { id: true, slug: true, publicadoEn: true },
    });

  // Sin ninguna novedad vigente en la base, la portada no tiene el bloque ni el menú se rompe
  const yaHay = await prisma.articulo.count({ where: { estado: "PUBLICADO", publicadoEn: { lte: new Date() }, novedadHasta: { gt: new Date() } } });
  if (yaHay === 0) {
    const sin = await pedir("/");
    assert.ok(!sin.html.includes('id="bloque-novedades"'), "sin novedades, la portada no tiene el bloque «Novedades»");
    const vacia = await pedir("/novedades/");
    assert.equal(vacia.estado, 200);
    assert.match(vacia.html, /Por ahora no hay novedades/, "la página vacía lo explica");
  }

  const vigente = await nota(`Novtest ${sufijo} vigente`, new Date(Date.now() + 10 * DIA));
  const vencida = await nota(`Novtest ${sufijo} vencida`, new Date(Date.now() - 1 * DIA));
  const comun = await nota(`Novtest ${sufijo} comun`, null);
  // Tres novedades viejas (no están entre las 6 notas más nuevas): son las que el bloque de la portada puede mostrar sin repetir lo de arriba
  const venta = new Date(Date.now() + 10 * DIA);
  await nota(`Novtest ${sufijo} antigua uno`, venta, { publicadoEn: new Date("1990-01-03T12:00:00Z") });
  await nota(`Novtest ${sufijo} antigua dos`, venta, { publicadoEn: new Date("1990-01-02T12:00:00Z") });
  await nota(`Novtest ${sufijo} antigua tres`, venta, { publicadoEn: new Date("1990-01-01T12:00:00Z") });
  await nota(`Novtest ${sufijo} borrador`, new Date(Date.now() + 10 * DIA), { estado: "BORRADOR", publicadoEn: null });
  await nota(`Novtest ${sufijo} programada`, new Date(Date.now() + 10 * DIA), { publicadoEn: new Date(Date.now() + 5 * DIA) });

  // ---------- Página «Novedades» ----------
  const pagina = await pedir("/novedades/");
  assert.equal(pagina.estado, 200);
  assert.match(pagina.html, /<h1[^>]*>Novedades<\/h1>/);
  const titulos = titulosEn(pagina.html);
  assert.ok(titulos.includes(`Novtest ${sufijo} vigente`), "una nota cuya novedad no venció está");
  assert.ok(!titulos.includes(`Novtest ${sufijo} vencida`), "una cuya fecha pasó ya no");
  assert.ok(!titulos.includes(`Novtest ${sufijo} comun`), "una sin marca tampoco");
  assert.ok(!titulos.some((t) => t.includes("borrador") || t.includes("programada")), "ni un borrador ni una programada");
  assert.equal(etiquetaPorTarjeta(pagina.html).get(`Novtest ${sufijo} vigente`), true, "y lleva la etiqueta «Novedad»");
  assert.equal((await pedir("/novedades/?pagina=999")).estado, 404);

  // ---------- Etiqueta en los listados ----------
  const ultimas = etiquetaPorTarjeta((await pedir("/ultimas/")).html);
  assert.equal(ultimas.get(`Novtest ${sufijo} vigente`), true, "en «Últimas publicaciones» la vigente lleva la etiqueta");
  assert.equal(ultimas.get(`Novtest ${sufijo} vencida`), false, "la vencida no");
  assert.equal(ultimas.get(`Novtest ${sufijo} comun`), false, "ni la común");

  // ---------- En la nota ----------
  const ruta = (n: { slug: string; publicadoEn: Date | null }) => rutaArticulo({ slug: n.slug, publicadoEn: n.publicadoEn! });
  const enNota = await pedir(ruta(vigente));
  assert.equal(enNota.estado, 200);
  assert.match(enNota.html, /<p class="rotulos">[\s\S]*?<span class="etiqueta etiqueta-novedad">Novedad<\/span>/, "la nota vigente muestra «Novedad» junto a la sección");
  const rotulos = async (n: { slug: string; publicadoEn: Date | null }) => /<p class="rotulos">[\s\S]*?<\/p>/.exec((await pedir(ruta(n))).html)?.[0] ?? "";
  assert.ok(!(await rotulos(vencida)).includes("Novedad"), "la vencida, no (en su cintillo; los relacionados de abajo son otra cosa)");
  assert.ok(!(await rotulos(comun)).includes("Novedad"), "la común, no");

  // ---------- En el buscador ----------
  const porPalabra = await pedir(`/buscar/?q=${encodeURIComponent(`vigente ${sufijo}`)}`);
  assert.equal(etiquetaPorTarjeta(porPalabra.html).get(`Novtest ${sufijo} vigente`), true, "el resultado de una búsqueda también lleva la etiqueta");

  // ---------- Portada, menú y pie ----------
  const home = await pedir("/");
  assert.match(home.html, /id="bloque-novedades"/, "la portada tiene el bloque «Novedades»");
  assert.match(home.html, /<h2 id="bloque-novedades"><a href="\/novedades\/">Novedades<\/a><\/h2>/, "que lleva a /novedades/");
  const bloque = /<section class="bloque-seccion" aria-labelledby="bloque-novedades">[\s\S]*?<\/section>/.exec(home.html)?.[0] ?? "";
  assert.deepEqual(titulosEn(bloque), [`Novtest ${sufijo} antigua uno`, `Novtest ${sufijo} antigua dos`], "con las 2 novedades más nuevas que no están ya arriba");
  assert.ok(!home.html.slice(0, home.html.indexOf('id="bloque-novedades"')).includes(`Novtest ${sufijo} antigua`), "y el bloque va primero: ninguna de ellas está antes");
  assert.ok(titulosEn(bloque).every((t) => etiquetaPorTarjeta(bloque).get(t) === true), "todas con la etiqueta");
  const bloques = [...home.html.matchAll(/<section class="bloque-seccion"/g)].length;
  assert.ok(bloques % 2 === 0 || bloques <= 1, `los bloques quedan de a pares (${bloques})`);
  assert.ok((home.html.match(/href="\/novedades\/"/g) ?? []).length >= 4, "enlaces a Novedades en el menú (escritorio y celular), el pie y el bloque");

  console.log("OK: las novedades se ven donde corresponde (página /novedades/ solo con las vigentes y publicadas, etiqueta «Novedad» en listados, nota y buscador, bloque en la portada, menú y pie).");
} finally {
  await prisma.articulo.deleteMany({ where: { slug: { startsWith: `novtest-${sufijo}` } } });
  servidor.closeAllConnections();
  servidor.close();
  await prisma.$disconnect();
}
