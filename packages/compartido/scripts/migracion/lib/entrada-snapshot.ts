// Arma la entrada de armar() sin base de datos: desde el snapshot de WordPress (datos/migracion/snapshot-wp-muestra.json)
// y los datos versionados. Lo único impuro es la lectura de esos archivos JSON.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cargarMapeo } from "../../../src/conversor/taxonomia.ts";
import { SECCIONES } from "../../../src/secciones.ts";
import type { CuentaSoloTexto, EntradaArmar, MuestraFixture } from "./armar.ts";
import type { SnapshotWp } from "./snapshot-tipos.ts";

const aRuta = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export const RUTA_SNAPSHOT = aRuta("../../../datos/migracion/snapshot-wp-muestra.json");

/** Lo que no viene de WordPress: la fixture, los 5 extras, las cuentas de solo texto y el mapeo de taxonomías. */
export function cargarDatosVersionados() {
  const fixture: MuestraFixture[] = JSON.parse(readFileSync(aRuta("../../../src/conversor/tests/fixtures/muestra-wordpress.json"), "utf8"));
  const extras: Array<{ id: number; casos: string[]; nota: string }> = JSON.parse(readFileSync(aRuta("../../../datos/migracion/muestra-extra.json"), "utf8")).articulos;
  const cuentas: CuentaSoloTexto[] = JSON.parse(readFileSync(aRuta("../../../datos/migracion/cuentas.json"), "utf8")).cuentas;
  const ids = [...fixture.map((m) => m.id), ...extras.map((e) => e.id)];
  if (new Set(ids).size !== 35) throw new Error(`Se esperaban 35 artículos distintos y hay ${new Set(ids).size}`);
  return { fixture, extras, cuentas, ids, mapeo: cargarMapeo() };
}

export function leerSnapshot(ruta = RUTA_SNAPSHOT): SnapshotWp {
  return JSON.parse(readFileSync(ruta, "utf8")) as SnapshotWp;
}

/**
 * Entrada de armar() desde el snapshot. Por defecto las secciones existentes son las de `src/secciones.ts` (las que siembra
 * `db:sembrar`) y no hay categorías en el CMS.
 */
export function entradaDesdeSnapshot(opciones: { snapshot?: SnapshotWp; seccionesExistentes?: string[]; categoriasExistentes?: string[] } = {}): EntradaArmar {
  const snapshot = opciones.snapshot ?? leerSnapshot();
  const datos = cargarDatosVersionados();
  return {
    ids: datos.ids, fixture: datos.fixture, extras: datos.extras,
    posts: snapshot.posts, meta: snapshot.meta, terminos: snapshot.terminos, usuarios: snapshot.usuarios,
    adjuntos: snapshot.adjuntos,
    adjuntoPorClave: snapshot.adjuntos.filter((a) => a.clave !== null).map((a) => [a.clave as string, a.id] as const),
    opciones: snapshot.opciones, cuentas: datos.cuentas, mapeo: datos.mapeo,
    seccionesExistentes: opciones.seccionesExistentes ?? SECCIONES.map((s) => s.slug),
    categoriasExistentes: opciones.categoriasExistentes ?? [],
  };
}
