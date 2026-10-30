// Tests con base (test:migracion-db), parte 5: subconjuntos con --ids y escritura incremental (D10). Escriben solo en evaristo_cms_test; antes y
// después de cada test se comprueba que evaristo_cms no cambió.
import assert from "node:assert/strict";
import type { PrismaClient } from "../../../src/generated/prisma/client.js";
import { escribirPlan } from "../lib/escribir.ts";
import type { PlanEscribible } from "../lib/escribir.ts";
import { abrirPruebas, crearEjecutor, planDePruebas, vaciarYSembrarPruebas } from "./ayudas-db.ts";

const { ta, cantidad } = crearEjecutor();
const conexion = await abrirPruebas();
const { prisma } = conexion;
const SIN_ABORTAR = { abortarAlPrimerError: false };
const porNumero = (a: number, b: number) => a - b;
const aJson = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Cambia cada imagenId del cuerpo por el wpId de su imagen: los ids de las filas dependen del orden en que se escribió. */
function cuerpoPorWpId(nodo: unknown, wpIdDe: Map<number, number>): unknown {
  if (Array.isArray(nodo)) return nodo.map((x) => cuerpoPorWpId(x, wpIdDe));
  if (nodo !== null && typeof nodo === "object") {
    return Object.fromEntries(Object.entries(nodo as Record<string, unknown>).map(([k, v]) => (k === "imagenId" && typeof v === "number" ? ["imagenWpId", wpIdDe.get(v)] : [k, cuerpoPorWpId(v, wpIdDe)])));
  }
  return nodo;
}

/** Todo el contenido de la base de pruebas sin id, creadoEn ni actualizadoEn: las relaciones por clave natural y los ids dentro del cuerpo por wpId. */
async function contenido(p: PrismaClient) {
  const sin = <T extends Record<string, unknown>>(f: T, ...quitar: string[]) => Object.fromEntries(Object.entries(f).filter(([k]) => !["id", "creadoEn", "actualizadoEn", ...quitar].includes(k)));
  const imagenes = await p.imagen.findMany({ orderBy: { wpId: "asc" } });
  const autores = await p.autor.findMany({ orderBy: { wpUserId: "asc" } });
  const categorias = await p.categoria.findMany({ orderBy: { slug: "asc" } });
  const secciones = await p.seccion.findMany();
  const wpIdDeImagen = new Map(imagenes.map((i) => [i.id, i.wpId as number]));
  const slugDeCategoria = new Map(categorias.map((c) => [c.id, c.slug]));
  const slugDeSeccion = new Map(secciones.map((s) => [s.id, s.slug]));
  const wpUserIdDeAutor = new Map(autores.map((a) => [a.id, a.wpUserId as number]));
  const articulos = await p.articulo.findMany({ orderBy: { wpId: "asc" }, include: { categorias: true, autores: true, galeria: true } });
  const wpIdDeArticulo = new Map(articulos.map((a) => [a.id, a.wpId as number]));
  const redirecciones = await p.redireccion.findMany({ orderBy: { origen: "asc" } });
  return aJson({
    conteos: { articulos: articulos.length, categorias: categorias.length, autores: autores.length, imagenes: imagenes.length, redirecciones: redirecciones.length,
      articulosCategorias: articulos.reduce((n, a) => n + a.categorias.length, 0), articulosAutores: articulos.reduce((n, a) => n + a.autores.length, 0), galeria: articulos.reduce((n, a) => n + a.galeria.length, 0), secciones: secciones.length },
    categorias: categorias.map((c) => sin(c)),
    autores: autores.map((a) => sin(a)),
    imagenes: imagenes.map((i) => sin(i)),
    articulos: articulos.map((a) => ({
      ...sin(a, "categorias", "autores", "galeria", "seccionId", "categoriaPrincipalId", "imagenEncabezadoId", "redesImagenId", "cuerpo"),
      seccion: slugDeSeccion.get(a.seccionId), categoriaPrincipal: a.categoriaPrincipalId === null ? null : slugDeCategoria.get(a.categoriaPrincipalId),
      imagenEncabezado: a.imagenEncabezadoId === null ? null : wpIdDeImagen.get(a.imagenEncabezadoId), redesImagen: a.redesImagenId === null ? null : wpIdDeImagen.get(a.redesImagenId),
      cuerpo: cuerpoPorWpId(a.cuerpo, wpIdDeImagen),
      categorias: a.categorias.map((x) => slugDeCategoria.get(x.categoriaId)).sort(),
      autores: a.autores.map((x) => [wpUserIdDeAutor.get(x.autorId), x.orden]).sort((x, y) => (x[0] as number) - (y[0] as number)),
      galeria: a.galeria.map((g) => [wpIdDeImagen.get(g.imagenId), g.orden, g.alt, g.epigrafe]).sort((x, y) => (x[1] as number) - (y[1] as number)),
    })),
    redirecciones: redirecciones.map((r) => ({
      origen: r.origen, tipo: r.tipo, codigo: r.codigo, destino: r.destino,
      articulo: r.articuloId === null ? null : wpIdDeArticulo.get(r.articuloId), autor: r.autorId === null ? null : wpUserIdDeAutor.get(r.autorId),
    })),
  });
}

try {
  // -------------------------------------------------------------------------------------------------------------
  // El plan de un subconjunto trae solo lo suyo
  // -------------------------------------------------------------------------------------------------------------
  await ta("D10: el plan de --ids=<un id> incluye solo sus categorías, autores, imágenes y redirecciones (artículo, slug anterior y las de autor de SUS autores)", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan: completo } = await planDePruebas(prisma);
    assert.equal(completo.articulos.length, 35);
    for (const art of completo.articulos) {
      const { plan: sub } = await planDePruebas(prisma, [art.wpId]);
      assert.deepEqual(sub.articulos.map((a) => a.wpId), [art.wpId]);
      assert.deepEqual(aJson(sub.articulos[0]), aJson(art), `${art.wpId}: es el mismo registro que en el plan completo`);
      const wpUserIds = art.autores.map((x) => x.wpUserId);
      assert.deepEqual(sub.categoriasACrear.map((c) => c.slug).sort(), [...art.categorias].sort(), `${art.wpId}: categorías`);
      assert.ok(sub.categoriasACrear.every((c) => c.articulos.length === 1 && c.articulos[0] === art.wpId));
      assert.deepEqual(sub.autores.map((a) => a.wpUserId), wpUserIds, `${art.wpId}: autores`);
      assert.ok(sub.autores.every((a) => a.articulosEnMuestra.length === 1 && a.articulosEnMuestra[0] === art.wpId));
      const imagenes = completo.imagenes.filter((i) => i.articulos.includes(art.wpId)).map((i) => i.wpId).sort(porNumero);
      assert.deepEqual(sub.imagenes.map((i) => i.wpId).sort(porNumero), imagenes, `${art.wpId}: imágenes`);
      assert.ok(sub.imagenes.every((i) => i.articulos.length === 1 && i.articulos[0] === art.wpId));
      assert.deepEqual(sub.imagenesSinFila.map((i) => i.adjuntoWpId).sort(porNumero), completo.imagenesSinFila.filter((i) => i.articulos.includes(art.wpId)).map((i) => i.adjuntoWpId).sort(porNumero), `${art.wpId}: sin original`);
      assert.deepEqual(sub.imagenesReferenciadas.map((i) => i.clave).sort(), completo.imagenesReferenciadas.filter((i) => i.articulos.includes(art.wpId)).map((i) => i.clave).sort());
      const propias = [...art.redirecciones.map((r) => r.origen), ...completo.redirecciones.filter((r) => r.tipo === "AUTOR" && r.autorWpUserId !== null && wpUserIds.includes(r.autorWpUserId)).map((r) => r.origen)];
      assert.deepEqual(sub.redirecciones.map((r) => r.origen).sort(), propias.sort(), `${art.wpId}: redirecciones`);
      assert.ok(sub.redirecciones.every((r) => r.articuloWpId === art.wpId || (r.tipo === "AUTOR" && wpUserIds.includes(r.autorWpUserId!))));
      assert.deepEqual(sub.problemas.filter((p) => p.bloqueante), [], `${art.wpId}: sin bloqueantes`);
    }
  });

  // -------------------------------------------------------------------------------------------------------------
  // El 22546 (borrador, sin encabezado) y el 2462 se escriben solos
  // -------------------------------------------------------------------------------------------------------------
  for (const id of [22546, 2462]) {
    await ta(`D10: el ${id} se puede escribir solo`, async () => {
      await vaciarYSembrarPruebas(prisma);
      const { plan } = await planDePruebas(prisma, [id]);
      assert.deepEqual(plan.articulos.map((a) => a.wpId), [id]);
      const r = await escribirPlan(prisma, plan, SIN_ABORTAR);
      assert.equal(r.estado, "ok");
      assert.deepEqual(r.conteos, { escritos: 1, sinCambios: 0, difieren: 0, sobrescritos: 0, fallidos: 0 });
      assert.deepEqual(r.conflictos, []);
      assert.equal(await prisma.articulo.count(), 1);
      const fila = (await prisma.articulo.findUnique({ where: { wpId: id }, include: { categorias: true, autores: true } }))!;
      assert.equal(fila.imagenEncabezadoId, null, "sin original: sin encabezado");
      assert.equal(fila.autores.length, plan.articulos[0]!.autores.length);
      assert.equal(fila.categorias.length, plan.articulos[0]!.categorias.length);
      assert.equal(await prisma.categoria.count(), plan.categoriasACrear.length);
      assert.equal(await prisma.autor.count(), plan.autores.length);
      assert.equal(await prisma.imagen.count(), plan.imagenes.length);
      assert.equal(await prisma.redireccion.count(), plan.redirecciones.length);
      if (id === 22546) assert.equal(fila.estado, "BORRADOR");
      // volver a escribirlo no cambia nada
      const otra = await escribirPlan(prisma, plan, SIN_ABORTAR);
      assert.deepEqual(otra.conteos, { escritos: 0, sinCambios: 1, difieren: 0, sobrescritos: 0, fallidos: 0 });
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // D10: equivalencia incremental
  // -------------------------------------------------------------------------------------------------------------
  await ta("D10: escribir un id y después los otros 34 deja la base igual a escribir los 35 de una vez (conteos y contenido)", async () => {
    // 1. los 35 de una vez
    await vaciarYSembrarPruebas(prisma);
    const { plan: completo } = await planDePruebas(prisma);
    const de35 = await escribirPlan(prisma, completo, SIN_ABORTAR);
    assert.deepEqual(de35.conteos, { escritos: 35, sinCambios: 0, difieren: 0, sobrescritos: 0, fallidos: 0 });
    const esperado = await contenido(prisma);
    assert.deepEqual(esperado.conteos, { articulos: 35, categorias: 7, autores: completo.autores.length, imagenes: 200, redirecciones: 58, articulosCategorias: esperado.conteos.articulosCategorias, articulosAutores: 35, galeria: 0, secciones: 9 });

    const texto = JSON.stringify(esperado.articulos);
    assert.ok(texto.includes('"imagenWpId":') && !texto.includes('"imagenId"'), "la comparación normaliza los imagenId del cuerpo (dependen del orden de escritura)");

    // 2. el 22546 solo, y después los otros 34 de a uno (con un plan nuevo cada vez, validado contra lo que ya hay)
    await vaciarYSembrarPruebas(prisma);
    const ids = [22546, ...completo.articulos.map((a) => a.wpId).filter((id) => id !== 22546)];
    let escritos = 0, sinCambios = 0, redirecciones = { creadas: 0, sinCambios: 0, conflictos: 0 };
    for (const id of ids) {
      const { plan } = await planDePruebas(prisma, [id]);
      assert.deepEqual(plan.articulos.map((a) => a.wpId), [id]);
      const r = await escribirPlan(prisma, plan, SIN_ABORTAR);
      assert.equal(r.estado, "ok", `${id}`);
      assert.deepEqual([r.conteos.escritos, r.conteos.fallidos, r.conflictos.length], [1, 0, 0], `${id}`);
      escritos += r.conteos.escritos; sinCambios += r.conteos.sinCambios;
      redirecciones = { creadas: redirecciones.creadas + r.redirecciones.creadas, sinCambios: redirecciones.sinCambios + r.redirecciones.sinCambios, conflictos: redirecciones.conflictos + r.redirecciones.conflictos };
    }
    assert.deepEqual([escritos, sinCambios], [35, 0]);
    assert.equal(redirecciones.creadas, 58, "cada redirección se creó una sola vez");
    assert.equal(redirecciones.conflictos, 0);
    const incremental = await contenido(prisma);
    assert.deepEqual(incremental.conteos, esperado.conteos, "mismos conteos");
    assert.deepEqual(incremental.categorias, esperado.categorias);
    assert.deepEqual(incremental.autores, esperado.autores);
    assert.deepEqual(incremental.imagenes, esperado.imagenes);
    assert.deepEqual(incremental.articulos, esperado.articulos, "mismo contenido de los artículos y sus relaciones");
    assert.deepEqual(incremental.redirecciones, esperado.redirecciones);
  });

  await ta("D10: al terminar queda la carga completa de los 35 en evaristo_cms_test", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    assert.equal((await escribirPlan(prisma, plan as PlanEscribible, SIN_ABORTAR)).conteos.escritos, 35);
    assert.equal(await prisma.articulo.count(), 35);
  });

  console.log(`${cantidad()} pruebas con base (parte 5) ok`);
} finally {
  await conexion.cerrar();
}
