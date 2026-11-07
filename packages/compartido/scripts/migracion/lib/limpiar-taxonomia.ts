// La limpieza de la taxonomía vieja (decisión 87): la parte que ESCRIBE. Recibe un cliente ya abierto (no abre conexiones ni importa
// escribir.ts): la usa correr-escritura.ts con la conexión de escritura de la corrida, después de escribir los artículos, cuando se pidió
// --limpiar-taxonomia. Todo va en una transacción: o se hace entero, o no se hace nada.
//
// Cada borrado vuelve a exigir, en la misma consulta, que la sección o la categoría no tenga artículos (ni como volanta): aunque el plan se
// calcule con datos de hace un instante, lo que tenga artículos no se borra nunca.
import type { PrismaClient } from "../../../src/generated/prisma/client.js";
import { planearLimpieza } from "./taxonomia-vieja.ts";
import type { ModeloTaxonomia, PlanLimpieza } from "./taxonomia-vieja.ts";

export interface ResultadoLimpieza {
  /** Lo que se calculó al empezar, con lo que había en la base en ese momento. */
  plan: PlanLimpieza;
  seccionesBorradas: number;
  seccionesAjustadas: number;
  seccionesCreadas: number;
  categoriasBorradas: number;
  categoriasAjustadas: number;
  /** false con `prueba`: se hizo todo y se deshizo al final. */
  aplicada: boolean;
}

class Deshacer extends Error {
  constructor(readonly resultado: ResultadoLimpieza) {
    super("limpieza de prueba: se deshace");
  }
}

/** Con `prueba`, hace todo dentro de la transacción y la deshace al final (para ver qué pasaría, sin cambiar nada). */
export async function limpiarTaxonomia(prisma: PrismaClient, modelo: ModeloTaxonomia, opciones: { prueba?: boolean } = {}): Promise<ResultadoLimpieza> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const secciones = await tx.seccion.findMany({ select: { slug: true, nombre: true, interna: true, orden: true, articulos: { select: { wpId: true } } } });
        const categorias = await tx.categoria.findMany({ select: { slug: true, nombre: true, articulos: { select: { articulo: { select: { wpId: true } } } }, principalDe: { select: { wpId: true } } } });
        const plan = planearLimpieza(
          modelo,
          secciones.map((s) => ({ slug: s.slug, nombre: s.nombre, interna: s.interna, orden: s.orden, articulos: s.articulos.map((a) => a.wpId) })),
          categorias.map((c) => ({ slug: c.slug, nombre: c.nombre, articulos: [...c.articulos.map((x) => x.articulo.wpId), ...c.principalDe.map((a) => a.wpId)] })),
        );

        const seccionesBorradas = plan.secciones.borrar.length
          ? (await tx.seccion.deleteMany({ where: { slug: { in: plan.secciones.borrar }, articulos: { none: {} } } })).count
          : 0;
        const categoriasBorradas = plan.categorias.borrar.length
          ? (await tx.categoria.deleteMany({ where: { slug: { in: plan.categorias.borrar }, articulos: { none: {} }, principalDe: { none: {} } } })).count
          : 0;
        // Si algo cambió entre el cálculo y el borrado (alguien le asignó un artículo), no se borra a medias: se deshace todo.
        if (seccionesBorradas !== plan.secciones.borrar.length || categoriasBorradas !== plan.categorias.borrar.length) {
          throw new Error(`La limpieza no pudo borrar todo lo previsto (secciones ${seccionesBorradas} de ${plan.secciones.borrar.length}, categorías ${categoriasBorradas} de ${plan.categorias.borrar.length}): se deshizo sin cambiar nada`);
        }

        const orden = new Map(modelo.secciones.map((s, i) => [s.slug, i + 1]));
        for (const a of plan.secciones.ajustar) {
          const s = modelo.secciones.find((x) => x.slug === a.slug)!;
          await tx.seccion.update({ where: { slug: a.slug }, data: { nombre: s.nombre, interna: s.interna, orden: orden.get(a.slug)! } });
        }
        for (const slug of plan.secciones.crear) {
          const s = modelo.secciones.find((x) => x.slug === slug)!;
          await tx.seccion.create({ data: { slug, nombre: s.nombre, interna: s.interna, orden: orden.get(slug)! } });
        }
        for (const a of plan.categorias.ajustar) {
          await tx.categoria.update({ where: { slug: a.slug }, data: { nombre: modelo.categorias.find((x) => x.slug === a.slug)!.nombre } });
        }

        const resultado: ResultadoLimpieza = {
          plan, seccionesBorradas, categoriasBorradas, aplicada: !opciones.prueba,
          seccionesAjustadas: plan.secciones.ajustar.length, seccionesCreadas: plan.secciones.crear.length, categoriasAjustadas: plan.categorias.ajustar.length,
        };
        if (opciones.prueba) throw new Deshacer(resultado);
        return resultado;
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    if (e instanceof Deshacer) return e.resultado;
    throw e;
  }
}
