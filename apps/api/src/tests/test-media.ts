// Pruebas de la ruta /media/<clave> (src/media.ts) sin base de datos: archivos temporales y un buscador falso.
// Levanta un servidor HTTP efímero en 127.0.0.1 con puerto asignado por el sistema y lo cierra al terminar.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import sharp from "sharp";
import { claveDeUrlMedia, srcsetDeUrl, srcsetMedia } from "@evaristo/compartido/urls";
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

// Imágenes reales para las variantes de tamaño (decisión 83).
const color = (width: number, height: number, r = 200) => sharp({ create: { width, height, channels: 3, background: { r, g: 60, b: 30 } } });
const GRANDE = await color(1000, 500).jpeg().toBuffer();
const CHICA = await color(300, 200).png().toBuffer();
const WEBP = await color(900, 900).webp().toBuffer();
// Guardada como 800 × 400 con orientación 6: se ve de 400 × 800.
const GIRADA = await color(800, 400).jpeg().withMetadata({ orientation: 6 }).toBuffer();
const GIF = await color(700, 300).gif().toBuffer();
const ANIMADA = await sharp([await color(700, 700).png().toBuffer(), await color(700, 700, 20).png().toBuffer()], { join: { animated: true } }).webp().toBuffer();
const reales: Record<string, Buffer> = {
  "grande.jpg": GRANDE,
  "chica.png": CHICA,
  "cuadrada.webp": WEBP,
  "girada.jpg": GIRADA,
  "quieta.gif": GIF,
  "animada.webp": ANIMADA,
  "chica-sin-ancho.png": CHICA,
  "hash-raro.jpg": GRANDE,
};
for (const [nombre, contenido] of Object.entries(reales)) writeFileSync(join(dir, nombre), contenido);
const dirVariantes = mkdtempSync(join(tmpdir(), "evaristo-variantes-"));
rmSync(dirVariantes, { recursive: true }); // la crea la ruta en la primera variante
const variantesEnDisco = () => (existsSync(dirVariantes) ? readdirSync(dirVariantes) : []);
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
  { clave: "grande.jpg", tipoMime: "image/jpeg", hash: "2".repeat(64), ancho: 1000 },
  { clave: "chica.png", tipoMime: "image/png", hash: "3".repeat(64), ancho: 300 },
  { clave: "cuadrada.webp", tipoMime: "image/webp", hash: "4".repeat(64), ancho: 900 },
  { clave: "girada.jpg", tipoMime: "image/jpeg", hash: "5".repeat(64), ancho: 400 },
  { clave: "quieta.gif", tipoMime: "image/gif", hash: "6".repeat(64), ancho: 700 },
  { clave: "animada.webp", tipoMime: "image/webp", hash: "7".repeat(64), ancho: 700 },
  { clave: "chica-sin-ancho.png", tipoMime: "image/png", hash: "8".repeat(64) },
  { clave: "hash-raro.jpg", tipoMime: "image/jpeg", hash: "../../x" },
];
// La base real compara con una colación laxa (sin mayúsculas ni tildes): el falso devuelve candidatas parecidas.
const normalizar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const buscar = async (clave: string) => filas.filter((f) => normalizar(f.clave) === normalizar(clave));

async function servidor(dirMedia: string | undefined, conVariantes = false): Promise<{ server: Server; puerto: number }> {
  const app = express();
  app.use("/media", crearManejadorMedia({ buscar, dirMedia, ...(conVariantes ? { dirVariantes } : {}) }));
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
const conVariantes = await servidor(dir, true);
const get = (ruta: string, cab?: Record<string, string>) => pedir(principal.puerto, "GET", ruta, cab);
const getV = (ruta: string, cab?: Record<string, string>) => pedir(conVariantes.puerto, "GET", ruta, cab);
const medidas = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return { ancho: m.width, alto: m.height, formato: m.format, orientacion: m.orientation };
};

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

// ---------- Variantes de tamaño (?w=N, decisión 83) ----------

const H = (c: string) => c.repeat(64);

t("variante: ?w=640 achica, se guarda con el hash y la segunda vez sale del disco", async () => {
  const r = await getV("/media/grande.jpg?w=640");
  assert.equal(r.estado, 200);
  assert.match(String(r.cabeceras["content-type"]), /^image\/jpeg/);
  assert.equal(r.cabeceras["etag"], `"${H("2")}-w640"`);
  assert.equal(r.cabeceras["cache-control"], "public, max-age=86400");
  assert.equal(r.cabeceras["x-content-type-options"], "nosniff");
  assert.deepEqual(await medidas(r.cuerpo), { ancho: 640, alto: 320, formato: "jpeg", orientacion: undefined });
  const archivo = join(dirVariantes, `${H("2")}-w640.jpg`);
  assert.ok(existsSync(archivo));
  const antes = statSync(archivo).mtimeMs;
  const otra = await getV("/media/grande.jpg?w=640");
  assert.deepEqual(otra.cuerpo, r.cuerpo);
  assert.equal(statSync(archivo).mtimeMs, antes);
});
t("variante: el WebP conserva su formato", async () => {
  const r = await getV("/media/cuadrada.webp?w=480");
  assert.match(String(r.cabeceras["content-type"]), /^image\/webp/);
  assert.deepEqual(await medidas(r.cuerpo), { ancho: 480, alto: 480, formato: "webp", orientacion: undefined });
});
t("variante: la orientación EXIF se aplica y se quita (se ve de 400 × 800)", async () => {
  const r = await getV("/media/girada.jpg?w=320");
  assert.deepEqual(await medidas(r.cuerpo), { ancho: 320, alto: 640, formato: "jpeg", orientacion: undefined });
});
t("variante: If-None-Match con su ETag da 304 sin generarla", async () => {
  const r = await getV("/media/grande.jpg?w=320", { "If-None-Match": `"${H("2")}-w320"` });
  assert.equal(r.estado, 304);
  assert.equal(r.cuerpo.length, 0);
  assert.ok(!variantesEnDisco().includes(`${H("2")}-w320.jpg`));
});
t("variante: HEAD da los encabezados de la variante sin cuerpo", async () => {
  const r = await pedir(conVariantes.puerto, "HEAD", "/media/grande.jpg?w=800");
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.length, 0);
  assert.equal(r.cabeceras["etag"], `"${H("2")}-w800"`);
});
t("variante: anchos no permitidos o repetidos dan 400", async () => {
  for (const q of ["w=500", "w=0", "w=-640", "w=abc", "w=", "w=0640", "w=640.0", "w=640&w=800", "w=99999999999"]) {
    const r = await getV(`/media/grande.jpg?${q}`);
    assert.equal(r.estado, 400, q);
    assert.match(r.cuerpo.toString(), /Ancho no permitido/, q);
  }
});
t("variante: si la imagen ya es igual o más chica, sale el original (con o sin ancho guardado) y no se guarda nada", async () => {
  const antes = variantesEnDisco().length;
  const casos: Array<[string, Buffer, string]> = [
    ["/media/chica.png?w=480", CHICA, "3"],
    ["/media/chica.png?w=320", CHICA, "3"],
    ["/media/chica-sin-ancho.png?w=320", CHICA, "8"],
    ["/media/grande.jpg?w=2000", GRANDE, "2"],
  ];
  for (const [ruta, bytes, hash] of casos) {
    const r = await getV(ruta);
    assert.equal(r.estado, 200, ruta);
    assert.deepEqual(r.cuerpo, bytes, ruta);
    assert.equal(r.cabeceras["etag"], `"${H(hash)}"`, ruta);
  }
  assert.equal(variantesEnDisco().length, antes);
});
t("variante: los GIF y las imágenes animadas se sirven tal cual", async () => {
  assert.deepEqual((await getV("/media/quieta.gif?w=320")).cuerpo, GIF);
  for (let i = 0; i < 2; i++) {
    const r = await getV("/media/animada.webp?w=320");
    assert.deepEqual(r.cuerpo, ANIMADA);
    assert.equal(r.cabeceras["etag"], `"${H("7")}"`);
  }
  assert.ok(!variantesEnDisco().some((n) => n.startsWith("6") || n.startsWith("7")));
});
t("variante: si sharp no puede leer el archivo, sale el original", async () => {
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const r = await getV("/media/foto.jpg?w=320");
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo, JPG);
  } finally {
    console.error = errorOriginal;
  }
});
t("variante: un hash que no es hexadecimal no se usa como nombre de archivo", async () => {
  const r = await getV("/media/hash-raro.jpg?w=320");
  assert.deepEqual(r.cuerpo, GRANDE);
  assert.ok(!variantesEnDisco().some((n) => !/^[0-9a-f]{64}-w\d+\.(jpg|png|webp)$/.test(n)));
});
t("variante: pedidos simultáneos generan un solo archivo y no dejan temporales", async () => {
  const respuestas = await Promise.all(Array.from({ length: 6 }, () => getV("/media/grande.jpg?w=480")));
  for (const r of respuestas) {
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo, respuestas[0]!.cuerpo);
  }
  assert.equal((await medidas(respuestas[0]!.cuerpo)).ancho, 480);
  assert.equal(variantesEnDisco().filter((n) => n.startsWith(`${H("2")}-w480`)).length, 1);
  assert.ok(!variantesEnDisco().some((n) => n.endsWith(".tmp")));
});
t("variante: sin carpeta de variantes, ?w se ignora y sale el original", async () => {
  const r = await get("/media/grande.jpg?w=640");
  assert.equal(r.estado, 200);
  assert.deepEqual(r.cuerpo, GRANDE);
  assert.equal(r.cabeceras["etag"], `"${H("2")}"`);
});
t("variante: las protecciones de la clave siguen igual con ?w", async () => {
  for (const ruta of ["/media/..%2fevaristo-media-secreto.txt?w=320", "/media/no-existe.jpg?w=320", "/media/pagina.html?w=320", "/media/GRANDE.jpg?w=320"]) {
    const r = await getV(ruta);
    assert.ok(r.estado === 404 || r.estado === 400, `${ruta} dio ${r.estado}`);
    assert.ok(!r.cuerpo.includes("secreto"), ruta);
  }
});
t("srcsetMedia, srcsetDeUrl y claveDeUrlMedia", async () => {
  assert.equal(srcsetMedia("a.jpg", 700), "/media/a.jpg?w=160 160w, /media/a.jpg?w=320 320w, /media/a.jpg?w=480 480w, /media/a.jpg?w=640 640w, /media/a.jpg 700w");
  assert.equal(srcsetMedia("a.jpg", 160), undefined);
  assert.equal(srcsetMedia("a.GIF", 2000), undefined);
  assert.equal(srcsetMedia("a b.png")?.split(", ").length, 8);
  assert.match(srcsetMedia("a b.png")!, /^\/media\/a%20b\.png\?w=160 160w/);
  assert.equal(claveDeUrlMedia("/media/a%20b.png"), "a b.png");
  assert.equal(claveDeUrlMedia("/media/a.png?w=320"), undefined);
  assert.equal(claveDeUrlMedia("https://otro.com/media/a.png"), undefined);
  assert.equal(claveDeUrlMedia("/media/%E0%A4%A"), undefined);
  assert.equal(srcsetDeUrl("https://otro.com/a.png"), undefined);
  assert.equal(srcsetDeUrl("/media/x.jpg", 500), "/media/x.jpg?w=160 160w, /media/x.jpg?w=320 320w, /media/x.jpg?w=480 480w, /media/x.jpg 500w");
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
  for (const s of [principal, sinConfigurar, conVariantes]) {
    s.server.closeAllConnections();
    s.server.close();
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(dirVariantes, { recursive: true, force: true });
  rmSync(join(tmpdir(), "evaristo-media-secreto.txt"), { force: true });
}
if (fallo) {
  console.error("FALLÓ:", fallo);
  process.exit(1);
}
console.log(`\n${ok} pruebas de /media ok`);
