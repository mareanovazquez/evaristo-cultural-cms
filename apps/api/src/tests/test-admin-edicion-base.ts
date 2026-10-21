// Prueba de la edición de artículos del panel (src/admin/edicion.ts) con la base de verdad, SOLO contra evaristo_cms_dev.
// Crea un usuario y artículos temporales y los borra al terminar; con los 35 migrados solo guarda borradores de cambios y los descarta.
// Comprueba que ningún artículo publicado cambie, que los conflictos no pisen nada y que las validaciones rechacen lo que corresponde.
//
// Uso: npm run test:admin-edicion
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma, Prisma } from "@evaristo/compartido/db";
import { textoPlanoDe } from "@evaristo/compartido/texto-plano";
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

const prisma = obtenerClientePrisma();
const sufijo = Date.now().toString(36);
const email = `prueba-edicion-${sufijo}@ejemplo.org`;
const clave = "clave-de-prueba-larga-1";
const creados: number[] = [];
let server: Server | undefined;

type J = Record<string, any>;
const T = (text: string): J => ({ type: "text", text });
const P = (...content: J[]): J => ({ type: "paragraph", content });
const doc = (...content: J[]): J => ({ type: "doc", content });
const nota = (texto: string): J => ({ type: "footnote", attrs: { content: doc(P(T(texto))) } });

try {
  try {
    await prisma.articuloBorrador.count();
  } catch (e) {
    fallar(`falta la tabla de borradores en evaristo_cms_dev (¿se aplicó la migración?): ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  await prisma.usuario.create({ data: { email, nombre: "Prueba de edición", rol: "EDITOR", passwordHash: await hashearClave(clave) }, select: { id: true } });
  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, cookie?: string, cabeceras: Record<string, string> = {}) =>
    new Promise<{ estado: number; json: J; cookie: string | undefined; texto: string }>((resolver, rechazar) => {
      const datos = cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
      const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...cabeceras } }, (res) => {
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

  // ---------- A. Sin sesión ----------
  for (const [m, r] of [["GET", "/api/admin/catalogos"], ["GET", "/api/admin/articulos/1"], ["POST", "/api/admin/articulos"], ["PUT", "/api/admin/articulos/1"], ["DELETE", "/api/admin/articulos/1/borrador"]] as const) {
    assert.equal((await pedir(m, r, m === "GET" || m === "DELETE" ? undefined : {})).estado, 401, `${m} ${r}`);
  }

  const ingreso = await pedir("POST", "/api/auth/ingresar", { email, clave });
  assert.equal(ingreso.estado, 200);
  const cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(ingreso.cookie ?? "")?.[1] ?? ""}`;
  const api = (m: string, r: string, cuerpo?: unknown, cab?: Record<string, string>) => pedir(m, `/api/admin${r}`, cuerpo, cookie, cab);

  // ---------- B. Catálogos ----------
  const cat = await api("GET", "/catalogos");
  assert.equal(cat.estado, 200);
  assert.equal(cat.json["secciones"].length, await prisma.seccion.count({ where: { interna: false } }));
  assert.ok(!cat.json["secciones"].some((s: J) => s.slug === "sin-asignar"));
  assert.equal(cat.json["categorias"].length, await prisma.categoria.count());
  assert.equal(cat.json["autores"].length, await prisma.autor.count());
  const seccionId: number = cat.json["secciones"][0].id;
  const segundaSeccionId: number = cat.json["secciones"][1].id;
  const categoriaIds: number[] = cat.json["categorias"].slice(0, 2).map((c: J) => c.id);
  const autorIds: number[] = cat.json["autores"].slice(0, 2).map((c: J) => c.id);
  const sinAsignar = await prisma.seccion.findFirstOrThrow({ where: { interna: true }, select: { id: true } });
  const imagen = await prisma.imagen.findFirstOrThrow({ select: { id: true }, orderBy: { id: "asc" } });

  // ---------- C. Los 35 migrados: guardar sin tocar no cambia nada publicado ----------
  const todos = await prisma.articulo.findMany({ select: { id: true, wpId: true, estado: true, actualizadoEn: true, cuerpo: true, textoPlano: true, titulo: true, slug: true, altPendientes: true }, orderBy: { id: "asc" } });
  assert.ok(todos.length >= 35);
  const instantanea = new Map(todos.map((a) => [a.id, JSON.stringify([a.actualizadoEn, a.cuerpo, a.textoPlano, a.titulo, a.slug, a.altPendientes])]));
  let guardados = 0;
  let imagenIdsVistos = 0;
  for (const a of todos) {
    const g = await api("GET", `/articulos/${a.id}`);
    assert.equal(g.estado, 200, `GET ${a.wpId}`);
    const art = g.json["articulo"];
    assert.deepEqual(art.datos.cuerpo, a.cuerpo, `el cuerpo de ${a.wpId} no vuelve igual`);
    assert.equal(art.datos.titulo, a.titulo);
    assert.equal(art.conCambiosSinPublicar, false);
    imagenIdsVistos += (JSON.stringify(art.datos.cuerpo).match(/"imagenId"/g) ?? []).length;
    if (a.estado === "BORRADOR") {
      // Un borrador migrado no se toca en esta prueba: solo se comprueba que una versión vieja da conflicto.
      const viejo = await api("PUT", `/articulos/${a.id}`, { version: "2000-01-01T00:00:00.000Z", datos: art.datos });
      assert.equal(viejo.estado, 409, `PUT con versión vieja de ${a.wpId}`);
      continue;
    }
    const p = await api("PUT", `/articulos/${a.id}`, { version: art.version, datos: art.datos });
    assert.equal(p.estado, 200, `PUT ${a.wpId}: ${p.texto.slice(0, 200)}`);
    assert.equal(p.json["conCambiosSinPublicar"], true);
    const g2 = await api("GET", `/articulos/${a.id}`);
    assert.equal(g2.json["articulo"].conCambiosSinPublicar, true);
    assert.deepEqual(g2.json["articulo"].datos.cuerpo, a.cuerpo, `el borrador de ${a.wpId} no conserva el cuerpo`);
    assert.deepEqual(g2.json["articulo"].datos.categoriaIds.slice().sort(), art.datos.categoriaIds.slice().sort());
    assert.deepEqual(g2.json["articulo"].datos.autorIds, art.datos.autorIds);
    guardados++;
  }
  assert.ok(guardados >= 34);
  assert.ok(imagenIdsVistos >= 172, `solo se vieron ${imagenIdsVistos} imagenId`);
  // El artículo publicado no cambió: ni la fila ni el texto plano
  for (const a of await prisma.articulo.findMany({ where: { id: { in: todos.map((t) => t.id) } }, select: { id: true, actualizadoEn: true, cuerpo: true, textoPlano: true, titulo: true, slug: true, altPendientes: true } })) {
    assert.equal(JSON.stringify([a.actualizadoEn, a.cuerpo, a.textoPlano, a.titulo, a.slug, a.altPendientes]), instantanea.get(a.id), `el artículo ${a.id} cambió`);
  }
  assert.equal(await prisma.articuloBorrador.count(), guardados);
  // Descartar los borradores de cambios
  for (const a of todos) assert.equal((await api("DELETE", `/articulos/${a.id}/borrador`)).estado, 200);
  assert.equal(await prisma.articuloBorrador.count(), 0);
  assert.equal((await api("DELETE", `/articulos/${todos[0]!.id}/borrador`)).estado, 200, "descartar dos veces no falla");

  // ---------- D. Artículo publicado temporal: conflictos y borrador de cambios ----------
  const pub = await prisma.articulo.create({
    data: { slug: `prueba-pub-${sufijo}`, titulo: "Prueba publicada", cuerpo: doc(P(T("Texto publicado."))) as Prisma.InputJsonValue, textoPlano: "Texto publicado.", estado: "PUBLICADO", publicadoEn: new Date("2020-01-02T03:04:05Z"), seccionId },
    select: { id: true },
  });
  creados.push(pub.id);
  const datosPub = (await api("GET", `/articulos/${pub.id}`)).json["articulo"];
  const v1: string = datosPub.version;
  const cambiado = { ...datosPub.datos, titulo: "Prueba publicada, editada", cuerpo: doc(P(T("Texto editado."), nota("Una nota."))) };
  const g1 = await api("PUT", `/articulos/${pub.id}`, { version: v1, datos: cambiado });
  assert.equal(g1.estado, 200);
  const v2: string = g1.json["version"];
  assert.notEqual(v2, v1);
  const enBase = await prisma.articulo.findUniqueOrThrow({ where: { id: pub.id }, select: { titulo: true, cuerpo: true, textoPlano: true } });
  assert.equal(enBase.titulo, "Prueba publicada", "el sitio sigue mostrando lo publicado");
  assert.equal(enBase.textoPlano, "Texto publicado.");
  // Una segunda persona que abrió la versión v1 no pisa
  const choque = await api("PUT", `/articulos/${pub.id}`, { version: v1, datos: { ...cambiado, titulo: "Otra persona" } });
  assert.equal(choque.estado, 409);
  assert.equal(choque.json["estado"], "conflicto");
  assert.equal((await api("GET", `/articulos/${pub.id}`)).json["articulo"].datos.titulo, "Prueba publicada, editada");
  const g3 = await api("PUT", `/articulos/${pub.id}`, { version: v2, datos: { ...cambiado, titulo: "Tercera versión" } });
  assert.equal(g3.estado, 200);
  // Si el artículo publicado cambia por otro lado después de empezar el borrador, también hay conflicto
  await prisma.articulo.update({ where: { id: pub.id }, data: { bajada: "cambió por otro lado" }, select: { id: true } });
  assert.equal((await api("PUT", `/articulos/${pub.id}`, { version: g3.json["version"], datos: cambiado })).estado, 409);
  await api("DELETE", `/articulos/${pub.id}/borrador`);
  // La dirección de uno publicado no se cambia desde acá
  const nuevaVersion = (await api("GET", `/articulos/${pub.id}`)).json["articulo"];
  assert.equal((await api("PUT", `/articulos/${pub.id}`, { version: nuevaVersion.version, datos: { ...nuevaVersion.datos, slug: "otra-direccion" } })).estado, 422);

  // ---------- E. Validaciones ----------
  const base = nuevaVersion.datos;
  const guardarMal = async (cambios: J, esperado = 422, texto?: RegExp) => {
    const v = (await api("GET", `/articulos/${pub.id}`)).json["articulo"].version;
    const r = await api("PUT", `/articulos/${pub.id}`, { version: v, datos: { ...base, ...cambios } });
    assert.equal(r.estado, esperado, `${JSON.stringify(cambios).slice(0, 80)} dio ${r.estado}: ${r.texto.slice(0, 160)}`);
    if (texto) assert.match(JSON.stringify(r.json), texto);
  };
  await guardarMal({ titulo: "" });
  await guardarMal({ titulo: "x".repeat(513) });
  await guardarMal({ bajada: "x".repeat(2001) });
  await guardarMal({ cuerpo: doc({ type: "heading", attrs: { level: 1 }, content: [T("No")] }) }, 422, /H1/);
  await guardarMal({ cuerpo: doc(P({ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] })) }, 422, /javascript/);
  await guardarMal({ cuerpo: doc({ type: "rarito", content: [] }) }, 422, /no permitido/i);
  await guardarMal({ cuerpo: doc({ type: "imagen", attrs: { src: "javascript:alert(1)", alt: "x" } }) });
  await guardarMal({ cuerpo: { type: "otra-cosa", content: [] } });
  await guardarMal({ cuerpo: "texto suelto" });
  await guardarMal({ seccionId: 999999 }, 422, /sección/);
  await guardarMal({ seccionId: sinAsignar.id }, 422, /sección/);
  await guardarMal({ categoriaIds, categoriaPrincipalId: 999999 }, 422, /principal/);
  await guardarMal({ categoriaIds: [999999], categoriaPrincipalId: null }, 422, /categoría/);
  await guardarMal({ categoriaIds: [categoriaIds[0], categoriaIds[0]], categoriaPrincipalId: null }, 422, /repetidas/);
  await guardarMal({ autorIds: [999999] }, 422, /autor/);
  await guardarMal({ imagenEncabezadoId: 999999 }, 422, /imagen/i);
  await guardarMal({ cuerpo: doc({ type: "imagen", attrs: { src: "/media/x.jpg", alt: "Algo", imagenId: 999999 } }) }, 422, /biblioteca/);
  await guardarMal({ encabezadoPuntoFocalX: 1.5 });
  await guardarMal({ encabezadoPuntoFocalY: -0.1 });
  await guardarMal({ novedadHasta: "mañana" });
  await guardarMal({ campoDeMas: 1 });
  await guardarMal({ conCapital: "si" });
  // La marca de texto alternativo pendiente no se puede inventar
  await guardarMal({ cuerpo: doc({ type: "imagen", attrs: { src: "/media/x.jpg", alt: "", decorativa: false, altPendiente: true } }) }, 422, /pendiente/);
  assert.equal((await api("PUT", `/articulos/${pub.id}`, { version: "x", datos: base })).estado, 409);
  assert.equal((await api("PUT", `/articulos/${pub.id}`, { datos: base })).estado, 422);
  assert.equal((await api("PUT", `/articulos/${pub.id}`, "esto no es json")).estado, 400);
  assert.equal((await api("PUT", "/articulos/999999", { version: "x", datos: base })).estado, 404);
  assert.equal((await api("GET", "/articulos/abc")).estado, 404);
  assert.equal((await api("GET", "/articulos/999999")).estado, 404);
  assert.equal(await prisma.articuloBorrador.count({ where: { articuloId: pub.id } }), 0, "ninguna validación fallida dejó un borrador");

  // ---------- F. altPendiente: se conserva en lo que ya la tenía, nunca en lo nuevo ----------
  const imgPend = (n: number, extra: J = {}): J => ({ type: "imagen", attrs: { src: `/media/pend-${n}.jpg`, alt: "", decorativa: false, altPendiente: true, ...extra } });
  const migrado = await prisma.articulo.create({
    data: { slug: `prueba-pend-${sufijo}`, titulo: "Con imagen pendiente", cuerpo: doc(P(T("Hola.")), imgPend(1)) as Prisma.InputJsonValue, textoPlano: "Hola.", estado: "BORRADOR", seccionId, altPendientes: 1 },
    select: { id: true },
  });
  creados.push(migrado.id);
  const dm = (await api("GET", `/articulos/${migrado.id}`)).json["articulo"];
  const g4 = await api("PUT", `/articulos/${migrado.id}`, { version: dm.version, datos: { ...dm.datos, titulo: "Con imagen pendiente (editada)" } });
  assert.equal(g4.estado, 200, "la imagen que ya estaba pendiente se conserva");
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: migrado.id }, select: { altPendientes: true } })).altPendientes, 1);
  const g5 = await api("PUT", `/articulos/${migrado.id}`, { version: g4.json["version"], datos: { ...dm.datos, cuerpo: doc(P(T("Hola.")), imgPend(1), imgPend(2)) } });
  assert.equal(g5.estado, 422, "una segunda imagen no puede nacer pendiente");
  const g6 = await api("PUT", `/articulos/${migrado.id}`, { version: g4.json["version"], datos: { ...dm.datos, cuerpo: doc(P(T("Hola.")), imgPend(1, { alt: "Ahora sí tiene texto", altPendiente: false })) } });
  assert.equal(g6.estado, 200, "completar el texto alternativo quita la marca");
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: migrado.id }, select: { altPendientes: true } })).altPendientes, 0);

  // ---------- G. Crear y editar un borrador: se guarda directo ----------
  const malNuevo = await api("POST", "/articulos", { titulo: "" });
  assert.equal(malNuevo.estado, 422);
  assert.equal((await api("POST", "/articulos", { titulo: "Sin sección", seccionId: 999999 })).estado, 422);
  assert.equal((await api("POST", "/articulos", { titulo: "Interna", seccionId: sinAsignar.id })).estado, 422);
  const nuevo = await api("POST", "/articulos", { titulo: "Artículo nuevo de prueba", seccionId });
  assert.equal(nuevo.estado, 201);
  creados.push(nuevo.json["id"]);
  const fila0 = await prisma.articulo.findUniqueOrThrow({ where: { id: nuevo.json["id"] }, select: { estado: true, slug: true, textoPlano: true, publicadoEn: true } });
  assert.equal(fila0.estado, "BORRADOR");
  assert.match(fila0.slug, /^borrador-[0-9a-f]{12}$/);
  assert.equal(fila0.publicadoEn, null);

  const cuerpoNuevo = doc(P(T("Primer párrafo con nota"), nota("La nota al pie.")), { type: "imagen", attrs: { src: "/media/x.jpg", alt: "Una imagen", imagenId: imagen.id, epigrafe: "Epígrafe" } }, P(T("Último párrafo.")));
  const nv: string = nuevo.json["version"];
  const datosNuevo = {
    titulo: "Título definitivo",
    bajada: "Una bajada.",
    cuerpo: cuerpoNuevo,
    seccionId: segundaSeccionId,
    categoriaIds,
    categoriaPrincipalId: categoriaIds[1],
    autorIds: [autorIds[1], autorIds[0]],
    imagenEncabezadoId: imagen.id,
    encabezadoAlt: null,
    encabezadoCredito: "Foto de prueba",
    encabezadoPuntoFocalX: 0.25,
    encabezadoPuntoFocalY: 0.75,
    conCapital: true,
    novedadHasta: "2030-01-01T00:00:00.000Z",
    slug: `mi-articulo-de-prueba-${sufijo}`,
  };
  const gn = await api("PUT", `/articulos/${nuevo.json["id"]}`, { version: nv, datos: datosNuevo });
  assert.equal(gn.estado, 200, gn.texto.slice(0, 300));
  assert.equal(gn.json["conCambiosSinPublicar"], false);
  const fila = await prisma.articulo.findUniqueOrThrow({
    where: { id: nuevo.json["id"] },
    select: { titulo: true, bajada: true, slug: true, seccionId: true, textoPlano: true, altPendientes: true, conCapital: true, novedadHasta: true, categoriaPrincipalId: true, imagenEncabezadoId: true, encabezadoPuntoFocalX: true, encabezadoPuntoFocalY: true, encabezadoCredito: true, cuerpo: true, categorias: { select: { categoriaId: true } }, autores: { orderBy: { orden: "asc" }, select: { autorId: true } }, borrador: { select: { articuloId: true } } },
  });
  assert.equal(fila.titulo, "Título definitivo");
  assert.equal(fila.slug, datosNuevo.slug);
  assert.equal(fila.seccionId, segundaSeccionId);
  assert.equal(fila.textoPlano, textoPlanoDe(cuerpoNuevo as never));
  assert.match(fila.textoPlano, /La nota al pie/);
  assert.equal(fila.altPendientes, 1, "el encabezado sin texto alternativo cuenta como pendiente");
  assert.equal(fila.conCapital, true);
  assert.equal(fila.novedadHasta?.toISOString(), datosNuevo.novedadHasta);
  assert.equal(fila.categoriaPrincipalId, categoriaIds[1]);
  assert.deepEqual(fila.categorias.map((c) => c.categoriaId).sort(), categoriaIds.slice().sort());
  assert.deepEqual(fila.autores.map((a) => a.autorId), [autorIds[1], autorIds[0]], "los autores conservan el orden");
  assert.deepEqual(fila.cuerpo, cuerpoNuevo);
  assert.equal(fila.borrador, null, "un borrador se guarda directo, sin copia de trabajo");
  assert.equal(fila.encabezadoPuntoFocalX, 0.25);
  // Versión vieja: conflicto sin pisar
  assert.equal((await api("PUT", `/articulos/${nuevo.json["id"]}`, { version: nv, datos: { ...datosNuevo, titulo: "Pisada" } })).estado, 409);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: nuevo.json["id"] }, select: { titulo: true } })).titulo, "Título definitivo");
  // Dirección: formato y repetidas
  const vNuevo: string = gn.json["version"];
  const formato = await api("PUT", `/articulos/${nuevo.json["id"]}`, { version: vNuevo, datos: { ...datosNuevo, slug: "Con Mayúsculas" } });
  assert.equal(formato.estado, 422);
  const repetida = await api("PUT", `/articulos/${nuevo.json["id"]}`, { version: vNuevo, datos: { ...datosNuevo, slug: todos[0]!.slug } });
  assert.equal(repetida.estado, 422);
  assert.match(JSON.stringify(repetida.json), /dirección/);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: nuevo.json["id"] }, select: { slug: true } })).slug, datosNuevo.slug, "un guardado rechazado no cambia nada");
  // Sacar categorías y autores
  const vacio = await api("PUT", `/articulos/${nuevo.json["id"]}`, { version: vNuevo, datos: { ...datosNuevo, categoriaIds: [], categoriaPrincipalId: null, autorIds: [] } });
  assert.equal(vacio.estado, 200);
  assert.equal(await prisma.articuloCategoria.count({ where: { articuloId: nuevo.json["id"] } }), 0);
  assert.equal(await prisma.articuloAutor.count({ where: { articuloId: nuevo.json["id"] } }), 0);

  // ---------- H. Origen y tamaño ----------
  assert.equal((await api("PUT", `/articulos/${nuevo.json["id"]}`, { version: vacio.json["version"], datos: datosNuevo }, { Origin: "http://sitio-malicioso.example" })).estado, 403);
  assert.equal((await api("POST", "/articulos", { titulo: "x", seccionId }, { "Sec-Fetch-Site": "cross-site" })).estado, 403);
  const enorme = await api("PUT", `/articulos/${nuevo.json["id"]}`, { version: vacio.json["version"], datos: { ...datosNuevo, cuerpo: doc(P(T("x".repeat(3 * 1024 * 1024)))) } });
  assert.equal(enorme.estado, 413);

  console.log(`OK: edición verificada contra evaristo_cms_dev: ${guardados} artículos publicados guardados como borrador de cambios sin alterar nada (${imagenIdsVistos} imagenId conservados), conflictos, ${"validaciones"} y guardado directo de borradores.`);
} finally {
  if (creados.length) await prisma.articulo.deleteMany({ where: { id: { in: creados } } });
  await prisma.articuloBorrador.deleteMany({});
  await prisma.usuario.deleteMany({ where: { email } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
