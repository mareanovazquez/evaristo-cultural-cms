// Prueba del comportamiento del banner de la portada (apps/sitio: components/Banner.astro) sin navegador: con la base de desarrollo y el sitio
// compilado (`npm run build:sitio`) se arma un banner de tres imágenes, se toma el HTML y el script reales que sirve el sitio y se ejecutan en jsdom
// con el intervalo acortado. Cubre: estado inicial (capas inactivas fuera del teclado), rotación sola y vuelta al principio, tocar un punto
// (muestra esa imagen y reinicia el tiempo), pausa con el mouse o el foco sobre el banner y los puntos, «reducir movimiento» escuchado en vivo,
// que una sola imagen no cree ningún reloj, y que el efecto de levantar siga a la imagen que se ve (solo si tiene enlace). No mide el aspecto ni el
// fundido: eso se mira en el navegador. Deja la configuración y las imágenes del banner como estaban.
//
// Uso: npm run test:banner
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
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
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const imagenesCreadas: number[] = [];
const servidor = crearApp(prisma, {}).listen(0, "127.0.0.1");
await new Promise((r) => servidor.once("listening", r));
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const configAnterior = await prisma.configuracionSitio.findUnique({ where: { id: 1 } });
const bannerAnterior = await prisma.bannerImagen.findMany();

try {
  await prisma.bannerImagen.deleteMany();
  await prisma.configuracionSitio.deleteMany();
  await prisma.configuracionSitio.create({ data: { id: 1, bannerActivo: true, topbarActivo: true, topbarTexto: "Prueba", topbarEnlace: null } });
  const nombres = ["uno", "dos", "tres"];
  const enlaces: Array<string | null> = ["/contacto", null, "https://ejemplo.org/x"];
  for (const [i, nombre] of nombres.entries()) {
    const img = await prisma.imagen.create({
      data: { clave: `banjs-${sufijo}-${nombre}.jpg`, nombreOriginal: `${nombre}.jpg`, tipoMime: "image/jpeg", ancho: 1800, alto: 600, bytes: 1000, hash: createHash("sha256").update(`${sufijo}-${nombre}`).digest("hex") },
      select: { id: true },
    });
    imagenesCreadas.push(img.id);
    await prisma.bannerImagen.create({ data: { orden: i + 1, imagenId: img.id, enlace: enlaces[i]!, alt: `Imagen ${nombre}` } });
  }

  const html = await (await fetch(`${base}/`)).text();
  const seccion = /<section class="banner"[\s\S]*?<\/section>/.exec(html)?.[0];
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).find((s) => s.includes("data-banner"));
  assert.ok(seccion && script, "la portada trae el banner y su script");

  /** Arma una página con el banner real (o una variante del HTML), el intervalo corto y «reducir movimiento» si se pide; y corre el script. */
  function montar(opciones: { reducirMovimiento?: boolean; intervalo?: number; marcado?: string } = {}) {
    const marcado = (opciones.marcado ?? seccion!).replace('data-intervalo="6000"', `data-intervalo="${opciones.intervalo ?? 120}"`);
    const dom = new JSDOM(`<!doctype html><body>${marcado}</body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    const oyentes: Array<() => void> = [];
    let reducir = !!opciones.reducirMovimiento;
    w.matchMedia = (q: string) => ({ get matches() { return q.includes("reduce") ? reducir : false; }, media: q, addEventListener: (_t: string, f: () => void) => oyentes.push(f), removeEventListener: () => undefined });
    let relojes = 0;
    const setIntervalOriginal = w.setInterval.bind(w);
    (w as unknown as { setInterval: unknown }).setInterval = ((...a: Parameters<typeof setInterval>) => (relojes++, setIntervalOriginal(...a))) as unknown;
    w.eval(script!);
    const documento = w.document as Document;
    const b = documento.querySelector<HTMLElement>("[data-banner]")!;
    const capas = [...b.querySelectorAll<HTMLElement>("[data-capa]")];
    const puntos = [...b.querySelectorAll<HTMLElement>("[data-punto]")];
    const activa = () => capas.findIndex((c) => c.classList.contains("activa"));
    const evento = (el: Element, tipo: string) => el.dispatchEvent(new w.MouseEvent(tipo, { bubbles: true, cancelable: true }));
    return { w, b, capas, puntos, activa, evento, relojes: () => relojes, cerrar: () => dom.window.close(), cambiarReduccion: (v: boolean) => { reducir = v; oyentes.forEach((f) => f()); } };
  }

  // ---------- Estado inicial ----------
  {
    const k = montar();
    assert.equal(k.capas.length, 3);
    assert.equal(k.activa(), 0, "arranca en la primera");
    assert.deepEqual(k.capas.map((c) => c.hasAttribute("inert")), [false, true, true], "las que no se ven no se alcanzan con Tab ni con el mouse (inert)");
    assert.deepEqual(k.capas.map((c) => c.getAttribute("aria-hidden")), ["false", "true", "true"], "y están ocultas a los lectores de pantalla");
    assert.deepEqual(k.puntos.map((p) => p.getAttribute("aria-current")), ["true", null, null], "el punto activo está marcado");
    assert.deepEqual(k.puntos.map((p) => p.getAttribute("aria-label")), ["Ver imagen 1 de 3", "Ver imagen 2 de 3", "Ver imagen 3 de 3"]);
    assert.equal(k.b.dataset["conEnlace"], "true", "la primera tiene enlace");
    k.cerrar();
  }

  // ---------- Rotación sola ----------
  {
    const k = montar();
    await dormir(170);
    assert.equal(k.activa(), 1, "pasa sola a la segunda");
    assert.deepEqual(k.capas.map((c) => c.hasAttribute("inert")), [true, false, true], "y el teclado la sigue");
    assert.deepEqual(k.puntos.map((p) => p.getAttribute("aria-current")), [null, "true", null]);
    assert.equal(k.b.dataset["conEnlace"], "false", "la segunda no tiene enlace: no se levanta");
    await dormir(120);
    assert.equal(k.activa(), 2);
    assert.equal(k.b.dataset["conEnlace"], "true", "la tercera sí");
    await dormir(120);
    assert.equal(k.activa(), 0, "vuelve al principio");
    k.cerrar();
  }

  // ---------- Tocar un punto muestra esa imagen y reinicia el tiempo ----------
  {
    const k = montar({ intervalo: 150 });
    await dormir(100);
    k.puntos[2]!.click();
    assert.equal(k.activa(), 2, "el punto muestra su imagen");
    await dormir(90);
    assert.equal(k.activa(), 2, "sin el reinicio ya habría pasado a la otra (a los 150 ms desde el principio); se ve el tiempo completo");
    await dormir(110);
    assert.equal(k.activa(), 0, "y recién después sigue");
    k.cerrar();
  }

  // ---------- Pausa con el mouse (sobre el banner o los puntos: es la misma sección) ----------
  {
    const k = montar();
    k.evento(k.b, "mouseenter");
    await dormir(300);
    assert.equal(k.activa(), 0, "con el mouse encima no rota");
    k.evento(k.b, "mouseleave");
    await dormir(180);
    assert.notEqual(k.activa(), 0, "al sacarlo, sigue");
    k.cerrar();
  }

  // ---------- Pausa con el foco ----------
  {
    const k = montar();
    k.puntos[0]!.focus();
    assert.ok(k.b.contains(k.w.document.activeElement), "el foco está en los puntos");
    await dormir(300);
    assert.equal(k.activa(), 0, "con el foco en los puntos no rota");
    k.puntos[0]!.blur();
    await dormir(200);
    assert.notEqual(k.activa(), 0, "al salir el foco, sigue");
    k.cerrar();
  }

  // ---------- «Reducir movimiento», escuchado en vivo ----------
  {
    const k = montar({ reducirMovimiento: true });
    await dormir(300);
    assert.equal(k.activa(), 0, "con «reducir movimiento» no rota");
    k.puntos[1]!.click();
    assert.equal(k.activa(), 1, "pero los puntos siguen andando");
    k.cambiarReduccion(false);
    await dormir(200);
    assert.notEqual(k.activa(), 1, "si la persona lo apaga con la página abierta, empieza a rotar");
    k.cambiarReduccion(true);
    const donde = k.activa();
    await dormir(300);
    assert.equal(k.activa(), donde, "y si lo vuelve a prender, se detiene");
    k.cerrar();
  }

  // ---------- Una sola imagen: fija, sin reloj ----------
  {
    const una = seccion!.replace(/<div class="banner-puntos"[\s\S]*?<\/div>\s*(?=<\/section>)/, "").replace(/<div class="banner-capa(?!\s+activa)[^>]*>[\s\S]*?<\/div>\s*(?=<div class="banner-capa|<\/div>\s*<\/div>)/g, "");
    const k = montar({ marcado: una });
    assert.equal(k.capas.length, 1, "armé una variante con una sola capa");
    assert.equal(k.puntos.length, 0);
    await dormir(300);
    assert.equal(k.relojes(), 0, "no se crea ningún reloj");
    assert.equal(k.activa(), 0);
    k.cerrar();
  }

  console.log("OK: el banner rota, se detiene y se elige como corresponde (inert, puntos, pausas, «reducir movimiento» y una sola imagen)");
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
} finally {
  await prisma.bannerImagen.deleteMany().catch(() => undefined);
  await prisma.imagen.deleteMany({ where: { id: { in: imagenesCreadas } } }).catch(() => undefined);
  if (bannerAnterior.length) await prisma.bannerImagen.createMany({ data: bannerAnterior }).catch(() => undefined);
  await prisma.configuracionSitio.deleteMany().catch(() => undefined);
  if (configAnterior) await prisma.configuracionSitio.create({ data: configAnterior }).catch(() => undefined);
  await new Promise((r) => servidor.close(r));
  await prisma.$disconnect();
}
