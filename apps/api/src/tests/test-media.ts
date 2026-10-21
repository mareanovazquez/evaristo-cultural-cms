// Pruebas de la ruta /media/<clave> (src/media.ts) sin base de datos: archivos temporales y un buscador falso.
// Levanta un servidor HTTP efímero en 127.0.0.1 con puerto asignado por el sistema y lo cierra al terminar.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { crearManejadorMedia, type FilaImagen } from "../media.js";

let ok = 0;
const pruebas: Array<[string, () => Promise<void>]> = [];
const t = (name: string, fn: () => Promise<void>) => pruebas.push([name, fn]);

const dir = mkdtempSync(join(tmpdir(), "evaristo-media-"));
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
const CLAVE_RARA = "La_vuelta_del_malón_-_Ángel & Cão (1).jpg";
const archivos: Record<string, Buffer> = { "foto.jpg": JPG, "dibujo.png": PNG, [CLAVE_RARA]: JPG, ".oculto.jpg": JPG, "pagina.html": Buffer.from("<script>alert(1)</script>") };
for (const [nombre, contenido] of Object.entries(archivos)) writeFileSync(join(dir, nombre), contenido);
mkdirSync(join(dir, "carpeta.jpg"));
writeFileSync(join(tmpdir(), "evaristo-media-secreto.txt"), "secreto");

const filas: FilaImagen[] = [
  { clave: "foto.jpg", tipoMime: "image/jpeg", hash: "a".repeat(64) },
  { clave: "dibujo.png", tipoMime: "image/png", hash: "b".repeat(64) },
  { clave: CLAVE_RARA, tipoMime: "image/jpeg", hash: "c".repeat(64) },
  { clave: ".oculto.jpg", tipoMime: "image/jpeg", hash: "d".repeat(64) },
  { clave: "pagina.html", tipoMime: "text/html", hash: "e".repeat(64) },
  { clave: "carpeta.jpg", tipoMime: "image/jpeg", hash: "f".repeat(64) },
  { clave: "falta.jpg", tipoMime: "image/jpeg", hash: "0".repeat(64) },
  { clave: "Mayus.JPG", tipoMime: "image/jpeg", hash: "1".repeat(64) },
];
// La base real compara con una colación laxa (sin mayúsculas ni tildes): el falso devuelve candidatas parecidas.
const normalizar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const buscar = async (clave: string) => filas.filter((f) => normalizar(f.clave) === normalizar(clave));

async function servidor(dirMedia: string | undefined): Promise<{ server: Server; puerto: number }> {
  const app = express();
  app.use("/media", crearManejadorMedia({ buscar, dirMedia }));
  const server = await new Promise<Server>((listo) => {
    const s = app.listen(0, "127.0.0.1", () => listo(s));
  });
  return { server, puerto: (server.address() as AddressInfo).port };
}

interface Respuesta {
  estado: number;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo: Buffer;
}
function pedir(puerto: number, metodo: string, ruta: string, cabeceras: Record<string, string> = {}): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: cabeceras }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p: Buffer) => partes.push(p));
      res.on("end", () => resolver({ estado: res.statusCode ?? 0, cabeceras: res.headers, cuerpo: Buffer.concat(partes) }));
    });
    req.on("error", rechazar);
    req.end();
  });
}

const principal = await servidor(dir);
const sinConfigurar = await servidor(undefined);
const get = (ruta: string, cab?: Record<string, string>) => pedir(principal.puerto, "GET", ruta, cab);

t("GET de una imagen: 200, bytes, tipo, nosniff, caché y ETag", async () => {
  const r = await get("/media/foto.jpg");
  assert.equal(r.estado, 200);
  assert.deepEqual(r.cuerpo, JPG);
  assert.match(String(r.cabeceras["content-type"]), /^image\/jpeg/);
  assert.equal(r.cabeceras["x-content-type-options"], "nosniff");
  assert.equal(r.cabeceras["cache-control"], "public, max-age=86400");
  assert.equal(r.cabeceras["etag"], `"${"a".repeat(64)}"`);
  const png = await get("/media/dibujo.png");
  assert.match(String(png.cabeceras["content-type"]), /^image\/png/);
});
t("HEAD: mismos encabezados y sin cuerpo", async () => {
  const r = await pedir(principal.puerto, "HEAD", "/media/foto.jpg");
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.length, 0);
  assert.equal(r.cabeceras["etag"], `"${"a".repeat(64)}"`);
  assert.equal(r.cabeceras["content-length"], String(JPG.length));
});
t("If-None-Match con el ETag: 304 sin cuerpo; con otro ETag: 200", async () => {
  const etag = `"${"a".repeat(64)}"`;
  const r = await get("/media/foto.jpg", { "If-None-Match": etag });
  assert.equal(r.estado, 304);
  assert.equal(r.cuerpo.length, 0);
  assert.equal((await get("/media/foto.jpg", { "If-None-Match": `"otro", ${etag}` })).estado, 304);
  assert.equal((await get("/media/foto.jpg", { "If-None-Match": '"otro"' })).estado, 200);
});
t("clave con tildes, espacios, & y paréntesis, codificada con encodeURIComponent", async () => {
  const r = await get(`/media/${encodeURIComponent(CLAVE_RARA)}`);
  assert.equal(r.estado, 200);
  assert.deepEqual(r.cuerpo, JPG);
});
t("sin fila, o con la clave parecida pero no igual (mayúsculas, tildes): 404", async () => {
  for (const ruta of ["/media/no-existe.jpg", "/media/FOTO.jpg", "/media/foto.JPG", "/media/mayus.jpg", `/media/${encodeURIComponent("La_vuelta_del_malon_-_Angel & Cao (1).jpg")}`]) {
    assert.equal((await get(ruta)).estado, 404, ruta);
  }
});
t("clave con fila pero archivo ausente, carpeta, archivo oculto o tipo no permitido: 404", async () => {
  for (const ruta of ["/media/falta.jpg", "/media/carpeta.jpg", "/media/.oculto.jpg", "/media/pagina.html"]) {
    const r = await get(ruta);
    assert.equal(r.estado, 404, ruta);
    assert.ok(!String(r.cabeceras["content-type"]).startsWith("image/"), ruta);
    assert.notEqual(r.cuerpo.toString(), "<script>alert(1)</script>");
  }
});
t("intentos de salir de la carpeta: 404 sin leer nada fuera", async () => {
  for (const ruta of [
    "/media/..",
    "/media/%2e%2e",
    "/media/../evaristo-media-secreto.txt",
    "/media/..%2fevaristo-media-secreto.txt",
    "/media/..%2Fevaristo-media-secreto.txt",
    "/media/%2e%2e%2fevaristo-media-secreto.txt",
    "/media/..%5cevaristo-media-secreto.txt",
    "/media/%5c..%5c",
    "/media/a/b.jpg",
    "/media/foto.jpg/",
    "/media/foto.jpg%00.png",
    "/media/%00",
    "/media/",
    "/media",
    "/media/.",
  ]) {
    const r = await get(ruta);
    assert.ok(r.estado === 404 || r.estado === 400, `${ruta} dio ${r.estado}`);
    assert.ok(!r.cuerpo.includes("secreto"), ruta);
  }
});
t("codificación inválida: 400", async () => {
  assert.equal((await get("/media/%E0%A4%A")).estado, 400);
  assert.equal((await get("/media/%")).estado, 400);
});
t("otros métodos: 405 con Allow", async () => {
  for (const metodo of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await pedir(principal.puerto, metodo, "/media/foto.jpg");
    assert.equal(r.estado, 405, metodo);
    assert.equal(r.cabeceras["allow"], "GET, HEAD");
  }
});
t("sin MEDIA_DIR: 503", async () => {
  const r = await pedir(sinConfigurar.puerto, "GET", "/media/foto.jpg");
  assert.equal(r.estado, 503);
  assert.match(r.cuerpo.toString(), /MEDIA_DIR/);
});

let fallo: unknown;
try {
  for (const [name, fn] of pruebas) {
    await fn();
    ok++;
    console.log("ok", name);
  }
} catch (e) {
  fallo = e;
} finally {
  principal.server.closeAllConnections();
  sinConfigurar.server.closeAllConnections();
  principal.server.close();
  sinConfigurar.server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(tmpdir(), "evaristo-media-secreto.txt"), { force: true });
}
if (fallo) {
  console.error("FALLÓ:", fallo);
  process.exit(1);
}
console.log(`\n${ok} pruebas de /media ok`);
