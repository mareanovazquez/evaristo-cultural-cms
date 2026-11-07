// Limpieza de la taxonomía vieja (decisión 87, 7/11/2026): qué secciones y categorías del modelo anterior a la decisión 78 se pueden borrar
// y qué hay que ajustar para que la base quede como el modelo nuevo. Módulo PURO, sin base ni disco: lo usan la simulación (la vista
// previa, con conexiones de solo lectura) y la limpieza que hace el comando de escritura con --limpiar-taxonomia (limpiar-taxonomia.ts).
//
// La regla de oro: nunca se borra una sección o una categoría que tenga artículos. Una vieja que todavía los tiene queda, y se informa.
import { cargarMapeo } from "../../../src/conversor/taxonomia.ts";
import { SECCIONES } from "../../../src/secciones.ts";

export interface ModeloTaxonomia {
  /** Las secciones del modelo nuevo, en el orden del menú. */
  secciones: ReadonlyArray<{ slug: string; nombre: string; interna: boolean }>;
  /** Las categorías del modelo nuevo. Las que falten no se crean acá: las crea la migración cuando algún artículo las usa. */
  categorias: ReadonlyArray<{ slug: string; nombre: string }>;
}

/** El modelo nuevo: src/secciones.ts y las categorías del mapeo de taxonomías. */
export function modeloTaxonomia(): ModeloTaxonomia {
  return { secciones: SECCIONES, categorias: cargarMapeo().categorias };
}

/** Una sección de la base con los artículos que la usan (su wpId, o null si se creó en el panel). `orden` falta si la base no tiene la columna. */
export interface SeccionEnBase { slug: string; nombre: string; interna: boolean; orden?: number | null; articulos: ReadonlyArray<number | null> }
/** Una categoría de la base con los artículos que la usan (como categoría o como volanta). */
export interface CategoriaEnBase { slug: string; nombre: string; articulos: ReadonlyArray<number | null> }

export interface Ajuste { slug: string; cambios: Record<string, { antes: unknown; despues: unknown }> }

export interface PlanLimpieza {
  secciones: {
    /** Viejas que quedan sin artículos: se borran. */
    borrar: string[];
    /** Viejas que todavía tienen artículos (después de reescribir los del plan): quedan, y hay que revisarlas. */
    conArticulos: Array<{ slug: string; articulos: number }>;
    /** Del modelo, con otro nombre, otro valor de `interna` u otro orden: se ajustan. */
    ajustar: Ajuste[];
    /** Del modelo y que faltan en la base: se crean. */
    crear: string[];
  };
  categorias: {
    borrar: string[];
    conArticulos: Array<{ slug: string; articulos: number }>;
    /** Del modelo, con otro nombre: se ajustan. */
    ajustar: Ajuste[];
  };
}

/**
 * Calcula la limpieza. `reescritos` son los wpId de los artículos que el plan va a reescribir con la taxonomía nueva (la vista previa,
 * antes de escribir): esos no cuentan como artículos de una sección o categoría vieja. Sin `reescritos` (la limpieza, después de escribir),
 * cuenta lo que hay en la base en ese momento.
 */
export function planearLimpieza(modelo: ModeloTaxonomia, secciones: readonly SeccionEnBase[], categorias: readonly CategoriaEnBase[], reescritos: ReadonlySet<number> = new Set()): PlanLimpieza {
  const quedan = (articulos: ReadonlyArray<number | null>) => articulos.filter((wpId) => wpId === null || !reescritos.has(wpId)).length;
  const plan: PlanLimpieza = { secciones: { borrar: [], conArticulos: [], ajustar: [], crear: [] }, categorias: { borrar: [], conArticulos: [], ajustar: [] } };

  const seccionDelModelo = new Map(modelo.secciones.map((s, i) => [s.slug, { ...s, orden: i + 1 }]));
  for (const s of [...secciones].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const nueva = seccionDelModelo.get(s.slug);
    if (!nueva) {
      const n = quedan(s.articulos);
      if (n === 0) plan.secciones.borrar.push(s.slug);
      else plan.secciones.conArticulos.push({ slug: s.slug, articulos: n });
      continue;
    }
    const cambios: Ajuste["cambios"] = {};
    if (s.nombre !== nueva.nombre) cambios["nombre"] = { antes: s.nombre, despues: nueva.nombre };
    if (s.interna !== nueva.interna) cambios["interna"] = { antes: s.interna, despues: nueva.interna };
    if ((s.orden ?? null) !== nueva.orden) cambios["orden"] = { antes: s.orden ?? null, despues: nueva.orden };
    if (Object.keys(cambios).length) plan.secciones.ajustar.push({ slug: s.slug, cambios });
  }
  const enBase = new Set(secciones.map((s) => s.slug));
  plan.secciones.crear = modelo.secciones.filter((s) => !enBase.has(s.slug)).map((s) => s.slug);

  const categoriaDelModelo = new Map(modelo.categorias.map((c) => [c.slug, c]));
  for (const c of [...categorias].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const nueva = categoriaDelModelo.get(c.slug);
    if (!nueva) {
      const n = quedan(c.articulos);
      if (n === 0) plan.categorias.borrar.push(c.slug);
      else plan.categorias.conArticulos.push({ slug: c.slug, articulos: n });
      continue;
    }
    if (c.nombre !== nueva.nombre) plan.categorias.ajustar.push({ slug: c.slug, cambios: { nombre: { antes: c.nombre, despues: nueva.nombre } } });
  }
  return plan;
}

/** ¿Hay algo para hacer? */
export const limpiezaVacia = (p: PlanLimpieza): boolean =>
  !p.secciones.borrar.length && !p.secciones.ajustar.length && !p.secciones.crear.length && !p.categorias.borrar.length && !p.categorias.ajustar.length;

/** Una línea por tipo, para el resumen del plan y el informe. */
export function resumenLimpieza(p: PlanLimpieza): string[] {
  const lista = (xs: readonly string[]) => (xs.length ? xs.join(", ") : "ninguna");
  const conArt = (xs: PlanLimpieza["secciones"]["conArticulos"]) => (xs.length ? xs.map((x) => `${x.slug} (${x.articulos})`).join(", ") : "ninguna");
  return [
    `Secciones viejas a borrar (${p.secciones.borrar.length}): ${lista(p.secciones.borrar)}`,
    `Secciones viejas que quedan con artículos (${p.secciones.conArticulos.length}): ${conArt(p.secciones.conArticulos)}`,
    `Secciones a ajustar (${p.secciones.ajustar.length}): ${lista(p.secciones.ajustar.map((a) => `${a.slug} [${Object.keys(a.cambios).join(", ")}]`))}; a crear (${p.secciones.crear.length}): ${lista(p.secciones.crear)}`,
    `Categorías viejas a borrar (${p.categorias.borrar.length}): ${lista(p.categorias.borrar)}`,
    `Categorías viejas que quedan con artículos (${p.categorias.conArticulos.length}): ${conArt(p.categorias.conArticulos)}`,
    `Categorías a ajustar (${p.categorias.ajustar.length}): ${lista(p.categorias.ajustar.map((a) => a.slug))}`,
  ];
}
