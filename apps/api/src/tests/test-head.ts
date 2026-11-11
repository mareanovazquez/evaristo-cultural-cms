// Pruebas del <head> para buscadores y redes (apps/sitio/src/lib/metadatos.ts) y de la redirección a la barra final (src/barra-final.ts),
// sin base de datos. La parte con la app levanta crearApp en un puerto efímero de 127.0.0.1 con un Prisma falso: las redirecciones de
// WordPress fallan sin base y dejan pasar el pedido, como si no hubiera redirección.
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { descripcionCorta, DESCRIPCION_SITIO, imagenParaRedes, urlCanonica } from "../../../sitio/src/lib/metadatos.ts";
import { crearApp } from "../app.js";
import { direccionConBarraFinal } from "../barra-final.js";

let ok = 0;
const pruebas: Array<[string, () => Promise<void> | void]> = [];
const t = (nombre: string, fn: () => Promise<void> | void) => pruebas.push([nombre, fn]);
const BASE = "https://evaristocultural.com.ar";

// ---------- Dirección canónica ----------
t("urlCanonica: base del sitio y la ruta tal cual", () => {
  assert.equal(urlCanonica(new URL("http://127.0.0.1:3000/autores/"), BASE), `${BASE}/autores/`);
  assert.equal(urlCanonica(new URL("http://127.0.0.1:3000/"), BASE), `${BASE}/`);
  assert.equal(urlCanonica(new URL("http://x/2015/03/04/una-nota/"), BASE), `${BASE}/2015/03/04/una-nota/`);
});
t("urlCanonica: de la consulta solo queda pagina, desde la 2", () => {
  assert.equal(urlCanonica(new URL("http://x/seccion/resena/?pagina=3"), BASE), `${BASE}/seccion/resena/?pagina=3`);
  assert.equal(urlCanonica(new URL("http://x/seccion/resena/?pagina=1"), BASE), `${BASE}/seccion/resena/`);
  assert.equal(urlCanonica(new URL("http://x/seccion/resena/?pagina=03&utm_source=fb"), BASE), `${BASE}/seccion/resena/?pagina=3`);
  assert.equal(urlCanonica(new URL("http://x/2015/03/04/una-nota/?capital=1&fbclid=abc"), BASE), `${BASE}/2015/03/04/una-nota/`);
  assert.equal(urlCanonica(new URL("http://x/ultimas/?pagina=dos"), BASE), `${BASE}/ultimas/`);
});
t("urlCanonica: la ruta con tildes o símbolos va codificada, como la sirve el sitio", () => {
  assert.equal(urlCanonica(new URL("http://x/author/josé/"), BASE), `${BASE}/author/jos%C3%A9/`);
});

// ---------- Descripción ----------
t("descripcionCorta: vacía o ausente, la del sitio", () => {
  for (const v of [undefined, null, "", "   "]) assert.equal(descripcionCorta(v), DESCRIPCION_SITIO);
});
t("descripcionCorta: sin espacios de más y, si entra, entera", () => {
  assert.equal(descripcionCorta("  Una   bajada\ncon saltos.  "), "Una bajada con saltos.");
});
t("descripcionCorta: larga, cortada en una palabra con «…» y sin pasarse de 160", () => {
  const larga = "Palabra ".repeat(40).trim();
  const r = descripcionCorta(larga);
  assert.ok(r.length <= 160, `${r.length}`);
  assert.ok(r.endsWith("Palabra…"), r.slice(-20));
  const sinEspacios = descripcionCorta("x".repeat(400));
  assert.equal(sinEspacios.length, 160);
  assert.ok(sinEspacios.endsWith("…"));
  assert.equal(descripcionCorta(`${"a".repeat(150)}, ${"b".repeat(30)}`), `${"a".repeat(150)}…`, "sin la coma colgando");
});

// ---------- Imagen para redes ----------
t("imagenParaRedes: grande → la variante de 1200 con su alto proporcional", () => {
  assert.deepEqual(imagenParaRedes({ clave: "tapa.jpg", ancho: 2400, alto: 1600 }, BASE), { url: `${BASE}/media/tapa.jpg?w=1200`, ancho: 1200, alto: 800 });
});
t("imagenParaRedes: chica → el original con sus medidas", () => {
  assert.deepEqual(imagenParaRedes({ clave: "foto.png", ancho: 800, alto: 600 }, BASE), { url: `${BASE}/media/foto.png`, ancho: 800, alto: 600 });
});
t("imagenParaRedes: GIF → el original (no se achica, puede ser animado)", () => {
  assert.deepEqual(imagenParaRedes({ clave: "anim.gif", ancho: 2000, alto: 1000 }, BASE), { url: `${BASE}/media/anim.gif`, ancho: 2000, alto: 1000 });
});
t("imagenParaRedes: sin medidas → la variante, sin medidas", () => {
  assert.deepEqual(imagenParaRedes({ clave: "x.jpg", ancho: null, alto: null }, BASE), { url: `${BASE}/media/x.jpg?w=1200` });
});
t("imagenParaRedes: la clave con espacios o tildes va codificada", () => {
  assert.equal(imagenParaRedes({ clave: "Perón 1.jpg", ancho: 500, alto: 500 }, BASE).url, `${BASE}/media/Per%C3%B3n%201.jpg`);
});

// ---------- Barra final ----------
t("direccionConBarraFinal: páginas sin barra → con barra, conservando la consulta", () => {
  assert.equal(direccionConBarraFinal("/autores"), "/autores/");
  assert.equal(direccionConBarraFinal("/seccion/resena"), "/seccion/resena/");
  assert.equal(direccionConBarraFinal("/seccion/resena?pagina=2"), "/seccion/resena/?pagina=2");
  assert.equal(direccionConBarraFinal("/2015/03/04/una-nota"), "/2015/03/04/una-nota/");
});
t("direccionConBarraFinal: lo que ya tiene barra, la API, el panel, /media, /_astro y los archivos no se tocan", () => {
  for (const r of ["/", "/autores/", "/autores/?pagina=2", "/api/salud", "/admin", "/admin/articulos", "/media/tapa.jpg", "/_astro/Base.css", "/favicon.svg", "/robots.txt", "/feed/"]) {
    assert.equal(direccionConBarraFinal(r), undefined, r);
  }
});
t("direccionConBarraFinal: // y /\\ no se redirigen (serían otro sitio para el navegador)", () => {
  for (const r of ["//otro-sitio.example", "//otro-sitio.example/algo", "/\\otro-sitio.example", "/a\\b"]) assert.equal(direccionConBarraFinal(r), undefined, r);
});
t("direccionConBarraFinal: una ruta mal codificada no se redirige (da 404 directo); una bien codificada sí", () => {
  assert.equal(direccionConBarraFinal("/%E0%A4%A"), undefined);
  assert.equal(direccionConBarraFinal("/author/jos%C3%A9"), "/author/jos%C3%A9/");
});

// ---------- Con la app (sin base) ----------
const sinPrisma = {} as never;
let server: Server | undefined;
const pedir = (puerto: number, ruta: string, metodo = "GET") =>
  new Promise<{ estado: number; location: string | undefined }>((resolver, rechazar) => {
    const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta }, (res) => {
      res.resume();
      res.on("end", () => resolver({ estado: res.statusCode ?? 0, location: res.headers.location }));
    });
    req.on("error", rechazar);
    req.end();
  });
t("La app: /autores y /contacto?x=1 redirigen con 301 a la dirección con barra; un POST no", async () => {
  // Los mensajes de error de las redirecciones sin base son esperados: se silencian mientras corre esta prueba.
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    server ??= await new Promise<Server>((listo) => {
      const s = crearApp(sinPrisma, { contacto: { enviar: undefined } }).listen(0, "127.0.0.1", () => listo(s));
    });
    const puerto = (server.address() as AddressInfo).port;
    assert.deepEqual(await pedir(puerto, "/autores"), { estado: 301, location: "/autores/" });
    assert.deepEqual(await pedir(puerto, "/contacto?x=1"), { estado: 301, location: "/contacto/?x=1" });
    assert.deepEqual(await pedir(puerto, "/autores", "HEAD"), { estado: 301, location: "/autores/" });
    assert.notEqual((await pedir(puerto, "/autores", "POST")).estado, 301);
    const raro = await pedir(puerto, "//otro-sitio.example");
    assert.notEqual(raro.estado, 301, "// no redirige");
    assert.ok(!raro.location?.includes("otro-sitio"), raro.location);
  } finally {
    console.error = errorOriginal;
  }
});

// ---------- Correr ----------
try {
  for (const [nombre, fn] of pruebas) {
    try {
      await fn();
      ok++;
      console.log(`  ok   ${nombre}`);
    } catch (e) {
      console.error(`  MAL  ${nombre}\n${e instanceof Error ? e.stack : String(e)}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${ok} de ${pruebas.length} pruebas bien.`);
} finally {
  if (server) {
    server.close();
    server.closeAllConnections();
  }
}
