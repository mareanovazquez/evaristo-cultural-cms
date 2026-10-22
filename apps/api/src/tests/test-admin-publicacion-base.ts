// Prueba de la publicación de artículos del panel (publicar, programar, publicar cambios y despublicar) con la base de verdad, SOLO contra
// evaristo_cms_dev. Comprueba también lo que ve el sitio de verdad (la app sirve el sitio compilado): lo publicado se ve, lo programado
// y lo despublicado dan 404, y una dirección cambiada redirige. Crea un usuario y artículos temporales y los borra al terminar.
//
// Uso: npm run test:admin-publicacion   (hace falta el sitio compilado: npm run build:sitio)
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { slugDesdeTitulo } from "../admin/publicacion.js";
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
const prefijo = `Pubtest ${sufijo}`;
const email = `prueba-publicacion-${sufijo}@ejemplo.org`;
const clave = "clave-de-prueba-larga-1";
let server: Server | undefined;

const T = (text: string): J => ({ type: "text", text });
const P = (...content: J[]): J => ({ type: "paragraph", content });
const doc = (...content: J[]): J => ({ type: "doc", content });
const DIA = 24 * 3600 * 1000;

try {
  if (!(await prisma.seccion.count())) fallar("la base de desarrollo no tiene secciones");
  await prisma.usuario.create({ data: { email, nombre: "Prueba de publicación", rol: "EDITOR", passwordHash: await hashearClave(clave) }, select: { id: true } });
  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  let cookie: string | undefined;

  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, conCookie = true) =>
    new Promise<{ estado: number; json: J; texto: string; cabeceras: Record<string, any>; cookie: string | undefined }>((resolver, rechazar) => {
      const datos = cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
      const req = request(
        { host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(conCookie && cookie ? { Cookie: cookie } : {}) } },
        (res) => {
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
            resolver({ estado: res.statusCode ?? 0, json, texto, cabeceras: res.headers, cookie: Array.isArray(set) ? set[0] : set });
          });
        },
      );
      req.on("error", rechazar);
      if (datos) req.write(datos);
      req.end();
    });
  const api = (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, `/api/admin${ruta}`, cuerpo);
  const sitio = (ruta: string) => pedir("GET", ruta, undefined, false);

  // Sin sesión no se publica nada
  for (const [m, r] of [["GET", "/articulos/1/publicacion"], ["POST", "/articulos/1/publicar"], ["POST", "/articulos/1/publicar-cambios"], ["POST", "/articulos/1/despublicar"]] as const) {
    assert.equal((await pedir(m, `/api/admin${r}`, m === "POST" ? {} : undefined, false)).estado, 401, `${m} ${r} sin sesión`);
  }
  const ingreso = await pedir("POST", "/api/auth/ingresar", { email, clave }, false);
  assert.equal(ingreso.estado, 200);
  cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(ingreso.cookie ?? "")?.[1] ?? ""}`;

  // ---------- Datos de apoyo ----------
  const secciones = await prisma.seccion.findMany({ where: { interna: false }, orderBy: { id: "asc" }, select: { id: true } });
  const interna = await prisma.seccion.findFirstOrThrow({ where: { interna: true }, select: { id: true } });
  const categorias = await prisma.categoria.findMany({ orderBy: { id: "asc" }, take: 3, select: { id: true } });
  const autores = await prisma.autor.findMany({ orderBy: { id: "asc" }, take: 3, select: { id: true } });
  const imagenes = await prisma.imagen.findMany({ orderBy: { id: "asc" }, take: 2, select: { id: true } });
  assert.ok(categorias.length >= 2 && autores.length >= 2 && imagenes.length >= 2, "la base de desarrollo tiene categorías, autores e imágenes");
  const antes = await prisma.articulo.findFirstOrThrow({ where: { estado: "PUBLICADO", wpId: { not: null } }, orderBy: { id: "asc" }, select: { id: true, actualizadoEn: true, titulo: true } });
  const totalAntes = await prisma.articulo.count();

  const datosCompletos = (titulo: string, extra: J = {}): J => ({
    titulo,
    bajada: "Una bajada de prueba",
    cuerpo: doc(P(T("Texto del artículo de prueba."))),
    seccionId: secciones[0]!.id,
    categoriaIds: [categorias[0]!.id, categorias[1]!.id],
    categoriaPrincipalId: categorias[0]!.id,
    autorIds: [autores[0]!.id, autores[1]!.id],
    imagenEncabezadoId: imagenes[0]!.id,
    encabezadoAlt: "Texto alternativo del encabezado",
    encabezadoCredito: null,
    encabezadoPuntoFocalX: 0.5,
    encabezadoPuntoFocalY: 0.5,
    conCapital: false,
    novedadHasta: null,
    ...extra,
  });
  /** Crea un borrador vacío y devuelve su id y versión. */
  const crear = async (titulo: string) => {
    const r = await api("POST", "/articulos", { titulo, seccionId: secciones[0]!.id });
    assert.equal(r.estado, 201, r.texto);
    return { id: r.json["id"] as number, version: r.json["version"] as string };
  };
  /** Guarda datos en un artículo y devuelve la versión nueva. */
  const guardar = async (id: number, version: string, datos: J) => {
    const r = await api("PUT", `/articulos/${id}`, { version, datos });
    assert.equal(r.estado, 200, `guardar: ${r.texto.slice(0, 300)}`);
    return r.json["version"] as string;
  };
  const leer = async (id: number) => (await api("GET", `/articulos/${id}`)).json["articulo"] as J;
  const publicar = (id: number, version: string, cuerpo: J = {}) => api("POST", `/articulos/${id}/publicar`, { version, ...cuerpo });
  const problemasDe = (r: { json: J }) => (r.json["problemas"] ?? []).join(" | ") as string;

  // ---------- Funciones de dirección ----------
  assert.equal(slugDesdeTitulo("Título de la Prueba: ¡Árbol & Ñandú!"), "titulo-de-la-prueba-arbol-y-nandu");
  assert.equal(slugDesdeTitulo("   ---  "), "articulo");
  assert.equal(slugDesdeTitulo("Ñ".repeat(5)), "nnnnn");
  const largo = slugDesdeTitulo("palabra ".repeat(30));
  assert.ok(largo.length <= 80 && !largo.endsWith("-") && !/palabra-palabr$/.test(largo), `el título largo se corta en un guion: ${largo}`);

  // ---------- Un borrador incompleto no se puede publicar ----------
  const titulo1 = `${prefijo} Título de la Prueba: ¡Árbol & Ñandú!`;
  const a1 = await crear(titulo1);
  const rev0 = await api("GET", `/articulos/${a1.id}/publicacion`);
  assert.equal(rev0.estado, 200);
  assert.equal(rev0.json["accion"], "publicar");
  assert.match(problemasDe(rev0), /imagen principal/);
  assert.match(problemasDe(rev0), /todavía no tiene texto/);
  assert.equal(rev0.json["slugPropuesto"], slugDesdeTitulo(titulo1), "propone la dirección desde el título");
  assert.equal(rev0.json["publicadoOriginal"], null);
  const noSale = await publicar(a1.id, a1.version);
  assert.equal(noSale.estado, 422);
  assert.match(problemasDe(noSale), /imagen principal/);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id } })).estado, "BORRADOR", "no se publicó");

  // Sin texto alternativo en la imagen principal
  let v1 = await guardar(a1.id, a1.version, datosCompletos(titulo1, { encabezadoAlt: null }));
  const sinAlt = await publicar(a1.id, v1);
  assert.equal(sinAlt.estado, 422);
  assert.match(problemasDe(sinAlt), /texto alternativo de la imagen principal/);
  // En una sección interna
  v1 = await guardar(a1.id, v1, datosCompletos(titulo1, { seccionId: secciones[0]!.id }));
  await prisma.articulo.update({ where: { id: a1.id }, data: { seccionId: interna.id } });
  v1 = (await leer(a1.id))["version"];
  const enInterna = await publicar(a1.id, v1);
  assert.equal(enInterna.estado, 422);
  assert.match(problemasDe(enInterna), /Elegí una sección/);
  await prisma.articulo.update({ where: { id: a1.id }, data: { seccionId: secciones[0]!.id } });
  v1 = (await leer(a1.id))["version"];

  // Reglas de la dirección
  const slugMalo = await publicar(a1.id, v1, { slug: "Con Mayúsculas y Ñ!" });
  assert.equal(slugMalo.estado, 422);
  assert.match(problemasDe(slugMalo), /letras minúsculas/);
  const ocupado = (await prisma.articulo.findFirstOrThrow({ where: { estado: "PUBLICADO" }, select: { slug: true } })).slug;
  const slugOcupado = await publicar(a1.id, v1, { slug: ocupado });
  assert.equal(slugOcupado.estado, 422);
  assert.match(problemasDe(slugOcupado), /Ya hay un artículo con esa dirección/);
  assert.equal((await publicar(a1.id, v1, { publicadoEn: "no es una fecha" })).estado, 422, "fecha inválida");
  assert.match(problemasDe(await publicar(a1.id, v1, { publicadoEn: "1999-01-01T00:00:00.000Z" })), /demasiado antigua/);
  assert.match(problemasDe(await publicar(a1.id, v1, { publicadoEn: new Date(Date.now() + 6 * 365 * DIA).toISOString() })), /demasiado lejana/);
  assert.equal((await publicar(a1.id, v1, { campoDeMas: 1 })).estado, 422, "campos de más");

  // Versión vieja: conflicto, y no cambia nada
  const viejo = await publicar(a1.id, "2000-01-01T00:00:00.000Z");
  assert.equal(viejo.estado, 409);
  assert.equal(viejo.json["estado"], "conflicto");

  // ---------- Publicar ya ----------
  const hace = Date.now();
  const sale = await publicar(a1.id, v1, { slug: "borrador-que-no-sirve" });
  assert.equal(sale.estado, 200, sale.texto.slice(0, 300));
  assert.equal(sale.json["slug"], slugDesdeTitulo(titulo1), "una dirección provisoria se reemplaza por la del título");
  assert.equal(sale.json["articuloEstado"], "PUBLICADO");
  const fila1 = await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id }, include: { categorias: true, autores: { orderBy: { orden: "asc" } } } });
  assert.equal(fila1.estado, "PUBLICADO");
  assert.ok(Math.abs(fila1.publicadoEn!.getTime() - hace) < 60_000, "la fecha es ahora");
  assert.equal(fila1.slug, sale.json["slug"]);
  assert.ok(fila1.textoPlano.includes("Texto del artículo de prueba"));
  assert.deepEqual(fila1.autores.map((x) => x.autorId), [autores[0]!.id, autores[1]!.id]);
  const ruta1 = rutaArticulo({ slug: fila1.slug, publicadoEn: fila1.publicadoEn! });
  assert.equal(sale.json["ruta"], ruta1);
  const verSitio = await sitio(ruta1);
  assert.equal(verSitio.estado, 200, "el artículo publicado se ve en el sitio");
  assert.ok(verSitio.texto.includes("Texto del artículo de prueba") && verSitio.texto.includes("Árbol"), "con su título y su texto");
  const panel1 = await leer(a1.id);
  assert.equal(panel1["estado"], "PUBLICADO");
  assert.equal(panel1["ruta"], ruta1);
  assert.equal((await publicar(a1.id, panel1["version"])).estado, 409, "publicar uno ya publicado");
  assert.equal((await api("GET", `/articulos/${a1.id}/publicacion`)).json["accion"], "ninguna");

  // ---------- Programar: publicado con fecha futura ----------
  const titulo2 = `${prefijo} Programada`;
  const a2 = await crear(titulo2);
  const v2 = await guardar(a2.id, a2.version, datosCompletos(titulo2));
  const futura = new Date(Date.now() + 2 * DIA);
  const prog = await publicar(a2.id, v2, { publicadoEn: futura.toISOString() });
  assert.equal(prog.estado, 200, prog.texto.slice(0, 300));
  assert.equal(prog.json["articuloEstado"], "PROGRAMADO");
  const fila2 = await prisma.articulo.findUniqueOrThrow({ where: { id: a2.id } });
  assert.equal(fila2.estado, "PUBLICADO", "en la base queda PUBLICADO con fecha futura");
  assert.equal(fila2.publicadoEn!.toISOString(), futura.toISOString());
  const ruta2 = rutaArticulo({ slug: fila2.slug, publicadoEn: futura });
  assert.equal((await sitio(ruta2)).estado, 404, "el sitio no muestra lo programado");
  const panel2 = await leer(a2.id);
  assert.equal(panel2["estado"], "PROGRAMADO");
  assert.equal(panel2["ruta"], null, "todavía no tiene dirección pública");
  const lista = async (consulta: string) => (await api("GET", `/articulos${consulta}`)).json;
  const progs = await lista(`?estado=PROGRAMADO&q=${encodeURIComponent(prefijo)}`);
  assert.deepEqual(progs["articulos"].map((x: J) => x.id), [a2.id]);
  assert.equal(progs["articulos"][0].estado, "PROGRAMADO");
  const pubs = await lista(`?estado=PUBLICADO&q=${encodeURIComponent(prefijo)}`);
  assert.deepEqual(pubs["articulos"].map((x: J) => x.id), [a1.id], "lo programado no figura entre los publicados");
  assert.deepEqual((await lista(`?q=${encodeURIComponent(prefijo)}`))["conteos"], { BORRADOR: 0, PUBLICADO: 1, PROGRAMADO: 1 });
  // Llega la fecha: se ve solo, sin ningún proceso
  await prisma.articulo.update({ where: { id: a2.id }, data: { publicadoEn: new Date(Date.now() - 1000) } });
  const ruta2Hoy = rutaArticulo({ slug: fila2.slug, publicadoEn: (await prisma.articulo.findUniqueOrThrow({ where: { id: a2.id } })).publicadoEn! });
  assert.equal((await sitio(ruta2Hoy)).estado, 200, "al llegar la fecha el sitio lo muestra");
  assert.equal((await leer(a2.id))["estado"], "PUBLICADO", "y el panel lo da por publicado");

  // ---------- Publicar los cambios de uno publicado ----------
  const tituloNuevo = `${prefijo} Título cambiado`;
  let v1b = (await leer(a1.id))["version"];
  v1b = await guardar(a1.id, v1b, datosCompletos(tituloNuevo, { cuerpo: doc(P(T("Texto cambiado de la prueba."))), categoriaIds: [categorias[1]!.id], categoriaPrincipalId: categorias[1]!.id, autorIds: [autores[1]!.id, autores[0]!.id] }));
  assert.ok((await sitio(ruta1)).texto.includes("Texto del artículo de prueba"), "mientras no se publican, el sitio sigue mostrando lo publicado");
  const revC = await api("GET", `/articulos/${a1.id}/publicacion`);
  assert.equal(revC.json["accion"], "cambios");
  assert.deepEqual(revC.json["problemas"], []);

  // Un cambio que no se puede publicar (le saca la imagen principal) no cambia nada
  const vMalo = await guardar(a1.id, v1b, datosCompletos(tituloNuevo, { imagenEncabezadoId: null, encabezadoAlt: null }));
  const malos = await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: vMalo });
  assert.equal(malos.estado, 422);
  assert.match(problemasDe(malos), /imagen principal/);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id } })).titulo, titulo1, "no se aplicó nada");
  assert.equal(await prisma.articuloBorrador.count({ where: { articuloId: a1.id } }), 1, "el borrador de cambios sigue ahí");
  // Cambiar la imagen principal exige su texto alternativo
  const vImg = await guardar(a1.id, vMalo, datosCompletos(tituloNuevo, { imagenEncabezadoId: imagenes[1]!.id, encabezadoAlt: null }));
  assert.match(problemasDe(await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: vImg })), /texto alternativo de la imagen principal/);
  // Con todo en orden
  const vOk = await guardar(a1.id, vImg, datosCompletos(tituloNuevo, { cuerpo: doc(P(T("Texto cambiado de la prueba."))), categoriaIds: [categorias[1]!.id], categoriaPrincipalId: categorias[1]!.id, autorIds: [autores[1]!.id, autores[0]!.id] }));
  assert.equal((await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: "2000-01-01T00:00:00.000Z" })).estado, 409, "versión vieja");
  const aplicados = await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: vOk });
  assert.equal(aplicados.estado, 200, aplicados.texto.slice(0, 300));
  const fila1b = await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id }, include: { categorias: true, autores: { orderBy: { orden: "asc" } } } });
  assert.equal(fila1b.titulo, tituloNuevo);
  assert.equal(fila1b.slug, fila1.slug, "la dirección no cambia");
  assert.equal(fila1b.publicadoEn!.toISOString(), fila1.publicadoEn!.toISOString(), "la fecha tampoco");
  assert.ok(fila1b.textoPlano.includes("Texto cambiado"));
  assert.deepEqual(fila1b.categorias.map((c) => c.categoriaId), [categorias[1]!.id]);
  assert.deepEqual(fila1b.autores.map((x) => x.autorId), [autores[1]!.id, autores[0]!.id], "los autores en el orden nuevo");
  assert.equal(await prisma.articuloBorrador.count({ where: { articuloId: a1.id } }), 0, "el borrador de cambios se borró");
  const sitioCambiado = await sitio(ruta1);
  assert.ok(sitioCambiado.texto.includes("Texto cambiado de la prueba") && sitioCambiado.texto.includes("Título cambiado"), "el sitio muestra los cambios");
  assert.equal((await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: aplicados.json["version"] })).estado, 409, "ya no hay cambios");
  assert.equal((await api("POST", `/articulos/${a2.id}/publicar-cambios`, { version: "x" })).estado, 409, "sin borrador de cambios");
  const bor = await crear(`${prefijo} Solo borrador`);
  assert.equal((await api("POST", `/articulos/${bor.id}/publicar-cambios`, { version: bor.version })).estado, 409, "un borrador se publica entero");

  // ---------- Despublicar ----------
  assert.equal((await api("POST", `/articulos/${bor.id}/despublicar`, { version: bor.version })).estado, 409, "un borrador no está publicado");
  const vPend = await guardar(a1.id, aplicados.json["version"], datosCompletos(`${prefijo} Con cambios pendientes`, { cuerpo: doc(P(T("Otro texto."))) }));
  const noDespub = await api("POST", `/articulos/${a1.id}/despublicar`, { version: vPend });
  assert.equal(noDespub.estado, 422);
  assert.match(problemasDe(noDespub), /cambios sin publicar/);
  assert.equal((await api("DELETE", `/articulos/${a1.id}/borrador`)).estado, 200);
  const vPub = (await leer(a1.id))["version"];
  assert.equal((await api("POST", `/articulos/${a1.id}/despublicar`, { version: "2000-01-01T00:00:00.000Z" })).estado, 409);
  const despub = await api("POST", `/articulos/${a1.id}/despublicar`, { version: vPub });
  assert.equal(despub.estado, 200, despub.texto);
  const fila1c = await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id } });
  assert.equal(fila1c.estado, "BORRADOR");
  assert.equal(fila1c.slug, fila1.slug, "conserva la dirección");
  assert.equal(fila1c.publicadoEn!.toISOString(), fila1.publicadoEn!.toISOString(), "y la fecha");
  assert.equal((await sitio(ruta1)).estado, 404, "ya no se ve en el sitio");
  assert.equal((await leer(a1.id))["estado"], "BORRADOR");
  assert.equal((await api("POST", `/articulos/${a1.id}/despublicar`, { version: despub.json["version"] })).estado, 409, "ya está despublicado");
  // Volver a publicarlo: sale en la misma URL, con la fecha original
  const rev = await api("GET", `/articulos/${a1.id}/publicacion`);
  assert.equal(rev.json["publicadoOriginal"], fila1.publicadoEn!.toISOString(), "propone mantener la fecha original");
  assert.equal(rev.json["slugPropuesto"], fila1.slug, "y la misma dirección");
  const repub = await publicar(a1.id, despub.json["version"]);
  assert.equal(repub.estado, 200, repub.texto.slice(0, 300));
  assert.equal(repub.json["ruta"], ruta1, "la misma URL");
  assert.equal((await sitio(ruta1)).estado, 200);

  // ---------- Cambiar la dirección de uno que ya estuvo publicado: la URL vieja redirige ----------
  const despub2 = await api("POST", `/articulos/${a1.id}/despublicar`, { version: repub.json["version"] });
  assert.equal(despub2.estado, 200);
  const nuevoSlug = `pubtest-${sufijo}-direccion-nueva`;
  const vSlug = await guardar(a1.id, despub2.json["version"], datosCompletos(tituloNuevo, { slug: nuevoSlug }));
  const conOtra = await publicar(a1.id, vSlug);
  assert.equal(conOtra.estado, 200, conOtra.texto.slice(0, 300));
  const ruta1Nueva = rutaArticulo({ slug: nuevoSlug, publicadoEn: fila1.publicadoEn! });
  assert.equal(conOtra.json["ruta"], ruta1Nueva);
  assert.equal((await sitio(ruta1Nueva)).estado, 200);
  const viejaR = await sitio(ruta1);
  assert.equal(viejaR.estado, 301, "la URL vieja redirige");
  assert.equal(viejaR.cabeceras["location"], ruta1Nueva);
  const red = await prisma.redireccion.findUniqueOrThrow({ where: { origen: ruta1 } });
  assert.deepEqual([red.tipo, red.codigo, red.articuloId], ["SLUG_ANTERIOR", 301, a1.id]);
  // Y si vuelve a la dirección original, la redirección propia sobra y se borra; la intermedia redirige
  const despub3 = await api("POST", `/articulos/${a1.id}/despublicar`, { version: conOtra.json["version"] });
  const vVuelta = await guardar(a1.id, despub3.json["version"], datosCompletos(tituloNuevo, { slug: fila1.slug }));
  const vuelta = await publicar(a1.id, vVuelta);
  assert.equal(vuelta.estado, 200, vuelta.texto.slice(0, 300));
  assert.equal(await prisma.redireccion.count({ where: { origen: ruta1 } }), 0, "la redirección que apuntaba a la URL actual se borró");
  assert.equal((await sitio(ruta1)).estado, 200);
  const intermedia = await sitio(ruta1Nueva);
  assert.equal(intermedia.estado, 301);
  assert.equal(intermedia.cabeceras["location"], ruta1);

  // ---------- La URL nueva no puede pisar la de otro artículo ----------
  const titulo3 = `${prefijo} Otro más`;
  const a3 = await crear(titulo3);
  const v3 = await guardar(a3.id, a3.version, datosCompletos(titulo3, { slug: `pubtest-${sufijo}-choque` }));
  const fechaFija = "2021-03-04T12:00:00.000Z";
  const rutaChoque = rutaArticulo({ slug: `pubtest-${sufijo}-choque`, publicadoEn: new Date(fechaFija) });
  await prisma.redireccion.create({ data: { origen: rutaChoque, tipo: "SLUG_ANTERIOR", codigo: 301, articuloId: a2.id } });
  const choque = await publicar(a3.id, v3, { publicadoEn: fechaFija });
  assert.equal(choque.estado, 422);
  assert.match(problemasDe(choque), /la usó antes otro artículo/);
  const sinChoque = await publicar(a3.id, v3, { publicadoEn: "2021-03-05T12:00:00.000Z" });
  assert.equal(sinChoque.estado, 200, "con otra fecha sí");

  // ---------- El estado viejo PROGRAMADO de la base también se entiende ----------
  await prisma.articulo.update({ where: { id: a3.id }, data: { estado: "PROGRAMADO" } });
  assert.equal((await leer(a3.id))["estado"], "PROGRAMADO");
  assert.equal((await lista(`?estado=PROGRAMADO&q=${encodeURIComponent(prefijo)}`))["articulos"].some((x: J) => x.id === a3.id), true);

  // ---------- Pedidos mal armados ----------
  assert.equal((await api("POST", "/articulos/999999/publicar", { version: "x" })).estado, 404);
  assert.equal((await api("POST", "/articulos/abc/despublicar", { version: "x" })).estado, 404);
  assert.equal((await api("GET", "/articulos/999999/publicacion")).estado, 404);
  assert.equal((await api("POST", `/articulos/${bor.id}/publicar`, {})).estado, 422, "falta la versión");
  assert.equal((await api("POST", `/articulos/${bor.id}/despublicar`, "esto no es json")).estado, 400);

  // ---------- No se tocó nada que no fuera de la prueba ----------
  const despues = await prisma.articulo.findUniqueOrThrow({ where: { id: antes.id }, select: { actualizadoEn: true, titulo: true } });
  assert.equal(despues.actualizadoEn.toISOString(), antes.actualizadoEn.toISOString(), "un artículo migrado no cambió");
  assert.equal(await prisma.articulo.count({ where: { titulo: { not: { startsWith: prefijo } } } }), totalAntes, "no apareció ni desapareció ningún otro artículo");

  console.log("OK: publicar, programar, publicar cambios y despublicar funcionan contra evaristo_cms_dev, y el sitio muestra lo que corresponde (publicado se ve; programado y despublicado, 404; dirección cambiada, 301).");
} finally {
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  await prisma.usuario.deleteMany({ where: { email } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
