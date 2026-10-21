// Comprueba /media/<clave> contra la base real (evaristo_cms, 3308) y la carpeta de originales.
// Solo lee: la ruta hace findMany sobre `imagenes` y esta prueba lee `articulos`. Pasa por crearApp, como en producción.
//
// Uso: npm run test:media-originales -- --originales="C:\ruta\a\originales"   (o con MEDIA_DIR en el entorno)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { crearApp } from "../app.js";

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

const arg = process.argv.find((a) => a.startsWith("--originales="))?.slice("--originales=".length);
const dirMedia = arg ?? process.env["MEDIA_DIR"];
if (!dirMedia) fallar("falta la carpeta de originales: --originales=<carpeta> o MEDIA_DIR");

const url = process.env["DATABASE_URL"] ? new URL(process.env["DATABASE_URL"]) : undefined;
if (!url) fallar("falta DATABASE_URL en el .env");
if (url.port !== "3308" || decodeURIComponent(url.pathname.slice(1)) !== "evaristo_cms") {
  fallar(`DATABASE_URL apunta a ${url.hostname}:${url.port}${url.pathname}; esta prueba solo corre contra evaristo_cms en el 3308`);
}

const prisma = obtenerClientePrisma();
let server: Server | undefined;
try {
  let imagenes;
  try {
    imagenes = await prisma.imagen.findMany({ select: { clave: true, tipoMime: true, hash: true, bytes: true } });
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
  const articulos = await prisma.articulo.findMany({ select: { wpId: true, cuerpo: true } });

  const app = crearApp(prisma, { dirMedia });
  server = await new Promise<Server>((listo) => {
    const s = app.listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;

  const pedir = (ruta: string) =>
    new Promise<{ estado: number; tipo: string | undefined; cuerpo: Buffer }>((resolver, rechazar) => {
      const req = request({ host: "127.0.0.1", port: puerto, path: ruta }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => resolver({ estado: res.statusCode ?? 0, tipo: res.headers["content-type"], cuerpo: Buffer.concat(partes) }));
      });
      req.on("error", rechazar);
      req.end();
    });

  // 1) Cada fila de `imagenes`: 200, bytes, SHA-256 y tipo iguales a los de la base
  const problemas: string[] = [];
  for (const im of imagenes) {
    const r = await pedir(`/media/${encodeURIComponent(im.clave)}`);
    if (r.estado !== 200) problemas.push(`${im.clave}: estado ${r.estado}`);
    else if (createHash("sha256").update(r.cuerpo).digest("hex") !== im.hash) problemas.push(`${im.clave}: el SHA-256 no coincide`);
    else if (r.cuerpo.length !== im.bytes) problemas.push(`${im.clave}: ${r.cuerpo.length} bytes, la base dice ${im.bytes}`);
    else if (!r.tipo?.startsWith(im.tipoMime)) problemas.push(`${im.clave}: tipo ${r.tipo}, la base dice ${im.tipoMime}`);
  }
  console.log(`Biblioteca: ${imagenes.length - problemas.length} de ${imagenes.length} imágenes sirven con bytes, SHA-256 y tipo correctos.`);

  // 2) Cada src /media/... de los cuerpos de los artículos
  let srcs = 0;
  const sueltos: string[] = [];
  const recorrer = (wpId: number | null, n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] } | undefined): void => {
    if (!n || typeof n !== "object") return;
    const src = n.attrs?.["src"];
    if (n.type === "imagen" && typeof src === "string") {
      srcs++;
      sueltos.push(`${wpId}\t${src}`);
    }
    (n.content as Array<typeof n> | undefined)?.forEach((h) => recorrer(wpId, h));
  };
  for (const a of articulos) recorrer(a.wpId, a.cuerpo as Parameters<typeof recorrer>[1]);
  for (const linea of sueltos) {
    const [wpId, src] = linea.split("\t") as [string, string];
    if (!src.startsWith("/media/")) {
      problemas.push(`${wpId}: src fuera de /media/: ${src}`);
      continue;
    }
    const r = await pedir(src);
    if (r.estado !== 200) problemas.push(`${wpId}: ${src} dio ${r.estado}`);
  }
  console.log(`Cuerpos: ${srcs} imágenes en ${articulos.length} artículos, ${srcs - problemas.filter((p) => /^\d+: /.test(p)).length} resuelven con 200.`);

  // 3) Una clave que no existe y un intento de salir de la carpeta
  assert.equal((await pedir("/media/no-existe-xyz.jpg")).estado, 404);
  assert.equal((await pedir("/media/..%2f..%2f.env")).estado, 404);
  console.log("404 para una clave inexistente y para un intento de salir de la carpeta.");

  if (problemas.length) fallar(`${problemas.length} problemas:\n  - ${problemas.slice(0, 30).join("\n  - ")}`);
  console.log("\nOK: /media sirve todas las imágenes de la base y de los 35 artículos.");
} finally {
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
