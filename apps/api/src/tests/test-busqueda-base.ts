// Prueba del buscador del sitio (apps/sitio: lib/busqueda.ts y pages/buscar.astro) con la base de desarrollo y el sitio compilado
// (`npm run build:sitio`). Crea artículos y autores temporales y los borra al terminar. Comprueba cómo se entiende lo que se escribe, que
// encuentre por título, bajada, texto y autor sin importar tildes ni mayúsculas, que todas las palabras tengan que estar, las frases, el orden
// por relevancia, que no aparezcan borradores ni programados, la paginación, el escape de lo escrito y que el texto plano no lleve el guion blando.
//
// Uso: npm run test:busqueda
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { textoPlanoDe } from "@evaristo/compartido/texto-plano";
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

// El código del sitio abre su conexión al cargarse: se carga recién ahora, con la base de desarrollo ya elegida (si no, apuntaría a la real).
const { extractoConResaltado, interpretarConsulta } = await import("../../../sitio/src/lib/busqueda.js");

// ---------- Cómo se entiende lo que se escribe ----------
assert.equal(interpretarConsulta(""), null);
assert.equal(interpretarConsulta("   "), null);
assert.equal(interpretarConsulta(null), null);
assert.equal(interpretarConsulta("de la"), null, "las palabras de menos de 3 letras no se buscan");
assert.equal(interpretarConsulta("+-*()<>~@ ab")?.booleana, undefined, "los operadores de MySQL no cuentan");
assert.equal(interpretarConsulta("García Márquez")?.booleana, "+garcía* +márquez*");
assert.deepEqual(interpretarConsulta("García   Márquez")?.palabras, ["garcía", "márquez"], "espacios de más");
assert.equal(interpretarConsulta("Ga­rcía")?.booleana, "+garcía*", "se quita el guion blando");
assert.equal(interpretarConsulta('"cien años" soledad')?.booleana, '+"cien años" +soledad*', "frase exacta entre comillas");
assert.equal(interpretarConsulta("post-moderno")?.booleana, "+post* +moderno*", "el guion separa palabras");
assert.equal(interpretarConsulta("novela novela NOVELA")?.booleana, "+novela*", "sin repetidas");
assert.equal(interpretarConsulta("uno dos tres cuatro cinco seis siete ocho nueve diez")?.palabras.length, 8, "hasta 8 palabras");
assert.ok((interpretarConsulta("a".repeat(500) + " libro")?.texto.length ?? 0) <= 120, "largo máximo");
assert.equal(interpretarConsulta('"; DROP TABLE articulos; --')?.booleana, "+drop* +table* +articulos*", "lo escrito no puede cambiar la consulta: solo quedan palabras");
// Resaltado seguro
const c = interpretarConsulta("márquez")!;
assert.equal(extractoConResaltado("Gabriel García <b>Marquez</b> & más", c, true), "Gabriel García &lt;b&gt;<mark>Marquez</mark>&lt;/b&gt; &amp; más", "resalta sin tildes y escapa el HTML");
assert.ok(extractoConResaltado("texto", c, false).startsWith("…"), "puntos suspensivos si no arranca al principio");
// El texto plano no lleva el guion blando
assert.equal(textoPlanoDe({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "bi­blioteca​ abierta" }] }] } as never), "biblioteca abierta");

const prisma = obtenerClientePrisma();
const sufijo = Date.now().toString(36).replace(/[^a-z0-9]/g, "");
const P = (palabra: string) => `${palabra}${sufijo}`; // palabras únicas de esta corrida
const servidor = crearApp(prisma, {}).listen(0, "127.0.0.1");
await new Promise((r) => servidor.once("listening", r));
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const pedir = async (ruta: string) => {
  const r = await fetch(`${base}${ruta}`);
  return { estado: r.status, html: await r.text() };
};
const buscar = (q: string, extra = "") => pedir(`/buscar/?q=${encodeURIComponent(q)}${extra}`);
const titulosEn = (html: string) => [...html.matchAll(/<h3><a href="[^"]+">([^<]*)<\/a><\/h3>/g)].map((m) => m[1]!);
const DIA = 24 * 3600 * 1000;

try {
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { interna: false }, orderBy: { orden: "asc" }, select: { id: true } });
  const nota = (titulo: string, extra: { bajada?: string; texto?: string; publicadoEn?: Date | null; estado?: "PUBLICADO" | "BORRADOR"; autorId?: number } = {}) =>
    prisma.articulo.create({
      data: {
        slug: `busqtest-${sufijo}-${titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 200),
        titulo,
        bajada: extra.bajada ?? null,
        cuerpo: { type: "doc", content: [] },
        textoPlano: extra.texto ?? "",
        estado: extra.estado ?? "PUBLICADO",
        publicadoEn: extra.publicadoEn === undefined ? new Date(Date.now() - DIA) : extra.publicadoEn,
        seccionId: seccion.id,
        ...(extra.autorId ? { autores: { create: { autorId: extra.autorId, orden: 0 } } } : {}),
      },
      select: { id: true },
    });
  const autor = await prisma.autor.create({ data: { nombre: `Fulano ${P("Zeppelin")}`, slug: `busqtest-${sufijo}-autor` }, select: { id: true } });

  await nota(`Busqtest ${P("Zapallo")} en el título`);
  await nota("Busqtest nota con bajada", { bajada: `Una bajada que habla del ${P("quimbombó")} y nada más` });
  await nota("Busqtest nota con texto", { texto: `Primer párrafo sin nada.\nUn texto largo donde aparece la ${P("chinchulín")} comiendo con ${P("Mondongo")}, y sigue el texto un poco más.` });
  await nota("Busqtest nota de autor", { autorId: autor.id });
  await nota(`Busqtest ${P("Programada")} futura`, { publicadoEn: new Date(Date.now() + 5 * DIA) });
  await nota(`Busqtest ${P("Borrador")} oculto`, { estado: "BORRADOR", publicadoEn: null });
  // Relevancia: la que tiene la palabra en el título va antes que otra, más nueva, que la tiene solo en el texto
  await nota(`Busqtest ${P("Relevante")} en el título`, { publicadoEn: new Date(Date.now() - 10 * DIA) });
  await nota("Busqtest solo en el texto", { texto: `Habla de ${P("Relevante")} una sola vez`, publicadoEn: new Date(Date.now() - 1 * DIA) });
  // Para la paginación: 14 notas con la misma palabra
  for (let i = 1; i <= 14; i++) await nota(`Busqtest ${P("Paginada")} número ${String(i).padStart(2, "0")}`);

  // ---------- Página y casos de uso ----------
  const vacia = await pedir("/buscar/");
  assert.equal(vacia.estado, 200);
  assert.match(vacia.html, /<form class="buscador" role="search" action="\/buscar\/" method="get">/);
  assert.match(vacia.html, /<meta name="robots" content="noindex, nofollow"/, "los resultados no se indexan");
  assert.match(vacia.html, /Entre comillas/, "explica cómo buscar");
  const home = await pedir("/");
  assert.match(home.html, /<a class="buscar" href="\/buscar\/" aria-label="Buscar en la revista"/, "el encabezado tiene el botón de búsqueda");
  assert.match((await buscar("ab")).html, /Escribí al menos una palabra de 3 letras o más/);
  assert.match((await buscar("zzzzqxwv")).html, /No encontramos notas para «zzzzqxwv»/);

  // Por título, sin importar tildes ni mayúsculas, y por el principio de una palabra
  let r = await buscar(P("ZAPALLO").toUpperCase());
  assert.equal(r.estado, 200);
  assert.deepEqual(titulosEn(r.html), [`Busqtest ${P("Zapallo")} en el título`], "por el título");
  assert.match(r.html, /1 resultado para «/);
  assert.deepEqual(titulosEn((await buscar(P("zapallo").slice(0, -3))).html), [`Busqtest ${P("Zapallo")} en el título`], "por el comienzo de una palabra");
  // Por bajada, con tildes en lo guardado y sin tildes en lo escrito
  assert.deepEqual(titulosEn((await buscar(P("quimbombo"))).html), ["Busqtest nota con bajada"], "por la bajada, sin tildes");
  assert.deepEqual(titulosEn((await buscar(P("quimbombó"))).html), ["Busqtest nota con bajada"], "y con tildes");
  // Por el texto, con un extracto donde se ve lo buscado resaltado
  r = await buscar(P("chinchulin"));
  assert.deepEqual(titulosEn(r.html), ["Busqtest nota con texto"], "por el texto del cuerpo");
  assert.match(r.html, new RegExp(`<p class="extracto">…?[^<]*<mark>${P("chinchulín")}</mark>`), "con el extracto y la palabra resaltada");
  // Todas las palabras tienen que estar
  assert.deepEqual(titulosEn((await buscar(`${P("chinchulin")} ${P("mondongo")}`)).html), ["Busqtest nota con texto"], "con dos palabras que están");
  assert.match((await buscar(`${P("chinchulin")} ${P("zapallo")}`)).html, /No encontramos notas/, "con una que no está en la misma nota, no hay resultados");
  // Frase exacta
  assert.deepEqual(titulosEn((await buscar(`"comiendo con ${P("mondongo")}"`)).html), ["Busqtest nota con texto"], "frase exacta");
  assert.match((await buscar(`"${P("mondongo")} comiendo con"`)).html, /No encontramos notas/, "la frase en otro orden no coincide");
  // Por autor
  assert.deepEqual(titulosEn((await buscar(`fulano ${P("zeppelin")}`)).html), ["Busqtest nota de autor"], "por el nombre del autor");
  // No aparecen programados ni borradores
  assert.match((await buscar(P("programada"))).html, /No encontramos notas/, "una nota programada no se encuentra hasta su fecha");
  assert.match((await buscar(P("borrador"))).html, /No encontramos notas/, "ni un borrador");
  // Relevancia: el título pesa más que el texto, aunque la otra sea más nueva
  assert.deepEqual(titulosEn((await buscar(P("relevante"))).html), [`Busqtest ${P("Relevante")} en el título`, "Busqtest solo en el texto"], "ordena por relevancia");

  // Paginación: 12 por página, conserva lo buscado y la página que no existe da 404
  const p1 = await buscar(P("paginada"));
  assert.equal(titulosEn(p1.html).length, 12);
  assert.match(p1.html, /14 resultados para «/);
  assert.match(p1.html, new RegExp(`href="/buscar/\\?q=${P("paginada")}&amp;pagina=2" rel="next"`), "el enlace a la página 2 conserva la búsqueda");
  const p2 = await buscar(P("paginada"), "&pagina=2");
  assert.equal(titulosEn(p2.html).length, 2);
  assert.match(p2.html, new RegExp(`href="/buscar/\\?q=${P("paginada")}" rel="prev"`));
  assert.equal((await buscar(P("paginada"), "&pagina=9")).estado, 404);

  // Lo escrito se escapa y no cambia la consulta
  const xss = await buscar('"><script>alert(1)</script>');
  assert.equal(xss.estado, 200);
  // Lo escrito vuelve solo dentro del valor (entre comillas, con la comilla escapada) del cuadro de búsqueda: ahí es texto, no HTML
  assert.ok(xss.html.includes('value="&quot;><script>alert(1)</script>"'), "el cuadro conserva lo escrito, con la comilla escapada");
  assert.ok(!xss.html.replace(/value="[^"]*"/, "").includes("<script>alert(1)"), "y en ningún otro lado se refleja como HTML");
  assert.equal((await buscar('"; DROP TABLE articulos; --')).estado, 200);
  assert.ok(await prisma.articulo.count() > 0, "la tabla sigue estando");
  assert.equal((await pedir(`/buscar/?q=${"a".repeat(5000)}`)).estado, 200, "una consulta enorme no rompe nada");

  console.log("OK: el buscador entiende lo que se escribe, encuentra por título, bajada, texto y autor sin importar tildes ni mayúsculas, exige todas las palabras, acepta frases, ordena por relevancia, no muestra borradores ni programados, pagina conservando lo buscado y escapa lo escrito; el texto plano no lleva el guion blando.");
} finally {
  await prisma.articulo.deleteMany({ where: { slug: { startsWith: `busqtest-${sufijo}` } } });
  await prisma.autor.deleteMany({ where: { slug: { startsWith: `busqtest-${sufijo}` } } });
  servidor.closeAllConnections();
  servidor.close();
  await prisma.$disconnect();
}
