// Tests con base (test:migracion-db), parte 2: artículos, relaciones y redirecciones. Escriben solo en evaristo_cms_test; antes y después de
// cada test se comprueba que evaristo_cms no cambió. El último test deja la carga completa de los 35 en la base de pruebas.
import assert from "node:assert/strict";
import { validateArticleBodyDetallado } from "../../../src/schema/validate.ts";
import type { Plan } from "../lib/armar.ts";
import { escribirPlan } from "../lib/escribir.ts";
import { nodosImagen } from "../lib/enlaces-imagenes.ts";
import { validarColisiones } from "../lib/validar.ts";
import { abrirPruebas, consultaDe, crearEjecutor, planDePruebas, vaciarYSembrarPruebas } from "./ayudas-db.ts";

const { ta, cantidad } = crearEjecutor();
const conexion = await abrirPruebas();
const { prisma } = conexion;
const SIN_ABORTAR = { abortarAlPrimerError: false };

const sumar = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nodosDe = (cuerpo: unknown) => nodosImagen(cuerpo as never);

async function conteos() {
  return {
    articulos: await prisma.articulo.count(), categorias: await prisma.categoria.count(), autores: await prisma.autor.count(), imagenes: await prisma.imagen.count(),
    articulosCategorias: await prisma.articuloCategoria.count(), articulosAutores: await prisma.articuloAutor.count(), galeria: await prisma.galeriaItem.count(),
    fichas: await prisma.fichaTecnica.count(), redirecciones: await prisma.redireccion.count(),
  };
}

/** Un plan nuevo contra la base ya vaciada y sembrada. */
async function planLimpio(): Promise<Plan> {
  await vaciarYSembrarPruebas(prisma);
  return (await planDePruebas(prisma)).plan;
}

try {
  // -------------------------------------------------------------------------------------------------------------
  // D05: colisión por intercalación (utf8mb4_es_0900_ai_ci): mayúsculas y tildes son iguales; la ñ no
  // -------------------------------------------------------------------------------------------------------------
  await ta("D05: dos slugs que solo difieren en mayúsculas o tildes: validar los detecta antes de insertar y la base rechaza el insert directo", async () => {
    const plan = await planLimpio();
    const [a, b, c] = plan.articulos.filter((x) => x.estado === "PUBLICADO" && /e/.test(x.slug) && x.slug === x.slug.toLowerCase());
    assert.ok(a && b && c);
    const bMayus = { ...b, slug: a.slug.toUpperCase() };
    const cTilde = { ...c, slug: a.slug.replace("e", "é") };
    assert.notEqual(bMayus.slug, a.slug);
    assert.notEqual(cTilde.slug, a.slug);

    // 1. la validación (la decide la base) los detecta antes de insertar nada
    const colisiones = await validarColisiones({ ...plan, articulos: [a, bMayus] }, consultaDe(prisma));
    assert.deepEqual(colisiones.problemas.map((p) => [p.wpId, p.codigo]).sort(), [[a.wpId, "slug_duplicado_en_el_plan"], [b.wpId, "slug_duplicado_en_el_plan"]].sort());
    const tildes = await validarColisiones({ ...plan, articulos: [a, cTilde] }, consultaDe(prisma));
    assert.deepEqual(tildes.problemas.map((p) => p.codigo), ["slug_duplicado_en_el_plan", "slug_duplicado_en_el_plan"]);
    // la ñ es una letra distinta de la n: no es colisión
    const ene = await validarColisiones({ ...plan, articulos: [{ ...a, slug: "ano-nuevo" }, { ...b, slug: "año-nuevo" }] }, consultaDe(prisma));
    assert.deepEqual(ene.problemas, []);
    assert.equal(await prisma.articulo.count(), 0, "validar no insertó nada");

    // 2. contra una fila que ya existe en la base
    const seccion = (await prisma.seccion.findUnique({ where: { slug: "ensayo" } }))!;
    const fila = (slug: string, wpId: number) => ({ wpId, slug, titulo: "t", cuerpo: { type: "doc", content: [] }, textoPlano: "", seccionId: seccion.id });
    await prisma.articulo.create({ data: fila(a.slug, 900001) });
    const existente = await validarColisiones({ ...plan, articulos: [bMayus] }, consultaDe(prisma));
    assert.deepEqual(existente.problemas.map((p) => [p.wpId, p.codigo]), [[b.wpId, "slug_choca_con_articulo_existente"]]);

    // 3. la base rechaza el insert directo (P2002: clave única)
    await assert.rejects(() => prisma.articulo.create({ data: fila(bMayus.slug, 900002) }), (e: { code?: string }) => e.code === "P2002");
    await assert.rejects(() => prisma.articulo.create({ data: fila(cTilde.slug, 900003) }), (e: { code?: string }) => e.code === "P2002");
    await prisma.articulo.create({ data: fila("año-nuevo", 900004) });
    await prisma.articulo.create({ data: fila("ano-nuevo", 900005) });
    assert.equal(await prisma.articulo.count(), 3);
  });

  // -------------------------------------------------------------------------------------------------------------
  // D06: conflicto de redirección
  // -------------------------------------------------------------------------------------------------------------
  await ta("D06: un origen de redirección que ya existe no se pisa y se reporta como conflicto", async () => {
    const plan = await planLimpio();
    const o1 = plan.articulos[0]!.redirecciones[0]!.origen;
    const o2 = plan.articulos[1]!.redirecciones[0]!.origen;
    assert.notEqual(o2.toUpperCase(), o2);
    // uno idéntico y otro que solo difiere en mayúsculas (la intercalación los considera iguales)
    await prisma.redireccion.create({ data: { origen: o1, tipo: "MANUAL", codigo: 302, destino: "/otra-cosa" } });
    await prisma.redireccion.create({ data: { origen: o2.toUpperCase(), tipo: "MANUAL", codigo: 301, destino: "/otra-mas" } });

    const r = await escribirPlan(prisma, plan, SIN_ABORTAR);
    assert.equal(r.estado, "ok");
    assert.equal(r.conteos.escritos, 35);
    assert.equal(r.redirecciones.conflictos, 2);
    assert.equal(r.redirecciones.creadas, 56);
    const delConflicto = r.conflictos.filter((c) => c.tabla === "redirecciones");
    assert.deepEqual(delConflicto.map((c) => c.clave).sort(), [o1, o2].sort());
    assert.ok(delConflicto.every((c) => (c.detalle as { existente: { tipo: string } }).existente.tipo === "MANUAL"));
    // las filas existentes quedaron como estaban
    const a = (await prisma.redireccion.findUnique({ where: { origen: o1 } }))!;
    assert.deepEqual([a.tipo, a.codigo, a.destino, a.articuloId, a.autorId], ["MANUAL", 302, "/otra-cosa", null, null]);
    const b = (await prisma.redireccion.findUnique({ where: { origen: o2.toUpperCase() } }))!;
    assert.deepEqual([b.origen, b.tipo, b.destino, b.articuloId], [o2.toUpperCase(), "MANUAL", "/otra-mas", null]);
    // el resto se escribió: 58 del plan - 2 en conflicto + 2 que ya estaban
    assert.equal(await prisma.redireccion.count(), 58);
    // y los artículos en conflicto se escribieron igual
    assert.equal(await prisma.articulo.count(), 35);
  });

  // -------------------------------------------------------------------------------------------------------------
  // D04: un artículo falla
  // -------------------------------------------------------------------------------------------------------------
  await ta("D04: si un artículo falla se deshace solo ese artículo, los demás se escriben y el estado es error", async () => {
    const plan = await planLimpio();
    const fallar = plan.articulos[2]!;
    const antes = await conteos();
    assert.equal(antes.articulos, 0);
    const r = await escribirPlan(prisma, plan, SIN_ABORTAR, {
      alFinalDelArticulo: async (wpId, tx) => {
        if (wpId !== fallar.wpId) return;
        // a esta altura ya se escribieron el artículo, sus relaciones y sus redirecciones: todo eso tiene que deshacerse
        assert.equal(await tx.articulo.count({ where: { wpId } }), 1);
        throw new Error("falla inyectada");
      },
    });
    assert.equal(r.estado, "error");
    assert.equal(r.abortado, false);
    assert.deepEqual(r.conteos, { escritos: 34, sinCambios: 0, difieren: 0, sobrescritos: 0, fallidos: 1 });
    const mal = r.articulos.find((x) => x.resultado === "fallido")!;
    assert.deepEqual([mal.wpId, mal.motivo], [fallar.wpId, "falla inyectada"]);

    // nada parcial del artículo que falló
    assert.equal(await prisma.articulo.count({ where: { wpId: fallar.wpId } }), 0);
    const otros = plan.articulos.filter((x) => x !== fallar);
    const despues = await conteos();
    assert.equal(despues.articulos, 34);
    assert.equal(despues.articulosCategorias, sumar(otros.map((x) => new Set(x.categorias).size)));
    assert.equal(despues.articulosAutores, sumar(otros.map((x) => x.autores.length)));
    const delAutor = plan.redirecciones.filter((x) => x.tipo === "AUTOR").length;
    assert.equal(despues.redirecciones, sumar(otros.map((x) => x.redirecciones.length)) + delAutor);
    for (const rd of fallar.redirecciones) assert.equal(await prisma.redireccion.findUnique({ where: { origen: rd.origen } }), null);
    // la categoría y el autor, que se escriben antes y fuera de la transacción del artículo, siguen ahí
    assert.equal(despues.categorias, 8);
    assert.equal(despues.autores, plan.autores.length);
  });

  await ta("D04: con abortar al primer error corta ahí y no escribe lo que sigue", async () => {
    const plan = await planLimpio();
    const fallar = plan.articulos[2]!;
    const r = await escribirPlan(prisma, plan, { abortarAlPrimerError: true }, { alFinalDelArticulo: (wpId) => { if (wpId === fallar.wpId) throw new Error("falla inyectada"); } });
    assert.equal(r.estado, "error");
    assert.equal(r.abortado, true);
    assert.deepEqual(r.articulos.map((x) => [x.wpId, x.resultado]), [[plan.articulos[0]!.wpId, "escrito"], [plan.articulos[1]!.wpId, "escrito"], [fallar.wpId, "fallido"]]);
    assert.equal(await prisma.articulo.count(), 2);
    assert.equal(await prisma.redireccion.count({ where: { tipo: "AUTOR" } }), 0, "no se escribieron las redirecciones de autor");
    assert.equal(await prisma.articulo.count({ where: { wpId: fallar.wpId } }), 0);
  });

  await ta("D04: un artículo que depende de una imagen en conflicto es fallido y no se escribe", async () => {
    const plan = await planLimpio();
    const imagen = plan.imagenes.find((i) => i.usos.includes("encabezado"))!;
    await prisma.imagen.create({ data: { clave: imagen.clave, nombreOriginal: "ajena.jpg", tipoMime: "image/jpeg", ancho: 1, alto: 1, bytes: 1, hash: "b".repeat(64), wpId: 777777 } });
    const r = await escribirPlan(prisma, plan, SIN_ABORTAR);
    assert.equal(r.estado, "error");
    const fallidos = r.articulos.filter((x) => x.resultado === "fallido").map((x) => x.wpId).sort((x, y) => x - y);
    assert.deepEqual(fallidos, [...imagen.articulos].sort((x, y) => x - y));
    for (const wpId of fallidos) assert.equal(await prisma.articulo.count({ where: { wpId } }), 0);
    assert.equal(r.conteos.escritos, 35 - fallidos.length);
    assert.equal(r.conflictos.filter((c) => c.tabla === "imagenes").length, 1);
  });

  // -------------------------------------------------------------------------------------------------------------
  // D07: original_faltante de punta a punta
  // -------------------------------------------------------------------------------------------------------------
  await ta("D07: los artículos 2462 y 22546 (sin original) se escriben sin encabezado, con el aviso guardado y altPendientes del plan", async () => {
    const plan = await planLimpio();
    const r = await escribirPlan(prisma, plan, SIN_ABORTAR);
    assert.equal(r.estado, "ok");
    for (const [wpId, adjunto] of [[2462, 2464], [22546, 22547]] as const) {
      const a = plan.articulos.find((x) => x.wpId === wpId)!;
      const fila = (await prisma.articulo.findUnique({ where: { wpId } }))!;
      assert.equal(a.imagenEncabezado, null);
      assert.equal(fila.imagenEncabezadoId, null);
      assert.equal(await prisma.imagen.findUnique({ where: { wpId: adjunto } }), null, "no hay fila para el adjunto sin original");
      assert.deepEqual([fila.encabezadoAlt, fila.encabezadoCredito], [null, null]);
      // el aviso queda guardado, con el alt y el crédito que declaraba WordPress
      const migracion = (fila.avisosMigracion as { migracion: Array<{ code: string; detalle: Record<string, unknown> }> }).migracion;
      const aviso = migracion.find((x) => x.code === "original_faltante" && x.detalle["contexto"] === "encabezado");
      assert.ok(aviso, `aviso original_faltante en ${wpId}`);
      assert.equal(aviso.detalle["adjuntoWpId"], adjunto);
      assert.deepEqual(fila.avisosMigracion, JSON.parse(JSON.stringify(a.avisosMigracion)));
      // sin encabezado no suma al contador: queda lo pendiente del cuerpo
      assert.equal(fila.altPendientes, a.altPendientes);
      assert.equal(fila.altPendientes, a.altPendientesCuerpo);
    }
    const borrador = (await prisma.articulo.findUnique({ where: { wpId: 22546 } }))!;
    assert.deepEqual([borrador.estado, borrador.publicadoEn], ["BORRADOR", null]);
  });

  // -------------------------------------------------------------------------------------------------------------
  // D01: carga completa de los 35 (queda en la base de pruebas)
  // -------------------------------------------------------------------------------------------------------------
  await ta("D01: carga completa de los 35: conteos por tabla contra el plan, cuerpo sin imagenWpId y con imagenId válidos", async () => {
    const plan = await planLimpio();
    const r = await escribirPlan(prisma, plan, SIN_ABORTAR);
    assert.equal(r.estado, "ok");
    assert.equal(r.abortado, false);
    assert.deepEqual(r.conteos, { escritos: 35, sinCambios: 0, difieren: 0, sobrescritos: 0, fallidos: 0 });
    assert.deepEqual(r.conflictos, []);
    assert.deepEqual(r.redirecciones, { creadas: 58, sinCambios: 0, conflictos: 0 });

    // conteos por tabla contra el plan
    const c = await conteos();
    assert.deepEqual(c, {
      articulos: 35, categorias: 8, autores: plan.autores.length, imagenes: 200,
      articulosCategorias: sumar(plan.articulos.map((a) => new Set(a.categorias).size)), articulosAutores: sumar(plan.articulos.map((a) => a.autores.length)),
      galeria: 0, fichas: 0, redirecciones: 58,
    });
    assert.equal(await prisma.articulo.count({ where: { estado: "PUBLICADO" } }), 34);
    assert.equal(await prisma.articulo.count({ where: { estado: "BORRADOR" } }), 1);
    assert.equal(await prisma.seccion.count(), 18);
    for (const tipo of ["ARTICULO", "SLUG_ANTERIOR", "AUTOR"] as const) {
      assert.equal(await prisma.redireccion.count({ where: { tipo } }), plan.redirecciones.filter((x) => x.tipo === tipo).length, tipo);
    }
    // exactamente un destino por redirección
    for (const rd of await prisma.redireccion.findMany()) {
      assert.equal([rd.articuloId, rd.autorId, rd.destino].filter((x) => x !== null).length, 1, rd.origen);
    }

    // artículo por artículo
    const idsImagenes = new Set((await prisma.imagen.findMany({ select: { id: true } })).map((x) => x.id));
    let conImagenId = 0;
    for (const a of plan.articulos) {
      const fila = (await prisma.articulo.findUnique({
        where: { wpId: a.wpId }, include: { seccion: true, categoriaPrincipal: true, categorias: { include: { categoria: true } }, autores: { include: { autor: true } }, imagenEncabezado: true },
      }))!;
      assert.ok(fila, `artículo ${a.wpId}`);
      assert.deepEqual([fila.slug, fila.titulo, fila.bajada, fila.estado, fila.schemaVersion, fila.textoPlano, fila.visitasWp, fila.altPendientes],
        [a.slug, a.titulo, a.bajada, a.estado, a.schemaVersion, a.textoPlano, a.visitasWp, a.altPendientes], `columnas de ${a.wpId}`);
      assert.equal(fila.seccion.slug, a.seccion);
      assert.equal(fila.categoriaPrincipal?.slug ?? null, a.categoriaPrincipal);
      assert.deepEqual(fila.categorias.map((x) => x.categoria.slug).sort(), [...new Set(a.categorias)].sort());
      assert.deepEqual(fila.autores.map((x) => [x.autor.wpUserId, x.orden]), a.autores.map((x) => [x.wpUserId, x.orden]));
      assert.equal(fila.publicadoEn?.toISOString() ?? null, a.publicadoEn);
      assert.deepEqual(fila.avisosMigracion, a.avisosMigracion === null ? null : JSON.parse(JSON.stringify(a.avisosMigracion)));
      assert.deepEqual(fila.etiquetasWp, a.etiquetasWp);
      // encabezado: la fila con el wpId del adjunto, o null si no hay fila
      const esperadoEncabezado = a.imagenEncabezado === null ? null : (await prisma.imagen.findUnique({ where: { wpId: a.imagenEncabezado.wpId } }))!.id;
      assert.equal(fila.imagenEncabezadoId, esperadoEncabezado);
      // cuerpo: sin imagenWpId, con imagenId que existe, y válido en modo migración
      const texto = JSON.stringify(fila.cuerpo);
      assert.ok(!texto.includes("imagenWpId"), `el cuerpo de ${a.wpId} conserva imagenWpId`);
      const nodos = nodosDe(fila.cuerpo);
      const delPlan = nodosDe(a.cuerpo);
      assert.equal(nodos.length, delPlan.length);
      nodos.forEach((n, i) => {
        const original = delPlan[i]!.attrs ?? {};
        if ("imagenWpId" in original) {
          const id = n.attrs?.["imagenId"];
          assert.ok(typeof id === "number" && idsImagenes.has(id), `imagenId válido en ${a.wpId}`);
          assert.equal(n.attrs?.["src"], original["src"]);
          conImagenId++;
        } else assert.ok(!("imagenId" in (n.attrs ?? {})));
      });
      assert.deepEqual(validateArticleBodyDetallado(fila.cuerpo as never, { modo: "migracion" }).errores, [], `cuerpo de ${a.wpId}`);
    }
    assert.ok(conImagenId > 0, "hay imágenes de cuerpo enlazadas");
    assert.equal(conImagenId, sumar(plan.articulos.map((a) => nodosDe(a.cuerpo).filter((n) => "imagenWpId" in (n.attrs ?? {})).length)));
    assert.equal((await prisma.articulo.findUnique({ where: { wpId: 22546 } }))!.publicadoEn, null);

    // una segunda corrida lo informa todo como sin cambios
    const otra = await escribirPlan(prisma, plan, SIN_ABORTAR);
    assert.equal(otra.estado, "ok");
    assert.deepEqual(otra.conteos, { escritos: 0, sinCambios: 35, difieren: 0, sobrescritos: 0, fallidos: 0 });
    assert.deepEqual(otra.redirecciones, { creadas: 0, sinCambios: 58, conflictos: 0 });
    assert.deepEqual(await conteos(), c);
  });

  console.log(`${cantidad()} pruebas con base (parte 2) ok`);
} finally {
  await conexion.cerrar();
}
