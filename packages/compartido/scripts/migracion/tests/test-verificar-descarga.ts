// Pruebas de la verificación de la descarga de uploads (lib/verificar-descarga.ts). Sin base: casos sintéticos y una carpeta temporal.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  colisionesDeNombres, compararConBase, compararConServidor, derivadasDeMetadatos, leerListaDeRutas, leerListaDelServidor, listarCarpeta, parsearArgumentos,
  type AdjuntoWp,
} from "../lib/verificar-descarga.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };

const adj = (id: number, clave: string, bytesDeclarados: number | null = null, derivadas: string[] = []): AdjuntoWp => ({ id, clave, bytesDeclarados, derivadas });
const f = (ruta: string, bytes = 100) => ({ ruta, bytes });
const NFC = "canción.jpg".normalize("NFC"), NFD = "canción.jpg".normalize("NFD");
assert.notEqual(NFC, NFD);

t("argumentos: válidos, valores por defecto y errores", () => {
  assert.deepEqual(parsearArgumentos(["--uploads=C:\\u"]), { uploads: "C:\\u", listaServidor: null, apartados: null, base: "evaristo_lectura", prefijo: "wp_", sinBase: false });
  assert.deepEqual(parsearArgumentos(["--uploads=x", "--lista-servidor=l.tsv", "--apartados=c.txt", "--base=otra", "--prefijo=abc_"]), { uploads: "x", listaServidor: "l.tsv", apartados: "c.txt", base: "otra", prefijo: "abc_", sinBase: false });
  assert.equal((parsearArgumentos(["--uploads=x", "--sin-base", "--lista-servidor=l.tsv"]) as { sinBase: boolean }).sinBase, true);
  for (const [args, motivo] of [
    [[], /falta --uploads/], [["--uploads="], /necesita un valor/], [["--uploads=x", "--apartados="], /--apartados necesita/], [["--uploads=x", "--base=a;b"], /--base/], [["--uploads=x", "--prefijo=wp-"], /--prefijo/],
    [["--uploads=x", "--sin-base"], /necesita --lista-servidor/], [["--uploads=x", "--raro"], /desconocido/], [["--uploads=x", "--sin-base=1", "--lista-servidor=l"], /no lleva valor/],
  ] as const) assert.match(parsearArgumentos(args) as string, motivo, args.join(" "));
});

t("listarCarpeta: archivos con su tamaño, subcarpetas con '/' y nombres con tildes", () => {
  const dir = mkdtempSync(join(tmpdir(), "verif-desc-"));
  try {
    writeFileSync(join(dir, "a.jpg"), "123");
    writeFileSync(join(dir, NFC), "12345");
    mkdirSync(join(dir, "2020"));
    writeFileSync(join(dir, "2020", "b.png"), "");
    const r = listarCarpeta(dir).sort((x, y) => (x.ruta < y.ruta ? -1 : 1));
    assert.deepEqual(r, [{ ruta: "2020/b.png", bytes: 0 }, { ruta: "a.jpg", bytes: 3 }, { ruta: NFC, bytes: 5 }].sort((x, y) => (x.ruta < y.ruta ? -1 : 1)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

t("contra la base: exactos, faltantes, vacíos y tamaño distinto", () => {
  const r = compararConBase(
    [adj(1, "a.jpg", 100), adj(2, "b.jpg"), adj(3, "c.jpg", 500), adj(4, "d.jpg", 50)],
    [f("a.jpg", 100), f("c.jpg", 480), f("d.jpg", 0)],
  );
  assert.equal(r.adjuntos, 4);
  assert.equal(r.exactos, 3);
  assert.deepEqual(r.faltantes, [{ id: 2, clave: "b.jpg" }]);
  assert.deepEqual(r.tamanoDistinto, [{ id: 3, clave: "c.jpg", declarado: 500, enDisco: 480 }]);
  assert.deepEqual(r.tamanoCero, [{ id: 4, clave: "d.jpg" }]);
  assert.equal(r.conTamanoDeclarado, 3);
  assert.equal(r.bytesTotales, 100 + 480 + 0);
});

t("contra la base: mayúsculas y tildes alteradas son un problema; la normalización Unicode solo se avisa (la migración la tolera)", () => {
  const r = compararConBase(
    [adj(1, NFC), adj(2, "Foto.JPG"), adj(3, "música.jpg"), adj(4, "ok.jpg")],
    [f(NFD), f("foto.jpg"), f("musica.jpg"), f("ok.jpg")],
  );
  assert.equal(r.exactos, 2); // ok.jpg y el de la normalización
  assert.deepEqual(r.normalizados, [{ id: 1, clave: NFC, archivo: NFD }]);
  assert.deepEqual(r.alterados.map((a) => [a.id, a.alteracion]), [[2, "mayusculas"], [3, "tildes"]]);
  assert.deepEqual(r.faltantes, []);
  assert.deepEqual(r.sobrantes, { derivadas: 0, otros: [] });
});

t("contra la base: una clave que en disco está NFC y la base pide NFD se reconoce (la migración compara en NFC), con aviso", () => {
  const r = compararConBase([adj(1, NFD)], [f(NFC)]);
  assert.deepEqual([r.exactos, r.alterados.length, r.faltantes.length, r.normalizados.length], [1, 0, 0, 1]);
  const idem = compararConBase([adj(1, NFC)], [f(NFC)]);
  assert.deepEqual([idem.exactos, idem.normalizados.length], [1, 0]);
});

t("colisiones: claves que el CMS no distingue (mayúsculas o tildes); Linux las distingue", () => {
  const adjuntos = [adj(1, "TAPA.jpg"), adj(2, "tapa.jpg"), adj(3, "otra.jpg"), adj(4, "Wilde.jpg"), adj(5, "wilde.jpg"), adj(6, "WILDE.jpg"), adj(7, NFC), adj(8, NFD)];
  assert.deepEqual(colisionesDeNombres(adjuntos), [
    { claves: ["TAPA.jpg", "tapa.jpg"], ids: [1, 2], tipo: "mayusculas" },
    { claves: ["WILDE.jpg", "Wilde.jpg", "wilde.jpg"], ids: [4, 5, 6], tipo: "mayusculas" },
  ]); // NFC y NFD de la misma palabra son el mismo nombre para la migración: no es una colisión
  assert.deepEqual(colisionesDeNombres([adj(1, "a.jpg"), adj(2, "b.jpg"), adj(3, "a.jpg")]), []); // el mismo archivo dos veces no choca
});

t("colisiones por tildes: chocan en el CMS pero no en Windows; la ñ sigue siendo una letra distinta de la n", () => {
  const g = colisionesDeNombres([adj(1, "Perón.jpg"), adj(2, "peron.jpg"), adj(3, "Sin-título-1.jpg"), adj(4, "sin-titulo-1.jpg"), adj(5, "Peron.jpg"), adj(6, "año.jpg"), adj(7, "ano.jpg"), adj(8, "AÑO.jpg")]);
  assert.deepEqual(g.map((x) => [x.tipo, x.ids]), [["tildes", [1, 2, 5]], ["tildes", [3, 4]], ["mayusculas", [6, 8]]]);
});

t("contra la base: las colisiones se informan y marcan a los faltantes y alterados que chocan con otro nombre", () => {
  // En Windows solo sobrevivió uno de cada par: TAPA.jpg está en disco, tapa.jpg no; y de Wilde/wilde quedó el de la otra capitalización
  const r = compararConBase([adj(1, "TAPA.jpg"), adj(2, "tapa.jpg"), adj(3, "Wilde.jpg"), adj(4, "wilde.jpg"), adj(5, "libre.jpg")], [f("TAPA.jpg"), f("Wilde.jpg"), f("libre.jpg")]);
  assert.equal(r.colisiones.length, 2);
  assert.equal(r.exactos, 3);
  assert.deepEqual(r.alterados, [{ id: 2, clave: "tapa.jpg", archivo: "TAPA.jpg", alteracion: "mayusculas", colisionaCon: ["TAPA.jpg"] }, { id: 4, clave: "wilde.jpg", archivo: "Wilde.jpg", alteracion: "mayusculas", colisionaCon: ["Wilde.jpg"] }]);
  assert.deepEqual(r.faltantes, []);
  const sinNinguno = compararConBase([adj(1, "TAPA.jpg"), adj(2, "tapa.jpg")], []);
  assert.deepEqual(sinNinguno.faltantes, [{ id: 1, clave: "TAPA.jpg", colisionaCon: ["tapa.jpg"] }, { id: 2, clave: "tapa.jpg", colisionaCon: ["TAPA.jpg"] }]);
  assert.deepEqual(r.colisiones.map((x) => x.tipo), ["mayusculas", "mayusculas"]);
});

t("contra la base: los apartados a propósito no son faltantes; los que no son de esta base se avisan", () => {
  const adjuntos = [adj(1, "TAPA.jpg"), adj(2, "tapa.jpg"), adj(3, "libre.jpg")];
  const r = compararConBase(adjuntos, [f("libre.jpg")], new Set(["TAPA.jpg", "tapa.jpg", "de-otra-base.jpg"]));
  assert.deepEqual(r.apartados, [{ id: 1, clave: "TAPA.jpg" }, { id: 2, clave: "tapa.jpg" }]);
  assert.deepEqual(r.faltantes, []);
  assert.deepEqual(r.apartadosSinAdjunto, ["de-otra-base.jpg"]);
  assert.equal(r.exactos, 1);
  const sinApartar = compararConBase(adjuntos, [f("libre.jpg")]);
  assert.deepEqual([sinApartar.apartados, sinApartar.apartadosSinAdjunto, sinApartar.faltantes.length], [[], [], 2]);
});

t("lista de rutas: una por línea, sin vacías ni BOM", () => {
  assert.deepEqual(leerListaDeRutas("\uFEFFa.jpg\r\n\r\nb c.jpg\n"), ["a.jpg", "b c.jpg"]);
  assert.deepEqual(leerListaDeRutas(""), []);
});

t("contra la base: sobrantes, derivadas declaradas, derivadas por nombre y otros", () => {
  const r = compararConBase(
    [adj(1, "a.jpg", null, ["a-150x150.jpg", "a-300x200.jpg"])],
    [f("a.jpg"), f("a-150x150.jpg"), f("a-300x200.jpg"), f("x-scaled.jpg"), f("y-768x1024.png"), f("z-e1234.jpg"), f("suelto.txt"), f("raro.jpg")],
  );
  assert.equal(r.exactos, 1);
  assert.deepEqual(r.sobrantes, { derivadas: 5, otros: ["suelto.txt", "raro.jpg"] });
});

t("contra la base: subcarpetas (año/mes) y derivadas junto al original", () => {
  const r = compararConBase(
    [adj(1, "2020/05/a.jpg", null, derivadasDeMetadatos('a:2:{s:4:"file";s:14:"2020/05/a.jpg";s:5:"sizes";a:1:{s:9:"thumbnail";a:1:{s:4:"file";s:13:"a-150x150.jpg";}}}', "2020/05/a.jpg"))],
    [f("2020/05/a.jpg"), f("2020/05/a-150x150.jpg"), f("a-150x150.jpg")],
  );
  assert.equal(r.exactos, 1);
  assert.deepEqual(r.sobrantes, { derivadas: 2, otros: [] }); // la de otra carpeta se reconoce por el sufijo de tamaño
});

t("derivadasDeMetadatos: saca las miniaturas del PHP serializado y no incluye al original", () => {
  const meta = 'a:6:{s:5:"width";i:800;s:6:"height";i:600;s:4:"file";s:5:"x.jpg";s:5:"sizes";a:2:{s:9:"thumbnail";a:5:{s:4:"file";s:11:"x-150x150.jpg";s:5:"width";i:150;}s:6:"medium";a:5:{s:4:"file";s:11:"x-300x225.jpg";s:5:"width";i:300;}}}';
  assert.deepEqual(derivadasDeMetadatos(meta, "x.jpg"), ["x-150x150.jpg", "x-300x225.jpg"]);
  assert.deepEqual(derivadasDeMetadatos("", "x.jpg"), []);
});

t("lista del servidor: tamaño, tabulación y ruta; CRLF, BOM y líneas vacías; línea inválida", () => {
  assert.deepEqual(leerListaDelServidor("\uFEFF10\ta.jpg\r\n2048\tcarpeta/b c.png\n\n0\tvacío.txt\n"), [f("a.jpg", 10), f("carpeta/b c.png", 2048), f("vacío.txt", 0)]);
  assert.throws(() => leerListaDelServidor("sin tabulacion.jpg\n"), /línea inválida/);
  assert.throws(() => leerListaDelServidor("abc\tx.jpg\n"), /línea inválida/);
  assert.throws(() => leerListaDelServidor("-5\tx.jpg\n"), /línea inválida/);
});

t("contra el servidor: iguales, faltantes, alterados, tamaño distinto (descarga cortada) y sobrantes", () => {
  const servidor = [f("a.jpg", 100), f("b.jpg", 200), f("c.jpg", 300), f(NFC, 40), f("d.jpg", 10)];
  const disco = [f("a.jpg", 100), f("b.jpg", 150), f("C.JPG", 300), f(NFD, 40), f("de-mas.txt", 5)];
  const r = compararConServidor(servidor, disco);
  assert.equal(r.enServidor, 5);
  assert.equal(r.exactos, 3); // a, b (con otro tamaño) y el de la normalización
  assert.deepEqual(r.tamanoDistinto, [{ ruta: "b.jpg", servidor: 200, enDisco: 150 }]);
  assert.deepEqual(r.normalizados, [{ ruta: NFC, archivo: NFD }]);
  assert.deepEqual(r.alterados.map((a) => [a.ruta, a.alteracion]), [["c.jpg", "mayusculas"]]);
  assert.deepEqual(r.faltantes, ["d.jpg"]);
  assert.deepEqual(r.sobrantes, ["de-mas.txt"]);
  assert.equal(r.bytesServidor, 650);
  assert.equal(r.bytesEnDisco, 100 + 150 + 300 + 40 + 5);
});

t("contra el servidor: una descarga perfecta no tiene ningún problema", () => {
  const lista = [f("a.jpg", 1), f("b/c.jpg", 2), f(NFC, 3)];
  const r = compararConServidor(lista, lista);
  assert.deepEqual([r.faltantes, r.alterados, r.tamanoDistinto, r.sobrantes], [[], [], [], []]);
  assert.equal(r.exactos, 3);
});

console.log(`\n${ok} pruebas de verificar-descarga ok`);
