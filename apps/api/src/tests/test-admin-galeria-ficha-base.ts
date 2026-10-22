// Prueba de la galería de imágenes y la ficha técnica del libro en la edición de artículos del panel, con la base de verdad, SOLO contra
// evaristo_cms_dev. Comprueba que se guardan (directo en un borrador y en el borrador de cambios de un publicado), el orden, las validaciones,
// la regla de publicación (cada imagen de la galería con su texto alternativo), el uso de las imágenes al borrarlas y lo que muestra el sitio
// de verdad (la ficha y la galería salen al final de la nota, en ese orden, y solo si hay algo). Crea un usuario y artículos temporales.
//
// Uso: npm run test:admin-galeria-ficha   (hace falta el sitio compilado: npm run build:sitio)
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { rutaArticulo } from "@evaristo/compartido/urls";
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
const prefijo = `Galtest ${sufijo}`;
const email = `prueba-galeria-${sufijo}@ejemplo.org`;
const clave = "clave-de-prueba-larga-1";
let server: Server | undefined;

const T = (text: string): J => ({ type: "text", text });
const doc = (...content: J[]): J => ({ type: "doc", content: content.length ? content : [{ type: "paragraph", content: [T("Texto del artículo de prueba.")] }] });

try {
  await prisma.usuario.create({ data: { email, nombre: "Prueba de galería", rol: "EDITOR", passwordHash: await hashearClave(clave) }, select: { id: true } });
  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  let cookie: string | undefined;
  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, conCookie = true) =>
    new Promise<{ estado: number; json: J; texto: string; cabeceras: Record<string, any>; cookie: string | undefined }>((resolver, rechazar) => {
      const datos = cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
      const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(conCookie && cookie ? { Cookie: cookie } : {}) } }, (res) => {
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
      });
      req.on("error", rechazar);
      if (datos) req.write(datos);
      req.end();
    });
  const api = (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, `/api/admin${ruta}`, cuerpo);
  const sitio = (ruta: string) => pedir("GET", ruta, undefined, false);
  const ingreso = await pedir("POST", "/api/auth/ingresar", { email, clave }, false);
  assert.equal(ingreso.estado, 200);
  cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(ingreso.cookie ?? "")?.[1] ?? ""}`;

  // ---------- Datos de apoyo ----------
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { interna: false }, orderBy: { id: "asc" }, select: { id: true } });
  const categoria = await prisma.categoria.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } });
  const imagenes = await prisma.imagen.findMany({ orderBy: { id: "asc" }, take: 45, select: { id: true, clave: true, nombreOriginal: true } });
  assert.ok(imagenes.length >= 45, "la base de desarrollo tiene imágenes de sobra");
  const [i1, i2, i3, i4] = imagenes as [(typeof imagenes)[0], (typeof imagenes)[0], (typeof imagenes)[0], (typeof imagenes)[0]];
  const migrado = await prisma.articulo.findFirstOrThrow({ where: { estado: "PUBLICADO", wpId: { not: null } }, orderBy: { id: "asc" }, select: { id: true, actualizadoEn: true } });
  const totalAntes = await prisma.articulo.count();

  const datosBase = (titulo: string, extra: J = {}): J => ({
    titulo,
    bajada: null,
    cuerpo: doc(),
    seccionId: seccion.id,
    categoriaIds: [categoria.id],
    categoriaPrincipalId: categoria.id,
    autorIds: [],
    imagenEncabezadoId: i1.id,
    encabezadoAlt: "Texto alternativo de la imagen principal",
    encabezadoCredito: null,
    encabezadoPuntoFocalX: 0.5,
    encabezadoPuntoFocalY: 0.5,
    galeria: [],
    ficha: null,
    conCapital: false,
    novedadHasta: null,
    ...extra,
  });
  const fichaCompleta = { titulo: "Cien años de soledad", autor: "Gabriel García Márquez", traductor: null, editorial: "Sudamericana", coleccion: "Biblioteca de autor", anio: 1967, paginas: 471, isbn: "978-950-07-0000-0", precio: "$ 25.000" };
  const crear = async (titulo: string) => {
    const r = await api("POST", "/articulos", { titulo, seccionId: seccion.id });
    assert.equal(r.estado, 201, r.texto);
    return { id: r.json["id"] as number, version: r.json["version"] as string };
  };
  const guardar = async (id: number, version: string, datos: J) => {
    const r = await api("PUT", `/articulos/${id}`, { version, datos });
    assert.equal(r.estado, 200, `guardar: ${r.texto.slice(0, 400)}`);
    return r.json["version"] as string;
  };
  const guardarMal = async (id: number, version: string, cambios: J, texto: RegExp) => {
    const r = await api("PUT", `/articulos/${id}`, { version, datos: datosBase("Rechazado", cambios) });
    assert.equal(r.estado, 422, `${JSON.stringify(cambios).slice(0, 100)} dio ${r.estado}: ${r.texto.slice(0, 200)}`);
    assert.match((r.json["problemas"] ?? []).join(" | "), texto);
  };
  const leer = async (id: number) => (await api("GET", `/articulos/${id}`)).json["articulo"] as J;
  const problemasDe = (r: { json: J }) => (r.json["problemas"] ?? []).join(" | ") as string;

  // ---------- Un artículo migrado devuelve la galería y la ficha vacías ----------
  const m = await leer(migrado.id);
  assert.deepEqual(m["datos"].galeria, []);
  assert.equal(m["datos"].ficha, null);
  assert.deepEqual(m["imagenesGaleria"], []);

  // ---------- Guardar en un borrador ----------
  const titulo1 = `${prefijo} Reseña con galería`;
  const a1 = await crear(titulo1);
  let v1 = await guardar(a1.id, a1.version, datosBase(titulo1, { galeria: [{ imagenId: i2.id, alt: "Tapa del libro", epigrafe: "La tapa" }, { imagenId: i3.id, alt: null, epigrafe: null }, { imagenId: i4.id, alt: "  Contratapa  ", epigrafe: "  " }], ficha: fichaCompleta }));
  const filas = await prisma.galeriaItem.findMany({ where: { articuloId: a1.id }, orderBy: { orden: "asc" } });
  assert.deepEqual(filas.map((f) => [f.imagenId, f.orden, f.alt, f.epigrafe]), [[i2.id, 0, "Tapa del libro", "La tapa"], [i3.id, 1, null, null], [i4.id, 2, "Contratapa", ""]], "la galería queda en orden, con los textos recortados");
  const ficha = await prisma.fichaTecnica.findUniqueOrThrow({ where: { articuloId: a1.id } });
  assert.deepEqual(
    [ficha.titulo, ficha.autor, ficha.traductor, ficha.editorial, ficha.coleccion, ficha.anio, ficha.paginas, ficha.isbn, ficha.precio],
    ["Cien años de soledad", "Gabriel García Márquez", null, "Sudamericana", "Biblioteca de autor", 1967, 471, "978-950-07-0000-0", "$ 25.000"],
  );
  // La imagen principal sin alt cuenta como pendiente; las de la galería sin alt también (1 sin texto: i3)
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id }, select: { altPendientes: true } })).altPendientes, 1, "una imagen de la galería sin texto alternativo");
  const g1 = await leer(a1.id);
  assert.deepEqual(g1["datos"].galeria.map((x: J) => x.imagenId), [i2.id, i3.id, i4.id]);
  assert.deepEqual(g1["datos"].ficha, fichaCompleta === null ? null : { ...fichaCompleta });
  assert.deepEqual(g1["imagenesGaleria"].map((x: J) => [x.id, x.clave, x.nombreOriginal]), [i2, i3, i4].map((x) => [x.id, x.clave, x.nombreOriginal]), "con sus miniaturas, en el mismo orden");

  // Reordenar, sacar una y cambiar un texto: las filas se reemplazan, sin duplicar
  v1 = await guardar(a1.id, v1, datosBase(titulo1, { galeria: [{ imagenId: i4.id, alt: "Contratapa", epigrafe: null }, { imagenId: i2.id, alt: "Tapa", epigrafe: "Nuevo epígrafe" }], ficha: { ...fichaCompleta, traductor: "Alguien Más", precio: null } }));
  assert.deepEqual((await prisma.galeriaItem.findMany({ where: { articuloId: a1.id }, orderBy: { orden: "asc" } })).map((f) => [f.imagenId, f.orden, f.alt, f.epigrafe]), [[i4.id, 0, "Contratapa", null], [i2.id, 1, "Tapa", "Nuevo epígrafe"]]);
  assert.equal(await prisma.galeriaItem.count({ where: { articuloId: a1.id } }), 2);
  const ficha2 = await prisma.fichaTecnica.findUniqueOrThrow({ where: { articuloId: a1.id } });
  assert.deepEqual([ficha2.traductor, ficha2.precio], ["Alguien Más", null]);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: a1.id }, select: { altPendientes: true } })).altPendientes, 0, "ya no hay imágenes sin texto alternativo");

  // La ficha en blanco, o con todos los campos vacíos, es lo mismo que no tener ficha
  const blanco = { titulo: "  ", autor: "", traductor: null, editorial: null, coleccion: null, anio: null, paginas: null, isbn: "", precio: " " };
  v1 = await guardar(a1.id, v1, datosBase(titulo1, { galeria: [], ficha: blanco }));
  assert.equal(await prisma.fichaTecnica.count({ where: { articuloId: a1.id } }), 0, "una ficha vacía se borra");
  assert.equal(await prisma.galeriaItem.count({ where: { articuloId: a1.id } }), 0, "y la galería vacía también");
  assert.equal((await leer(a1.id))["datos"].ficha, null);
  v1 = await guardar(a1.id, v1, datosBase(titulo1, { ficha: { ...blanco, titulo: "  Solo el título  " } }));
  assert.equal((await prisma.fichaTecnica.findUniqueOrThrow({ where: { articuloId: a1.id } })).titulo, "Solo el título", "una ficha con un solo campo es válida");

  // ---------- Validaciones ----------
  await guardarMal(a1.id, v1, { galeria: [{ imagenId: i2.id, alt: "a", epigrafe: null }, { imagenId: i2.id, alt: "b", epigrafe: null }] }, /imagen repetida/);
  await guardarMal(a1.id, v1, { galeria: [{ imagenId: 999999999, alt: "a", epigrafe: null }] }, /no está en la biblioteca/);
  await guardarMal(a1.id, v1, { galeria: imagenes.slice(0, 41).map((x) => ({ imagenId: x.id, alt: "a", epigrafe: null })) }, /demasiadas imágenes/);
  await guardarMal(a1.id, v1, { galeria: [{ imagenId: i2.id, alt: "x".repeat(2001), epigrafe: null }] }, /texto alternativo de una imagen de la galería es demasiado largo/);
  await guardarMal(a1.id, v1, { galeria: [{ imagenId: i2.id, alt: "a", epigrafe: "x".repeat(1001) }] }, /epígrafe de una imagen de la galería es demasiado largo/);
  await guardarMal(a1.id, v1, { galeria: [{ imagenId: i2.id, alt: "a", epigrafe: null, de_mas: 1 }] }, /./);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, anio: 999 } }, /año del libro no es válido/);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, anio: new Date().getFullYear() + 5 } }, /año del libro no es válido/);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, anio: 1967.5 } }, /año tiene que ser un número entero/);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, paginas: 0 } }, /cantidad de páginas no es válida/);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, isbn: "abc-def" } }, /ISBN solo puede tener números/);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, precio: "x".repeat(51) } }, /precio es demasiado largo/);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, editorial: "x".repeat(256) } }, /editorial es demasiado larga/);
  await guardarMal(a1.id, v1, { ficha: { ...fichaCompleta, campoDeMas: 1 } }, /./);
  await guardarMal(a1.id, v1, { ficha: "no es una ficha" }, /./);
  const sinCambios = await prisma.galeriaItem.count({ where: { articuloId: a1.id } });
  assert.equal(sinCambios, 0, "ninguna validación fallida dejó filas");

  // ---------- Reglas al publicar: cada imagen de la galería con su texto alternativo ----------
  v1 = await guardar(a1.id, v1, datosBase(titulo1, { galeria: [{ imagenId: i2.id, alt: "Tapa", epigrafe: null }, { imagenId: i3.id, alt: null, epigrafe: null }, { imagenId: i4.id, alt: "", epigrafe: null }], ficha: fichaCompleta }));
  const rev = await api("GET", `/articulos/${a1.id}/publicacion`);
  assert.match(problemasDe(rev), /Falta el texto alternativo de 2 imágenes de la galería/);
  const noSale = await api("POST", `/articulos/${a1.id}/publicar`, { version: v1 });
  assert.equal(noSale.estado, 422);
  assert.match(problemasDe(noSale), /2 imágenes de la galería/);
  v1 = await guardar(a1.id, v1, datosBase(titulo1, { galeria: [{ imagenId: i2.id, alt: "Tapa", epigrafe: "La tapa del libro" }, { imagenId: i3.id, alt: "Lomo", epigrafe: null }], ficha: fichaCompleta }));
  const publicada = await api("POST", `/articulos/${a1.id}/publicar`, { version: v1 });
  assert.equal(publicada.estado, 200, publicada.texto.slice(0, 300));
  const ruta1 = publicada.json["ruta"] as string;

  // ---------- Lo que muestra el sitio ----------
  const visto = await sitio(ruta1);
  assert.equal(visto.estado, 200);
  const html = visto.texto;
  assert.ok(html.includes("Ficha técnica"), "el sitio muestra la ficha técnica");
  assert.ok(html.includes("Cien años de soledad") && html.includes("Gabriel García Márquez") && html.includes("Sudamericana") && html.includes("Biblioteca de autor") && html.includes("1967") && html.includes("471") && html.includes("978-950-07-0000-0") && html.includes("$ 25.000"), "con sus campos");
  assert.ok(!html.includes("Traductor"), "los campos vacíos no aparecen");
  assert.ok(html.includes("Galería"), "y la galería");
  assert.ok(html.includes(`/media/${encodeURIComponent(i2.clave)}`) && html.includes(`/media/${encodeURIComponent(i3.clave)}`), "con sus imágenes");
  assert.ok(html.includes('alt="Tapa"') && html.includes('alt="Lomo"') && html.includes("La tapa del libro"), "con su texto alternativo y su epígrafe");
  assert.ok(html.includes("<dialog"), "y el visor ampliado");
  assert.ok(html.indexOf("Ficha técnica") < html.indexOf("Galería"), "la ficha va antes que la galería (orden de la especificación)");
  assert.ok(html.indexOf("Galería") > html.indexOf("Texto del artículo de prueba"), "y las dos van después del texto");

  // Sin ficha ni galería no se muestra nada
  const titulo2 = `${prefijo} Sin nada`;
  const a2 = await crear(titulo2);
  const v2 = await guardar(a2.id, a2.version, datosBase(titulo2));
  const pub2 = await api("POST", `/articulos/${a2.id}/publicar`, { version: v2 });
  assert.equal(pub2.estado, 200, pub2.texto.slice(0, 300));
  const html2 = (await sitio(pub2.json["ruta"])).texto;
  assert.ok(!html2.includes("Ficha técnica") && !html2.includes("galeria-grilla") && !html2.includes("<dialog"), "un artículo sin ficha ni galería no muestra esas secciones");

  // ---------- Uso de las imágenes al borrarlas ----------
  const subida = await prisma.imagen.create({ data: { clave: `galtest-${sufijo}.png`, nombreOriginal: "galtest.png", tipoMime: "image/png", ancho: 10, alto: 10, bytes: 10, hash: "a".repeat(63) + "b" }, select: { id: true } });
  const enGaleria = await api("DELETE", `/imagenes/${i2.id}`);
  assert.equal(enGaleria.estado, 409, "una imagen de la galería no se borra");
  assert.match(enGaleria.json["mensaje"], /la galería del artículo/);

  // ---------- Un publicado: la galería y la ficha van al borrador de cambios ----------
  let vp = (await leer(a1.id))["version"];
  const nuevaFicha = { ...fichaCompleta, editorial: "Otra Editorial" };
  vp = await guardar(a1.id, vp, datosBase(`${prefijo} Reseña con galería`, { galeria: [{ imagenId: i3.id, alt: "Lomo", epigrafe: null }, { imagenId: subida.id, alt: "Nueva imagen", epigrafe: "Una nueva" }], ficha: nuevaFicha }));
  assert.deepEqual((await prisma.galeriaItem.findMany({ where: { articuloId: a1.id }, orderBy: { orden: "asc" } })).map((f) => f.imagenId), [i2.id, i3.id], "lo publicado no cambia");
  assert.equal((await prisma.fichaTecnica.findUniqueOrThrow({ where: { articuloId: a1.id } })).editorial, "Sudamericana");
  const sitioViejo = (await sitio(ruta1)).texto;
  assert.ok(sitioViejo.includes("Sudamericana") && !sitioViejo.includes("Otra Editorial"), "el sitio sigue mostrando lo publicado");
  const pendiente = await leer(a1.id);
  assert.equal(pendiente["conCambiosSinPublicar"], true);
  assert.deepEqual(pendiente["datos"].galeria.map((x: J) => x.imagenId), [i3.id, subida.id], "el panel ve el borrador de cambios");
  assert.deepEqual(pendiente["imagenesGaleria"].map((x: J) => x.id), [i3.id, subida.id]);
  // La imagen que solo está en el borrador de cambios tampoco se borra
  const enBorrador = await api("DELETE", `/imagenes/${subida.id}`);
  assert.equal(enBorrador.estado, 409, "una imagen que solo está en el borrador de cambios de la galería");
  assert.match(enBorrador.json["mensaje"], /cambios sin publicar/);
  // Publicar los cambios aplica la galería y la ficha
  const aplicados = await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: vp });
  assert.equal(aplicados.estado, 200, aplicados.texto.slice(0, 300));
  assert.deepEqual((await prisma.galeriaItem.findMany({ where: { articuloId: a1.id }, orderBy: { orden: "asc" } })).map((f) => [f.imagenId, f.orden, f.alt, f.epigrafe]), [[i3.id, 0, "Lomo", null], [subida.id, 1, "Nueva imagen", "Una nueva"]]);
  assert.equal((await prisma.fichaTecnica.findUniqueOrThrow({ where: { articuloId: a1.id } })).editorial, "Otra Editorial");
  assert.ok((await sitio(ruta1)).texto.includes("Otra Editorial"), "el sitio muestra los cambios publicados");

  // En un publicado, una imagen nueva de la galería sin texto alternativo no se publica, pero una que ya venía sin texto sí puede seguir
  await prisma.galeriaItem.updateMany({ where: { articuloId: a1.id, imagenId: i3.id }, data: { alt: null } });
  let vq = (await leer(a1.id))["version"];
  vq = await guardar(a1.id, vq, datosBase(`${prefijo} Reseña con galería`, { galeria: [{ imagenId: i3.id, alt: null, epigrafe: "Se sigue sin texto" }, { imagenId: subida.id, alt: "Nueva imagen", epigrafe: null }], ficha: nuevaFicha }));
  assert.equal((await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: vq })).estado, 200, "una imagen que ya estaba sin texto alternativo (migrada) puede seguir así");
  vq = (await leer(a1.id))["version"];
  vq = await guardar(a1.id, vq, datosBase(`${prefijo} Reseña con galería`, { galeria: [{ imagenId: i3.id, alt: null, epigrafe: null }, { imagenId: i4.id, alt: null, epigrafe: null }], ficha: nuevaFicha }));
  const nueva = await api("POST", `/articulos/${a1.id}/publicar-cambios`, { version: vq });
  assert.equal(nueva.estado, 422);
  assert.match(problemasDe(nueva), /Falta el texto alternativo de una imagen de la galería/, "solo cuenta la nueva (i4), no la que ya venía así");

  // ---------- Un borrador de cambios viejo, sin galería ni ficha, no las borra al publicarse ----------
  const titulo3 = `${prefijo} Borrador viejo`;
  const a3 = await crear(titulo3);
  let v3 = await guardar(a3.id, a3.version, datosBase(titulo3, { galeria: [{ imagenId: i2.id, alt: "Tapa", epigrafe: null }], ficha: fichaCompleta }));
  const pub3 = await api("POST", `/articulos/${a3.id}/publicar`, { version: v3 });
  assert.equal(pub3.estado, 200, pub3.texto.slice(0, 300));
  const fila3 = await prisma.articulo.findUniqueOrThrow({ where: { id: a3.id }, select: { actualizadoEn: true } });
  const { galeria: _g, ficha: _f, ...sinGaleria } = datosBase(`${titulo3} (cambiado)`);
  await prisma.articuloBorrador.create({ data: { articuloId: a3.id, baseVersion: fila3.actualizadoEn, datos: sinGaleria as never } });
  const completo = await leer(a3.id);
  assert.deepEqual(completo["datos"].galeria.map((x: J) => x.imagenId), [i2.id], "el panel completa lo que le falta al borrador con lo publicado");
  assert.equal(completo["datos"].ficha.titulo, "Cien años de soledad");
  v3 = completo["version"];
  assert.equal((await api("POST", `/articulos/${a3.id}/publicar-cambios`, { version: v3 })).estado, 200);
  assert.equal(await prisma.galeriaItem.count({ where: { articuloId: a3.id } }), 1, "la galería no se borró");
  assert.equal(await prisma.fichaTecnica.count({ where: { articuloId: a3.id } }), 1, "ni la ficha");
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: a3.id } })).titulo, `${titulo3} (cambiado)`);

  // ---------- Despublicar y borrar el artículo no dejan nada suelto ----------
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  assert.equal(await prisma.galeriaItem.count({ where: { articuloId: { in: [a1.id, a2.id, a3.id] } } }), 0, "la galería se borra con el artículo");
  assert.equal(await prisma.fichaTecnica.count({ where: { articuloId: { in: [a1.id, a2.id, a3.id] } } }), 0, "y la ficha también");

  // ---------- No se tocó nada que no fuera de la prueba ----------
  const despues = await prisma.articulo.findUniqueOrThrow({ where: { id: migrado.id }, select: { actualizadoEn: true } });
  assert.equal(despues.actualizadoEn.toISOString(), migrado.actualizadoEn.toISOString(), "un artículo migrado no cambió");
  assert.equal(await prisma.articulo.count({ where: { titulo: { not: { startsWith: prefijo } } } }), totalAntes, "no apareció ni desapareció ningún otro artículo");
  void rutaArticulo;

  console.log("OK: la galería y la ficha técnica se guardan, se validan, se publican y se ven en el sitio contra evaristo_cms_dev (borrador, publicado con borrador de cambios, orden, repetidas, usos de las imágenes y regla del texto alternativo).");
} finally {
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  await prisma.imagen.deleteMany({ where: { clave: { startsWith: `galtest-${sufijo}` } } });
  await prisma.usuario.deleteMany({ where: { email } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
