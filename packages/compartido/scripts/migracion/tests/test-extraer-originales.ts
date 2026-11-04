// Pruebas de la extracción de originales (lib/extraer-originales.ts). Sin base: paquetes .tar armados en memoria y una carpeta temporal.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  abrirTar, decodificarCp850, decodificarUtf8, emparejar, esProporcional, indexarTar, mapaCsv, motivoNombreInvalido, parsearArgumentos, planificar, resolverCompartidos,
  type DatosAdjunto, type EntradaTar, type LectorTar, type Medida,
} from "../lib/extraer-originales.ts";
import { tamanosDeMetadatos } from "../lib/verificar-descarga.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };

// ---- armador de .tar mínimo (para las pruebas)
type Formato = "gnu" | "posix";
function encabezado(nombre: Buffer, bytes: number, tipo: string, formato: Formato, prefijo?: Buffer): Buffer {
  const h = Buffer.alloc(512);
  nombre.copy(h, 0, 0, Math.min(100, nombre.length));
  h.write("0000644\0", 100, "latin1"); h.write("0000000\0", 108, "latin1"); h.write("0000000\0", 116, "latin1");
  h.write(bytes.toString(8).padStart(11, "0") + "\0", 124, "latin1");
  h.write("00000000000\0", 136, "latin1");
  h.write(tipo, 156, "latin1");
  if (formato === "gnu") h.write("ustar  \0", 257, "latin1"); else { h.write("ustar\0", 257, "latin1"); h.write("00", 263, "latin1"); }
  if (prefijo) prefijo.copy(h, 345);
  h.fill(0x20, 148, 156);
  let s = 0; for (const x of h) s += x;
  h.write(s.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
  return h;
}
const relleno = (n: number) => Buffer.alloc((512 - (n % 512)) % 512);
interface EntradaPrueba { nombre: Buffer | string; datos?: Buffer | string; tipo?: string; formato?: Formato; largo?: "L" | "pax"; prefijo?: string }
function armarTar(entradas: EntradaPrueba[], cierre = true): Buffer {
  const partes: Buffer[] = [];
  for (const e of entradas) {
    const nombre = typeof e.nombre === "string" ? Buffer.from(e.nombre, "utf8") : e.nombre;
    const datos = typeof e.datos === "string" ? Buffer.from(e.datos) : (e.datos ?? Buffer.alloc(0));
    const formato = e.formato ?? "gnu";
    if (e.largo === "L") { const n = Buffer.concat([nombre, Buffer.from([0])]); partes.push(encabezado(Buffer.from("././@LongLink"), n.length, "L", "gnu"), n, relleno(n.length)); }
    if (e.largo === "pax") {
      const cuerpo = (largoTotal: number) => `${largoTotal} path=${nombre.toString("latin1")}\n`;
      let l = 0; while (Buffer.byteLength(cuerpo(l), "latin1") !== l) l = Buffer.byteLength(cuerpo(l), "latin1");
      const p = Buffer.from(cuerpo(l), "latin1");
      partes.push(encabezado(Buffer.from("PaxHeader"), p.length, "x", "posix"), p, relleno(p.length));
    }
    const tipo = e.tipo ?? "0";
    const corto = e.largo ? nombre.subarray(0, 99) : nombre;
    partes.push(encabezado(corto, tipo === "0" ? datos.length : 0, tipo, formato, e.prefijo ? Buffer.from(e.prefijo) : undefined));
    if (tipo === "0") partes.push(datos, relleno(datos.length));
  }
  if (cierre) partes.push(Buffer.alloc(1024));
  return Buffer.concat(partes);
}
const enMemoria = (b: Buffer): LectorTar => ({ total: b.length, leer: (p, l) => Buffer.from(b.subarray(p, p + l)) });
const cp850 = (s: string) => Buffer.from([...s].map((c) => ({ ñ: 0xa4, ó: 0xa2, í: 0xa1, é: 0x82, á: 0xa0, ú: 0xa3 } as Record<string, number>)[c] ?? c.charCodeAt(0)));
const ent = (nombre: string | Buffer, inicio = 0, bytes = 1): EntradaTar => ({ nombre: typeof nombre === "string" ? Buffer.from(nombre, "utf8") : nombre, inicio, bytes });

t("CP850: las letras del castellano y la tabla completa", () => {
  assert.equal(decodificarCp850(Buffer.from([0x72, 0x65, 0x73, 0x65, 0xa4, 0x61])), "reseña");
  assert.equal(decodificarCp850(Buffer.from([0x82, 0xa0, 0xa1, 0xa2, 0xa3, 0xa5, 0x81, 0x90, 0xb5])), "éáíóúÑüÉÁ");
  const todo = decodificarCp850(Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
  assert.equal([...todo].length, 256);
  assert.equal(new Set(todo).size, 256, "cada byte decodifica a un carácter distinto");
});

t("UTF-8 estricto: null si los bytes no son UTF-8", () => {
  assert.equal(decodificarUtf8(Buffer.from("canción", "utf8")), "canción");
  assert.equal(decodificarUtf8(cp850("canción")), null);
});

t("tar: GNU con nombre largo, pax, prefijo POSIX, carpetas, enlaces y ./ inicial", () => {
  const largo = "a".repeat(150) + ".jpg";
  const tar = armarTar([
    { nombre: "./", tipo: "5" },
    { nombre: "./uno.jpg", datos: "hola" },
    { nombre: `./${largo}`, datos: "x".repeat(600), largo: "L" },
    { nombre: "./pax-ñ.jpg", datos: "p", largo: "pax", formato: "posix" },
    { nombre: "dos.png", datos: "zz", formato: "posix", prefijo: "sub" },
    { nombre: "enlace.jpg", tipo: "2" },
    { nombre: cp850("./reseña.jpg"), datos: "r" },
  ]);
  const r = indexarTar(enMemoria(tar));
  assert.equal(r.carpetas, 1);
  assert.deepEqual(r.otros, [{ nombre: "enlace.jpg", tipo: "2" }]);
  assert.deepEqual(r.archivos.map((a) => [decodificarUtf8(a.nombre) ?? decodificarCp850(a.nombre), a.bytes]), [["uno.jpg", 4], [largo, 600], ["pax-ñ.jpg", 1], ["sub/dos.png", 2], ["reseña.jpg", 1]]);
  assert.equal(tar.subarray(r.archivos[0]!.inicio, r.archivos[0]!.inicio + 4).toString(), "hola");
  assert.equal(tar.subarray(r.archivos[1]!.inicio, r.archivos[1]!.inicio + 600).toString(), "x".repeat(600));
});

t("tar: suma de control, paquete cortado y sin los ceros del final", () => {
  const bueno = armarTar([{ nombre: "a.jpg", datos: "123" }]);
  const dañado = Buffer.from(bueno); dañado[0] = 0x62;
  assert.throws(() => indexarTar(enMemoria(dañado)), /suma de control/);
  const cortado = armarTar([{ nombre: "a.jpg", datos: "x".repeat(2000) }], false).subarray(0, 1024);
  assert.throws(() => indexarTar(enMemoria(cortado)), /cortado/);
  assert.throws(() => indexarTar(enMemoria(bueno.subarray(0, 512 + 512 + 100))), /mitad de un encabezado/);
  assert.equal(indexarTar(enMemoria(armarTar([{ nombre: "a.jpg", datos: "123" }], false))).archivos.length, 1);
});

t("abrirTar: lee el paquete del disco por posición", () => {
  const dir = mkdtempSync(join(tmpdir(), "extraer-"));
  try {
    const ruta = join(dir, "p.tar");
    writeFileSync(ruta, armarTar([{ nombre: "a.jpg", datos: "abc" }, { nombre: "b.jpg", datos: "defg" }]));
    const tar = abrirTar(ruta);
    try {
      const r = indexarTar(tar);
      assert.deepEqual(r.archivos.map((a) => tar.leer(a.inicio, a.bytes).toString()), ["abc", "defg"]);
    } finally { tar.cerrar(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

t("emparejar: exacto, NFD, CP850, cola, mayúsculas y faltante, en ese orden", () => {
  const entradas = [ent("a.jpg"), ent("canción.jpg".normalize("NFD")), ent(cp850("reseña.jpg")), ent("foto.jpg0"), ent(cp850("Raúl.png00")), ent("Mankell.jpg"), ent("b.jpg"), ent("B.JPG")];
  const r = emparejar([
    { id: 1, clave: "a.jpg" }, { id: 2, clave: "canción.jpg" }, { id: 3, clave: "reseña.jpg" }, { id: 4, clave: "foto.jpg" }, { id: 5, clave: "Raúl.png" },
    { id: 6, clave: "Mankell.jpg" }, { id: 7, clave: "mankell.jpg" }, { id: 8, clave: "b.jpg" }, { id: 9, clave: "no-esta.jpg" },
  ], entradas);
  assert.deepEqual(r.emparejados.map((e) => [e.id, e.coincidencia, e.nombreEnPaquete]), [
    [1, "exacto", "a.jpg"], [2, "exacto", "canción.jpg".normalize("NFD")], [3, "cp850", "reseña.jpg"], [4, "cola", "foto.jpg0"], [5, "cola", "Raúl.png00"],
    [6, "exacto", "Mankell.jpg"], [7, "mayusculas", "Mankell.jpg"], [8, "exacto", "b.jpg"],
  ]);
  assert.equal(r.emparejados.find((e) => e.id === 6)!.entrada, r.emparejados.find((e) => e.id === 7)!.entrada);
  assert.deepEqual(r.faltantes, [{ id: 9, clave: "no-esta.jpg" }]);
  assert.deepEqual(r.ambiguos, []);
});

t("emparejar: dos candidatos en un nivel es ambiguo, no se adivina", () => {
  const r = emparejar([{ id: 1, clave: "Tapa.jpg" }], [ent("TAPA.jpg"), ent("tapa.jpg")]);
  assert.deepEqual(r.emparejados, []);
  assert.deepEqual(r.ambiguos, [{ id: 1, clave: "Tapa.jpg", nivel: "mayusculas", candidatos: ["TAPA.jpg", "tapa.jpg"] }]);
});

t("planificar: el archivo compartido se escribe una vez con la clave exacta; nombres inválidos y choques en el destino", () => {
  const m = ent("Mankell.jpg", 1024), x = ent("x.jpg", 0), y = ent("X.JPG", 2048), z = ent("con.jpg", 4096);
  const plan = planificar([
    { id: 7, clave: "mankell.jpg", entrada: m, nombreEnPaquete: "Mankell.jpg", coincidencia: "mayusculas" },
    { id: 6, clave: "Mankell.jpg", entrada: m, nombreEnPaquete: "Mankell.jpg", coincidencia: "exacto" },
    { id: 1, clave: "x.jpg", entrada: x, nombreEnPaquete: "x.jpg", coincidencia: "exacto" },
    { id: 2, clave: "X.JPG", entrada: y, nombreEnPaquete: "X.JPG", coincidencia: "exacto" },
    { id: 3, clave: "con.jpg", entrada: z, nombreEnPaquete: "con.jpg", coincidencia: "exacto" },
  ]);
  assert.deepEqual(plan.archivos.map((a) => a.nombreDestino), ["x.jpg", "Mankell.jpg", "X.JPG", "con.jpg"], "ordenados por posición en el paquete");
  assert.deepEqual(plan.compartidos.map((a) => [a.nombreDestino, a.adjuntos.map((e) => e.id)]), [["Mankell.jpg", [6, 7]]]);
  assert.deepEqual(plan.chocanEnDestino, [["x.jpg", "X.JPG"]]);
  assert.deepEqual(plan.nombresInvalidos.map((n) => n.clave), ["con.jpg"]);
});

t("motivoNombreInvalido", () => {
  for (const ok of ["a.jpg", "reseña.jpg", "foto (1).png", "Ra'úl.jpg"]) assert.equal(motivoNombreInvalido(ok), null, ok);
  for (const mal of ["", "..", "a/b.jpg", "a\\b.jpg", "a:b.jpg", "a?.jpg", "a.jpg.", "a.jpg ", "NUL", "com1.png", "a\u0001.jpg"]) assert.notEqual(motivoNombreInvalido(mal), null, mal);
});

t("resolverCompartidos: el dueño por medidas y la miniatura proporcional más grande para el otro", () => {
  const archivo = ent("Tapa.jpg", 0), recorte = ent("Tapa-1400x700.jpg", 512), grande = ent("Tapa-742x1024.jpg", 1024), chica = ent("Tapa-217x300.jpg", 1536), mentirosa = ent("Tapa-800x1104.jpg", 2048);
  const medidas = new Map<EntradaTar, Medida>([[archivo, { ancho: 625, alto: 1073 }], [recorte, { ancho: 1400, alto: 700 }], [grande, { ancho: 742, alto: 1024 }], [chica, { ancho: 217, alto: 300 }], [mentirosa, { ancho: 10, alto: 10 }]]);
  const porNombre = new Map([recorte, grande, chica, mentirosa].map((e) => [e.nombre.toString(), e]));
  const datos = new Map<number, DatosAdjunto>([
    [270, { ancho: 1881, alto: 2596, tamanos: [{ archivo: "Tapa-1400x700.jpg", ancho: 1400, alto: 700 }, { archivo: "Tapa-217x300.jpg", ancho: 217, alto: 300 }, { archivo: "Tapa-742x1024.jpg", ancho: 742, alto: 1024 }, { archivo: "Tapa-800x1104.jpg", ancho: 800, alto: 1104 }, { archivo: "Tapa-900x1242.jpg", ancho: 900, alto: 1242 }] }],
    [175, { ancho: 625, alto: 1073 }],
  ]);
  const plan = planificar([
    { id: 270, clave: "Tapa.jpg", entrada: archivo, nombreEnPaquete: "Tapa.jpg", coincidencia: "exacto" },
    { id: 175, clave: "tapa.jpg", entrada: archivo, nombreEnPaquete: "Tapa.jpg", coincidencia: "mayusculas" },
  ]);
  const r = resolverCompartidos(plan, datos, (e) => medidas.get(e) ?? null, (n) => porNombre.get(n));
  assert.deepEqual(r.sinResolver, []);
  assert.deepEqual(plan.archivos.map((a) => [a.nombreDestino, a.adjuntos.map((x) => x.id)]), [["tapa.jpg", [175]]], "el archivo queda con el nombre de su dueño");
  assert.equal(r.reemplazos.length, 1);
  const x = r.reemplazos[0]!;
  assert.deepEqual([x.id, x.nombreDestino, x.miniatura, x.medida, x.original, x.dueno], [270, "Tapa.jpg", "Tapa-742x1024.jpg", { ancho: 742, alto: 1024 }, { ancho: 1881, alto: 2596 }, { id: 175, clave: "tapa.jpg" }],
    "ni el recorte (1400×700), ni la que miente en sus medidas, ni la que no está en el paquete");
});

t("resolverCompartidos: sin dueño, con dos dueños o sin miniatura queda sin resolver y no cambia el plan", () => {
  const archivo = ent("A.jpg");
  const armar = () => planificar([
    { id: 1, clave: "A.jpg", entrada: archivo, nombreEnPaquete: "A.jpg", coincidencia: "exacto" },
    { id: 2, clave: "a.jpg", entrada: archivo, nombreEnPaquete: "A.jpg", coincidencia: "mayusculas" },
  ]);
  const medir = () => ({ ancho: 100, alto: 50 });
  const casos: Array<[Map<number, DatosAdjunto>, RegExp]> = [
    [new Map([[1, { ancho: 1, alto: 1 }], [2, { ancho: 2, alto: 2 }]]), /no coinciden con ningún adjunto/],
    [new Map([[1, { ancho: 100, alto: 50 }], [2, { ancho: 100, alto: 50 }]]), /más de un adjunto/],
    [new Map([[1, { ancho: 300, alto: 150, tamanos: [] }], [2, { ancho: 100, alto: 50 }]]), /ninguna miniatura proporcional/],
    [new Map([[1, { ancho: null, alto: null }], [2, { ancho: 100, alto: 50 }]]), /no declara las medidas/],
  ];
  for (const [datos, motivo] of casos) {
    const plan = armar();
    const r = resolverCompartidos(plan, datos, medir, () => undefined);
    assert.equal(r.reemplazos.length, 0);
    assert.equal(r.sinResolver.length, 1);
    assert.match(r.sinResolver[0]!.motivo, motivo);
    assert.deepEqual(plan.archivos[0]!.adjuntos.map((x) => x.id), [1, 2]);
  }
  const plan = armar();
  assert.match(resolverCompartidos(plan, new Map(), () => null, () => undefined).sinResolver[0]!.motivo, /no se pudieron leer las medidas/);
});

t("esProporcional y tamanosDeMetadatos", () => {
  assert.equal(esProporcional({ ancho: 742, alto: 1024 }, { ancho: 1881, alto: 2596 }), true);
  assert.equal(esProporcional({ ancho: 1400, alto: 700 }, { ancho: 1881, alto: 2596 }), false);
  const meta = 'a:5:{s:5:"width";i:1881;s:6:"height";i:2596;s:4:"file";s:14:"Tapa-libro.jpg";s:5:"sizes";a:2:{s:6:"medium";a:4:{s:4:"file";s:22:"Tapa-libro-217x300.jpg";s:5:"width";i:217;s:6:"height";i:300;s:9:"mime-type";s:10:"image/jpeg";}s:5:"large";a:4:{s:4:"file";s:23:"Tapa-libro-742x1024.jpg";s:5:"width";i:742;s:6:"height";i:1024;s:9:"mime-type";s:10:"image/jpeg";}}}';
  assert.deepEqual(tamanosDeMetadatos(meta, "Tapa-libro.jpg"), [{ archivo: "Tapa-libro-217x300.jpg", ancho: 217, alto: 300 }, { archivo: "Tapa-libro-742x1024.jpg", ancho: 742, alto: 1024 }]);
  assert.deepEqual(tamanosDeMetadatos(meta, "2020/05/Tapa-libro.jpg").map((x) => x.archivo), ["2020/05/Tapa-libro-217x300.jpg", "2020/05/Tapa-libro-742x1024.jpg"]);
});

t("mapaCsv: BOM, cabecera, orden por id y comillas", () => {
  const csv = mapaCsv([
    { id: 9, clave: "b,c.jpg", nombreEnPaquete: "b,c.jpg", coincidencia: "exacto", carpeta: "originales", archivo: "b,c.jpg", comparteCon: "", bytes: 3, sha256: "ff" },
    { id: 2, clave: "A\"x.jpg", nombreEnPaquete: "A\"x-30x30.jpg", coincidencia: "miniatura", carpeta: "reemplazos", archivo: "A\"x.jpg", comparteCon: "a\"x.jpg", bytes: 1, sha256: "aa" },
  ]);
  assert.ok(csv.startsWith("\uFEFFid_adjunto,clave,nombre_en_paquete,coincidencia,carpeta,archivo_extraido,comparte_archivo_con,bytes,sha256\r\n"));
  assert.deepEqual(csv.slice(1).trimEnd().split("\r\n").slice(1), ['2,"A""x.jpg","A""x-30x30.jpg",miniatura,reemplazos,"A""x.jpg","a""x.jpg",1,aa', '9,"b,c.jpg","b,c.jpg",exacto,originales,"b,c.jpg",,3,ff']);
});

t("argumentos: válidos y errores", () => {
  assert.deepEqual(parsearArgumentos(["--paquete=p.tar", "--base=b"]), { paquete: "p.tar", base: "b", prefijo: "wp_", destino: null, reemplazos: null, mapa: null });
  assert.deepEqual(parsearArgumentos(["--paquete=p.tar", "--base=b", "--destino=C:\\o", "--reemplazos=C:\\r", "--mapa=m.csv", "--prefijo=x_"]), { paquete: "p.tar", base: "b", prefijo: "x_", destino: "C:\\o", reemplazos: "C:\\r", mapa: "m.csv" });
  for (const [args, motivo] of [
    [[], /falta --paquete/], [["--paquete=p"], /falta --base/], [["--paquete=p", "--base=a;b"], /--base/], [["--paquete=p", "--base=b", "--mapa=m"], /solo tienen sentido/], [["--paquete=p", "--base=b", "--reemplazos=r"], /solo tienen sentido/],
    [["--paquete=p", "--base=b", "--otro"], /desconocido/], [["--paquete="], /necesita un valor/],
  ] as const) assert.match(parsearArgumentos(args) as string, motivo, args.join(" "));
});

console.log(`${ok} pruebas de la extracción de originales ok`);
