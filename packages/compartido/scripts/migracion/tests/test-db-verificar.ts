// Tests con base (test:migracion-db), parte 6: el verificador posterior (lib/verificar.ts, la misma función que usa verificar:escritura) contra
// evaristo_cms_test, con su propia conexión de SOLO LECTURA. Escriben solo en evaristo_cms_test; antes y después de cada test se comprueba que evaristo_cms
// no cambió. El plan esperado se arma del snapshot (sin WordPress ni originales). El último test deja la carga completa de los 35.
import assert from "node:assert/strict";
import { DESTINO_PRUEBAS } from "../lib/destinos.ts";
import { abrirConexionLectura, escribirPlan } from "../lib/escribir.ts";
import type { PlanEscribible } from "../lib/escribir.ts";
import type { Consulta } from "../lib/leer-wordpress.ts";
import { codigoDeSalida, formatearVerificacion, verificarEscritura } from "../lib/verificar.ts";
import type { ResultadoVerificacion } from "../lib/verificar.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
import { abrirPruebas, crearEjecutor, planDePruebas, vaciarYSembrarPruebas } from "./ayudas-db.ts";

const { ta, cantidad } = crearEjecutor();
const conexion = await abrirPruebas();
const { prisma } = conexion;
const lectura = await abrirConexionLectura(DESTINO_PRUEBAS);   // sesión READ ONLY, otra conexión
const SIN_ABORTAR = { abortarAlPrimerError: false };
const IDS_MUESTRA = entradaDesdeSnapshot().ids;
const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** Las sentencias que el verificador mandó por la conexión de lectura: tienen que ser todas SELECT. */
const sentencias: string[] = [];
const bd: Consulta = (sql, ...p) => { sentencias.push(sql); return lectura.bd(sql, ...p); };

async function verificar(ids: readonly number[], soloEstos: boolean): Promise<ResultadoVerificacion> {
  const { plan } = await planDePruebas(prisma, ids);
  return verificarEscritura({ bd, destino: DESTINO_PRUEBAS, ids, soloEstos, originales: "(sin carpeta: plan del snapshot)", plan });
}
const fallan = (r: ResultadoVerificacion) => r.comprobaciones.filter((c) => !c.ok);
async function cargarTodo(): Promise<PlanEscribible> {
  await vaciarYSembrarPruebas(prisma);
  const { plan } = await planDePruebas(prisma);
  const r = await escribirPlan(prisma, plan as PlanEscribible, SIN_ABORTAR);
  assert.deepEqual(r.conteos, { escritos: 35, sinCambios: 0, difieren: 0, sobrescritos: 0, fallidos: 0 });
  return plan as PlanEscribible;
}

try {
  await ta("V1: tras la carga completa de los 35, el verificador con la muestra da 0 diferencias y sale con 0", async () => {
    await cargarTodo();
    const r = await verificar(IDS_MUESTRA, false);
    assert.deepEqual(fallan(r), []);
    assert.equal(r.diferencias, 0);
    assert.equal(codigoDeSalida(r), 0);
    assert.equal(r.presentes.length, 35);
    assert.deepEqual(r.ausentes, []);
    assert.ok(r.comprobaciones.length > 500, `${r.comprobaciones.length} comprobaciones`);
    assert.ok(r.comprobaciones.some((c) => c.nombre.startsWith("(a) conteo articulos") && c.ok), "comparó los conteos globales");
    const lineas = formatearVerificacion(r, IDS_MUESTRA);
    assert.match(lineas.at(-1)!, /0 diferencias\. Nada se escribió/);
    assert.ok(!CORREO.test(lineas.join("\n")), "la salida no trae correos");
  });

  await ta("V2: con --ids=12526 --solo-estos también da 0 diferencias (aunque la base tenga 35 artículos)", async () => {
    const r = await verificar([12526], true);
    assert.deepEqual(fallan(r), []);
    assert.equal(codigoDeSalida(r), 0);
    assert.deepEqual(r.presentes, [12526]);
    assert.ok(!r.comprobaciones.some((c) => c.nombre.startsWith("(a) conteo")), "no compara los conteos globales");
    assert.ok(r.comprobaciones.length >= 25);
    // sin --solo-estos y con un solo id, los conteos globales (35 artículos) no coinciden con el plan de 1: lo dice
    const global = await verificar([12526], false);
    assert.ok(global.comprobaciones.some((c) => c.nombre === "(a) conteo articulos" && !c.ok));
    assert.equal(codigoDeSalida(global), 1);
  });

  await ta("V3: prueba negativa: un título cambiado a mano, una redirección borrada y un nombre de autor cambiado se informan como DIFERENCIA y salen con 1; restaurados, vuelve a 0", async () => {
    const ID = 1555;
    const art = (await prisma.articulo.findUnique({ where: { wpId: ID }, include: { autores: { include: { autor: true } } } }))!;
    const autor = art.autores[0]!.autor;
    // título
    await prisma.articulo.update({ where: { wpId: ID }, data: { titulo: "Título cambiado a mano" } });
    let r = await verificar([ID], true);
    assert.ok(fallan(r).some((c) => c.articulo === ID && c.nombre === "(b) título"), JSON.stringify(fallan(r)));
    assert.equal(codigoDeSalida(r), 1);
    await prisma.articulo.update({ where: { wpId: ID }, data: { titulo: art.titulo } });
    assert.equal(codigoDeSalida(await verificar([ID], true)), 0, "restaurado el título");
    // redirección
    const redireccion = (await prisma.redireccion.findFirst({ where: { articuloId: art.id, tipo: "ARTICULO" } }))!;
    await prisma.redireccion.delete({ where: { id: redireccion.id } });
    r = await verificar([ID], true);
    assert.ok(fallan(r).some((c) => c.nombre === `(e) redirección ${redireccion.origen}` && c.detalle === "no existe"), JSON.stringify(fallan(r)));
    assert.equal(codigoDeSalida(r), 1);
    await prisma.redireccion.create({ data: redireccion });
    assert.equal(codigoDeSalida(await verificar([ID], true)), 0, "restaurada la redirección");
    // nombre del autor
    await prisma.autor.update({ where: { id: autor.id }, data: { nombre: "Nombre cambiado a mano" } });
    r = await verificar([ID], true);
    assert.ok(fallan(r).some((c) => c.nombre === `(d) autor ${autor.wpUserId}: slug, nombre y soloTexto`), JSON.stringify(fallan(r)));
    assert.equal(codigoDeSalida(r), 1);
    await prisma.autor.update({ where: { id: autor.id }, data: { nombre: autor.nombre } });
    // restaurado todo: la muestra completa vuelve a dar 0
    const final = await verificar(IDS_MUESTRA, false);
    assert.deepEqual(fallan(final), []);
    assert.equal(codigoDeSalida(final), 0);
  });

  await ta("V3b: también se informa un texto plano distinto, una categoría cambiada y una fila de más (conteos globales)", async () => {
    const ID = 3026;   // dos categorías
    const art = (await prisma.articulo.findUnique({ where: { wpId: ID }, include: { categorias: true } }))!;
    await prisma.articulo.update({ where: { wpId: ID }, data: { textoPlano: art.textoPlano + " sobra" } });
    assert.ok(fallan(await verificar([ID], true)).some((c) => c.nombre === "(c) texto plano igual al del plan"));
    await prisma.articulo.update({ where: { wpId: ID }, data: { textoPlano: art.textoPlano } });
    const quitada = art.categorias[0]!;
    await prisma.articuloCategoria.delete({ where: { articuloId_categoriaId: { articuloId: art.id, categoriaId: quitada.categoriaId } } });
    assert.ok(fallan(await verificar([ID], true)).some((c) => c.nombre === "(a) categorías del artículo"));
    await prisma.articuloCategoria.create({ data: { articuloId: art.id, categoriaId: quitada.categoriaId } });
    const extra = await prisma.categoria.create({ data: { slug: "categoria-de-mas", nombre: "De más" } });
    const global = await verificar(IDS_MUESTRA, false);
    assert.ok(fallan(global).some((c) => c.nombre === "(a) conteo categorias"), "una categoría de más se ve en los conteos globales");
    assert.equal(codigoDeSalida(global), 1);
    assert.equal(codigoDeSalida(await verificar([ID], true)), 0, "con --solo-estos no molesta");
    await prisma.categoria.delete({ where: { id: extra.id } });
    assert.equal(codigoDeSalida(await verificar(IDS_MUESTRA, false)), 0);
  });

  await ta("V7: la regla de correos: los del plan (16691 y la bio del 39) no dan diferencia; uno de más en bajada, cuerpo y texto plano, categoría, bio de otro autor o imagen sí, y sale con 1", async () => {
    const CORREO_FALSO = "prueba@example.invalid";
    const regla = (r: ResultadoVerificacion) => r.comprobaciones.find((c) => c.nombre.startsWith("(h) sin correos fuera de autores.bio"))!;
    /** Agrega el correo de mentira al primer texto que encuentre (nodos con `text` de un cuerpo o de una bio). */
    const conCorreo = (doc: unknown): unknown => {
      const copia = JSON.parse(JSON.stringify(doc)) as unknown;
      let hecho = false;
      const recorrer = (n: unknown) => {
        if (hecho || n === null || typeof n !== "object") return;
        if (!Array.isArray(n) && typeof (n as { text?: unknown }).text === "string") { (n as { text: string }).text += ` ${CORREO_FALSO}`; hecho = true; return; }
        for (const v of Object.values(n as Record<string, unknown>)) recorrer(v);
      };
      recorrer(copia);
      assert.ok(hecho, "se encontró un texto donde agregar el correo");
      return copia;
    };
    const debeFallar = async (ids: readonly number[], nombre: string) => {
      const r = await verificar(ids, true);
      assert.equal(regla(r).ok, false, `${nombre}: la regla de correos tiene que informar DIFERENCIA`);
      assert.equal(codigoDeSalida(r), 1, `${nombre}: sale con 1`);
    };
    const sinDiferencias = async (nombre: string) => assert.deepEqual(fallan(await verificar(IDS_MUESTRA, false)), [], `${nombre}: restaurado, 0 diferencias`);

    // los correos legítimos del plan existen en la base y no dan diferencia
    const a16691 = (await prisma.articulo.findUnique({ where: { wpId: 16691 } }))!;
    assert.ok(CORREO.test(a16691.textoPlano) && CORREO.test(JSON.stringify(a16691.cuerpo)), "el 16691 trae un correo en el cuerpo y en el texto plano");
    const bio39 = (await prisma.autor.findUnique({ where: { wpUserId: 39 } }))!.bio;   // en el snapshot lleva el marcador de correo omitido, no el correo
    const base = await verificar(IDS_MUESTRA, false);
    assert.equal(regla(base).ok, true, regla(base).detalle);
    assert.deepEqual(fallan(base), []);
    const solo = await verificar([16691], true);
    assert.equal(regla(solo).ok, true);
    assert.equal(codigoDeSalida(solo), 0);

    // la bio del 39 con un correo (el de mentira) en la base Y en el plan, como pasa con el plan en vivo: tampoco da diferencia
    await prisma.autor.update({ where: { wpUserId: 39 }, data: { bio: conCorreo(bio39) as never } });
    const { plan: planConBio } = await planDePruebas(prisma, [22255]);
    planConBio.autores.find((a) => a.wpUserId === 39)!.bio = conCorreo(bio39) as never;
    const legitima = await verificarEscritura({ bd, destino: DESTINO_PRUEBAS, ids: [22255], soloEstos: true, originales: "(sin carpeta: plan del snapshot)", plan: planConBio });
    assert.equal(regla(legitima).ok, true, regla(legitima).detalle);
    assert.deepEqual(fallan(legitima), []);
    // y si la base trae un correo y el plan no, sí
    const sinEnPlan = await verificar([22255], true);
    assert.equal(regla(sinEnPlan).ok, false);
    assert.equal(codigoDeSalida(sinEnPlan), 1);
    await prisma.autor.update({ where: { wpUserId: 39 }, data: { bio: bio39 as never } });
    await sinDiferencias("bio del 39");

    // (a) un correo en la bajada de un artículo (fuera del contenido del plan)
    const art = (await prisma.articulo.findUnique({ where: { wpId: 1555 } }))!;
    await prisma.articulo.update({ where: { wpId: 1555 }, data: { bajada: `Contacto: ${CORREO_FALSO}` } });
    await debeFallar([1555], "bajada");
    await prisma.articulo.update({ where: { wpId: 1555 }, data: { bajada: art.bajada } });
    await sinDiferencias("bajada");

    // (b) un correo extra en el cuerpo y en el texto plano de un artículo que no lo tenía
    const art2 = (await prisma.articulo.findUnique({ where: { wpId: 3026 } }))!;
    await prisma.articulo.update({ where: { wpId: 3026 }, data: { cuerpo: conCorreo(art2.cuerpo) as never, textoPlano: `${art2.textoPlano} ${CORREO_FALSO}` } });
    await debeFallar([3026], "cuerpo y texto plano");
    await prisma.articulo.update({ where: { wpId: 3026 }, data: { cuerpo: art2.cuerpo as never, textoPlano: art2.textoPlano } });
    await sinDiferencias("cuerpo y texto plano");

    // (c) un correo en el nombre de una categoría
    const categoria = (await prisma.categoria.findFirst({ orderBy: { id: "asc" } }))!;
    await prisma.categoria.update({ where: { id: categoria.id }, data: { nombre: `${categoria.nombre} ${CORREO_FALSO}` } });
    await debeFallar([1555], "categoría");
    await prisma.categoria.update({ where: { id: categoria.id }, data: { nombre: categoria.nombre } });
    await sinDiferencias("categoría");

    // (d) un correo en la bio de un autor que no es el 39 (el 3, autor del 1555)
    const autor3 = (await prisma.autor.findUnique({ where: { wpUserId: 3 } }))!;
    assert.notEqual(autor3.bio, null, "el autor 3 tiene bio");
    await prisma.autor.update({ where: { wpUserId: 3 }, data: { bio: conCorreo(autor3.bio) as never } });
    await debeFallar([1555], "bio de otro autor");
    await prisma.autor.update({ where: { wpUserId: 3 }, data: { bio: autor3.bio as never } });
    await sinDiferencias("bio de otro autor");

    // (e) un correo en el nombreOriginal de una imagen
    const imagen = (await prisma.imagen.findFirst({ orderBy: { id: "asc" } }))!;
    await prisma.imagen.update({ where: { id: imagen.id }, data: { nombreOriginal: `${CORREO_FALSO}.jpg` } });
    await debeFallar([1555], "nombre original de una imagen");
    await prisma.imagen.update({ where: { id: imagen.id }, data: { nombreOriginal: imagen.nombreOriginal } });
    await sinDiferencias("nombre original de una imagen");
  });

  await ta("V8: una ficha técnica del artículo (que el plan no escribe) se informa como DIFERENCIA, también con --solo-estos, y sale con 1; borrada, vuelve a 0", async () => {
    const ID = 1555;
    const art = (await prisma.articulo.findUnique({ where: { wpId: ID } }))!;
    assert.deepEqual(fallan(await verificar([ID], true)), []);
    await prisma.fichaTecnica.create({ data: { articuloId: art.id, titulo: "Ficha de prueba" } });
    const r = await verificar([ID], true);
    assert.ok(fallan(r).some((c) => c.articulo === ID && c.nombre === "(a) ficha técnica del artículo (0)"), JSON.stringify(fallan(r)));
    assert.equal(codigoDeSalida(r), 1);
    await prisma.fichaTecnica.delete({ where: { articuloId: art.id } });
    assert.equal(codigoDeSalida(await verificar([ID], true)), 0);
    assert.deepEqual(fallan(await verificar(IDS_MUESTRA, false)), []);
  });

  await ta("V4: sobre una base donde un artículo pedido no existe, informa que no está, sin errores y sin escribir", async () => {
    // base vacía: ningún artículo
    await vaciarYSembrarPruebas(prisma);
    const antes = JSON.stringify([await prisma.articulo.count(), await prisma.autor.count(), await prisma.redireccion.count(), await prisma.categoria.count(), await prisma.imagen.count()]);
    const vacia = await verificar([12526], false);
    assert.deepEqual(vacia.ausentes, [12526]);
    assert.deepEqual(vacia.presentes, []);
    assert.ok(fallan(vacia).some((c) => c.articulo === 12526 && c.nombre === "el artículo está en la base" && c.detalle === "no está"));
    assert.equal(codigoDeSalida(vacia), 1);
    assert.match(formatearVerificacion(vacia, [12526]).join("\n"), /No están en la base: 12526/);
    // solo el 12526 escrito: el 1555 no está y el 12526 sí, con todo en orden
    const { plan } = await planDePruebas(prisma, [12526]);
    assert.equal((await escribirPlan(prisma, plan as PlanEscribible, SIN_ABORTAR)).conteos.escritos, 1);
    const mixta = await verificar([12526, 1555], true);
    assert.deepEqual(mixta.presentes, [12526]);
    assert.deepEqual(mixta.ausentes, [1555]);
    assert.deepEqual(mixta.comprobaciones.filter((c) => c.articulo === 12526 && !c.ok), []);
    assert.equal(codigoDeSalida(mixta), 1);
    assert.equal(antes, JSON.stringify([0, 0, 0, 0, 0]), "la base vacía no tenía nada");
    // el verificador no escribió nada: sigue habiendo exactamente lo del 12526
    assert.deepEqual([await prisma.articulo.count(), await prisma.autor.count(), await prisma.redireccion.count(), await prisma.categoria.count(), await prisma.imagen.count()], [1, 1, 3, 1, 1]);
  });

  await ta("V5: todo lo que el verificador mandó por la conexión de lectura fue SELECT", async () => {
    assert.ok(sentencias.length > 1000, `${sentencias.length} sentencias`);
    const raras = sentencias.filter((s) => !/^\s*SELECT\b/i.test(s));
    assert.deepEqual(raras, []);
    assert.ok(sentencias.every((s) => !s.includes(";")));
    assert.equal(lectura.servidor.soloLectura, 1, "la sesión de lectura es READ ONLY");
  });

  await ta("V6: al terminar queda la carga completa de los 35 en evaristo_cms_test", async () => {
    await cargarTodo();
    assert.equal(await prisma.articulo.count(), 35);
    assert.equal(codigoDeSalida(await verificar(IDS_MUESTRA, false)), 0);
  });

  console.log(`${cantidad()} pruebas con base (parte 6) ok`);
} finally {
  await lectura.cerrar();
  await conexion.cerrar();
}
