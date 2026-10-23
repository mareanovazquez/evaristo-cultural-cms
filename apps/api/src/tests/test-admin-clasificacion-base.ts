// Prueba de las secciones y categorías del panel (src/admin/clasificacion.ts) con la base de verdad, SOLO contra evaristo_cms_dev.
// Crea secciones, categorías, artículos y usuarios temporales y los borra al terminar (y deja el orden de las secciones como estaba).
// Comprueba: permisos (solo administrador), crear con dirección única, renombrar, cambiar la dirección con redirección (y encadenar),
// ordenar, eliminar solo vacías, unir sin perder artículos ni repetir categorías, y los cambios sin publicar.
//
// Uso: npm run test:admin-clasificacion
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
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

type J = Record<string, any>;
const prisma = obtenerClientePrisma();
const sufijo = Date.now().toString(36);
const prefijo = `Clatest ${sufijo}`;
const slugBase = `clatest-${sufijo}`;
const dominio = `${sufijo}.ejemplo.org`;
const CLAVE = "clave-de-prueba-larga-1";
let server: Server | undefined;
let ordenOriginal: Array<{ id: number; orden: number }> = [];

try {
  await prisma.seccion.count({ where: { orden: 0 } }).catch(() => fallar("falta la migración del orden de las secciones en evaristo_cms_dev (db:deploy)"));
  ordenOriginal = await prisma.seccion.findMany({ select: { id: true, orden: true } });
  const mk = (email: string, rol: "ADMINISTRADOR" | "EDITOR") => hashearClave(CLAVE).then((passwordHash) => prisma.usuario.create({ data: { email: `${email}@${dominio}`, nombre: `${prefijo} ${email}`, rol, passwordHash }, select: { id: true } }));
  const admin = await mk("admin", "ADMINISTRADOR");
  await mk("editor", "EDITOR");

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, cookie?: string) =>
    new Promise<{ estado: number; json: J; texto: string; cookie: string | undefined; location: string | undefined }>((resolver, rechazar) => {
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
          resolver({ estado: res.statusCode ?? 0, json, texto, cookie: Array.isArray(set) ? set[0] : set, location: res.headers.location });
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
  const problemasDe = (r: { json: J }) => ((r.json["problemas"] ?? []) as string[]).join(" | ") + " | " + String(r.json["mensaje"] ?? "");
  const redir = (origen: string) => prisma.redireccion.findUnique({ where: { origen }, select: { tipo: true, codigo: true, destino: true, articuloId: true, autorId: true } });

  // ---------- A. Permisos ----------
  for (const [m, r] of [["GET", "/secciones"], ["POST", "/secciones"], ["PUT", "/secciones/1"], ["DELETE", "/secciones/1"], ["POST", "/secciones/orden"], ["POST", "/secciones/1/unir"], ["GET", "/categorias"], ["POST", "/categorias"], ["PUT", "/categorias/1"], ["DELETE", "/categorias/1"], ["POST", "/categorias/1/unir"]] as const) {
    assert.equal((await pedir(m, `/api/admin${r}`, m === "GET" || m === "DELETE" ? undefined : {})).estado, 401, `${m} ${r} sin sesión`);
    assert.equal((await edi(m, r, m === "GET" || m === "DELETE" ? undefined : {})).estado, 403, `${m} ${r} como editor`);
  }

  // ---------- B. Secciones ----------
  const lista0 = await ana("GET", "/secciones");
  assert.equal(lista0.estado, 200);
  const listadas = lista0.json["secciones"] as J[];
  assert.equal(listadas.at(-1)!["interna"], true, "«Sin asignar» sale al final");
  assert.ok(listadas.filter((s) => !s["interna"]).every((s, i, l) => i === 0 || l[i - 1]!["orden"] <= s["orden"]), "ordenadas por orden");
  const internaId = listadas.at(-1)!["id"] as number;
  assert.equal((await ana("PUT", `/secciones/${internaId}`, { nombre: "X", slug: "x" })).estado, 409, "la interna no se renombra");
  assert.equal((await ana("DELETE", `/secciones/${internaId}`)).estado, 409, "ni se elimina");
  assert.equal((await ana("GET", `/secciones/${internaId}/unir?destinoId=1`)).estado, 409, "ni se une");

  assert.equal((await ana("POST", "/secciones", { nombre: "  " })).estado, 422);
  assert.equal((await ana("POST", "/secciones", { nombre: "X", slug: "Mal Formato" })).estado, 422);
  assert.equal((await ana("POST", "/secciones", { nombre: "X", otro: 1 })).estado, 422);
  const maxOrden = Math.max(...listadas.filter((s) => !s["interna"]).map((s) => s["orden"] as number));
  const c1 = await ana("POST", "/secciones", { nombre: `${prefijo} Cine Argentino` });
  assert.equal(c1.estado, 201, c1.texto);
  const S1 = c1.json["seccion"] as J;
  assert.match(S1["slug"], /^clatest-[a-z0-9]+-cine-argentino$/, "la dirección sale del nombre, sin tildes");
  assert.equal(S1["orden"], maxOrden + 1, "la nueva va al final del menú");
  assert.equal((await ana("POST", "/secciones", { nombre: "Otra", slug: S1["slug"] })).estado, 422, "dirección repetida");
  const c2 = await ana("POST", "/secciones", { nombre: `${prefijo} Cine Argentino` });
  assert.equal(c2.estado, 201);
  const S2 = c2.json["seccion"] as J;
  assert.notEqual(S2["slug"], S1["slug"], "el mismo nombre genera otra dirección");

  // Renombrar y cambiar la dirección: la vieja redirige
  const rS1 = (slug: string) => `/seccion/${slug}/`;
  const viejo = S1["slug"] as string;
  const A = `${slugBase}-a`;
  const B = `${slugBase}-b`;
  assert.equal((await ana("PUT", `/secciones/${S1["id"]}`, { nombre: "", slug: A })).estado, 422);
  assert.equal((await ana("PUT", `/secciones/${S1["id"]}`, { nombre: `${prefijo} Renombrada`, slug: S2["slug"] })).estado, 422, "dirección de otra sección");
  const ren = await ana("PUT", `/secciones/${S1["id"]}`, { nombre: `${prefijo} Renombrada`, slug: A });
  assert.equal(ren.estado, 200, ren.texto);
  assert.equal(ren.json["seccion"]["slug"], A);
  assert.deepEqual(await redir(rS1(viejo)), { tipo: "MANUAL", codigo: 301, destino: rS1(A), articuloId: null, autorId: null }, "la dirección vieja redirige a la nueva");
  // Solo renombrar no crea redirecciones
  const soloNombre = await ana("PUT", `/secciones/${S1["id"]}`, { nombre: `${prefijo} Renombrada 2`, slug: A });
  assert.equal(soloNombre.estado, 200);
  assert.equal(await prisma.redireccion.count({ where: { origen: rS1(A) } }), 0);
  // Encadenar: A → B deja viejo → B y A → B
  assert.equal((await ana("PUT", `/secciones/${S1["id"]}`, { nombre: `${prefijo} Renombrada 2`, slug: B })).estado, 200);
  assert.equal((await redir(rS1(viejo)))!.destino, rS1(B), "la primera redirección se actualiza: no hay cadenas");
  assert.equal((await redir(rS1(A)))!.destino, rS1(B));
  // Volver a una dirección vieja la libera
  assert.equal((await ana("PUT", `/secciones/${S1["id"]}`, { nombre: `${prefijo} Renombrada 2`, slug: A })).estado, 200);
  assert.equal(await redir(rS1(A)), null, "la redirección de la dirección que volvió a usarse se borra");
  assert.equal((await redir(rS1(B)))!.destino, rS1(A));
  assert.equal((await redir(rS1(viejo)))!.destino, rS1(A));
  // Una dirección ocupada por una redirección ajena no se puede tomar
  await prisma.redireccion.create({ data: { origen: rS1(`${slugBase}-ocupada`), tipo: "MANUAL", codigo: 301, destino: "/otra-cosa/" } });
  assert.match(problemasDe(await ana("PUT", `/secciones/${S2["id"]}`, { nombre: `${prefijo} Segunda`, slug: `${slugBase}-ocupada` })), /reservada por una redirección/);
  // La redirección sirve en el sitio
  const hacia = await pedir("GET", rS1(viejo));
  assert.equal(hacia.estado, 301);
  assert.equal(hacia.location, rS1(A));

  // Ordenar
  const antesOrden = ((await ana("GET", "/secciones")).json["secciones"] as J[]).filter((s) => !s["interna"]).map((s) => s["id"] as number);
  const nuevoOrden = [S2["id"] as number, ...antesOrden.filter((id) => id !== S2["id"])];
  assert.equal((await ana("POST", "/secciones/orden", { ids: nuevoOrden.slice(1) })).estado, 409, "tiene que nombrar a todas");
  assert.equal((await ana("POST", "/secciones/orden", { ids: [...nuevoOrden, internaId] })).estado, 409, "ni a la interna");
  assert.equal((await ana("POST", "/secciones/orden", { ids: [...nuevoOrden.slice(0, -1), nuevoOrden[0]] })).estado, 409, "ni repetir");
  assert.equal((await ana("POST", "/secciones/orden", { ids: nuevoOrden })).estado, 200);
  const trasOrden = ((await ana("GET", "/secciones")).json["secciones"] as J[]).filter((s) => !s["interna"]).map((s) => s["id"] as number);
  assert.deepEqual(trasOrden, nuevoOrden, "el orden quedó como se pidió");
  const catalogo = ((await ana("GET", "/catalogos")).json["secciones"] as J[]).map((s) => s["id"] as number);
  assert.deepEqual(catalogo, nuevoOrden, "los desplegables del artículo usan el mismo orden");
  assert.ok(!catalogo.includes(internaId), "y no ofrecen la interna");
  // El menú del sitio (si está compilado) sigue el mismo orden y muestra el nombre nuevo
  const portada = await pedir("GET", "/");
  if (portada.estado === 200) {
    const primeraOriginal = (await prisma.seccion.findUniqueOrThrow({ where: { id: antesOrden[0]! }, select: { slug: true } })).slug;
    const posNueva = portada.texto.indexOf(`href="${rS1(S2["slug"])}"`);
    const posOriginal = portada.texto.indexOf(`href="${rS1(primeraOriginal)}"`);
    assert.ok(posNueva > 0 && posOriginal > 0 && posNueva < posOriginal, "el menú del sitio muestra primero la sección que se subió al principio");
    assert.ok(portada.texto.includes(`${prefijo} Cine Argentino`), "y la sección nueva aparece en el menú");
  }

  // Eliminar solo vacías; unir
  const seccionBase = await prisma.seccion.findFirstOrThrow({ where: { interna: false, NOT: { id: { in: [S1["id"], S2["id"]] } } }, select: { id: true } });
  const art = (titulo: string, seccionId: number, categorias: number[] = [], principal: number | null = null) =>
    prisma.articulo.create({
      data: { slug: `${slugBase}-${titulo}`, titulo: `${prefijo} ${titulo}`, cuerpo: { type: "doc", content: [] }, textoPlano: "", estado: "BORRADOR", seccionId, categoriaPrincipalId: principal, categorias: { create: categorias.map((categoriaId) => ({ categoriaId })) } },
      select: { id: true },
    });
  const a1 = await art("en-s1", S1["id"]);
  const conNotas = await ana("DELETE", `/secciones/${S1["id"]}`);
  assert.equal(conNotas.estado, 409);
  assert.match(conNotas.json["mensaje"], /1 artículo/);
  await prisma.articuloBorrador.create({ data: { articuloId: a1.id, datos: { seccionId: S2["id"], titulo: "x" }, baseVersion: new Date(), usuarioId: admin.id } });
  assert.equal((await ana("DELETE", `/secciones/${S2["id"]}`)).estado, 409, "figura en cambios sin publicar");

  assert.equal((await ana("POST", `/secciones/${S1["id"]}/unir`, { destinoId: S1["id"] })).estado, 422, "no se une consigo misma");
  assert.equal((await ana("POST", `/secciones/${S1["id"]}/unir`, { destinoId: internaId })).estado, 422, "ni con la interna");
  assert.equal((await ana("POST", `/secciones/${S1["id"]}/unir`, { destinoId: 999_999_999 })).estado, 422);
  const vista = await ana("GET", `/secciones/${S1["id"]}/unir?destinoId=${S2["id"]}`);
  assert.equal(vista.estado, 200, vista.texto);
  assert.equal(vista.json["articulos"], 1);
  assert.equal(vista.json["enBorradores"], 0);
  assert.equal(await prisma.seccion.count({ where: { id: S1["id"] } }), 1, "la vista previa no cambia nada");
  const unida = await ana("POST", `/secciones/${S1["id"]}/unir`, { destinoId: S2["id"] });
  assert.equal(unida.estado, 200, unida.texto);
  assert.equal(unida.json["movidos"], 1);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id }, select: { seccionId: true } })).seccionId, S2["id"], "el artículo pasó a la otra sección");
  assert.equal(await prisma.seccion.count({ where: { id: S1["id"] } }), 0);
  assert.equal((await redir(rS1(A)))!.destino, rS1(S2["slug"]), "la dirección de la unida redirige a la elegida");
  assert.equal((await redir(rS1(viejo)))!.destino, rS1(S2["slug"]), "y las anteriores también");

  // Con un cambio sin publicar que nombra a la sobrante: pasa a la elegida
  const S3 = (await ana("POST", "/secciones", { nombre: `${prefijo} Tercera` })).json["seccion"] as J;
  const a2 = await art("en-s2-borrador", S2["id"]);
  await prisma.articuloBorrador.create({ data: { articuloId: a2.id, datos: { seccionId: S3["id"], titulo: "y" }, baseVersion: new Date(), usuarioId: admin.id } });
  assert.equal((await ana("GET", `/secciones/${S3["id"]}/unir?destinoId=${S2["id"]}`)).json["enBorradores"], 1);
  assert.equal((await ana("POST", `/secciones/${S3["id"]}/unir`, { destinoId: S2["id"] })).estado, 200);
  const borr = await prisma.articuloBorrador.findUniqueOrThrow({ where: { articuloId: a2.id }, select: { datos: true } });
  assert.deepEqual(borr.datos, { seccionId: S2["id"], titulo: "y" }, "el cambio sin publicar pasa a la elegida sin perder nada más");
  await prisma.articuloBorrador.deleteMany({ where: { articuloId: { in: [a1.id, a2.id] } } });

  // Eliminar una vacía borra también las redirecciones que llevaban a ella
  const S4 = (await ana("POST", "/secciones", { nombre: `${prefijo} Cuarta` })).json["seccion"] as J;
  assert.equal((await ana("PUT", `/secciones/${S4["id"]}`, { nombre: `${prefijo} Cuarta`, slug: `${slugBase}-cuarta-nueva` })).estado, 200);
  const rutaCuartaVieja = rS1(S4["slug"]);
  assert.ok(await redir(rutaCuartaVieja));
  assert.equal((await ana("DELETE", `/secciones/${S4["id"]}`)).estado, 200);
  assert.equal(await redir(rutaCuartaVieja), null, "no quedan redirecciones hacia una sección que ya no existe");
  assert.equal((await ana("DELETE", `/secciones/${S4["id"]}`)).estado, 404);

  // ---------- C. Categorías ----------
  const rC = (slug: string) => `/categoria/${slug}/`;
  assert.equal((await ana("POST", "/categorias", { nombre: "" })).estado, 422);
  const k1 = (await ana("POST", "/categorias", { nombre: `${prefijo} Cuentos` })).json["categoria"] as J;
  const k2 = (await ana("POST", "/categorias", { nombre: `${prefijo} Cuentos` })).json["categoria"] as J;
  assert.match(k1["slug"], /^clatest-[a-z0-9]+-cuentos$/);
  assert.notEqual(k1["slug"], k2["slug"]);
  assert.deepEqual({ articulos: k1["articulos"], comoPrincipal: k1["comoPrincipal"] }, { articulos: 0, comoPrincipal: 0 });
  assert.match(problemasDe(await ana("PUT", `/categorias/${k1["id"]}`, { nombre: "X", slug: k2["slug"] })), /Ya hay una categoría con esa dirección/);
  const kViejo = k1["slug"] as string;
  const kNuevo = `${slugBase}-cuentos-nuevo`;
  assert.equal((await ana("PUT", `/categorias/${k1["id"]}`, { nombre: `${prefijo} Cuentos y relatos`, slug: kNuevo })).estado, 200);
  assert.deepEqual(await redir(rC(kViejo)), { tipo: "MANUAL", codigo: 301, destino: rC(kNuevo), articuloId: null, autorId: null });
  const kRedir = await pedir("GET", rC(kViejo));
  assert.equal(kRedir.estado, 301);
  assert.equal(kRedir.location, rC(kNuevo));
  const listaK = await ana("GET", "/categorias");
  assert.ok((listaK.json["categorias"] as J[]).some((c) => c["id"] === k1["id"]));
  assert.ok(!listaK.texto.includes("passwordHash"));

  // Unir categorías: artículos con una, con las dos y volanta
  const k3 = (await ana("POST", "/categorias", { nombre: `${prefijo} Tercera` })).json["categoria"] as J;
  const x1 = await art("k-solo-k1", S2["id"], [k1["id"]], k1["id"]);
  const x2 = await art("k-ambas", S2["id"], [k1["id"], k2["id"]], k1["id"]);
  const x3 = await art("k-solo-k2", S2["id"], [k2["id"]], k2["id"]);
  const x4 = await art("k-borrador", S2["id"], [k3["id"]]);
  await prisma.articuloBorrador.create({ data: { articuloId: x4.id, datos: { categoriaIds: [k3["id"], k1["id"]], categoriaPrincipalId: k1["id"], titulo: "z" }, baseVersion: new Date(), usuarioId: admin.id } });
  const delK = await ana("DELETE", `/categorias/${k1["id"]}`);
  assert.equal(delK.estado, 409);
  assert.match(delK.json["mensaje"], /2 artículos/);
  assert.equal((await ana("POST", `/categorias/${k1["id"]}/unir`, { destinoId: k1["id"] })).estado, 422);
  assert.equal((await ana("POST", `/categorias/${k1["id"]}/unir`, { destinoId: 999_999_999 })).estado, 422);
  const vK = await ana("GET", `/categorias/${k1["id"]}/unir?destinoId=${k2["id"]}`);
  assert.equal(vK.estado, 200, vK.texto);
  assert.deepEqual({ articulos: vK.json["articulos"], yaConAmbas: vK.json["yaConAmbas"], comoPrincipal: vK.json["comoPrincipal"], enBorradores: vK.json["enBorradores"] }, { articulos: 2, yaConAmbas: 1, comoPrincipal: 2, enBorradores: 1 });
  const uK = await ana("POST", `/categorias/${k1["id"]}/unir`, { destinoId: k2["id"] });
  assert.equal(uK.estado, 200, uK.texto);
  const cats = async (id: number) => (await prisma.articuloCategoria.findMany({ where: { articuloId: id }, select: { categoriaId: true } })).map((c) => c.categoriaId).sort();
  assert.deepEqual(await cats(x1.id), [k2["id"]], "pasó a la elegida");
  assert.deepEqual(await cats(x2.id), [k2["id"]], "el que tenía las dos queda con una sola");
  assert.deepEqual(await cats(x3.id), [k2["id"]]);
  assert.equal(await prisma.articuloCategoria.count({ where: { categoriaId: k2["id"] } }), 3, "ni se perdió ni se repitió ningún artículo");
  const principales = await prisma.articulo.findMany({ where: { id: { in: [x1.id, x2.id, x3.id] } }, select: { categoriaPrincipalId: true } });
  assert.ok(principales.every((p) => p.categoriaPrincipalId === k2["id"]), "la categoría principal (volanta) también pasó a la elegida");
  const bk = await prisma.articuloBorrador.findUniqueOrThrow({ where: { articuloId: x4.id }, select: { datos: true } });
  assert.deepEqual(bk.datos, { categoriaIds: [k3["id"], k2["id"]], categoriaPrincipalId: k2["id"], titulo: "z" }, "los cambios sin publicar nombran a la elegida");
  assert.equal(await prisma.categoria.count({ where: { id: k1["id"] } }), 0);
  assert.equal((await redir(rC(kViejo)))!.destino, rC(k2["slug"]), "la dirección vieja de la unida ahora lleva a la elegida");
  assert.equal((await redir(rC(kNuevo)))!.destino, rC(k2["slug"]));

  // Eliminar: con una categoría en cambios sin publicar no; vacía sí
  assert.equal((await ana("DELETE", `/categorias/${k3["id"]}`)).estado, 409, "tiene un artículo");
  await prisma.articuloBorrador.deleteMany({ where: { articuloId: x4.id } });
  await prisma.articuloCategoria.deleteMany({ where: { articuloId: x4.id } });
  const delOk = await ana("DELETE", `/categorias/${k3["id"]}`);
  assert.equal(delOk.estado, 200, delOk.texto);
  assert.equal((await ana("DELETE", `/categorias/${k3["id"]}`)).estado, 404);

  console.log("OK: las secciones y las categorías funcionan contra evaristo_cms_dev (solo administrador, direcciones únicas, redirecciones sin cadenas, orden del menú, eliminar solo vacías y unir sin perder artículos, volantas ni cambios sin publicar).");
} finally {
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  await prisma.redireccion.deleteMany({ where: { OR: [{ origen: { contains: slugBase } }, { destino: { contains: slugBase } }] } });
  await prisma.seccion.deleteMany({ where: { OR: [{ nombre: { startsWith: prefijo } }, { slug: { startsWith: slugBase } }] } });
  await prisma.categoria.deleteMany({ where: { OR: [{ nombre: { startsWith: prefijo } }, { slug: { startsWith: slugBase } }] } });
  for (const s of ordenOriginal) await prisma.seccion.updateMany({ where: { id: s.id }, data: { orden: s.orden } });
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${dominio}` } } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
