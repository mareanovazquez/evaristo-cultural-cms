// Pruebas puras de scripts/migracion/lib/armar.ts con la entrada del snapshot de WordPress (sin base ni disco, salvo la
// lectura de los JSON de datos).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { armar } from "../lib/armar.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };
const cuenta = <T>(xs: T[], f: (x: T) => string) => { const o: Record<string, number> = {}; for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1; return o; };

const plan = armar(entradaDesdeSnapshot());
const articulo = (id: number) => plan.articulos.find((a) => a.wpId === id)!;

t("T01: los 35 desde el snapshot: estados, slugs, secciones y categorías a crear", () => {
  assert.equal(plan.articulos.length, 35);
  assert.deepEqual(cuenta(plan.articulos, (a) => a.estado), { PUBLICADO: 34, BORRADOR: 1 });
  assert.equal(articulo(22546).estado, "BORRADOR");
  assert.equal(articulo(22546).slug, "borrador-22546");
  assert.ok(plan.articulos.every((a) => a.slug !== ""), "ningún slug vacío");
  assert.ok(plan.articulos.every((a) => typeof a.seccion === "string" && a.seccion !== ""), "todos con sección");
  assert.deepEqual(cuenta(plan.articulos, (a) => a.seccion), {
    asia: 17, ensayo: 4, rastros: 3, literatura: 3, musica: 2, "sin-asignar": 2, entrevista: 1, resena: 1, poesia: 1, teatro: 1,
  });
  assert.deepEqual(plan.seccionesFaltantes, []);
  assert.equal(plan.categoriasACrear.length, 8);
  assert.deepEqual(plan.categoriasACrear.map((c) => c.slug).sort(), ["ensayo", "entrevista", "fantastico", "historieta", "literatura", "poesia", "resena", "tv-y-cine"]);
  assert.ok(plan.categoriasACrear.every((c) => c.nombre !== null));
});

// Baseline de la salida de 7eda10c: vive en out/ (ignorado por git), así que este test se saltea si no está.
const BASELINE = fileURLToPath(new URL("../../../out/baseline-armar/corrida-en-seco-ampliada.json", import.meta.url));
if (!existsSync(BASELINE)) {
  console.log("SALTEADO: no hay baseline (out/baseline-armar/corrida-en-seco-ampliada.json); T02 no se ejecutó");
} else {
  t("T02: el Plan desde el snapshot coincide con el baseline en los campos que produce armar()", () => {
    const base = JSON.parse(readFileSync(BASELINE, "utf8"));
    assert.equal(base.articulos.length, plan.articulos.length);
    for (const b of base.articulos) {
      const a = articulo(b.wpId);
      assert.ok(a, `falta el ${b.wpId}`);
      for (const k of ["slug", "estado", "seccion", "categorias", "categoriaPrincipal", "autores", "redirecciones", "publicadoEn"] as const) {
        assert.deepEqual(a[k], b[k], `${b.wpId}.${k}`);
      }
      assert.deepEqual(a.avisosMigracion?.cuerpo ?? null, b.avisosMigracion?.cuerpo ?? null, `${b.wpId}.avisos.cuerpo`);
      assert.deepEqual(a.avisosMigracion?.titulo ?? null, b.avisosMigracion?.titulo ?? null, `${b.wpId}.avisos.titulo`);
    }
    assert.deepEqual(plan.redirecciones, base.redirecciones);
    assert.deepEqual(plan.autores.map((x) => x.wpUserId), base.autores.map((x: { wpUserId: number }) => x.wpUserId));
  });
}

console.log(`${ok} pruebas de armar ok`);
