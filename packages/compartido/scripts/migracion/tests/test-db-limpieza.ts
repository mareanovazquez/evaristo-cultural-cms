// Tests con base (test:migracion-db), parte 7: la limpieza de la taxonomía vieja (decisión 87, lib/limpiar-taxonomia.ts). Escribe solo en
// evaristo_cms_test; antes y después de cada test se comprueba que evaristo_cms no cambió.
import assert from "node:assert/strict";
import type { PrismaClient } from "../../../src/generated/prisma/client.js";
import { SECCIONES } from "../../../src/secciones.ts";
import { limpiarTaxonomia } from "../lib/limpiar-taxonomia.ts";
import { modeloTaxonomia } from "../lib/taxonomia-vieja.ts";
import { abrirPruebas, crearEjecutor, vaciarYSembrarPruebas } from "./ayudas-db.ts";

const { ta, cantidad } = crearEjecutor();
const conexion = await abrirPruebas();
const { prisma } = conexion;
const modelo = modeloTaxonomia();

/** Una base con el modelo mezclado: secciones y categorías viejas, con y sin artículos, y del modelo con otro nombre u orden. */
async function baseMezclada(p: PrismaClient): Promise<void> {
  await vaciarYSembrarPruebas(p);
  await p.seccion.update({ where: { slug: "entrevista" }, data: { nombre: "Entrevistas", orden: 7 } });
  await p.seccion.delete({ where: { slug: "critica" } });
  const ficcion = await p.seccion.create({ data: { slug: "ficcion", nombre: "Ficción", orden: 20 } });
  await p.seccion.create({ data: { slug: "seda", nombre: "Seda", orden: 21 } });
  const textos = await p.seccion.findUniqueOrThrow({ where: { slug: "textos" } });
  const usada = await p.categoria.create({ data: { slug: "usada", nombre: "Usada" } });
  const enlazada = await p.categoria.create({ data: { slug: "enlazada", nombre: "Enlazada" } });
  await p.categoria.create({ data: { slug: "vieja", nombre: "Vieja" } });
  await p.categoria.create({ data: { slug: "poesia", nombre: "POESÍA" } });
  const art = (slug: string, seccionId: number, extra: Record<string, unknown> = {}) =>
    p.articulo.create({ data: { slug, titulo: slug, cuerpo: { type: "doc", content: [] }, textoPlano: "", seccionId, ...extra } });
  // Uno creado en el panel (sin wpId) en una sección vieja, con una categoría vieja como volanta; otro con una categoría vieja enlazada.
  await art("del-panel", ficcion.id, { categoriaPrincipalId: usada.id });
  const b = await art("con-enlace", textos.id, { wpId: 999001 });
  await p.articuloCategoria.create({ data: { articuloId: b.id, categoriaId: enlazada.id } });
}

const foto = async (p: PrismaClient) => ({
  secciones: await p.seccion.findMany({ select: { slug: true, nombre: true, interna: true, orden: true }, orderBy: { slug: "asc" } }),
  categorias: await p.categoria.findMany({ select: { slug: true, nombre: true }, orderBy: { slug: "asc" } }),
  articulos: await p.articulo.count(),
});

try {
  await ta("L1: en modo de prueba calcula todo y no cambia nada", async () => {
    await baseMezclada(prisma);
    const antes = await foto(prisma);
    const r = await limpiarTaxonomia(prisma, modelo, { prueba: true });
    assert.equal(r.aplicada, false);
    assert.deepEqual(r.plan.secciones.borrar, ["seda"]);
    assert.deepEqual(r.plan.secciones.conArticulos, [{ slug: "ficcion", articulos: 1 }]);
    assert.deepEqual(r.plan.secciones.ajustar, [{ slug: "entrevista", cambios: { nombre: { antes: "Entrevistas", despues: "Entrevista" }, orden: { antes: 7, despues: 1 } } }]);
    assert.deepEqual(r.plan.secciones.crear, ["critica"]);
    assert.deepEqual(r.plan.categorias.borrar, ["vieja"]);
    assert.deepEqual(r.plan.categorias.conArticulos, [{ slug: "enlazada", articulos: 1 }, { slug: "usada", articulos: 1 }]);
    assert.deepEqual(r.plan.categorias.ajustar, [{ slug: "poesia", cambios: { nombre: { antes: "POESÍA", despues: "Poesía" } } }]);
    assert.equal(r.seccionesBorradas, 1);
    assert.equal(r.categoriasBorradas, 1);
    assert.deepEqual(await foto(prisma), antes, "la base quedó como estaba");
  });

  await ta("L2: aplicada, borra solo lo viejo sin artículos y deja las secciones del modelo como SECCIONES", async () => {
    const r = await limpiarTaxonomia(prisma, modelo);
    assert.equal(r.aplicada, true);
    assert.deepEqual([r.seccionesBorradas, r.seccionesAjustadas, r.seccionesCreadas, r.categoriasBorradas, r.categoriasAjustadas], [1, 1, 1, 1, 1]);
    const f = await foto(prisma);
    const delModelo = f.secciones.filter((s) => s.slug !== "ficcion");
    assert.deepEqual(delModelo.map((s) => s.slug).sort(), SECCIONES.map((s) => s.slug).sort());
    for (const [i, s] of SECCIONES.entries()) {
      assert.deepEqual(delModelo.find((x) => x.slug === s.slug), { slug: s.slug, nombre: s.nombre, interna: s.interna, orden: i + 1 }, s.slug);
    }
    // Lo viejo con artículos queda: la sección del artículo del panel y las dos categorías que se usan.
    assert.ok(f.secciones.some((s) => s.slug === "ficcion"));
    assert.deepEqual(f.categorias.map((c) => c.slug), ["enlazada", "poesia", "usada"]);
    assert.equal(f.categorias.find((c) => c.slug === "poesia")!.nombre, "Poesía");
    assert.equal(f.articulos, 2, "ningún artículo se tocó");
  });

  await ta("L3: repetirla no hace nada más (solo vuelve a informar lo viejo que tiene artículos)", async () => {
    const antes = await foto(prisma);
    const r = await limpiarTaxonomia(prisma, modelo);
    assert.deepEqual([r.seccionesBorradas, r.seccionesAjustadas, r.seccionesCreadas, r.categoriasBorradas, r.categoriasAjustadas], [0, 0, 0, 0, 0]);
    assert.deepEqual(r.plan.secciones.conArticulos, [{ slug: "ficcion", articulos: 1 }]);
    assert.equal(r.plan.categorias.conArticulos.length, 2);
    assert.deepEqual(await foto(prisma), antes);
  });

  await ta("L4: cuando ya no tienen artículos, lo viejo se borra en la corrida siguiente", async () => {
    const textos = await prisma.seccion.findUniqueOrThrow({ where: { slug: "textos" } });
    await prisma.articulo.update({ where: { slug: "del-panel" }, data: { seccionId: textos.id, categoriaPrincipalId: null } });
    await prisma.articuloCategoria.deleteMany({});
    const r = await limpiarTaxonomia(prisma, modelo);
    assert.deepEqual(r.plan.secciones.borrar, ["ficcion"]);
    assert.deepEqual(r.plan.categorias.borrar, ["enlazada", "usada"]);
    const f = await foto(prisma);
    assert.deepEqual(f.secciones.map((s) => s.slug).sort(), SECCIONES.map((s) => s.slug).sort());
    assert.deepEqual(f.categorias.map((c) => c.slug), ["poesia"]);
  });
} finally {
  await vaciarYSembrarPruebas(prisma);
  await conexion.cerrar();
}
console.log(`${cantidad()} pruebas con base (parte 7: limpieza de la taxonomía vieja) ok`);
