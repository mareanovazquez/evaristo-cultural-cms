// Prueba de la herramienta de imágenes externas (src/herramientas/imagenes-externas.ts, decisión 90), SOLO contra evaristo_cms_dev.
// No usa la red: las descargas son imágenes generadas acá. Crea artículos, filas de imagen y una carpeta temporales y los borra al terminar.
// Comprueba: el reemplazo puro (no toca el cuerpo original, conserva los atributos, quita el píxel), que el ensayo no guarde nada, que la
// escritura cree el archivo y la fila y deje el nodo en /media/ con su imagenId, que baje altPendientes, que un src sin fuente revisada no
// se toque, que repetirla no haga nada, que una imagen igual se reuse y que una descarga fallida se informe.
//
// Uso: npm run test:imagenes-externas
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { obtenerClientePrisma, Prisma } from "@evaristo/compartido/db";
import type { JSONNode } from "@evaristo/compartido/schema";
import { elegirBase } from "../entorno.js";
import { reescribirCuerpo, srcExternos, traerImagenesExternas, type Fuente } from "../herramientas/imagenes-externas.js";

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
const articulos: number[] = [];
let carpeta: string | undefined;
let pruebas = 0;
const ok = (nombre: string) => {
  pruebas++;
  console.log(`ok ${nombre}`);
};

const T = (text: string): JSONNode => ({ type: "text", text });
const P = (...content: JSONNode[]): JSONNode => ({ type: "paragraph", content });
const doc = (...content: JSONNode[]): JSONNode => ({ type: "doc", content });
const img = (src: string, extra: Record<string, unknown> = {}): JSONNode => ({ type: "imagen", attrs: { alt: "Una foto", src, epigrafe: "Epígrafe", decorativa: false, ...extra } });

const EXT = `https://ejemplo.invalid/${sufijo}/foto.jpg`;
const PIXEL = `https://ejemplo.invalid/${sufijo}/pixel.gif`;
const DESCONOCIDA = `https://otro.invalid/${sufijo}/nada.jpg`;
const ROTA = `https://ejemplo.invalid/${sufijo}/rota.jpg`;
const fuentes = new Map<string, Fuente>([
  [EXT, { descarga: `${EXT}?descarga`, nombre: "Foto de prueba.jpg" }],
  [PIXEL, { quitar: true, motivo: "píxel de prueba" }],
  [ROTA, { descarga: `${ROTA}?descarga`, nombre: "rota.jpg" }],
]);
const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: Date.now() % 255, b: 10 } } }).jpeg().toBuffer();
let descargas = 0;
const descargar = async (u: string) => {
  descargas++;
  if (u.startsWith(ROTA)) throw new Error("HTTP 404");
  return jpeg;
};

try {
  // ---------- Puro ----------
  const original = doc(P(T("Hola.")), img(EXT, { imagenId: 99 }), img(PIXEL, { altPendiente: true }), img("/media/x.jpg", { imagenId: 5 }));
  const copia = structuredClone(original);
  const r = reescribirCuerpo(original, new Map([[EXT, { imagenId: 7, clave: "foto-abc.jpg" }]]), new Set([PIXEL]));
  assert.deepEqual(original, copia, "no modifica el cuerpo que recibe");
  assert.equal(r.reemplazados, 1);
  assert.equal(r.quitados, 1);
  assert.deepEqual(r.cuerpo, doc(P(T("Hola.")), { type: "imagen", attrs: { alt: "Una foto", src: "/media/foto-abc.jpg", imagenId: 7, epigrafe: "Epígrafe", decorativa: false } }, img("/media/x.jpg", { imagenId: 5 })));
  assert.deepEqual(srcExternos(original), [EXT, PIXEL]);
  ok("reemplazo puro: conserva los atributos, pone imagenId, quita el píxel y no toca el original");

  // ---------- Con base ----------
  carpeta = await mkdtemp(join(tmpdir(), "externas-"));
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { interna: false }, select: { id: true } });
  const crear = async (n: string, cuerpo: JSONNode, altPendientes: number) => {
    const a = await prisma.articulo.create({ data: { slug: `externas-${sufijo}-${n}`, titulo: `Externas ${n}`, cuerpo: cuerpo as Prisma.InputJsonValue, textoPlano: "Hola.", estado: "BORRADOR", seccionId: seccion.id, altPendientes }, select: { id: true } });
    articulos.push(a.id);
    return a.id;
  };
  const a1 = await crear("1", doc(P(T("Hola.")), img(EXT), img(PIXEL, { alt: "", altPendiente: true }), img(DESCONOCIDA)), 1);
  const opciones = { prisma, carpeta, descargar, fuentes, articuloIds: articulos, log: () => undefined };

  const ensayo = await traerImagenesExternas({ ...opciones, escribir: false });
  assert.equal(ensayo.articulos, 1);
  assert.equal(ensayo.nodos, 3);
  assert.deepEqual(ensayo.sinFuente, [{ articuloId: a1, src: DESCONOCIDA }]);
  assert.equal(ensayo.fallidas.length, 0);
  assert.deepEqual(await readdir(carpeta), [], "el ensayo no crea archivos");
  assert.equal(await prisma.imagen.count({ where: { nombreOriginal: "Foto de prueba.jpg" } }), 0, "el ensayo no crea filas");
  const sinTocar = await prisma.articulo.findUniqueOrThrow({ where: { id: a1 }, select: { cuerpo: true } });
  assert.equal(srcExternos(sinTocar.cuerpo as JSONNode).length, 3, "el ensayo no cambia el cuerpo");
  ok("ensayo: informa lo que haría (y el src sin fuente revisada) sin guardar nada");

  const escrito = await traerImagenesExternas({ ...opciones, escribir: true });
  assert.equal(escrito.imagenesCreadas, 1);
  assert.equal(escrito.articulosCambiados, 1);
  const fila = await prisma.imagen.findFirstOrThrow({ where: { nombreOriginal: "Foto de prueba.jpg" }, orderBy: { id: "desc" }, select: { id: true, clave: true, tipoMime: true, ancho: true, alto: true } });
  assert.match(fila.clave, /^foto-de-prueba-[0-9a-f]{12}\.jpg$/);
  assert.deepEqual([fila.tipoMime, fila.ancho, fila.alto], ["image/jpeg", 40, 30]);
  assert.ok((await readFile(join(carpeta, fila.clave))).length > 0, "el archivo quedó en la carpeta");
  const despues = await prisma.articulo.findUniqueOrThrow({ where: { id: a1 }, select: { cuerpo: true, altPendientes: true } });
  const nodos = ((despues.cuerpo as JSONNode).content ?? []).filter((n) => n.type === "imagen");
  assert.equal(nodos.length, 2, "el píxel se quitó");
  assert.deepEqual(nodos[0]!.attrs, { alt: "Una foto", src: `/media/${fila.clave}`, imagenId: fila.id, epigrafe: "Epígrafe", decorativa: false });
  assert.equal(nodos[1]!.attrs?.["src"], DESCONOCIDA, "el src sin fuente revisada no se toca");
  assert.equal(despues.altPendientes, 0, "altPendientes baja con el píxel quitado");
  ok("escritura: archivo, fila, nodo en /media/ con imagenId, píxel quitado y altPendientes al día");

  const repetida = await traerImagenesExternas({ ...opciones, escribir: true });
  assert.deepEqual([repetida.imagenesCreadas, repetida.articulosCambiados, repetida.nodos], [0, 0, 1], "repetirla no cambia nada (solo queda el src sin fuente)");
  ok("repetirla no hace nada");

  const a2 = await crear("2", doc(img(EXT)), 0);
  const reuso = await traerImagenesExternas({ ...opciones, articuloIds: [a2], escribir: true });
  assert.deepEqual([reuso.imagenesCreadas, reuso.imagenesReusadas, reuso.articulosCambiados], [0, 1, 1]);
  const c2 = await prisma.articulo.findUniqueOrThrow({ where: { id: a2 }, select: { cuerpo: true } });
  assert.equal((c2.cuerpo as JSONNode).content![0]!.attrs?.["imagenId"], fila.id, "la misma imagen se reusa");
  ok("una imagen con el mismo contenido se reusa (no se duplica)");

  const a3 = await crear("3", doc(img(ROTA)), 0);
  const antes = descargas;
  const rota = await traerImagenesExternas({ ...opciones, articuloIds: [a3], escribir: false });
  assert.equal(descargas, antes + 1);
  assert.deepEqual(rota.fallidas, [{ src: ROTA, error: "HTTP 404" }]);
  ok("una descarga fallida se informa");

  console.log(`\n${pruebas} pruebas de imágenes externas pasaron`);
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
} finally {
  await prisma.articulo.deleteMany({ where: { id: { in: articulos } } }).catch(() => undefined);
  await prisma.imagen.deleteMany({ where: { nombreOriginal: { in: ["Foto de prueba.jpg", "rota.jpg"] }, clave: { startsWith: "foto-de-prueba-" } } }).catch(() => undefined);
  if (carpeta) await rm(carpeta, { recursive: true, force: true });
  await prisma.$disconnect();
}
