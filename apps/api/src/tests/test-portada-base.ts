// Prueba de la portada del sitio (apps/sitio: pages/index.astro, lib/portada.ts, Carrusel y BloqueSeccion) y de «Últimas publicaciones»
// con la base de desarrollo. Necesita el sitio compilado (`npm run build:sitio`). Crea artículos temporales (una nota nueva, una programada
// y un borrador) y los borra al terminar. No reemplaza mirar la portada en un navegador: acá se comprueba qué se muestra y en qué orden.
//
// Uso: npm run test:portada
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
const sufijo = Date.now().toString(36);
const prefijo = `Portatest ${sufijo}`;
const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const DIA = 24 * 3600 * 1000;

const servidor = crearApp(prisma, {}).listen(0, "127.0.0.1");
await new Promise((r) => servidor.once("listening", r));
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

try {
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { interna: false, articulos: { some: { estado: "PUBLICADO" } } }, orderBy: { orden: "asc" }, select: { id: true, slug: true, nombre: true } });
  const nuevo = (titulo: string, estado: "PUBLICADO" | "BORRADOR", publicadoEn: Date | null) =>
    prisma.articulo.create({ data: { slug: `portatest-${sufijo}-${titulo.toLowerCase().replace(/\W+/g, "-")}`, titulo: `${prefijo} ${titulo}`, cuerpo: { type: "doc", content: [] }, textoPlano: "", estado, publicadoEn, seccionId: seccion.id }, select: { id: true, slug: true } });
  const reciente = await nuevo("Nota nueva", "PUBLICADO", new Date(Date.now() - 60_000));
  await nuevo("Nota programada", "PUBLICADO", new Date(Date.now() + 10 * DIA));
  await nuevo("Nota en borrador", "BORRADOR", null);

  const pedir = async (ruta: string) => {
    const r = await fetch(`${base}${ruta}`);
    return { estado: r.status, html: await r.text() };
  };

  // ---------- Portada ----------
  const { estado, html } = await pedir("/");
  assert.equal(estado, 200);
  assert.equal((html.match(/<h1[^>]*>/g) ?? []).length, 1, "un solo H1");
  // El sitio oculta el texto solo para lectores con `sr-only` (la clase `solo-lectores` es del panel y acá no existe: el texto se vería)
  assert.ok(!html.includes("solo-lectores"), "no se usa una clase que el sitio no define para ocultar texto");
  assert.match(html, /<a class="btn btn--primary"[^>]*>\s*Leer\s*<span class="sr-only">/, "el botón dice solo «Leer» a la vista");
  assert.ok(/<h1[^>]*class="logo-titulo"[^>]*><a class="logo"[^>]*aria-label="Evaristo Cultural"/.test(html), "el H1 es el nombre de la revista del encabezado (no hay un título repetido)");
  assert.ok(!html.includes('class="sr-only">Evaristo Cultural'), "y no hay un título oculto aparte");
  // En las demás páginas el nombre de la revista es solo un enlace
  assert.ok(!/<h1[^>]*class="logo-titulo"/.test((await pedir("/ultimas/")).html), "en otras páginas el nombre de la revista no es el título");
  assert.match(html, /class="portada-fecha">[A-ZÁÉÍÓÚ][a-záéíóúñ]+, \d{1,2} de [a-zé]+ de \d{4}</, "la fecha completa en español, con mayúscula inicial");

  // Las notas que la base considera «las últimas»: visibles (publicadas y con fecha cumplida), de la más nueva a la más vieja
  const ultimas = await prisma.articulo.findMany({ where: { estado: "PUBLICADO", publicadoEn: { lte: new Date() } }, orderBy: [{ publicadoEn: "desc" }, { id: "desc" }], take: 6, select: { id: true, slug: true, bajada: true, titulo: true, publicadoEn: true, encabezadoAlt: true, imagenEncabezado: { select: { clave: true } } } });
  assert.equal(ultimas[0]!.id, reciente.id, "la nota recién publicada es la primera");
  const ruta = (a: { slug: string; publicadoEn: Date | null }) => rutaArticulo({ slug: a.slug, publicadoEn: a.publicadoEn! });

  // Carrusel: las 3 más nuevas, en orden, accesible
  const carrusel = /<section class="carrusel"[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(carrusel, "hay carrusel");
  assert.match(carrusel, /aria-roledescription="carrusel"/);
  const slides = [...carrusel.matchAll(/<article class="diapositiva(?: activa)?"([\s\S]*?)<\/article>/g)].map((m) => m[0]);
  assert.equal(slides.length, 3, "3 diapositivas");
  slides.forEach((s, i) => {
    const a = ultimas[i]!;
    assert.ok(s.includes(`<a class="btn btn--primary" href="${ruta(a)}"`), `diapositiva ${i + 1}: el botón lleva a la nota ${i + 1} más nueva`);
    assert.ok(s.includes(`<h2>${escapar(a.titulo)}</h2>`), `diapositiva ${i + 1}: con su título (que no es otro enlace igual al botón)`);
    assert.match(s, />\s*Leer\s*<span class="sr-only"> la nota «/, `diapositiva ${i + 1}: el botón dice «Leer» y para un lector de pantalla, qué nota`);
    assert.equal((s.match(/<a /g) ?? []).length, 1, `diapositiva ${i + 1}: un solo enlace`);
    assert.equal(s.includes('class="diapositiva-descripcion"'), !!a.bajada?.trim(), `diapositiva ${i + 1}: la descripción es la bajada, y solo si la nota tiene`);
    assert.equal(s.startsWith('<article class="diapositiva activa"'), i === 0, `diapositiva ${i + 1}: solo la primera arranca visible`);
    assert.ok(s.includes(`aria-label="${i + 1} de 3"`), `diapositiva ${i + 1}: «${i + 1} de 3» para lectores de pantalla`);
    if (a.imagenEncabezado) {
      assert.match(s, new RegExp(`<img[^>]*alt="${escapar(a.encabezadoAlt ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `diapositiva ${i + 1}: usa el texto alternativo de la imagen`);
      assert.ok(i === 0 ? /loading="eager"/.test(s) && /fetchpriority="high"/.test(s) : /loading="lazy"/.test(s), `diapositiva ${i + 1}: ${i === 0 ? "la primera carga con prioridad" : "las demás, diferidas"}`);
    }
  });
  // Sin flechas: la navegación es el control inferior, con un indicador por diapositiva y la pausa
  assert.ok(!/Nota anterior|Nota siguiente|data-anterior|data-siguiente/.test(carrusel), "no hay flechas de anterior y siguiente");
  assert.deepEqual([...carrusel.matchAll(/aria-label="(Ir a la diapositiva \d)"/g)].map((m) => m[1]), ["Ir a la diapositiva 1", "Ir a la diapositiva 2", "Ir a la diapositiva 3"], "un indicador por nota, con su nombre");
  assert.equal((carrusel.match(/data-indicador/g) ?? []).length, 3);
  assert.match(carrusel, /data-indicador[^>]*aria-label="Ir a la diapositiva 1" aria-current="true"/, "el activo está marcado");
  assert.match(carrusel, /aria-label="Pausar la reproducción automática"/, "y la pausa integrada al control");
  assert.match(carrusel, /data-intervalo="6000"/, "avanza cada 6 segundos");

  // Banda: las 3 siguientes + la presentación con «Ver todo»
  const banda = /<section class="portada-banda"[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(banda, "hay banda de últimas publicaciones");
  assert.ok(banda.includes("Últimas publicaciones") && banda.includes('href="/ultimas/"'), "con la presentación y el «Ver todo»");
  const enBanda = [...banda.matchAll(/<h3><a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(enBanda, ultimas.slice(3, 6).map(ruta), "la banda muestra la 4.ª a la 6.ª nota más nueva");

  // Bloques de sección: hasta 6, con 2 notas como máximo, sin repetir lo de arriba
  const bloques = [...html.matchAll(/<section class="bloque-seccion"[\s\S]*?<\/section>/g)].map((m) => m[0]);
  assert.ok(bloques.length >= 1 && bloques.length <= 6, `bloques de sección: ${bloques.length}`);
  const vistas = new Set(ultimas.map(ruta));
  for (const b of bloques) {
    const nombre = /<h2[^>]*><a href="\/seccion\/([^"]+)\/">/.exec(b);
    assert.ok(nombre, "cada bloque tiene el nombre de su sección con enlace");
    const notas = [...b.matchAll(/<h3><a href="([^"]+)"/g)].map((m) => m[1]!);
    assert.ok(notas.length >= 1 && notas.length <= 2, `${nombre[1]}: entre 1 y 2 notas`);
    for (const n of notas) {
      assert.ok(!vistas.has(n), `${nombre[1]}: no repite la nota ${n}, que ya está arriba o en la banda`);
      vistas.add(n);
    }
    assert.match(b, /class="ver-todo" href="\/seccion\//, "con «Ver todo» a la página de la sección");
  }
  assert.equal(new Set(bloques.map((b) => /\/seccion\/([^"]+)\//.exec(b)![1])).size, bloques.length, "una sola vez cada sección");
  // Lo programado y los borradores no aparecen
  assert.ok(!html.includes(`${prefijo} Nota programada`), "una nota programada no aparece hasta su fecha");
  assert.ok(!html.includes(`${prefijo} Nota en borrador`), "ni un borrador");
  // Cada título es H2 (carrusel y bloques) o H3 (tarjetas): ninguno más
  assert.equal((html.match(/<h1/g) ?? []).length, 1);

  // La sección interna no aparece en los bloques
  const interna = await prisma.seccion.findFirst({ where: { interna: true }, select: { slug: true } });
  if (interna) assert.ok(!html.includes(`/seccion/${interna.slug}/`), "«Sin asignar» no tiene bloque ni enlace");

  // ---------- Últimas publicaciones ----------
  const lista = await pedir("/ultimas/");
  assert.equal(lista.estado, 200);
  assert.ok(lista.html.includes(`>${escapar(`${prefijo} Nota nueva`)}</a>`), "la primera nota es la más nueva");
  assert.ok(!lista.html.includes(`${prefijo} Nota programada`) && !lista.html.includes(`${prefijo} Nota en borrador`));
  assert.ok(((await prisma.articulo.count({ where: { estado: "PUBLICADO", publicadoEn: { lte: new Date() } } })) > 12) === /pagina=2/.test(lista.html), "pagina de a 12");
  assert.equal((await pedir("/ultimas/?pagina=9999")).estado, 404, "una página que no existe da 404");

  console.log("OK: la portada se arma sola con lo publicado (carrusel de las 3 más nuevas con su accesibilidad, banda con las 3 siguientes, bloques de las secciones más activas sin repetir notas, nada de programados ni borradores) y «Últimas publicaciones» pagina.");
} finally {
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  servidor.closeAllConnections();
  servidor.close();
  await prisma.$disconnect();
}
