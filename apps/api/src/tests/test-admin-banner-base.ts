// Prueba del banner de la portada (src/admin/banner.ts y components/Banner.astro) con la base de verdad, SOLO contra evaristo_cms_dev, y con el
// sitio compilado (`npm run build:sitio`). Guarda la configuración y las imágenes del banner que hubiera y las deja como estaban al terminar; crea
// imágenes, un autor, un usuario y una carpeta de subidas temporales y los borra.
// Comprueba: permisos (solo administrador), el interruptor (y que crear la fila no cambie el topbar), las validaciones (cantidad, texto de la imagen,
// enlaces, tipo, peso y medida), guardar y ordenar, borrar solo lo que ya no se usa (fila y archivo), que la biblioteca no borre una imagen del banner,
// y el sitio: dónde está el banner, una sola imagen fija, varias con puntos, capas inactivas fuera del teclado, enlaces internos y externos, el
// límite de 3, y que sin las tablas (la base real hasta la fase 7) el sitio no se rompa.
//
// Uso: npm run test:admin-banner
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { TOPBAR_POR_DEFECTO } from "@evaristo/compartido/sitio";
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
let carpeta: string | undefined;
let configAnterior: Awaited<ReturnType<typeof prisma.configuracionSitio.findUnique>> = null;
let bannerAnterior: Awaited<ReturnType<typeof prisma.bannerImagen.findMany>> = [];
let tablaRenombrada = false;
const imagenesCreadas: number[] = [];

try {
  await prisma.bannerImagen.count().catch(() => fallar("falta la migración banner_portada en evaristo_cms_dev (db:deploy)"));
  configAnterior = await prisma.configuracionSitio.findUnique({ where: { id: 1 } });
  bannerAnterior = await prisma.bannerImagen.findMany();
  await prisma.bannerImagen.deleteMany();
  await prisma.configuracionSitio.deleteMany();

  carpeta = await mkdtemp(join(tmpdir(), "banner-prueba-"));
  const mk = (email: string, rol: "ADMINISTRADOR" | "EDITOR") => hashearClave(CLAVE).then((passwordHash) => prisma.usuario.create({ data: { email: `${email}@${dominio}`, nombre: `Bantest ${sufijo} ${email}`, rol, passwordHash }, select: { id: true } }));
  await mk("admin", "ADMINISTRADOR");
  await mk("editor", "EDITOR");

  /** Una imagen de la biblioteca (y su archivo en la carpeta de subidas) con la medida, el tipo y el peso que se pidan. */
  const imagen = async (nombre: string, extra: { ancho?: number; alto?: number; tipoMime?: string; bytes?: number } = {}) => {
    const clave = `bantest-${sufijo}-${nombre}.jpg`;
    await writeFile(join(carpeta!, clave), "x");
    const creada = await prisma.imagen.create({
      data: { clave, nombreOriginal: `${nombre}.jpg`, tipoMime: extra.tipoMime ?? "image/jpeg", ancho: extra.ancho ?? 1800, alto: extra.alto ?? 600, bytes: extra.bytes ?? 150_000, hash: createHash("sha256").update(`${sufijo}-${nombre}`).digest("hex") },
      select: { id: true, clave: true },
    });
    imagenesCreadas.push(creada.id);
    return creada;
  };
  const A = await imagen("a");
  const B = await imagen("b");
  const C = await imagen("c");
  const D = await imagen("d");

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, { dirSubidas: carpeta }).listen(0, "127.0.0.1", () => listo(s));
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
  const guardar = (slides: unknown) => ana("PUT", "/banner", { slides });
  const slide = (imagenId: number, extra: J = {}) => ({ imagenId, enlace: null, alt: `Promoción ${imagenId}`, ...extra });
  const problemasDe = (r: { json: J }) => ((r.json["problemas"] ?? []) as string[]).join(" | ");
  const portada = async () => (await pedir("GET", "/")).texto;
  const banner = (html: string) => /<section class="banner"[\s\S]*?<\/section>/.exec(html)?.[0] ?? null;
  const existe = (clave: string) => existsSync(join(carpeta!, clave));

  // ---------- A. Permisos ----------
  for (const [m, r] of [["GET", "/banner"], ["PATCH", "/banner/activo"], ["PUT", "/banner"]] as const) {
    assert.equal((await pedir(m, `/api/admin${r}`, m === "GET" ? undefined : {})).estado, 401, `${m} ${r} sin sesión`);
    assert.equal((await edi(m, r, m === "GET" ? undefined : {})).estado, 403, `${m} ${r} como editor`);
  }

  // ---------- B. Sin nada guardado ----------
  const inicial = await ana("GET", "/banner");
  assert.equal(inicial.estado, 200);
  assert.deepEqual({ activo: inicial.json["activo"], max: inicial.json["max"], slides: inicial.json["slides"] }, { activo: false, max: 3, slides: [] }, "apagado, sin imágenes y con máximo 3");
  assert.equal(banner(await portada()), null, "el sitio no dibuja nada");

  // ---------- C. El interruptor ----------
  assert.equal((await ana("PATCH", "/banner/activo", { activo: "si" })).estado, 422);
  assert.equal((await ana("PATCH", "/banner/activo", {})).estado, 422);
  assert.equal((await ana("PATCH", "/banner/activo", { activo: true, otro: 1 })).estado, 422);
  assert.equal((await ana("PATCH", "/banner/activo", { activo: true })).estado, 200);
  assert.equal((await ana("GET", "/banner")).json["activo"], true);
  // Crear la fila desde el banner no le cambia el topbar al sitio (los valores de la columna no son los que se veían sin fila)
  assert.deepEqual((await ana("GET", "/sitio")).json["topbar"], TOPBAR_POR_DEFECTO, "el topbar sigue con los valores por defecto");
  assert.ok((await portada()).includes(TOPBAR_POR_DEFECTO.texto), "y el sitio lo sigue mostrando");
  assert.equal(banner(await portada()), null, "activado pero sin imágenes no se dibuja nada");
  // Guardar el topbar no apaga el banner, ni al revés
  assert.equal((await ana("PUT", "/sitio", { topbar: { activo: true, texto: `Topbar ${sufijo}`, enlace: null } })).estado, 200);
  assert.equal((await ana("GET", "/banner")).json["activo"], true, "guardar el topbar no toca el interruptor del banner");
  assert.equal((await ana("PATCH", "/banner/activo", { activo: false })).estado, 200);
  assert.equal((await ana("GET", "/sitio")).json["topbar"].texto, `Topbar ${sufijo}`, "ni el interruptor del banner toca el topbar");
  assert.equal((await ana("PATCH", "/banner/activo", { activo: true })).estado, 200);

  // ---------- D. Validaciones (nada se guarda si falla) ----------
  const gif = await imagen("gif", { tipoMime: "image/gif" });
  const pesada = await imagen("pesada", { bytes: 2 * 1024 * 1024 + 1 });
  const cuadrada = await imagen("cuadrada", { ancho: 1000, alto: 1000 });
  const chica = await imagen("chica", { ancho: 900, alto: 300 });
  const casi = await imagen("casi", { ancho: 1800, alto: 590 });
  const rechazos: Array<[string, unknown, RegExp]> = [
    ["más de 3", [slide(A.id), slide(B.id), slide(C.id), slide(D.id)], /hasta 3 imágenes/],
    ["sin texto de la imagen", [slide(A.id, { alt: "   " })], /Imagen 1: Escribí qué dice la imagen/],
    ["texto muy largo", [slide(A.id), slide(B.id, { alt: "x".repeat(201) })], /Imagen 2: .*demasiado largo/],
    ["javascript:", [slide(A.id, { enlace: "javascript:alert(1)" })], /Imagen 1: El enlace tiene que empezar/],
    ["enlace sin protocolo", [slide(A.id, { enlace: "ejemplo.org" })], /El enlace tiene que empezar/],
    ["enlace con espacios", [slide(A.id, { enlace: "/mi pagina" })], /El enlace tiene que empezar/],
    ["imagen inexistente", [slide(999999999)], /Imagen 1: No encontramos la imagen/],
    ["un GIF", [slide(gif.id)], /Imagen 1: Tiene que ser una imagen JPEG, PNG o WebP/],
    ["pesa más de 2 MB", [slide(pesada.id)], /Imagen 1: Pesa demasiado/],
    ["no es 3:1", [slide(cuadrada.id)], /Imagen 1: Mide 1000 × 1000 .* proporción 3:1/],
    ["muy chica", [slide(chica.id)], /Imagen 1: Es muy chica/],
    ["campo de más", [{ ...slide(A.id), color: "rojo" }], /./],
    ["sin imagenId", [{ enlace: null, alt: "x" }], /Imagen 1: Elegí una imagen/],
    ["slides que no es lista", "hola", /./],
  ];
  for (const [que, slides, patron] of rechazos) {
    const r = await guardar(slides);
    assert.equal(r.estado, 422, `${que}: ${r.texto}`);
    assert.match(problemasDe(r), patron, que);
  }
  assert.equal((await ana("PUT", "/banner", {})).estado, 422, "sin slides");
  assert.equal((await ana("GET", "/banner")).json["slides"].length, 0, "lo rechazado no guardó nada");
  assert.equal((await guardar([slide(casi.id)])).estado, 200, "una proporción dentro de la tolerancia (2 %) sirve");
  assert.equal((await guardar([])).estado, 200, "se puede vaciar");

  // ---------- E. Guardar, leer y ordenar ----------
  const g1 = await guardar([slide(A.id, { enlace: " https://ejemplo.org/promo " }), slide(B.id, { enlace: "/contacto", alt: "  Dos   líneas\n de texto " }), slide(C.id, { enlace: "   " })]);
  assert.equal(g1.estado, 200, g1.texto);
  const s1 = g1.json["slides"] as J[];
  assert.deepEqual(s1.map((s) => s["imagenId"]), [A.id, B.id, C.id]);
  assert.deepEqual(s1.map((s) => s["enlace"]), ["https://ejemplo.org/promo", "/contacto", null], "el enlace se recorta y en blanco es sin enlace");
  assert.equal(s1[1]!["alt"], "Dos líneas de texto", "el texto se normaliza");
  assert.equal(s1[0]!["imagen"].clave, A.clave);
  assert.deepEqual((await prisma.bannerImagen.findMany({ orderBy: { orden: "asc" }, select: { orden: true, imagenId: true } })).map((f) => [f.orden, f.imagenId]), [[1, A.id], [2, B.id], [3, C.id]], "el orden se guarda de 1 en adelante");
  assert.deepEqual((await ana("GET", "/banner")).json["slides"], s1, "leer devuelve lo mismo");
  const g2 = await guardar([slide(C.id), slide(B.id), slide(A.id)]);
  assert.deepEqual((g2.json["slides"] as J[]).map((s) => s["imagenId"]), [C.id, B.id, A.id], "reordenar cambia el orden de rotación");
  assert.equal(g2.json["borradas"], 0, "y no borra ninguna imagen");
  assert.ok(existe(A.clave) && existe(B.clave) && existe(C.clave));

  // ---------- F. Borrar solo lo que ya no se usa ----------
  const autor = await prisma.autor.create({ data: { slug: `bantest-${sufijo}`, nombre: `Bantest ${sufijo}`, fotoId: B.id }, select: { id: true } });
  const g3 = await guardar([slide(C.id)]);
  assert.equal(g3.json["borradas"], 1, "A deja de usarse y se borra; B sigue siendo la foto de un autor y se queda");
  assert.equal(await prisma.imagen.count({ where: { id: A.id } }), 0, "la fila de la imagen se fue");
  assert.ok(!existe(A.clave), "y su archivo también");
  assert.ok(existe(B.clave) && (await prisma.imagen.count({ where: { id: B.id } })) === 1, "la que se usa en otro lado no se toca");
  assert.ok(existe(C.clave));
  await prisma.autor.delete({ where: { id: autor.id } });

  // La biblioteca no deja borrar una imagen del banner
  const borrar = await ana("DELETE", `/imagenes/${C.id}`);
  assert.equal(borrar.estado, 409, borrar.texto);
  assert.match(String(borrar.json["mensaje"]), /el banner de la portada/, "dice dónde se usa");
  assert.equal(await prisma.imagen.count({ where: { id: C.id } }), 1);
  assert.equal((await guardar([slide(D.id)])).json["borradas"], 1, "cambiar C por D borra C");
  assert.ok(!existe(C.clave));

  // ---------- G. El sitio ----------
  await guardar([slide(D.id, { enlace: "https://ejemplo.org/promo", alt: `Una sola ${sufijo}` })]);
  let html = await portada();
  let b = banner(html)!;
  assert.ok(b, "con una imagen y el interruptor encendido, el banner está");
  assert.equal((b.match(/data-capa/g) ?? []).length, 1);
  assert.ok(!b.includes("banner-punto") && !b.includes("data-punto"), "una sola imagen: sin puntos");
  assert.ok(b.includes(`alt="Una sola ${sufijo}"`) && b.includes(`src="/media/${encodeURIComponent(D.clave)}"`), "con su texto alternativo y su imagen");
  assert.match(b, /<a class="banner-enlace" href="https:\/\/ejemplo.org\/promo"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/, "el enlace externo abre en otra pestaña");
  assert.ok(b.includes('data-con-enlace="true"'), "con enlace, la pieza se levanta");
  // Dónde está: después de la banda «Últimas publicaciones» y antes de los bloques de abajo
  assert.ok(html.indexOf('class="banner"') > html.indexOf('class="portada-banda"'), "el banner va después de «Últimas publicaciones»");
  const bloques = [...html.matchAll(/class="portada-bloques"/g)].map((m) => m.index!);
  if (bloques.length > 1) assert.ok(html.indexOf('class="banner"') < bloques[1]!, "y antes de los bloques de abajo");

  const E = await imagen("e");
  const F = await imagen("f");
  await guardar([slide(D.id, { enlace: "/contacto", alt: "Primera" }), slide(E.id, { alt: "Segunda" }), slide(F.id, { enlace: "https://ejemplo.org/x", alt: "Tercera" })]);
  b = banner(await portada())!;
  assert.equal((b.match(/data-capa/g) ?? []).length, 3);
  assert.equal((b.match(/data-punto/g) ?? []).length, 3, "tres puntos");
  assert.ok(b.indexOf('class="banner-puntos"') > b.indexOf('class="banner-marco"'), "los puntos están debajo del banner");
  assert.match(b, /aria-label="Ver imagen 2 de 3"/, "los puntos dicen cuál muestran");
  assert.equal((b.match(/aria-current="true"/g) ?? []).length, 1, "y solo uno es el activo");
  const capas = [...b.matchAll(/<div class="banner-capa[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.ok(capas[0]!.includes("activa") && !capas[0]!.includes("inert") && capas[0]!.includes('aria-hidden="false"'), "la primera es la que se ve");
  assert.ok(capas.slice(1).every((c) => !c.includes("activa") && c.includes("inert") && c.includes('aria-hidden="true"')), "las demás están fuera del teclado y de los lectores");
  assert.ok(b.includes('<a class="banner-enlace" href="/contacto" aria-label="Primera">') || /<a class="banner-enlace" href="\/contacto" aria-label="Primera"\s*>/.test(b), "el enlace interno es un enlace común, sin pestaña nueva");
  assert.ok(!/href="\/contacto"[^>]*target/.test(b), "sin target");
  assert.ok(/aria-label="Tercera \(se abre en una pestaña nueva\)"/.test(b), "el externo avisa que abre otra pestaña");
  assert.ok(!/<a [^>]*>\s*<img[^>]*alt="Segunda"/.test(b), "sin enlace, la imagen no es clickeable");
  assert.ok(b.includes('data-intervalo="6000"'), "rota cada 6 segundos");

  // Más de 3 en la base (por otro camino): el sitio muestra 3. Un enlace raro no se dibuja.
  const G = await imagen("g");
  await prisma.bannerImagen.create({ data: { orden: 4, imagenId: G.id, enlace: "javascript:alert(1)", alt: "Cuarta" } });
  await prisma.bannerImagen.update({ where: { id: (await prisma.bannerImagen.findFirstOrThrow({ where: { alt: "Segunda" } })).id }, data: { enlace: "javascript:alert(2)" } });
  b = banner(await portada())!;
  assert.equal((b.match(/data-capa/g) ?? []).length, 3, "no muestra más de 3");
  assert.ok(!b.includes("Cuarta") && !b.includes("javascript:"), "ni la cuarta ni un enlace peligroso");
  assert.ok(b.includes('alt="Segunda"'), "pero la imagen con el enlace raro sí se ve, sin enlace");
  await prisma.bannerImagen.deleteMany({ where: { alt: "Cuarta" } });

  // Apagado no se ve; el texto alternativo se escapa
  await ana("PATCH", "/banner/activo", { activo: false });
  assert.equal(banner(await portada()), null, "apagado, el banner no está aunque tenga imágenes");
  await ana("PATCH", "/banner/activo", { activo: true });
  await guardar([slide(D.id, { alt: `<script>alert('${sufijo}')</script> & "comillas"` })]);
  html = await portada();
  // Va dentro de un atributo: lo que lo podría romper (comillas y &) sale escapado, y un «<» dentro de un atributo no es una etiqueta.
  const conAlt = banner(html)!;
  assert.ok(conAlt.includes("&quot;comillas&quot;") && conAlt.includes("&amp;"), "el texto alternativo se escapa");
  assert.equal((conAlt.match(/<img /g) ?? []).length, 1, "y no se abre ninguna etiqueta nueva");
  assert.match(conAlt, /<img class="banner-img" src="[^"]+" alt="[^"]*alert\('[a-z0-9]+'\)[^"]*" loading="eager"\s*\/?>/, "todo el texto queda dentro del atributo alt");

  // Sin las tablas (la base real hasta la fase 7) el sitio sigue y no hay banner
  await prisma.$executeRawUnsafe("RENAME TABLE `banner_imagenes` TO `banner_imagenes_prueba`");
  tablaRenombrada = true;
  const sinTabla = await pedir("GET", "/");
  assert.equal(sinTabla.estado, 200, "el sitio no se rompe sin la tabla");
  assert.equal(banner(sinTabla.texto), null, "y no dibuja el banner");
  await prisma.$executeRawUnsafe("RENAME TABLE `banner_imagenes_prueba` TO `banner_imagenes`");
  tablaRenombrada = false;

  console.log("OK: banner de la portada (permisos, interruptor, validaciones, guardado y orden, borrado de lo que no se usa y sitio)");
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
} finally {
  if (tablaRenombrada) await prisma.$executeRawUnsafe("RENAME TABLE `banner_imagenes_prueba` TO `banner_imagenes`").catch(() => console.error("ATENCIÓN: hay que renombrar a mano banner_imagenes_prueba → banner_imagenes en evaristo_cms_dev"));
  await prisma.bannerImagen.deleteMany().catch(() => undefined);
  await prisma.autor.deleteMany({ where: { slug: { startsWith: `bantest-${sufijo}` } } }).catch(() => undefined);
  await prisma.imagen.deleteMany({ where: { id: { in: imagenesCreadas } } }).catch(() => undefined);
  if (bannerAnterior.length) await prisma.bannerImagen.createMany({ data: bannerAnterior }).catch(() => undefined);
  await prisma.configuracionSitio.deleteMany().catch(() => undefined);
  if (configAnterior) await prisma.configuracionSitio.create({ data: configAnterior }).catch(() => undefined);
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${dominio}` } } }).catch(() => undefined);
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  if (carpeta) await rm(carpeta, { recursive: true, force: true });
  await prisma.$disconnect();
}
