// Prueba de la subida y el borrado de imágenes del panel (POST y DELETE /api/admin/imagenes) con la base de verdad, SOLO contra evaristo_cms_dev.
// Las imágenes se arman con sharp (con EXIF, perfil de color, formatos válidos e inválidos) y se guardan en una carpeta temporal.
// Crea un usuario, artículos e imágenes temporales y los borra al terminar. No toca las imágenes de la muestra.
//
// Uso: npm run test:admin-subida
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { claveParaSubida, nombreOriginalLimpio } from "../admin/procesar-imagen.js";
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
const email = `prueba-subida-${sufijo}@ejemplo.org`;
const clave = "clave-de-prueba-larga-1";
const dirSubidas = mkdtempSync(join(tmpdir(), "evaristo-subidas-"));
const dirMedia = mkdtempSync(join(tmpdir(), "evaristo-muestra-"));
const imagenesCreadas: number[] = [];
const articulosCreados: number[] = [];
let server: Server | undefined;
let servidorSinCarpeta: Server | undefined;

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const archivosSubidos = () => readdirSync(dirSubidas).filter((f) => !f.startsWith("."));

// ---------- Imágenes de prueba ----------
const colorBase = { r: 200, g: 40, b: 40 };
/** 200 × 100 con la orientación EXIF 6 (se ve de 100 × 200), la marca de la cámara, un dato de ubicación y el perfil de color Display P3. */
const jpegConExif = await sharp({ create: { width: 200, height: 100, channels: 3, background: colorBase } })
  .withIccProfile("p3")
  .withMetadata({ orientation: 6 })
  .withExifMerge({ IFD0: { Make: "CamaraDePrueba" }, IFD3: { GPSLatitudeRef: "S" } })
  .jpeg()
  .toBuffer();
const metaOriginal = await sharp(jpegConExif).metadata();
assert.equal(metaOriginal.orientation, 6, "la imagen de prueba trae la orientación EXIF");
assert.ok(metaOriginal.exif, "la imagen de prueba trae EXIF");
const png = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();
const webp = await sharp({ create: { width: 50, height: 50, channels: 3, background: colorBase } }).webp().toBuffer();
const gif = await sharp({ create: { width: 30, height: 20, channels: 3, background: colorBase } }).gif().toBuffer();
const gifAnimado = await sharp([gif, await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } } }).gif().toBuffer()], { join: { animated: true } } as never).gif({ loop: 0, delay: [100, 100] } as never).toBuffer();
const metaAnimado = await sharp(gifAnimado, { animated: true }).metadata();
const gigante = await sharp({ create: { width: 8001, height: 10, channels: 3, background: colorBase } }).png().toBuffer();
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>');
const html = Buffer.from("<html><body><script>alert(1)</script></body></html>");
const roto = jpegConExif.subarray(0, Math.floor(jpegConExif.length / 2));

// ---------- Pedidos ----------
function multipart(campo: string, nombre: string, contenido: Buffer): { cuerpo: Buffer; tipo: string } {
  const limite = `----evaristo${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const cabeza = Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${campo}"; filename="${nombre}"\r\nContent-Type: application/octet-stream\r\n\r\n`, "utf8");
  const cola = Buffer.from(`\r\n--${limite}--\r\n`);
  return { cuerpo: Buffer.concat([cabeza, contenido, cola]), tipo: `multipart/form-data; boundary=${limite}` };
}

try {
  try {
    await prisma.imagen.count();
  } catch (e) {
    fallar(`no se puede leer evaristo_cms_dev: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  await prisma.usuario.create({ data: { email, nombre: "Prueba de subida", rol: "EDITOR", passwordHash: await hashearClave(clave) }, select: { id: true } });
  const escuchar = (opciones: Parameters<typeof crearApp>[1]) =>
    new Promise<Server>((listo) => {
      const s = crearApp(prisma, opciones).listen(0, "127.0.0.1", () => listo(s));
    });
  server = await escuchar({ dirMedia, dirSubidas });
  servidorSinCarpeta = await escuchar({ dirMedia, dirSubidas: undefined });
  const puerto = (server.address() as AddressInfo).port;
  const puertoSin = (servidorSinCarpeta.address() as AddressInfo).port;

  const pedir = (metodo: string, ruta: string, opciones: { cuerpo?: Buffer | string; tipo?: string; cookie?: string; puerto?: number } = {}) =>
    new Promise<{ estado: number; json: J; texto: string; buffer: Buffer; cabeceras: Record<string, any>; cookie: string | undefined }>((resolver, rechazar) => {
      const datos = typeof opciones.cuerpo === "string" ? Buffer.from(opciones.cuerpo) : opciones.cuerpo;
      const cabeceras: Record<string, string> = {};
      if (datos) {
        cabeceras["Content-Type"] = opciones.tipo ?? "application/json";
        cabeceras["Content-Length"] = String(datos.length);
      }
      if (opciones.cookie) cabeceras["Cookie"] = opciones.cookie;
      const req = request({ host: "127.0.0.1", port: opciones.puerto ?? puerto, method: metodo, path: ruta, headers: cabeceras }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          const buffer = Buffer.concat(partes);
          const texto = buffer.toString("utf8");
          let json: J = {};
          try {
            json = JSON.parse(texto) as J;
          } catch {
            /* no es JSON */
          }
          const set = res.headers["set-cookie"];
          resolver({ estado: res.statusCode ?? 0, json, texto, buffer, cabeceras: res.headers, cookie: Array.isArray(set) ? set[0] : set });
        });
      });
      req.on("error", rechazar);
      if (datos) req.write(datos);
      req.end();
    });

  // Sin sesión no se sube ni se borra
  const mp0 = multipart("archivo", "a.png", png);
  assert.equal((await pedir("POST", "/api/admin/imagenes", { cuerpo: mp0.cuerpo, tipo: mp0.tipo })).estado, 401);
  assert.equal((await pedir("DELETE", "/api/admin/imagenes/1")).estado, 401);

  const ingreso = await pedir("POST", "/api/auth/ingresar", { cuerpo: JSON.stringify({ email, clave }) });
  assert.equal(ingreso.estado, 200);
  const cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(ingreso.cookie ?? "")?.[1] ?? ""}`;
  const subir = (nombre: string, contenido: Buffer, campo = "archivo", p?: number) => {
    const m = multipart(campo, nombre, contenido);
    return pedir("POST", "/api/admin/imagenes", { cuerpo: m.cuerpo, tipo: m.tipo, cookie, ...(p ? { puerto: p } : {}) });
  };
  const registrar = (r: { json: J }) => {
    if (r.json["imagen"]?.id) imagenesCreadas.push(r.json["imagen"].id);
  };
  const totalAntes = await prisma.imagen.count();

  // ---------- Pedidos mal armados ----------
  const sinArchivo = await pedir("POST", "/api/admin/imagenes", { cuerpo: "{}", cookie });
  assert.equal(sinArchivo.estado, 400);
  assert.match(sinArchivo.json["mensaje"], /Elegí una imagen/);
  const campoMal = await subir("a.png", png, "otro");
  assert.equal(campoMal.estado, 400, "un campo con otro nombre se rechaza");
  assert.match(campoMal.json["mensaje"], /una sola imagen/i);
  assert.equal((await subir("a.png", Buffer.alloc(0))).estado, 400, "un archivo vacío");
  const sinCarpeta = await subir("a.png", png, "archivo", puertoSin);
  assert.equal(sinCarpeta.estado, 503, "sin carpeta de subidas configurada");
  assert.match(sinCarpeta.json["mensaje"], /no está configurada/);

  // ---------- Archivos que no se aceptan ----------
  const svgR = await subir("dibujo.jpg", svg);
  assert.equal(svgR.estado, 415, "un SVG con nombre .jpg se rechaza por su contenido");
  assert.match(svgR.json["mensaje"], /JPEG, PNG, WebP o GIF/);
  const htmlR = await subir("pagina.png", html);
  assert.ok([415, 422].includes(htmlR.estado), `un HTML con nombre .png se rechaza (dio ${htmlR.estado})`);
  assert.ok(!/script|alert/i.test(htmlR.texto), "el rechazo no repite el contenido del archivo");
  const rotoR = await subir("roto.jpg", roto);
  assert.equal(rotoR.estado, 422, "un JPEG cortado");
  assert.match(rotoR.json["mensaje"], /No se pudo/);
  const gigR = await subir("enorme.png", gigante);
  assert.equal(gigR.estado, 422, "más de 8000 píxeles de ancho");
  assert.match(gigR.json["mensaje"], /8000 píxeles/);
  const pesada = await subir("pesada.jpg", Buffer.concat([jpegConExif, Buffer.alloc(11 * 1024 * 1024, 7)]));
  assert.equal(pesada.estado, 413, "más de 10 MB");
  assert.match(pesada.json["mensaje"], /10 MB/);
  assert.equal(archivosSubidos().length, 0, "nada de lo rechazado quedó guardado");
  assert.equal(await prisma.imagen.count(), totalAntes, "nada de lo rechazado quedó en la base");

  // ---------- Un JPEG con EXIF, rotación y perfil de color ----------
  const nombre = "Foto de Prueba ÁÉ.JPG";
  const j = await subir(nombre, jpegConExif);
  assert.equal(j.estado, 201, j.texto.slice(0, 200));
  registrar(j);
  assert.equal(j.json["repetida"], false);
  const img = j.json["imagen"];
  assert.deepEqual(Object.keys(img).sort(), ["alto", "ancho", "clave", "id", "nombreOriginal"]);
  assert.equal(img.nombreOriginal, nombre, "el nombre con tildes llega bien (multer lo lee como latin1)");
  assert.match(img.clave, /^foto-de-prueba-ae-[0-9a-f]{12}\.jpg$/, img.clave);
  assert.deepEqual([img.ancho, img.alto], [100, 200], "se aplicó la rotación de la foto (200 × 100 con orientación 6 se ve de 100 × 200)");
  const guardado = readFileSync(join(dirSubidas, img.clave));
  const metaGuardado = await sharp(guardado).metadata();
  assert.equal(metaGuardado.exif, undefined, "no quedó EXIF (cámara, GPS, fechas)");
  assert.equal(metaGuardado.orientation, undefined, "no quedó la orientación");
  assert.ok(metaGuardado.icc, "se conservó el perfil de color");
  assert.deepEqual([metaGuardado.width, metaGuardado.height], [100, 200]);
  assert.ok(!guardado.includes(Buffer.from("CamaraDePrueba")), "la marca de la cámara no está en el archivo");
  const fila = await prisma.imagen.findUniqueOrThrow({ where: { id: img.id } });
  assert.equal(fila.tipoMime, "image/jpeg");
  assert.equal(fila.bytes, guardado.length);
  assert.equal(fila.hash, sha(guardado), "el hash es el del archivo guardado");
  assert.equal(fila.wpId, null);
  assert.deepEqual(archivosSubidos(), [img.clave], "un solo archivo, sin temporales");

  // Se sirve desde /media (de la carpeta de subidas)
  const servida = await pedir("GET", `/media/${encodeURIComponent(img.clave)}`);
  assert.equal(servida.estado, 200);
  assert.equal(servida.cabeceras["content-type"], "image/jpeg");
  assert.ok(servida.buffer.equals(guardado));
  assert.equal(servida.cabeceras["etag"], `"${fila.hash}"`);

  // ---------- Repetida: se reusa, no se guarda otra ----------
  const otraVez = await subir("OTRO-nombre.jpg", jpegConExif);
  assert.equal(otraVez.estado, 200);
  assert.equal(otraVez.json["repetida"], true);
  assert.equal(otraVez.json["imagen"].id, img.id, "devuelve la imagen que ya estaba");
  assert.equal(archivosSubidos().length, 1);
  assert.equal(await prisma.imagen.count({ where: { hash: fila.hash } }), 1);

  // ---------- Los otros formatos ----------
  for (const [nombreArchivo, contenido, mime, extension] of [
    ["logo.png", png, "image/png", "png"],
    ["foto.webp", webp, "image/webp", "webp"],
    ["dibujo.gif", gif, "image/gif", "gif"],
  ] as const) {
    const r = await subir(nombreArchivo, contenido);
    assert.equal(r.estado, 201, `${nombreArchivo}: ${r.texto.slice(0, 160)}`);
    registrar(r);
    assert.match(r.json["imagen"].clave, new RegExp(`\\.${extension}$`));
    const f = await prisma.imagen.findUniqueOrThrow({ where: { id: r.json["imagen"].id } });
    assert.equal(f.tipoMime, mime);
    const archivo = readFileSync(join(dirSubidas, f.clave));
    assert.equal(f.hash, sha(archivo));
    assert.equal((await sharp(archivo).metadata()).format, extension === "gif" ? "gif" : extension === "png" ? "png" : "webp");
  }
  // Una imagen animada se guarda tal cual (volver a codificarla rompería la animación)
  if ((metaAnimado.pages ?? 1) > 1) {
    const an = await subir("animado.gif", gifAnimado);
    assert.equal(an.estado, 201, an.texto.slice(0, 160));
    registrar(an);
    const archivoAn = readFileSync(join(dirSubidas, an.json["imagen"].clave));
    assert.ok(archivoAn.equals(gifAnimado), "el GIF animado se guardó sin cambios");
    assert.deepEqual([an.json["imagen"].ancho, an.json["imagen"].alto], [30, 20], "el alto es el de un cuadro, no la suma de todos");
  } else {
    console.log("(aviso: esta versión de sharp no armó un GIF animado de prueba; se omite esa comprobación)");
  }

  // ---------- La biblioteca la lista ----------
  const lista = await pedir("GET", `/api/admin/imagenes?q=${encodeURIComponent("Foto de Prueba")}`, { cookie });
  assert.equal(lista.estado, 200);
  assert.ok(lista.json["imagenes"].some((i: { id: number }) => i.id === img.id), "la imagen subida aparece al buscarla por nombre");

  // ---------- Borrar ----------
  assert.equal((await pedir("DELETE", "/api/admin/imagenes/999999999", { cookie })).estado, 404);
  assert.equal((await pedir("DELETE", "/api/admin/imagenes/abc", { cookie })).estado, 404);

  // Una imagen sin usar se borra, con su archivo
  const sinUso = await subir("sin-uso.png", await sharp({ create: { width: 11, height: 11, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer());
  registrar(sinUso);
  const archivoSinUso = join(dirSubidas, sinUso.json["imagen"].clave);
  assert.ok(existsSync(archivoSinUso));
  const borrada = await pedir("DELETE", `/api/admin/imagenes/${sinUso.json["imagen"].id}`, { cookie });
  assert.equal(borrada.estado, 200, borrada.texto);
  assert.ok(!existsSync(archivoSinUso), "se borró el archivo");
  assert.equal(await prisma.imagen.count({ where: { id: sinUso.json["imagen"].id } }), 0, "se borró la fila");
  assert.equal((await pedir("GET", `/media/${encodeURIComponent(sinUso.json["imagen"].clave)}`)).estado, 404);
  assert.equal((await pedir("DELETE", `/api/admin/imagenes/${sinUso.json["imagen"].id}`, { cookie })).estado, 404, "borrarla de nuevo da 404");

  // Una imagen en uso no se borra: en el texto, en el encabezado, y en el borrador de cambios de un publicado
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { interna: false }, select: { id: true } });
  const cuerpoCon = (imagenId: number) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }, { type: "imagen", attrs: { imagenId, src: "/media/x.jpg", alt: "Algo" } }] });
  const articulo = await prisma.articulo.create({
    data: { slug: `prueba-subida-${sufijo}`, titulo: "Artículo de la prueba de subida", cuerpo: cuerpoCon(img.id) as never, textoPlano: "Hola", estado: "BORRADOR", seccionId: seccion.id },
    select: { id: true },
  });
  articulosCreados.push(articulo.id);
  const enCuerpo = await pedir("DELETE", `/api/admin/imagenes/${img.id}`, { cookie });
  assert.equal(enCuerpo.estado, 409, "en uso en el cuerpo");
  assert.match(enCuerpo.json["mensaje"], /Artículo de la prueba de subida/);
  assert.match(enCuerpo.json["mensaje"], /el texto del artículo/);
  assert.equal(enCuerpo.json["usos"][0].tipo, "cuerpo");
  assert.ok(existsSync(join(dirSubidas, img.clave)), "el archivo sigue ahí");
  assert.equal(await prisma.imagen.count({ where: { id: img.id } }), 1);

  // Sacada del cuerpo y puesta de encabezado
  await prisma.articulo.update({ where: { id: articulo.id }, data: { cuerpo: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }] } as never, imagenEncabezadoId: img.id } });
  const enEncabezado = await pedir("DELETE", `/api/admin/imagenes/${img.id}`, { cookie });
  assert.equal(enEncabezado.estado, 409, "en uso como encabezado");
  assert.match(enEncabezado.json["mensaje"], /la imagen principal/);
  await prisma.articulo.update({ where: { id: articulo.id }, data: { imagenEncabezadoId: null } });

  // Solo en el borrador de cambios de un artículo publicado (el sitio todavía no la muestra, pero se perdería al publicar)
  const publicado = await prisma.articulo.create({
    data: { slug: `prueba-subida-pub-${sufijo}`, titulo: "Publicado de la prueba de subida", cuerpo: { type: "doc", content: [] } as never, textoPlano: "", estado: "PUBLICADO", publicadoEn: new Date("2020-01-01T00:00:00Z"), seccionId: seccion.id },
    select: { id: true, actualizadoEn: true },
  });
  articulosCreados.push(publicado.id);
  await prisma.articuloBorrador.create({ data: { articuloId: publicado.id, baseVersion: publicado.actualizadoEn, datos: { titulo: "x", cuerpo: cuerpoCon(img.id), imagenEncabezadoId: null } as never } });
  const enBorrador = await pedir("DELETE", `/api/admin/imagenes/${img.id}`, { cookie });
  assert.equal(enBorrador.estado, 409, "en uso solo en un borrador de cambios");
  assert.match(enBorrador.json["mensaje"], /cambios sin publicar/);
  await prisma.articuloBorrador.update({ where: { articuloId: publicado.id }, data: { datos: { titulo: "x", cuerpo: { type: "doc", content: [] }, imagenEncabezadoId: img.id } as never } });
  assert.equal((await pedir("DELETE", `/api/admin/imagenes/${img.id}`, { cookie })).estado, 409, "en uso como encabezado de un borrador de cambios");
  await prisma.articuloBorrador.delete({ where: { articuloId: publicado.id } });

  // Con varios usos, el mensaje los resume
  for (let i = 0; i < 4; i++) {
    const extra = await prisma.articulo.create({
      data: { slug: `prueba-subida-extra${i}-${sufijo}`, titulo: `Extra ${i}`, cuerpo: cuerpoCon(img.id) as never, textoPlano: "", estado: "BORRADOR", seccionId: seccion.id },
      select: { id: true },
    });
    articulosCreados.push(extra.id);
  }
  const varios = await pedir("DELETE", `/api/admin/imagenes/${img.id}`, { cookie });
  assert.equal(varios.estado, 409);
  assert.match(varios.json["mensaje"], /y 1 más/, varios.json["mensaje"]); // 4 usos: se nombran 3 y se resume el resto
  await prisma.articulo.deleteMany({ where: { id: { in: articulosCreados } } });
  articulosCreados.length = 0;

  // Sin usos, ahora sí
  const final = await pedir("DELETE", `/api/admin/imagenes/${img.id}`, { cookie });
  assert.equal(final.estado, 200, final.texto);
  assert.ok(!existsSync(join(dirSubidas, img.clave)));
  imagenesCreadas.splice(imagenesCreadas.indexOf(img.id), 1);

  // Los archivos que no están en la carpeta de subidas (la muestra) no se tocan: se borra la fila y el archivo queda
  const claveMuestra = `muestra-${sufijo}.png`;
  writeFileSync(join(dirMedia, claveMuestra), png);
  const filaMuestra = await prisma.imagen.create({ data: { clave: claveMuestra, nombreOriginal: claveMuestra, tipoMime: "image/png", ancho: 64, alto: 32, bytes: png.length, hash: sha(png) }, select: { id: true } });
  imagenesCreadas.push(filaMuestra.id);
  assert.equal((await pedir("GET", `/media/${claveMuestra}`)).estado, 200, "/media también sirve lo de la carpeta de la muestra");
  assert.equal((await pedir("DELETE", `/api/admin/imagenes/${filaMuestra.id}`, { cookie })).estado, 200);
  assert.ok(existsSync(join(dirMedia, claveMuestra)), "el archivo de la muestra no se borró");
  imagenesCreadas.splice(imagenesCreadas.indexOf(filaMuestra.id), 1);

  // ---------- Funciones auxiliares ----------
  assert.equal(nombreOriginalLimpio(Buffer.from("Ángel – foto.jpg", "utf8").toString("latin1")), "Ángel – foto.jpg", "nombre con tildes mal decodificado por multer");
  assert.equal(nombreOriginalLimpio("Ángel.jpg"), "Ángel.jpg", "un nombre ya bien decodificado queda igual");
  assert.equal(nombreOriginalLimpio("C:\\fotos\\..\\secreto\\a.jpg"), "a.jpg", "sin carpetas");
  assert.equal(nombreOriginalLimpio("a\u0000b\n.jpg"), "ab.jpg", "sin caracteres de control");
  assert.equal(nombreOriginalLimpio(undefined), "imagen");
  assert.equal(nombreOriginalLimpio("x".repeat(400) + ".jpg").length, 255);
  assert.equal(claveParaSubida("../../Raro: ñandú & Cía?.png", "abcdef0123456789".repeat(4), "png"), "raro-nandu-cia-abcdef012345.png");
  assert.equal(claveParaSubida("....", "0123456789abcdef".repeat(4), "jpg"), "imagen-0123456789ab.jpg");
  assert.ok(!claveParaSubida("a/b\\c.jpg", "f".repeat(64), "jpg").includes("/"), "la clave es un solo tramo");

  console.log(`OK: la subida y el borrado de imágenes funcionan contra evaristo_cms_dev (tipo por contenido, rotación y metadatos, límites, repetidas, usos y archivos).`);
} finally {
  await prisma.articulo.deleteMany({ where: { slug: { startsWith: `prueba-subida-` } } });
  await prisma.imagen.deleteMany({ where: { id: { in: imagenesCreadas } } });
  await prisma.imagen.deleteMany({ where: { clave: { startsWith: "muestra-" + sufijo } } });
  await prisma.usuario.deleteMany({ where: { email } });
  server?.closeAllConnections();
  server?.close();
  servidorSinCarpeta?.closeAllConnections();
  servidorSinCarpeta?.close();
  rmSync(dirSubidas, { recursive: true, force: true });
  rmSync(dirMedia, { recursive: true, force: true });
  await prisma.$disconnect();
}
void mkdirSync;
void statSync;
