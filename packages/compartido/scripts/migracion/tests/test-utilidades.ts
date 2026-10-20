// Pruebas puras de scripts/migracion/lib/utilidades.ts (sin base ni archivos).
import assert from "node:assert/strict";
import type { DocNode } from "../../../src/conversor/types.ts";
import { aNFC, decodificarPostName, limpiarSlug, quitarU200E, slugBorrador, slugFinal, textoPlanoDe } from "../lib/utilidades.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };
const L = "\u200E";

t("T05: 19899: post_name crudo con %e2%80%8e -> millie-jackson-i-cry y hubo limpieza", () => {
  const d = decodificarPostName("millie-jackson-%e2%80%8e-i-cry");
  assert.equal(d.fallo, false);
  assert.equal(d.valor, `millie-jackson-${L}-i-cry`);
  assert.deepEqual(limpiarSlug(d.valor), { slug: "millie-jackson-i-cry", limpio: true });
});
t("slug sin U+200E con doble guion legítimo no se toca", () => {
  assert.deepEqual(limpiarSlug("a--b"), { slug: "a--b", limpio: false });
  assert.deepEqual(limpiarSlug("-a--b-"), { slug: "-a--b-", limpio: false });
});
t("U+200E al principio o al final: se recorta sin guiones sobrantes", () => {
  assert.deepEqual(limpiarSlug(`${L}-hola-mundo`), { slug: "hola-mundo", limpio: true });
  assert.deepEqual(limpiarSlug(`hola-mundo-${L}`), { slug: "hola-mundo", limpio: true });
  assert.deepEqual(limpiarSlug(`${L}hola${L}`), { slug: "hola", limpio: true });
});
t("varios U+200E seguidos", () => {
  assert.deepEqual(limpiarSlug(`a-${L}${L}${L}-b`), { slug: "a-b", limpio: true });
  assert.deepEqual(limpiarSlug(`a${L}${L}b`), { slug: "ab", limpio: true });
});
t("slug vacío tras limpiar: vacío con indicador, sin lanzar", () => {
  assert.deepEqual(limpiarSlug(L), { slug: "", limpio: true });
  assert.deepEqual(limpiarSlug(`${L}-${L}`), { slug: "", limpio: true });
});
t("post_name con percent-encoding inválido: no lanza y avisa", () => {
  assert.deepEqual(decodificarPostName("%E0%A4%A"), { valor: "%E0%A4%A", fallo: true });
  assert.deepEqual(decodificarPostName("sin-codificar"), { valor: "sin-codificar", fallo: false });
});
t("slugBorrador", () => assert.equal(slugBorrador(22546), "borrador-22546"));
t("slugFinal: el borrador ignora el post_name; el publicado se limpia", () => {
  assert.deepEqual(slugFinal(true, 19300, "lo-que-sea"), { slug: "borrador-19300", limpio: false });
  assert.equal(slugFinal(false, 19899, `millie-jackson-${L}-i-cry`).slug, "millie-jackson-i-cry");
  assert.equal(slugFinal(false, 1, "otro--slug").slug, "otro--slug");
});
t("quitarU200E en un título con U+200E antes de la barra", () => {
  assert.equal(quitarU200E(`MILLIE JACKSON ${L}| I Cry`), "MILLIE JACKSON | I Cry");
  assert.equal(quitarU200E("sin invisibles"), "sin invisibles");
});
t("NFC: una é descompuesta pasa a compuesta", () => {
  const descompuesta = "e\u0301";
  assert.equal(descompuesta.length, 2);
  assert.equal(aNFC(descompuesta), "\u00E9");
  assert.equal(aNFC(descompuesta).length, 1);
});
// ---------------------------------------------------------------------------------------------------------------
// textoPlanoDe: texto plano para el buscador (función pura del cuerpo)
// ---------------------------------------------------------------------------------------------------------------
const txt = (text: string, ...marks: string[]): DocNode => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type: type as "bold" })) } : {}) });
const par = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const celda = (...c: DocNode[]): DocNode => ({ type: "tableCell", content: c });

t("textoPlanoDe: nodos de texto adyacentes con marcas se unen sin separar (pa + negrita la + bra)", () => {
  assert.equal(textoPlanoDe(doc(par(txt("pa"), txt("la", "bold"), txt("bra", "italic")))), "palabra");
  assert.equal(textoPlanoDe(doc(par(txt("uno "), txt("dos", "bold"), txt(", tres")))), "uno dos, tres");
});
t("textoPlanoDe: párrafos y títulos van en líneas aparte", () => {
  assert.equal(textoPlanoDe(doc({ type: "heading", attrs: { level: 2 }, content: [txt("Título")] }, par(txt("uno")), par(txt("dos")))), "Título\nuno\ndos");
});
t("textoPlanoDe: un hardBreak separa las palabras de los dos lados", () => {
  assert.equal(textoPlanoDe(doc(par(txt("uno"), { type: "hardBreak" }, txt("dos")))), "uno\ndos");
  assert.equal(textoPlanoDe(doc(par(txt("uno"), { type: "hardBreak" }, { type: "hardBreak" }, txt("dos")))), "uno\ndos");
});
t("textoPlanoDe: celdas y filas de tabla, una línea por párrafo de celda", () => {
  const tabla: DocNode = { type: "table", content: [
    { type: "tableRow", content: [{ type: "tableHeader", content: [par(txt("A1"))] }, { type: "tableHeader", content: [par(txt("B1"))] }] },
    { type: "tableRow", content: [celda(par(txt("A2"), txt("x", "bold")), par(txt("A2 bis"))), celda(par(txt("B2")))] },
  ] };
  assert.equal(textoPlanoDe(doc(tabla)), "A1\nB1\nA2x\nA2 bis\nB2");
});
t("textoPlanoDe: ítems de lista, listas anidadas y párrafos dentro de un ítem", () => {
  const lista: DocNode = { type: "bulletList", content: [
    { type: "listItem", content: [par(txt("uno")), { type: "orderedList", content: [{ type: "listItem", content: [par(txt("uno-a"))] }, { type: "listItem", content: [par(txt("uno-b"))] }] }] },
    { type: "listItem", content: [par(txt("dos")), par(txt("dos bis"))] },
  ] };
  assert.equal(textoPlanoDe(doc(lista)), "uno\nuno-a\nuno-b\ndos\ndos bis");
});
t("textoPlanoDe: la cita lleva sus párrafos, el autor y la fuente (en ese orden); vacíos no suman líneas", () => {
  const cita = (attrs: Record<string, unknown>): DocNode => ({ type: "cita", attrs, content: [par(txt("primero")), par(txt("segundo"))] });
  assert.equal(textoPlanoDe(doc(cita({ variante: "textual", autor: "Quien Dijo", fuente: "Un libro" }))), "primero\nsegundo\nQuien Dijo\nUn libro");
  assert.equal(textoPlanoDe(doc(cita({ variante: "textual", autor: "", fuente: "" }))), "primero\nsegundo");
});
t("textoPlanoDe: el epígrafe de la imagen entra donde aparece; el alt, no", () => {
  const imagen: DocNode = { type: "imagen", attrs: { src: "/media/a.jpg", alt: "descripción de accesibilidad", decorativa: false, epigrafe: "Pie de foto" } };
  assert.equal(textoPlanoDe(doc(par(txt("antes")), imagen, par(txt("después")))), "antes\nPie de foto\ndespués");
  assert.equal(textoPlanoDe(doc(par(txt("antes")), { type: "imagen", attrs: { src: "/media/a.jpg", alt: "solo alt", epigrafe: "" } }, par(txt("después")))), "antes\ndespués");
});
t("textoPlanoDe: la nota al pie queda separada por espacios del texto que la rodea, sin partir la línea", () => {
  const nota: DocNode = { type: "footnote", attrs: { content: doc(par(txt("Texto de la nota"), txt(" con negrita", "bold")), par(txt("segundo párrafo de la nota"))) } };
  assert.equal(textoPlanoDe(doc(par(txt("antes"), nota, txt("después")))), "antes Texto de la nota con negrita segundo párrafo de la nota después");
  assert.equal(textoPlanoDe(doc(par(nota))), "Texto de la nota con negrita segundo párrafo de la nota");
});
t("textoPlanoDe: sin espacios al principio ni al final, sin dobles espacios ni líneas vacías; determinista", () => {
  const d = doc(par(txt("  hola   mundo  ")), par(txt("   ")), par(), par(txt(" chau\n\ntodo ")), { type: "video", attrs: { provider: "youtube", id: "x" } }, par(txt("fin")));
  const r = textoPlanoDe(d);
  assert.equal(r, "hola mundo\nchau todo\nfin");
  assert.ok(!/\n\n|  |^\s|\s$| \n|\n /.test(r));
  assert.equal(textoPlanoDe(d), r);
});
t("textoPlanoDe: cuerpos vacíos o sin texto devuelven cadena vacía, también uno grande sin texto", () => {
  assert.equal(textoPlanoDe(doc()), "");
  assert.equal(textoPlanoDe({ type: "doc" }), "");
  const vacio = doc(...Array.from({ length: 20000 }, (_, i) => (i % 3 === 0 ? par() : i % 3 === 1 ? par(txt("  ")) : ({ type: "imagen", attrs: { src: "/media/a.jpg", alt: "x", epigrafe: "" } } as DocNode))));
  assert.equal(textoPlanoDe(vacio), "");
});
console.log(`${ok} pruebas de utilidades ok`);
