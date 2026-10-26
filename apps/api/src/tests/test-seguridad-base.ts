// Prueba de las cabeceras de seguridad del panel y del sitio (src/seguridad.ts, app.ts y la política de contenido de Astro), con la base de
// desarrollo (solo lee). Necesita el sitio y el panel compilados (`npm run build`). No reemplaza abrirlos en un navegador: una política de
// contenido demasiado estricta se nota ahí (algo que no carga), y esta prueba solo puede comprobar que lo que el sitio usa esté permitido.
//
// Uso: npm run test:seguridad
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { crearApp } from "../app.js";
import { confiarEnProxy } from "../seguridad.js";
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

const raiz = fileURLToPath(new URL("../../../", import.meta.url));
if (!existsSync(`${raiz}panel/dist/index.html`) || !existsSync(`${raiz}sitio/dist/server/entry.mjs`)) fallar("faltan los builds: corré npm run build");

const prisma = obtenerClientePrisma();
const directivas = (csp: string): Map<string, string[]> => new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [nombre, ...valores] = d.split(/\s+/); return [nombre!, valores]; }));
const sha256 = (texto: string): string => `'sha256-${createHash("sha256").update(texto).digest("base64")}'`;

async function servir<T>(opciones: Parameters<typeof crearApp>[1], fn: (base: string) => Promise<T>): Promise<T> {
  const servidor = crearApp(prisma, opciones).listen(0, "127.0.0.1");
  await new Promise((r) => servidor.once("listening", r));
  try {
    return await fn(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`);
  } finally {
    servidor.closeAllConnections();
    servidor.close();
  }
}

try {
  const articulo = await prisma.articulo.findFirstOrThrow({ where: { estado: "PUBLICADO", publicadoEn: { lte: new Date() } }, select: { slug: true, publicadoEn: true } });
  const rutaNota = rutaArticulo({ slug: articulo.slug, publicadoEn: articulo.publicadoEn! });

  await servir({}, async (base) => {
    // ---------- Panel ----------
    const panel = await fetch(`${base}/admin/`);
    assert.equal(panel.status, 200);
    const cspPanel = directivas(panel.headers.get("content-security-policy") ?? "");
    assert.deepEqual(cspPanel.get("script-src"), ["'self'"], "el panel solo ejecuta scripts propios, sin nada en línea");
    assert.deepEqual(cspPanel.get("frame-ancestors"), ["'none'"], "y nadie puede incrustarlo");
    assert.deepEqual(cspPanel.get("object-src"), ["'none'"]);
    assert.ok(cspPanel.get("connect-src")!.join() === "'self'" && cspPanel.get("img-src")!.includes("'self'"));
    assert.ok(cspPanel.get("frame-src")!.includes("https://www.youtube-nocookie.com") && cspPanel.get("frame-src")!.includes("https://player.vimeo.com"), "la vista previa puede mostrar videos");
    assert.equal(panel.headers.get("x-content-type-options"), "nosniff");
    assert.equal(panel.headers.get("referrer-policy"), "no-referrer");
    assert.equal(panel.headers.get("strict-transport-security"), null, "HSTS solo en producción");
    assert.equal(panel.headers.get("x-robots-tag"), "noindex, nofollow");
    const indice = await panel.text();
    assert.deepEqual((indice.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? []), [], "el HTML del panel no tiene scripts en línea (la política los bloquearía)");
    assert.ok(!/\son[a-z]+\s*=/.test(indice), "ni manejadores de eventos en línea");
    // Una ruta interna del panel y un archivo estático llevan lo mismo
    assert.ok((await fetch(`${base}/admin/articulos/1`)).headers.get("content-security-policy")?.includes("script-src 'self'"));

    // ---------- Sitio ----------
    for (const ruta of ["/", rutaNota]) {
      const r = await fetch(`${base}${ruta}`);
      assert.equal(r.status, 200, ruta);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff", `${ruta}: nosniff`);
      assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN", `${ruta}: y las cabeceras de Express siguen puestas`);
      assert.equal(r.headers.get("strict-transport-security"), null);
      const html = await r.text();
      // La política que Astro calcula para la página (con el hash de cada script) viaja en la cabecera
      const meta = r.headers.get("content-security-policy");
      assert.ok(meta, `${ruta}: la página trae su política de contenido (la pone Astro)`);
      assert.deepEqual(directivas(meta).get("frame-ancestors"), ["'self'"], `${ruta}: solo el propio sitio puede incrustarlo`);
      const csp = directivas(meta);
      const scripts = csp.get("script-src")!;
      assert.ok(scripts.includes("'self'") && !scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"), `${ruta}: scripts solo propios o con hash`);
      // Cada script en línea tiene su hash en la política (si no, el navegador lo bloquearía y el menú o el visor dejarían de andar)
      const enLinea = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      assert.ok(enLinea.length > 0, `${ruta}: hay scripts en línea para comprobar`);
      for (const cuerpo of enLinea) assert.ok(scripts.includes(sha256(cuerpo)), `${ruta}: falta el hash de un script en línea (${cuerpo.slice(0, 40)}…)`);
      // Lo que el sitio usa de afuera está permitido
      assert.ok(csp.get("style-src")!.includes("https://fonts.googleapis.com"), `${ruta}: la hoja de Google Fonts`);
      assert.ok(csp.get("font-src")!.includes("https://fonts.gstatic.com"), `${ruta}: las tipografías`);
      assert.ok(csp.get("frame-src")!.includes("https://www.youtube-nocookie.com") && csp.get("frame-src")!.includes("https://player.vimeo.com"), `${ruta}: los videos`);
      assert.ok(csp.get("img-src")!.includes("'self'"), `${ruta}: las imágenes propias`);
      assert.deepEqual(csp.get("object-src"), ["'none'"]);
      assert.deepEqual(csp.get("base-uri"), ["'self'"]);
      // Todo lo que carga de otro dominio está en la lista: hojas de estilo, tipografías y videos. Los enlaces (<a href>, como la tienda
      // o Instagram en el pie y el topbar) no cargan nada: el navegador solo los abre si alguien hace clic.
      const externos = [...html.matchAll(/(?:<link\b[^>]*\bhref|\bsrc)="(https:\/\/[^"]+)"/g)].map((m) => new URL(m[1]!).origin);
      for (const origen of new Set(externos)) {
        assert.ok([...csp.values()].some((v) => v.includes(origen)), `${ruta}: el sitio carga algo de ${origen} y la política no lo permite`);
      }
    }
    // Las imágenes se pueden mostrar en otros sitios; todo lleva nosniff
    const media = await fetch(`${base}/media/no-existe.jpg`);
    assert.equal(media.headers.get("x-content-type-options"), "nosniff");
    assert.equal(media.headers.get("cross-origin-resource-policy"), "cross-origin");
    // La API sigue con las suyas
    const api = await fetch(`${base}/api/auth/yo`);
    assert.equal(api.headers.get("x-content-type-options"), "nosniff");
    assert.ok(api.headers.get("content-security-policy"));
  });

  // ---------- HSTS solo en producción ----------
  const entorno = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "production";
  try {
    await servir({}, async (base) => {
      for (const ruta of ["/admin/", "/"]) {
        const r = await fetch(`${base}${ruta}`);
        assert.match(r.headers.get("strict-transport-security") ?? "", /^max-age=15552000$/, `${ruta}: HSTS en producción`);
      }
    });
  } finally {
    if (entorno === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = entorno;
  }

  // ---------- Proxies de confianza ----------
  assert.equal(confiarEnProxy(undefined), false);
  assert.equal(confiarEnProxy(""), false);
  assert.equal(confiarEnProxy("0"), false);
  assert.equal(confiarEnProxy("false"), false);
  assert.equal(confiarEnProxy("1"), 1);
  assert.equal(confiarEnProxy(" 2 "), 2);
  assert.equal(confiarEnProxy("loopback"), "loopback");
  assert.throws(() => confiarEnProxy("true"), /no se acepta/);
  const sinProxy = crearApp(prisma, {});
  assert.equal(sinProxy.get("trust proxy"), false, "por defecto no se confía en ningún proxy");
  assert.equal(crearApp(prisma, { proxy: 1 }).get("trust proxy"), 1);
  // Con un proxy declarado, la dirección que cuenta es la que dice el proxy (el límite de intentos separa a cada visitante)
  const dirs = await servir({ proxy: 1 }, async (base) => {
    const r = await fetch(`${base}/api/auth/yo`, { headers: { "X-Forwarded-For": "203.0.113.7" } });
    return r.status;
  });
  assert.equal(dirs, 401);

  console.log("OK: el panel y el sitio mandan sus cabeceras de seguridad (política de contenido del panel sin scripts en línea; política del sitio con el hash de cada script y lo que usa de Google Fonts, YouTube y Vimeo; HSTS solo en producción; proxies de confianza por variable).");
} finally {
  await prisma.$disconnect();
}
