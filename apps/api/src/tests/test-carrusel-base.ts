// Prueba del comportamiento del carrusel de la portada (apps/sitio: components/Carrusel.astro) sin navegador: se toma el HTML y el script reales
// que sirve el sitio (compilado; `npm run build:sitio`) y se ejecutan en jsdom, con el intervalo acortado. Cubre: diapositivas inactivas fuera del
// alcance del teclado, indicadores, flechas del teclado, vuelta al principio, avance automático, pausas (mouse, foco, botón), «reducir movimiento»,
// deslizar con el dedo y que lo anuncie solo cuando lo cambia una persona. No mide el aspecto ni el fundido: eso se mira en el navegador.
//
// Uso: npm run test:carrusel
import assert from "node:assert/strict";
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
if (!existsSync(fileURLToPath(new URL("../../../sitio/dist/server/entry.mjs", import.meta.url)))) fallar("falta compilar el sitio: npm run build:sitio");

const prisma = obtenerClientePrisma();
const servidor = crearApp(prisma, {}).listen(0, "127.0.0.1");
await new Promise((r) => servidor.once("listening", r));
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  const html = await (await fetch(`${base}/`)).text();
  const seccion = /<section class="carrusel"[\s\S]*?<\/section>/.exec(html)?.[0];
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).find((s) => s.includes("data-carrusel"));
  assert.ok(seccion && script, "la portada trae el carrusel y su script");

  /** Arma una página con el carrusel real, el intervalo corto y (si se pide) «reducir movimiento»; y corre el script. */
  function montar(opciones: { reducirMovimiento?: boolean } = {}) {
    const dom = new JSDOM(`<!doctype html><body>${seccion!.replace('data-intervalo="6000"', 'data-intervalo="80"')}</body>`, { runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    const oyentes: Array<() => void> = [];
    let reducir = !!opciones.reducirMovimiento;
    w.matchMedia = (q: string) => ({ get matches() { return q.includes("reduce") ? reducir : false; }, media: q, addEventListener: (_t: string, f: () => void) => oyentes.push(f), removeEventListener: () => undefined });
    w.eval(script!);
    const documento = w.document as Document;
    const c = documento.querySelector<HTMLElement>("[data-carrusel]")!;
    const diapos = [...c.querySelectorAll<HTMLElement>("[data-diapositiva]")];
    const indicadores = [...c.querySelectorAll<HTMLElement>("[data-indicador]")];
    const marco = c.querySelector<HTMLElement>("[data-marco]")!;
    const pausa = c.querySelector<HTMLButtonElement>("[data-pausa]")!;
    const activa = () => diapos.findIndex((d) => d.classList.contains("activa"));
    const evento = (el: Element, tipo: string, extra: Record<string, unknown> = {}) => {
      const e = new w.MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: (extra["x"] as number) ?? 0, clientY: (extra["y"] as number) ?? 0 });
      if (extra["pointerType"]) Object.defineProperty(e, "pointerType", { value: extra["pointerType"] });
      if (extra["key"]) Object.defineProperty(e, "key", { value: extra["key"] });
      el.dispatchEvent(e);
      return e;
    };
    const tecla = (el: Element, key: string) => {
      const e = new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e;
    };
    const cerrar = () => dom.window.close();
    return { w, c, diapos, indicadores, marco, pausa, activa, evento, tecla, cerrar, cambiarReduccion: (v: boolean) => { reducir = v; oyentes.forEach((f) => f()); } };
  }

  // ---------- Estado inicial ----------
  {
    const k = montar();
    assert.equal(k.diapos.length, 3);
    assert.equal(k.activa(), 0, "arranca en la primera");
    assert.deepEqual(k.diapos.map((d) => d.hasAttribute("inert")), [false, true, true], "las que no se ven no se alcanzan con Tab (inert)");
    assert.deepEqual(k.diapos.map((d) => d.getAttribute("aria-hidden")), ["false", "true", "true"], "y están ocultas a los lectores de pantalla");
    assert.deepEqual(k.indicadores.map((i) => i.getAttribute("aria-current")), ["true", null, null], "el indicador activo está marcado");
    assert.equal(k.marco.getAttribute("aria-live"), "off", "no anuncia cambios por su cuenta");
    assert.equal(k.pausa.hidden, false, "la pausa se ve cuando hay avance automático");
    k.cerrar();
  }

  // ---------- Indicadores, teclado y vuelta al principio (sin avance automático para que no se mueva solo) ----------
  {
    const k = montar({ reducirMovimiento: true });
    assert.equal(k.pausa.hidden, true, "con «reducir movimiento» no hay avance automático y no se muestra la pausa");
    k.indicadores[2]!.click();
    assert.equal(k.activa(), 2, "un indicador lleva directo a su diapositiva");
    assert.deepEqual(k.diapos.map((d) => d.hasAttribute("inert")), [true, true, false], "la nueva es la única alcanzable");
    assert.deepEqual(k.indicadores.map((i) => i.getAttribute("aria-current")), [null, null, "true"]);
    assert.equal(k.marco.getAttribute("aria-live"), "polite", "cuando lo cambia una persona, se anuncia");
    const e = k.tecla(k.indicadores[2]!, "ArrowRight");
    assert.equal(k.activa(), 0, "después de la última vuelve a la primera");
    assert.equal(e.defaultPrevented, true);
    k.tecla(k.indicadores[0]!, "ArrowLeft");
    assert.equal(k.activa(), 2, "y hacia atrás, de la primera a la última");
    k.tecla(k.c, "a");
    assert.equal(k.activa(), 2, "otras teclas no hacen nada");
    // Deslizar con el dedo
    const antes = k.activa();
    k.evento(k.marco, "pointerdown", { pointerType: "touch", x: 300, y: 100 });
    k.evento(k.marco, "pointerup", { pointerType: "touch", x: 280, y: 100 });
    assert.equal(k.activa(), antes, "un movimiento corto no cambia de diapositiva");
    k.evento(k.marco, "pointerdown", { pointerType: "touch", x: 300, y: 100 });
    k.evento(k.marco, "pointerup", { pointerType: "touch", x: 120, y: 220 });
    assert.equal(k.activa(), antes, "un movimiento más vertical que horizontal es desplazar la página, no deslizar");
    k.evento(k.marco, "pointerdown", { pointerType: "touch", x: 300, y: 100 });
    k.evento(k.marco, "pointerup", { pointerType: "touch", x: 150, y: 110 });
    assert.equal(k.activa(), (antes + 1) % 3, "deslizar hacia la izquierda pasa a la siguiente");
    k.evento(k.marco, "pointerdown", { pointerType: "touch", x: 100, y: 100 });
    k.evento(k.marco, "pointerup", { pointerType: "touch", x: 260, y: 100 });
    assert.equal(k.activa(), antes, "y hacia la derecha, a la anterior");
    k.evento(k.marco, "pointerdown", { pointerType: "mouse", x: 300, y: 100 });
    k.evento(k.marco, "pointerup", { pointerType: "mouse", x: 100, y: 100 });
    assert.equal(k.activa(), antes, "con el mouse no se desliza (se usa el control inferior)");
    k.cerrar();
  }

  // ---------- Avance automático y sus pausas (intervalo de 80 ms) ----------
  {
    const k = montar();
    /** Espera hasta que la diapositiva activa deje de ser `desde` (devuelve la nueva) o se acaba el tiempo (devuelve la misma). */
    const cambio = async (desde: number, tope = 600) => {
      for (let t = 0; t < tope && k.activa() === desde; t += 10) await dormir(10);
      return k.activa();
    };
    /** Durante 200 ms (dos intervalos y medio: no puede dar la vuelta completa) no tiene que moverse. */
    const congelada = async (motivo: string) => {
      const a = k.activa();
      await dormir(200);
      assert.equal(k.activa(), a, motivo);
    };
    assert.notEqual(await cambio(0), 0, "avanza solo");
    assert.equal(k.marco.getAttribute("aria-live"), "off", "sin anunciarlo");
    // Mouse encima
    k.evento(k.c, "mouseenter");
    await congelada("con el mouse encima se detiene");
    k.evento(k.c, "mouseleave");
    const a = k.activa();
    assert.notEqual(await cambio(a), a, "al sacar el mouse sigue");
    // Foco adentro
    const boton = k.c.querySelector<HTMLAnchorElement>(".diapositiva.activa .btn")!;
    boton.focus();
    k.evento(boton, "focusin");
    await congelada("con el foco adentro se detiene");
    boton.blur();
    k.evento(k.c, "focusout");
    const a2 = k.activa();
    assert.notEqual(await cambio(a2), a2, "al sacar el foco sigue");
    // Botón de pausa
    k.pausa.click();
    assert.equal(k.pausa.getAttribute("aria-pressed"), "true");
    assert.equal(k.pausa.getAttribute("aria-label"), "Reanudar la reproducción automática", "la pausa cambia de nombre");
    await congelada("con la pausa puesta no avanza");
    k.evento(k.c, "mouseenter");
    k.evento(k.c, "mouseleave");
    await congelada("y sacar el mouse no la reanuda");
    k.pausa.click();
    assert.equal(k.pausa.getAttribute("aria-pressed"), "false");
    assert.equal(k.pausa.getAttribute("aria-label"), "Pausar la reproducción automática");
    const b = k.activa();
    assert.notEqual(await cambio(b), b, "al reanudar vuelve a avanzar");
    // «Reducir movimiento» lo frena y esconde la pausa
    k.cambiarReduccion(true);
    assert.equal(k.pausa.hidden, true);
    await congelada("si el sistema pide menos movimiento, deja de avanzar");
    k.cambiarReduccion(false);
    assert.equal(k.pausa.hidden, false);
    k.cerrar();
  }

  // ---------- Un indicador reinicia el tiempo ----------
  {
    const k = montar();
    await dormir(50);
    k.indicadores[1]!.click(); // le quedaban ~30 ms: si no se reiniciara, saltaría enseguida a la 3.ª
    assert.equal(k.activa(), 1);
    await dormir(40);
    assert.equal(k.activa(), 1, "después de elegir una, el tiempo empieza de nuevo");
    for (let t = 0; t < 400 && k.activa() === 1; t += 10) await dormir(10);
    assert.equal(k.activa(), 2, "y después avanza a la siguiente");
    k.cerrar();
  }

  console.log("OK: el carrusel se comporta (diapositivas inactivas fuera del Tab, indicadores y flechas del teclado, vuelta al principio, avance automático con pausas por mouse, foco y botón, «reducir movimiento», deslizar con el dedo y avisos solo cuando lo cambia una persona).");
} finally {
  servidor.closeAllConnections();
  servidor.close();
  await prisma.$disconnect();
}
