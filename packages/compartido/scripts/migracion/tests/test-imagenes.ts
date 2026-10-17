// Pruebas de scripts/migracion/lib/imagenes.ts y lib/enlaces-imagenes.ts. Las mediciones usan archivos SINTÉTICOS en un directorio
// temporal que se borra al terminar: no dependen de la carpeta de originales.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertWpPost } from "../../../src/conversor/convert.ts";
import { armar } from "../lib/armar.ts";
import type { EntradaArmar } from "../lib/armar.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
import { crearMedidor, medirImagenes, nodosImagen, resolverImagen, srcDeClave, verificarEnlacesCuerpo } from "../lib/imagenes.ts";
import type { Medicion } from "../lib/imagenes.ts";
import type { AdjuntoSnapshot, MetaSnapshot, PostSnapshot } from "../lib/snapshot-tipos.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };

// ---------------------------------------------------------------------------------------------------------------
// Imágenes sintéticas mínimas (solo lo que lee el medidor)
// ---------------------------------------------------------------------------------------------------------------
const jpeg = (ancho: number, alto: number) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14, 0),
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 255, ancho >> 8, ancho & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
  Buffer.alloc(32, 7),
]);
const png = (ancho: number, alto: number) => {
  const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4, "latin1"); ihdr.writeUInt32BE(ancho, 8); ihdr.writeUInt32BE(alto, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(16, 1)]);
};
const gif = (ancho: number, alto: number) => { const b = Buffer.alloc(20, 2); b.write("GIF89a", 0, "latin1"); b.writeUInt16LE(ancho, 6); b.writeUInt16LE(alto, 8); return b; };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const carpeta = mkdtempSync(join(tmpdir(), "evaristo-imagenes-"));
try {
  const J = jpeg(640, 480), P = png(300, 200), G = gif(32, 16);
  writeFileSync(join(carpeta, "foto.jpg"), J);
  writeFileSync(join(carpeta, "grafico.png"), P);
  writeFileSync(join(carpeta, "animada.gif"), G);
  writeFileSync(join(carpeta, "miente.jpg"), P);                       // contenido PNG con extensión .jpg
  writeFileSync(join(carpeta, "roto.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));  // JPEG truncado
  writeFileSync(join(carpeta, "ilegible.jpg"), Buffer.from("esto no es una imagen"));
  writeFileSync(join(carpeta, "formato.webp"), Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]));
  writeFileSync(join(carpeta, "Mayus.jpg"), J);
  writeFileSync(join(carpeta, "Cão.png"), P);                         // nombre en disco en NFC
  writeFileSync(join(carpeta, "Mañana.png".normalize("NFD")), G);     // nombre en disco en NFD
  mkdirSync(join(carpeta, "2020", "05"), { recursive: true });
  mkdirSync(join(carpeta, "sub"));
  writeFileSync(join(carpeta, "sub", "dentro.jpg"), J);
  writeFileSync(join(carpeta, "2020", "05", "anidada.jpg"), jpeg(10, 20));

  const medir = crearMedidor(carpeta);

  t("T10: JPEG, PNG y GIF sintéticos: hash, bytes, MIME y dimensiones salen del contenido", () => {
    assert.deepEqual(medir("foto.jpg"), { estado: "medida", archivo: "foto.jpg", diferenciaDeNombre: null, bytes: J.length, sha256: sha(J), mime: "image/jpeg", ancho: 640, alto: 480 });
    assert.deepEqual(medir("grafico.png"), { estado: "medida", archivo: "grafico.png", diferenciaDeNombre: null, bytes: P.length, sha256: sha(P), mime: "image/png", ancho: 300, alto: 200 });
    assert.deepEqual(medir("animada.gif"), { estado: "medida", archivo: "animada.gif", diferenciaDeNombre: null, bytes: G.length, sha256: sha(G), mime: "image/gif", ancho: 32, alto: 16 });
    const anidada = medir("2020/05/anidada.jpg");
    assert.equal(anidada.estado, "medida");
    assert.deepEqual([anidada.ancho, anidada.alto], [10, 20]);
  });

  t("T10: el MIME sale del contenido aunque la extensión mienta", () => {
    const m = medir("miente.jpg");
    assert.equal(m.estado, "medida");
    assert.equal(m.mime, "image/png");
    assert.deepEqual([m.ancho, m.alto], [300, 200]);
  });

  t("T10: archivo corrupto, ilegible o de formato no soportado -> ilegible (imagen_sin_medir)", () => {
    for (const nombre of ["roto.jpg", "ilegible.jpg", "formato.webp"]) {
      const m = medir(nombre);
      assert.equal(m.estado, "ilegible", nombre);
      assert.equal(m.ancho, null);
      assert.ok(m.motivo, nombre);
    }
    assert.equal(medir("formato.webp").mime, "image/webp");
    assert.match(medir("formato.webp").motivo!, /no soportado/);
    assert.equal(medir("ilegible.jpg").mime, null);
    const mediciones = medirImagenes(carpeta, ["roto.jpg", "foto.jpg", "no-esta.jpg"]);
    assert.equal(resolverImagen("roto.jpg", mediciones).codigo, "imagen_sin_medir");
    assert.equal(resolverImagen("foto.jpg", mediciones).codigo, "con_fila");
    assert.equal(resolverImagen("no-esta.jpg", mediciones).codigo, "original_faltante");
    assert.equal(resolverImagen(null, mediciones).codigo, "original_faltante");
    assert.throws(() => resolverImagen("sin-medir.jpg", mediciones), /Falta la medición/);
  });

  t("T10: ausente -> original faltante, sin hash ni bytes", () => {
    for (const clave of ["no-esta.jpg", "2020/06/nada.jpg", "carpeta-que-no-existe/x.jpg"]) {
      assert.deepEqual(medir(clave), { estado: "original faltante", archivo: null, diferenciaDeNombre: null, bytes: null, sha256: null, mime: null, ancho: null, alto: null });
    }
  });

  t("T10: un nombre con otra capitalización NO se abre", () => {
    for (const clave of ["foto.JPG", "FOTO.jpg", "mayus.jpg", "MAYUS.JPG", "2020/05/Anidada.jpg", "2020/05/ANIDADA.JPG"]) {
      const m = medir(clave);
      assert.equal(m.estado, "original faltante", clave);
      assert.equal(m.sha256, null, clave);
      assert.equal(m.bytes, null, clave);
      assert.equal(m.archivo, null, clave);
    }
    assert.equal(medir("mayus.jpg").diferenciaDeNombre, "mayusculas");
    assert.equal(medir("mayus.jpg").archivoConOtraCapitalizacion, "Mayus.jpg");
    assert.equal(medir("Mayus.jpg").estado, "medida");
    // la carpeta también es sensible a mayúsculas
    assert.equal(medir("2020/05/anidada.jpg").estado, "medida");
    assert.equal(medir("sub/dentro.jpg").estado, "medida");
    assert.equal(medir("SUB/dentro.jpg").estado, "original faltante");
    assert.equal(medir("Sub/dentro.jpg").estado, "original faltante");
  });

  t("T10: clave NFD -> se compara en NFC y se abre; la clave de la medición queda en NFC", () => {
    const nfd = "Cão.png".normalize("NFD");
    assert.notEqual(nfd, "Cão.png");
    const m = medir(nfd);
    assert.equal(m.estado, "medida");
    assert.equal(m.diferenciaDeNombre, "normalizacion_unicode");
    assert.equal(m.archivo, "Cão.png");
    // y al revés: el archivo está en NFD en disco y la clave llega en NFC
    const inverso = medir("Mañana.png");
    assert.equal(inverso.estado, "medida");
    assert.equal(inverso.diferenciaDeNombre, "normalizacion_unicode");
    const mediciones = medirImagenes(carpeta, [nfd, "Cão.png"]);
    assert.deepEqual([...mediciones.keys()], ["Cão.png"], "las dos formas son la misma clave NFC");
    assert.equal(resolverImagen(nfd, mediciones).codigo, "con_fila");
    assert.equal((resolverImagen(nfd, mediciones) as { clave: string }).clave, "Cão.png");
  });

  t("T10: claves con trucos de ruta no se abren", () => {
    writeFileSync(join(carpeta, "..", `fuera-${process.pid}.png`), P);
    try {
      for (const clave of [`../fuera-${process.pid}.png`, "/foto.jpg", "2020/../foto.jpg", "a\\b.jpg", "C:/x.jpg", "", "2020//x.jpg"]) {
        const m = medir(clave);
        assert.notEqual(m.estado, "medida", clave);
        assert.equal(m.sha256, null, clave);
      }
    } finally { rmSync(join(carpeta, "..", `fuera-${process.pid}.png`), { force: true }); }
  });

  // -------------------------------------------------------------------------------------------------------------
  // T15: imágenes del cuerpo
  // -------------------------------------------------------------------------------------------------------------
  t("T15: srcDeClave: percent-encoding por segmento con tildes, espacios y ñ, sin codificar las barras", () => {
    assert.equal(srcDeClave("Cão.png"), "/media/C%C3%A3o.png");
    assert.equal(srcDeClave("Año nuevo.jpg"), "/media/A%C3%B1o%20nuevo.jpg");
    assert.equal(srcDeClave("2020/05/Mi foto ñandú.jpg"), "/media/2020/05/Mi%20foto%20%C3%B1and%C3%BA.jpg");
    assert.equal(srcDeClave("Cão.png".normalize("NFD")), "/media/C%C3%A3o.png", "siempre desde la clave en NFC");
    assert.equal(srcDeClave("La_vuelta_del_malón_-_Ángel.jpg"), "/media/La_vuelta_del_mal%C3%B3n_-_%C3%81ngel.jpg");
  });

  const adjunto = (id: number, clave: string): AdjuntoSnapshot => ({ id, tipoPost: "attachment", mime: "image/jpeg", guid: `http://x/wp-content/uploads/${clave}`, clave, alt: null, ancho: 1, alto: 1, bytes: null });
  const medida = (ancho: number, alto: number): Medicion => ({ estado: "medida", archivo: "x", diferenciaDeNombre: null, bytes: 1000, sha256: "a".repeat(64), mime: "image/jpeg", ancho, alto });
  const faltante: Medicion = { estado: "original faltante", archivo: null, diferenciaDeNombre: null, bytes: null, sha256: null, mime: null, ancho: null, alto: null };
  const base = entradaDesdeSnapshot();
  const sintetica = (contenido: string, adjuntos: AdjuntoSnapshot[], mediciones: Map<string, Medicion>, extra: Partial<EntradaArmar> = {}): EntradaArmar => ({
    ...base, ids: [700], fixture: [], extras: [],
    posts: [{ id: 700, tipo: "post", estado: "publish", autor: 9001, nombre: "post-700", titulo: "Título 700", fecha: "2020-01-02 03:04:05", fechaGmt: "2020-01-02 03:04:05", contenido } satisfies PostSnapshot],
    meta: [] as MetaSnapshot[], terminos: [], usuarios: [{ id: 9001, login: "u", nicename: "autor", nombre: "Autor", bio: null }],
    adjuntos, adjuntoPorClave: adjuntos.map((a) => [a.clave!, a.id] as const), mediciones, ...extra,
  });
  const img = (archivo: string) => `<p><img src="http://evaristocultural.com.ar/wp-content/uploads/${encodeURIComponent(archivo)}" alt="a" /></p>`;
  const nodos = (p: ReturnType<typeof armar>) => nodosImagen(p.articulos[0]!.cuerpo);

  t("T15: el cuerpo recibe imagenWpId y src /media/<clave> (tildes, espacios y ñ), y la fila de imagen sale del plan", () => {
    const adj = [adjunto(9500, "Año nuevo.jpg"), adjunto(9501, "Cão.png"), adjunto(9502, "Mi foto.jpg")];
    const med = new Map<string, Medicion>([["Año nuevo.jpg", medida(30, 20)], ["Cão.png", medida(5, 6)], ["Mi foto.jpg", medida(7, 8)]]);
    const p = armar(sintetica(`<p>Hola</p>${img("Año nuevo.jpg")}${img("Cão.png")}${img("Mi foto.jpg")}${img("Año nuevo.jpg")}`, adj, med));
    assert.deepEqual(p.problemas, []);
    const ns = nodos(p);
    assert.deepEqual(ns.map((n) => [n.attrs!["imagenWpId"], n.attrs!["src"]]), [
      [9500, "/media/A%C3%B1o%20nuevo.jpg"], [9501, "/media/C%C3%A3o.png"], [9502, "/media/Mi%20foto.jpg"], [9500, "/media/A%C3%B1o%20nuevo.jpg"],
    ]);
    assert.ok(ns.every((n) => !("imagenId" in n.attrs!)), "el plan no inventa ids numéricos");
    assert.deepEqual(p.imagenes.map((i) => i.wpId).sort(), [9500, 9501, 9502]);
    assert.deepEqual(p.imagenes.find((i) => i.wpId === 9500)!.articulos, [700]);
    assert.deepEqual(p.articulos[0]!.avisosMigracion?.migracion ?? [], []);
    assert.deepEqual(verificarEnlacesCuerpo(p.articulos[0]!.cuerpo, new Map(p.imagenes.map((i) => [i.wpId, i.clave] as const))), []);
    // lo demás del nodo no se toca (alt, decorativa, epigrafe)
    assert.equal(ns[0]!.attrs!["alt"], "a");
  });

  t("T15: una imagen del cuerpo sin original o sin poder medir queda como está, con aviso y src; el artículo no se excluye", () => {
    const adj = [adjunto(9600, "perdida.jpg"), adjunto(9601, "rota.jpg"), adjunto(9602, "buena.jpg")];
    const med = new Map<string, Medicion>([
      ["perdida.jpg", faltante],
      ["rota.jpg", { ...faltante, estado: "ilegible", archivo: "rota.jpg", bytes: 3, sha256: "b".repeat(64), motivo: "tipo de contenido no reconocido" }],
      ["buena.jpg", medida(1, 1)],
    ]);
    const p = armar(sintetica(`${img("perdida.jpg")}${img("perdida.jpg")}${img("rota.jpg")}${img("buena.jpg")}`, adj, med));
    assert.equal(p.articulos.length, 1, "no se excluye");
    assert.deepEqual(p.problemas, []);
    const ns = nodos(p);
    assert.deepEqual(ns.map((n) => "imagenWpId" in n.attrs!), [false, false, false, true]);
    assert.equal(ns[0]!.attrs!["src"], "http://evaristocultural.com.ar/wp-content/uploads/perdida.jpg", "conserva su src original");
    assert.deepEqual(p.articulos[0]!.avisosMigracion!.migracion, [
      { code: "original_faltante", detalle: { contexto: "cuerpo", src: "http://evaristocultural.com.ar/wp-content/uploads/perdida.jpg", adjuntoWpId: 9600, clave: "perdida.jpg" } },
      { code: "imagen_sin_medir", detalle: { contexto: "cuerpo", src: "http://evaristocultural.com.ar/wp-content/uploads/rota.jpg", adjuntoWpId: 9601, clave: "rota.jpg", motivo: "tipo de contenido no reconocido" } },
    ]);
    assert.deepEqual(p.imagenes.map((i) => i.wpId), [9602]);
    assert.deepEqual(p.imagenesSinFila.map((i) => [i.adjuntoWpId, i.codigo]), [[9600, "original_faltante"], [9601, "imagen_sin_medir"]]);
  });

  t("T15: una discordancia entre src e imagenId, o un imagenId sin fila, se detecta", () => {
    const doc = (attrs: Record<string, unknown>) => ({ type: "doc", content: [{ type: "imagen", attrs: { alt: "a", decorativa: false, epigrafe: "", ...attrs } }] });
    const filas = new Map([[1, "foto.jpg"], [2, "Cão.png"]]);
    assert.deepEqual(verificarEnlacesCuerpo(doc({ imagenWpId: 2, src: "/media/C%C3%A3o.png" }), filas), []);
    assert.deepEqual(verificarEnlacesCuerpo(doc({ src: "http://x/y.jpg" }), filas), [], "sin enlace no hay nada que comprobar");
    assert.match(verificarEnlacesCuerpo(doc({ imagenWpId: 1, src: "/media/C%C3%A3o.png" }), filas)[0]!, /no coincide con la imagen 1/);
    assert.match(verificarEnlacesCuerpo(doc({ imagenWpId: 3, src: "/media/foto.jpg" }), filas)[0]!, /adjunto 3, que no tiene fila/);
    assert.match(verificarEnlacesCuerpo(doc({ imagenWpId: "1", src: "/media/foto.jpg" }), filas)[0]!, /no tiene fila/);
    assert.match(verificarEnlacesCuerpo(doc({ imagenId: 5, imagenWpId: 1, src: "/media/foto.jpg" }), filas)[0]!, /ya trae imagenId/);
    // un src sin percent-encoding no coincide con el esperado
    assert.equal(verificarEnlacesCuerpo(doc({ imagenWpId: 2, src: "/media/Cão.png" }), filas).length, 1);
    // armar excluye al artículo con un problema explícito
    const adj = [adjunto(9500, "foto.jpg")];
    const med = new Map<string, Medicion>([["foto.jpg", medida(1, 1)]]);
    const conImagenId: typeof convertWpPost = (x, o) => {
      const r = convertWpPost(x, o);
      return { ...r, doc: { ...r.doc, content: r.doc.content!.map((n) => (n.type === "imagen" ? { ...n, attrs: { ...n.attrs, imagenId: 5 } } : n)) } };
    };
    const p = armar(sintetica(img("foto.jpg"), adj, med), { convertir: conImagenId });
    assert.deepEqual(p.articulos, []);
    assert.equal(p.problemas.length, 1);
    assert.equal(p.problemas[0]!.codigo, "imagen_cuerpo_inconsistente");
    assert.match(String(p.problemas[0]!.detalle), /ya trae imagenId/);
    assert.equal(p.problemas[0]!.bloqueante, false);
  });
} finally {
  rmSync(carpeta, { recursive: true, force: true });
}
console.log(`${ok} pruebas de imágenes ok`);
