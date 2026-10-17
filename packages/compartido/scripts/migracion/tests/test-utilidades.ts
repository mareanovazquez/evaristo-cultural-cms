// Pruebas puras de scripts/migracion/lib/utilidades.ts (sin base ni archivos).
import assert from "node:assert/strict";
import { aNFC, decodificarPostName, limpiarSlug, quitarU200E, slugBorrador, slugFinal } from "../lib/utilidades.ts";

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
console.log(`${ok} pruebas de utilidades ok`);
