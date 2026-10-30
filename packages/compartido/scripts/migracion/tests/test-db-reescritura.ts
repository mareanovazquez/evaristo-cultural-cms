// Tests con base (test:migracion-db), parte 3: re-ejecución, política de no pisar, sobrescritura confirmada y galería. Escriben solo en
// evaristo_cms_test; antes y después de cada test se comprueba que evaristo_cms no cambió.
import assert from "node:assert/strict";
import { ErrorDeSobrescritura, comparable, escribirPlan } from "../lib/escribir.ts";
import type { PlanEscribible, ResultadoEscritura, Sobrescritura } from "../lib/escribir.ts";
import { abrirPruebas, crearEjecutor, planDePruebas, vaciarYSembrarPruebas } from "./ayudas-db.ts";

const { ta, cantidad } = crearEjecutor();
const conexion = await abrirPruebas();
const { prisma } = conexion;
const SIN_ABORTAR = { abortarAlPrimerError: false };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Una sobrescritura confirmada con el total correcto para las listas dadas (wpId de artículos, wpUserId de autores y wpId de imágenes). */
const sobre = (articulos: number[] = [], autores: number[] = [], imagenes: number[] = []): Sobrescritura => ({ cantidad: articulos.length + autores.length + imagenes.length, articulos, autores, imagenes });
const NINGUNO = { articulos: [], autores: [], imagenes: [] };

async function planLimpio(): Promise<PlanEscribible> {
  await vaciarYSembrarPruebas(prisma);
  return (await planDePruebas(prisma)).plan;
}

/** Foto de la base: ids, instantes de actualización y contenido de las relaciones. */
async function foto() {
  const t = (d: Date) => d.toISOString();
  return {
    articulos: (await prisma.articulo.findMany({ orderBy: { id: "asc" }, select: { id: true, wpId: true, creadoEn: true, actualizadoEn: true } })).map((x) => [x.id, x.wpId, t(x.creadoEn), t(x.actualizadoEn)]),
    autores: (await prisma.autor.findMany({ orderBy: { id: "asc" }, select: { id: true, creadoEn: true, actualizadoEn: true } })).map((x) => [x.id, t(x.creadoEn), t(x.actualizadoEn)]),
    categorias: (await prisma.categoria.findMany({ orderBy: { id: "asc" }, select: { id: true } })).map((x) => x.id),
    imagenes: (await prisma.imagen.findMany({ orderBy: { id: "asc" }, select: { id: true, creadoEn: true } })).map((x) => [x.id, t(x.creadoEn)]),
    redirecciones: (await prisma.redireccion.findMany({ orderBy: { id: "asc" }, select: { id: true, origen: true, articuloId: true, autorId: true, destino: true, creadoEn: true } })).map((x) => [x.id, x.origen, x.articuloId, x.autorId, x.destino, t(x.creadoEn)]),
    articulosCategorias: (await prisma.articuloCategoria.findMany({ orderBy: [{ articuloId: "asc" }, { categoriaId: "asc" }] })).map((x) => [x.articuloId, x.categoriaId]),
    articulosAutores: (await prisma.articuloAutor.findMany({ orderBy: [{ articuloId: "asc" }, { autorId: "asc" }] })).map((x) => [x.articuloId, x.autorId, x.orden]),
    galeria: await prisma.galeriaItem.count(),
    secciones: await prisma.seccion.count(),
  };
}

const todoSinCambios = (r: ResultadoEscritura, plan: PlanEscribible) => {
  assert.equal(r.estado, "ok");
  assert.deepEqual(r.conteos, { escritos: 0, sinCambios: plan.articulos.length, difieren: 0, sobrescritos: 0, fallidos: 0 });
  assert.deepEqual(r.base.categorias, { enElPlan: 7, creadas: 0, existentes: 7 });
  assert.deepEqual(r.base.autores, { enElPlan: plan.autores.length, creados: 0, sinCambios: plan.autores.length, difieren: 0, sobrescritos: 0, conflictos: 0 });
  assert.deepEqual(r.base.imagenes, { enElPlan: 200, creadas: 0, sinCambios: 200, difieren: 0, sobrescritas: 0, conflictos: 0 });
  assert.deepEqual(r.redirecciones, { creadas: 0, sinCambios: plan.redirecciones.length, conflictos: 0 });
  assert.deepEqual([r.conflictos, r.base.difieren, r.idsSobrescritos], [[], [], NINGUNO]);
};

try {
  // -------------------------------------------------------------------------------------------------------------
  // D02: idempotencia
  // -------------------------------------------------------------------------------------------------------------
  await ta("D02: una segunda corrida deja los mismos conteos, ids y actualizadoEn en todas las tablas, y lo informa como sin cambios", async () => {
    const plan = await planLimpio();
    const primera = await escribirPlan(prisma, plan, SIN_ABORTAR);
    assert.equal(primera.estado, "ok");
    assert.equal(primera.conteos.escritos, 35);
    const antes = await foto();
    assert.equal(antes.articulos.length, 35);
    await esperar(1200);   // si algo se actualizara, actualizadoEn cambiaría

    const segunda = await escribirPlan(prisma, plan, SIN_ABORTAR);
    todoSinCambios(segunda, plan);
    assert.deepEqual(await foto(), antes);
    // y una tercera, por si la segunda dejó algo distinto
    await esperar(50);
    todoSinCambios(await escribirPlan(prisma, plan, SIN_ABORTAR), plan);
    assert.deepEqual(await foto(), antes);
  });

  // -------------------------------------------------------------------------------------------------------------
  // D03: reemplazo de galería (datos sintéticos: los 35 no tienen galería)
  // -------------------------------------------------------------------------------------------------------------
  await ta("D03: reescribir con otra galería no duplica filas ni deja las viejas", async () => {
    const plan = await planLimpio();
    const a = plan.articulos[0]!;
    const w = plan.imagenes.map((i) => i.wpId);
    const conGaleria = (galeria: PlanEscribible["articulos"][number]["galeria"]): PlanEscribible => ({ ...plan, articulos: plan.articulos.map((x) => (x.wpId === a.wpId ? { ...x, galeria } : x)) });
    const filasDe = async () => (await prisma.galeriaItem.findMany({ where: { articulo: { wpId: a.wpId } }, orderBy: { orden: "asc" }, include: { imagen: true } })).map((g) => [g.imagen.wpId, g.orden, g.alt, g.epigrafe]);

    const g1 = [{ imagenWpId: w[0]!, orden: 0, alt: "uno", epigrafe: null }, { imagenWpId: w[1]!, orden: 1, alt: null, epigrafe: "dos" }, { imagenWpId: w[2]!, orden: 2, alt: "tres", epigrafe: "tres" }];
    const r1 = await escribirPlan(prisma, conGaleria(g1), SIN_ABORTAR);
    assert.equal(r1.conteos.escritos, 35);
    assert.deepEqual(await filasDe(), g1.map((g) => [g.imagenWpId, g.orden, g.alt, g.epigrafe]));
    assert.equal(await prisma.galeriaItem.count(), 3);
    const articuloAntes = (await prisma.articulo.findUnique({ where: { wpId: a.wpId } }))!;

    // la misma galería: sin cambios, sin duplicar
    const r2 = await escribirPlan(prisma, conGaleria(g1), SIN_ABORTAR);
    assert.equal(r2.conteos.sinCambios, 35);
    assert.equal(await prisma.galeriaItem.count(), 3);

    // otra galería sin sobrescribir: difiere (solo "galeria") y no se toca
    const g2 = [{ imagenWpId: w[3]!, orden: 0, alt: "cuatro", epigrafe: null }, { imagenWpId: w[1]!, orden: 1, alt: null, epigrafe: "dos" }];
    const r3 = await escribirPlan(prisma, conGaleria(g2), SIN_ABORTAR);
    assert.deepEqual(r3.articulos.filter((x) => x.resultado === "difiere").map((x) => [x.wpId, x.campos]), [[a.wpId, ["galeria"]]]);
    assert.deepEqual(await filasDe(), g1.map((g) => [g.imagenWpId, g.orden, g.alt, g.epigrafe]));

    // con sobrescritura: las viejas se van, las nuevas quedan una vez
    const r4 = await escribirPlan(prisma, conGaleria(g2), { abortarAlPrimerError: false, sobrescribir: sobre([a.wpId]) });
    assert.deepEqual([r4.conteos.sobrescritos, r4.idsSobrescritos], [1, { articulos: [a.wpId], autores: [], imagenes: [] }]);
    assert.deepEqual(await filasDe(), g2.map((g) => [g.imagenWpId, g.orden, g.alt, g.epigrafe]));
    assert.equal(await prisma.galeriaItem.count(), 2);
    const articuloDespues = (await prisma.articulo.findUnique({ where: { wpId: a.wpId } }))!;
    assert.deepEqual([articuloDespues.id, articuloDespues.creadoEn], [articuloAntes.id, articuloAntes.creadoEn], "conserva id y creadoEn");

    // repetirla no cambia nada; y sacar la galería la vacía
    assert.equal((await escribirPlan(prisma, conGaleria(g2), SIN_ABORTAR)).conteos.sinCambios, 35);
    assert.equal(await prisma.galeriaItem.count(), 2);
    const r5 = await escribirPlan(prisma, conGaleria([]), { abortarAlPrimerError: false, sobrescribir: sobre([a.wpId]) });
    assert.equal(r5.conteos.sobrescritos, 1);
    assert.equal(await prisma.galeriaItem.count(), 0);
  });

  // -------------------------------------------------------------------------------------------------------------
  // D09: política (no pisar lo existente; solo la sobrescritura confirmada lo reescribe)
  // -------------------------------------------------------------------------------------------------------------
  await ta("D09: lo editado en la base no se pisa, se reporta con los nombres de los campos, y solo la sobrescritura exacta lo reescribe", async () => {
    const plan = await planLimpio();
    assert.equal((await escribirPlan(prisma, plan, SIN_ABORTAR)).estado, "ok");
    const a = plan.articulos[3]!;
    const autor = plan.autores.find((x) => !x.soloTexto)!;
    const imagen = plan.imagenes[7]!;
    const TITULO = "TÍTULO EDITADO A MANO";

    // se editan a mano: un título, una bio y un dato de una imagen
    await prisma.articulo.update({ where: { wpId: a.wpId }, data: { titulo: TITULO } });
    await prisma.autor.update({ where: { wpUserId: autor.wpUserId }, data: { bio: { type: "doc", content: [] } } });
    await prisma.imagen.update({ where: { wpId: imagen.wpId }, data: { ancho: imagen.ancho + 1 } });
    const editado = await foto();

    // 1. sin sobrescribir: no se pisa nada y se informan los campos (solo nombres)
    await esperar(1100);
    const r = await escribirPlan(prisma, plan, SIN_ABORTAR);
    assert.equal(r.estado, "ok");
    assert.deepEqual(r.conteos, { escritos: 0, sinCambios: 34, difieren: 1, sobrescritos: 0, fallidos: 0 });
    assert.deepEqual(r.articulos.filter((x) => x.resultado === "difiere").map((x) => [x.wpId, x.campos]), [[a.wpId, ["titulo"]]]);
    assert.deepEqual(r.base.difieren, [
      { tabla: "autores", clave: String(autor.wpUserId), campos: ["bio"], sobrescrita: false },
      { tabla: "imagenes", clave: String(imagen.wpId), campos: ["ancho"], sobrescrita: false },
    ]);
    assert.deepEqual([r.base.autores.difieren, r.base.imagenes.difieren], [1, 1]);
    const informe = JSON.stringify({ ...r, base: { ...r.base, fallidos: [...r.base.fallidos] } });
    assert.ok(!informe.includes("EDITADO") && !informe.includes(String(imagen.ancho + 1)), "el resultado no trae valores, solo nombres de campos");
    assert.equal((await prisma.articulo.findUnique({ where: { wpId: a.wpId } }))!.titulo, TITULO);
    assert.deepEqual((await prisma.autor.findUnique({ where: { wpUserId: autor.wpUserId } }))!.bio, { type: "doc", content: [] });
    assert.equal((await prisma.imagen.findUnique({ where: { wpId: imagen.wpId } }))!.ancho, imagen.ancho + 1);
    assert.deepEqual(await foto(), editado, "no cambió nada, ni actualizadoEn");

    // 2. con sobrescritura pero total o listas incorrectos: no escribe NADA (el total cuenta artículos + autores + imágenes)
    const otro = plan.articulos[4]!.wpId, otraImagen = plan.imagenes[8]!.wpId;
    const buena = sobre([a.wpId], [autor.wpUserId], [imagen.wpId]);
    for (const mala of [
      sobre(), sobre([a.wpId]), sobre([a.wpId], [autor.wpUserId]), sobre([a.wpId], [], [imagen.wpId]),   // N de solo artículos, o de dos tipos de tres
      sobre([a.wpId, otro], [autor.wpUserId], [imagen.wpId]), sobre([otro], [autor.wpUserId], [imagen.wpId]), sobre([a.wpId], [autor.wpUserId], [otraImagen]),
      sobre([a.wpId], [plan.autores[0]!.wpUserId === autor.wpUserId ? plan.autores[1]!.wpUserId : plan.autores[0]!.wpUserId], [imagen.wpId]),
      { ...buena, cantidad: 2 }, { ...buena, cantidad: 4 },
    ]) {
      await assert.rejects(() => escribirPlan(prisma, plan, { abortarAlPrimerError: false, sobrescribir: mala }),
        (e: unknown) => e instanceof ErrorDeSobrescritura && comparable(e.calculados) === comparable({ articulos: [a.wpId], autores: [autor.wpUserId], imagenes: [imagen.wpId] }));
      assert.deepEqual(await foto(), editado, `sobrescritura mal pedida ${JSON.stringify(mala)}: no escribió nada`);
    }
    assert.equal((await prisma.articulo.findUnique({ where: { wpId: a.wpId } }))!.titulo, TITULO);

    // 3. con la cantidad y la lista exactas: se reescribe lo que difiere y solo eso
    const tituloAntes = editado.articulos.find((x) => x[1] === a.wpId)!;
    await esperar(1100);
    const ok = await escribirPlan(prisma, plan, { abortarAlPrimerError: false, sobrescribir: buena });
    assert.equal(ok.estado, "ok");
    assert.deepEqual(ok.conteos, { escritos: 0, sinCambios: 34, difieren: 0, sobrescritos: 1, fallidos: 0 });
    assert.deepEqual(ok.idsSobrescritos, { articulos: [a.wpId], autores: [autor.wpUserId], imagenes: [imagen.wpId] });
    assert.deepEqual([ok.base.autores.sobrescritos, ok.base.imagenes.sobrescritas], [1, 1]);
    assert.ok(ok.base.difieren.every((x) => x.sobrescrita));
    const fila = (await prisma.articulo.findUnique({ where: { wpId: a.wpId } }))!;
    assert.equal(fila.titulo, a.titulo);
    assert.deepEqual([fila.id, fila.creadoEn.toISOString()], [tituloAntes[0], tituloAntes[2]], "conserva id y creadoEn");
    assert.notEqual(fila.actualizadoEn.toISOString(), tituloAntes[3], "actualizadoEn se movió");
    assert.deepEqual((await prisma.autor.findUnique({ where: { wpUserId: autor.wpUserId } }))!.bio, JSON.parse(JSON.stringify(autor.bio)));
    assert.equal((await prisma.imagen.findUnique({ where: { wpId: imagen.wpId } }))!.ancho, imagen.ancho);
    // los demás artículos no se tocaron
    const despues = await foto();
    assert.deepEqual(despues.articulos.filter((x) => x[1] !== a.wpId), editado.articulos.filter((x) => x[1] !== a.wpId));
    // y ahora todo coincide: otra corrida es "sin cambios"
    todoSinCambios(await escribirPlan(prisma, plan, SIN_ABORTAR), plan);
  });

  await ta("D09: un autor o una imagen que difiere no se reescribe con N=0 ni con N de solo artículos; con el total correcto sí, y solo esa fila", async () => {
    const plan = await planLimpio();
    assert.equal((await escribirPlan(prisma, plan, SIN_ABORTAR)).estado, "ok");
    const autor = plan.autores.find((x) => !x.soloTexto)!;
    const imagen = plan.imagenes[3]!;
    const articulo = plan.articulos[2]!;
    const intentar = (sobrescribir: Sobrescritura | null) => escribirPlan(prisma, plan, { abortarAlPrimerError: false, sobrescribir });

    // solo el autor difiere (ningún artículo): el N=0 no alcanza y no escribe nada, ni siquiera categorías
    await prisma.autor.update({ where: { wpUserId: autor.wpUserId }, data: { nombre: "Nombre editado" } });
    const soloAutor = await foto();
    await assert.rejects(() => intentar(sobre()), (e: unknown) => e instanceof ErrorDeSobrescritura && comparable(e.calculados) === comparable({ articulos: [], autores: [autor.wpUserId], imagenes: [] }));
    assert.deepEqual(await foto(), soloAutor);
    assert.equal((await prisma.autor.findUnique({ where: { wpUserId: autor.wpUserId } }))!.nombre, "Nombre editado");
    // sin sobrescritura confirmada (null) tampoco se reescribe nada
    const sin = await intentar(null);
    assert.deepEqual([sin.base.autores.difieren, sin.base.autores.sobrescritos, sin.idsSobrescritos], [1, 0, NINGUNO]);
    assert.equal((await prisma.autor.findUnique({ where: { wpUserId: autor.wpUserId } }))!.nombre, "Nombre editado");
    // con el total correcto sí: se reescribe el autor y nada más
    await esperar(1100);
    const r = await intentar(sobre([], [autor.wpUserId]));
    assert.deepEqual(r.idsSobrescritos, { articulos: [], autores: [autor.wpUserId], imagenes: [] });
    assert.equal((await prisma.autor.findUnique({ where: { wpUserId: autor.wpUserId } }))!.nombre, autor.nombre);
    assert.deepEqual((await foto()).articulos, soloAutor.articulos, "ningún artículo se tocó");

    // solo la imagen difiere
    await prisma.imagen.update({ where: { wpId: imagen.wpId }, data: { bytes: imagen.bytes + 5 } });
    const soloImagen = await foto();
    await assert.rejects(() => intentar(sobre()), ErrorDeSobrescritura);
    await assert.rejects(() => intentar(sobre([articulo.wpId])), ErrorDeSobrescritura, "un N de artículos no cubre una imagen");
    assert.deepEqual(await foto(), soloImagen);
    assert.equal((await prisma.imagen.findUnique({ where: { wpId: imagen.wpId } }))!.bytes, imagen.bytes + 5);
    const r2 = await intentar(sobre([], [], [imagen.wpId]));
    assert.deepEqual(r2.idsSobrescritos, { articulos: [], autores: [], imagenes: [imagen.wpId] });
    assert.equal((await prisma.imagen.findUnique({ where: { wpId: imagen.wpId } }))!.bytes, imagen.bytes);

  });

  await ta("D09: el conflicto de clave de imagen y el de redirección siguen sin pisarse, también con sobrescritura", async () => {
    // clave de imagen de otro wpId
    const plan = await planLimpio();
    const imagen = plan.imagenes.find((i) => i.usos.includes("encabezado"))!;
    const ajena = await prisma.imagen.create({ data: { clave: imagen.clave, nombreOriginal: "ajena.jpg", tipoMime: "image/jpeg", ancho: 1, alto: 1, bytes: 1, hash: "c".repeat(64), wpId: 555555 } });
    const r = await escribirPlan(prisma, plan, { abortarAlPrimerError: false, sobrescribir: sobre() });
    assert.equal(r.base.imagenes.conflictos, 1);
    assert.deepEqual(r.conflictos.filter((c) => c.tabla === "imagenes").map((c) => c.clave), [imagen.clave]);
    const intacta = (await prisma.imagen.findUnique({ where: { id: ajena.id } }))!;
    assert.deepEqual([intacta.wpId, intacta.nombreOriginal, intacta.hash], [555555, "ajena.jpg", "c".repeat(64)]);
    assert.equal(await prisma.imagen.findUnique({ where: { wpId: imagen.wpId } }), null);
    assert.deepEqual(r.articulos.filter((x) => x.resultado === "fallido").map((x) => x.wpId).sort((x, y) => x - y), [...imagen.articulos].sort((x, y) => x - y));

    // redirección con otro destino
    const plan2 = await planLimpio();
    assert.equal((await escribirPlan(prisma, plan2, SIN_ABORTAR)).estado, "ok");
    const origen = plan2.articulos[0]!.redirecciones[0]!.origen;
    const otro = (await prisma.articulo.findUnique({ where: { wpId: plan2.articulos[1]!.wpId } }))!;
    await prisma.redireccion.update({ where: { origen }, data: { articuloId: otro.id } });
    const antes = await foto();
    const r2 = await escribirPlan(prisma, plan2, { abortarAlPrimerError: false, sobrescribir: sobre() });
    assert.equal(r2.redirecciones.conflictos, 1);
    assert.deepEqual(r2.conflictos.map((c) => c.clave), [origen]);
    assert.equal((await prisma.redireccion.findUnique({ where: { origen } }))!.articuloId, otro.id, "no se pisó");
    assert.deepEqual(await foto(), antes);
    // mismo origen y mismo destino NO es conflicto (ya lo comprueba D02: 58 sin cambios)
  });

  // deja la carga completa de los 35 en la base de pruebas
  await ta("D02: al terminar queda la carga completa de los 35 en evaristo_cms_test", async () => {
    const plan = await planLimpio();
    assert.equal((await escribirPlan(prisma, plan, SIN_ABORTAR)).conteos.escritos, 35);
    assert.equal(await prisma.articulo.count(), 35);
  });

  console.log(`${cantidad()} pruebas con base (parte 3) ok`);
} finally {
  await conexion.cerrar();
}
