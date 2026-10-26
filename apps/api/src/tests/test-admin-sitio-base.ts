// Prueba del topbar editable (src/admin/sitio.ts y el Header del sitio) con la base de verdad, SOLO contra evaristo_cms_dev, y con el sitio
// compilado (`npm run build:sitio`). Guarda la configuración que hubiera y la deja como estaba al terminar; crea un usuario temporal y lo borra.
// Comprueba: permisos (solo administrador), valores por defecto sin configuración, guardar y leer, normalización del texto, validaciones
// (texto largo, enlaces peligrosos o mal formados, texto vacío con el topbar encendido), y el sitio: se ve lo guardado, se oculta apagado
// o sin texto, sin enlace es un mensaje sin vínculo, el texto se escapa y, sin la tabla (la base real hasta la fase 7), usa los valores por defecto.
//
// Uso: npm run test:admin-sitio
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { enlaceValido, TOPBAR_POR_DEFECTO, TOPBAR_TEXTO_MAX } from "@evaristo/compartido/sitio";
import { crearApp } from "../app.js";
import { hashearClave } from "../auth/clave.js";
import { NOMBRE_COOKIE } from "../auth/rutas.js";
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

type J = Record<string, any>;
const prisma = obtenerClientePrisma();
const sufijo = Date.now().toString(36);
const dominio = `${sufijo}.ejemplo.org`;
const CLAVE = "clave-de-prueba-larga-1";
let server: Server | undefined;
let anterior: Awaited<ReturnType<typeof prisma.configuracionSitio.findUnique>> = null;
let tablaRenombrada = false;

try {
  await prisma.configuracionSitio.count().catch(() => fallar("falta la migración configuracion_sitio en evaristo_cms_dev (db:deploy)"));
  anterior = await prisma.configuracionSitio.findUnique({ where: { id: 1 } });
  await prisma.configuracionSitio.deleteMany();

  const mk = (email: string, rol: "ADMINISTRADOR" | "EDITOR") => hashearClave(CLAVE).then((passwordHash) => prisma.usuario.create({ data: { email: `${email}@${dominio}`, nombre: `Sitiotest ${sufijo} ${email}`, rol, passwordHash }, select: { id: true } }));
  await mk("admin", "ADMINISTRADOR");
  await mk("editor", "EDITOR");

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, cookie?: string) =>
    new Promise<{ estado: number; json: J; texto: string; cookie: string | undefined }>((resolver, rechazar) => {
      const datos = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
      const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let json: J = {};
          try {
            json = JSON.parse(texto) as J;
          } catch {
            /* no es JSON */
          }
          const set = res.headers["set-cookie"];
          resolver({ estado: res.statusCode ?? 0, json, texto, cookie: Array.isArray(set) ? set[0] : set });
        });
      });
      req.on("error", rechazar);
      if (datos) req.write(datos);
      req.end();
    });
  const como = async (email: string) => {
    const r = await pedir("POST", "/api/auth/ingresar", { email: `${email}@${dominio}`, clave: CLAVE });
    assert.equal(r.estado, 200, r.texto);
    const cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(r.cookie ?? "")?.[1] ?? ""}`;
    return (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, `/api/admin${ruta}`, cuerpo, cookie);
  };
  const ana = await como("admin");
  const edi = await como("editor");
  const guardar = (topbar: unknown) => ana("PUT", "/sitio", { topbar });
  const problemasDe = (r: { json: J }) => ((r.json["problemas"] ?? []) as string[]).join(" | ");
  const portada = async () => (await pedir("GET", "/")).texto;
  /** La franja del topbar tal como sale en el HTML del sitio: null si no está. */
  const franja = (html: string) => /<(a|p) class="topbar[^"]*"[^>]*>[\s\S]*?<\/\1>/.exec(html)?.[0] ?? null;

  // ---------- A. Permisos ----------
  for (const m of ["GET", "PUT"] as const) {
    assert.equal((await pedir(m, "/api/admin/sitio", m === "PUT" ? {} : undefined)).estado, 401, `${m} sin sesión`);
    assert.equal((await edi(m, "/sitio", m === "PUT" ? {} : undefined)).estado, 403, `${m} como editor`);
  }

  // ---------- B. Sin nada guardado: los valores por defecto ----------
  const inicial = await ana("GET", "/sitio");
  assert.equal(inicial.estado, 200);
  assert.deepEqual(inicial.json["topbar"], TOPBAR_POR_DEFECTO, "sin configuración, la API devuelve los valores por defecto");
  const conDefecto = franja(await portada());
  assert.ok(conDefecto?.includes(TOPBAR_POR_DEFECTO.texto) && conDefecto.includes(`href="${TOPBAR_POR_DEFECTO.enlace}"`), "y el sitio los muestra");

  // ---------- C. Guardar y leer ----------
  const g1 = await guardar({ activo: true, texto: "  Nuevo   mensaje\n de la tienda ", enlace: " https://evaristoeditorial.com.ar/coleccion " });
  assert.equal(g1.estado, 200, g1.texto);
  assert.deepEqual(g1.json["topbar"], { activo: true, texto: "Nuevo mensaje de la tienda", enlace: "https://evaristoeditorial.com.ar/coleccion" }, "el texto se normaliza y el enlace se recorta");
  assert.deepEqual((await ana("GET", "/sitio")).json["topbar"], g1.json["topbar"]);
  assert.equal(await prisma.configuracionSitio.count(), 1, "una sola fila");
  assert.equal((await guardar({ activo: true, texto: "Otro", enlace: "/novedades/" })).estado, 200, "enlace interno");
  assert.equal(await prisma.configuracionSitio.count(), 1, "guardar de nuevo no suma filas");
  assert.equal((await guardar({ activo: true, texto: "Otro", enlace: "" })).json["topbar"].enlace, null, "enlace vacío = sin enlace");
  assert.equal((await guardar({ activo: true, texto: "Otro", enlace: "   " })).json["topbar"].enlace, null, "enlace en blanco = sin enlace");
  assert.equal((await guardar({ activo: false, texto: "", enlace: null })).estado, 200, "apagado puede quedar sin texto");
  assert.equal((await guardar({ activo: true, texto: "x".repeat(TOPBAR_TEXTO_MAX), enlace: null })).estado, 200, "el largo máximo entra");

  // ---------- D. Validaciones (nada se guarda si falla) ----------
  await guardar({ activo: true, texto: "Válido", enlace: "https://ejemplo.org" });
  const rechazos: Array<[string, unknown, RegExp]> = [
    ["texto de más", { activo: true, texto: "x".repeat(TOPBAR_TEXTO_MAX + 1), enlace: null }, /demasiado largo/],
    ["encendido sin texto", { activo: true, texto: "   ", enlace: null }, /Escribí el texto/],
    ["javascript:", { activo: true, texto: "Hola", enlace: "javascript:alert(1)" }, /El enlace tiene que empezar/],
    ["data:", { activo: true, texto: "Hola", enlace: "data:text/html,<b>x</b>" }, /El enlace tiene que empezar/],
    ["ftp", { activo: true, texto: "Hola", enlace: "ftp://ejemplo.org/a" }, /El enlace tiene que empezar/],
    ["sin protocolo", { activo: true, texto: "Hola", enlace: "ejemplo.org" }, /El enlace tiene que empezar/],
    ["protocolo relativo", { activo: true, texto: "Hola", enlace: "//otro.sitio/x" }, /El enlace tiene que empezar/],
    ["con espacios", { activo: true, texto: "Hola", enlace: "https://ejemplo.org/a b" }, /El enlace tiene que empezar/],
    ["barra invertida", { activo: true, texto: "Hola", enlace: "/\\otro.sitio" }, /El enlace tiene que empezar/],
    ["enlace muy largo", { activo: true, texto: "Hola", enlace: `https://ejemplo.org/${"a".repeat(600)}` }, /demasiado largo/],
    ["activo que no es booleano", { activo: "si", texto: "Hola", enlace: null }, /se muestra o no/],
    ["texto que no es texto", { activo: true, texto: 5, enlace: null }, /Escribí el texto/],
    ["campo de más", { activo: true, texto: "Hola", enlace: null, color: "rojo" }, /./],
    ["sin enlace (campo faltante)", { activo: true, texto: "Hola" }, /enlace/i],
  ];
  for (const [que, cuerpo, patron] of rechazos) {
    const r = await guardar(cuerpo);
    assert.equal(r.estado, 422, `${que}: ${r.texto}`);
    assert.match(problemasDe(r), patron, que);
  }
  assert.equal((await ana("PUT", "/sitio", {})).estado, 422, "sin topbar");
  assert.equal((await ana("PUT", "/sitio", { topbar: "hola" })).estado, 422, "topbar que no es un objeto");
  assert.deepEqual((await ana("GET", "/sitio")).json["topbar"], { activo: true, texto: "Válido", enlace: "https://ejemplo.org" }, "lo rechazado no cambió nada");
  for (const bueno of ["https://ejemplo.org", "http://ejemplo.org/a?b=1#c", "/", "/novedades/", "/autores/ana-perez/"]) assert.ok(enlaceValido(bueno), `válido: ${bueno}`);
  for (const malo of ["", "http://localhost", "https://", "mailto:a@b.org", "/a b", "//x.org"]) assert.ok(!enlaceValido(malo), `inválido: ${malo}`);

  // ---------- E. El sitio ----------
  await guardar({ activo: true, texto: `Mensaje ${sufijo}`, enlace: "https://ejemplo.org/tienda" });
  let f = franja(await portada());
  assert.ok(f && f.startsWith('<a class="topbar"') && f.includes('href="https://ejemplo.org/tienda"') && f.includes(`Mensaje ${sufijo}`), `con enlace: ${f}`);
  const otra = await pedir("GET", "/novedades/");
  assert.ok(franja(otra.texto)?.includes(`Mensaje ${sufijo}`), "se ve en todas las páginas, no solo en la portada");

  await guardar({ activo: true, texto: `Sin enlace ${sufijo}`, enlace: null });
  f = franja(await portada());
  assert.ok(f && f.startsWith("<p ") && f.includes("topbar-sin-enlace") && !f.includes("href") && f.includes(`Sin enlace ${sufijo}`), `sin enlace: ${f}`);

  await guardar({ activo: false, texto: `Apagado ${sufijo}`, enlace: "https://ejemplo.org" });
  let html = await portada();
  assert.equal(franja(html), null, "apagado no se dibuja");
  assert.ok(!html.includes(`Apagado ${sufijo}`), "ni su texto");
  assert.ok(html.includes('class="header"'), "el resto del encabezado sigue");

  await prisma.configuracionSitio.update({ where: { id: 1 }, data: { topbarActivo: true, topbarTexto: "   " } });
  assert.equal(franja(await portada()), null, "encendido pero sin texto tampoco se dibuja");

  await guardar({ activo: true, texto: `<script>alert('${sufijo}')</script> & "comillas"`, enlace: null });
  html = await portada();
  f = franja(html);
  assert.ok(f && !f.includes("<script>") && f.includes("&lt;script&gt;") && f.includes("&amp;"), `el texto se escapa: ${f}`);
  assert.ok(!html.includes(`alert('${sufijo}')</script>`), "no llega como código a la página");

  // Un enlace raro que llegara a la base por otro camino no se dibuja (el texto sí)
  await prisma.configuracionSitio.update({ where: { id: 1 }, data: { topbarActivo: true, topbarTexto: `Raro ${sufijo}`, topbarEnlace: "javascript:alert(1)" } });
  f = franja(await portada());
  assert.ok(f && f.includes(`Raro ${sufijo}`) && !f.includes("javascript:") && !f.includes("href"), `enlace inválido en la base: ${f}`);

  // Sin la tabla (la base real hasta la fase 7), el sitio sigue y usa los valores por defecto
  await prisma.$executeRawUnsafe("RENAME TABLE `configuracion_sitio` TO `configuracion_sitio_prueba`");
  tablaRenombrada = true;
  const sinTabla = await pedir("GET", "/");
  assert.equal(sinTabla.estado, 200, "el sitio no se rompe sin la tabla");
  assert.ok(franja(sinTabla.texto)?.includes(TOPBAR_POR_DEFECTO.texto), "y muestra el topbar por defecto");
  await prisma.$executeRawUnsafe("RENAME TABLE `configuracion_sitio_prueba` TO `configuracion_sitio`");
  tablaRenombrada = false;

  console.log("OK: topbar editable (permisos, valores por defecto, guardado, validaciones y sitio)");
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
} finally {
  if (tablaRenombrada) await prisma.$executeRawUnsafe("RENAME TABLE `configuracion_sitio_prueba` TO `configuracion_sitio`").catch(() => console.error("ATENCIÓN: hay que renombrar a mano configuracion_sitio_prueba → configuracion_sitio en evaristo_cms_dev"));
  await prisma.configuracionSitio.deleteMany().catch(() => undefined);
  if (anterior) await prisma.configuracionSitio.create({ data: anterior }).catch(() => undefined);
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${dominio}` } } }).catch(() => undefined);
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  await prisma.$disconnect();
}
