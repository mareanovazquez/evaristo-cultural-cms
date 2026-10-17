// Tests con base (test:migracion-db), parte 1: la guarda de destinos de escritura (T20) y la escritura de categorías, autores e imágenes.
// Escriben solo en evaristo_cms_test; antes y después de cada test se comprueba que evaristo_cms no cambió.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DESTINO_PRUEBAS, DESTINO_REAL, ESCRITURA_REAL_HABILITADA, guardaDestino } from "../lib/destinos.ts";
import { parsearArgumentos } from "../lib/conexiones.ts";
import { cargarDatosVersionados } from "../lib/entrada-snapshot.ts";
import { abrirConexionEscritura, elegirDestinoEscritura, escribirBase, verificarServidorEscritura } from "../lib/escribir.ts";
import { grafo } from "./grafo-imports.ts";
import { abrirPruebas, crearEjecutor, planDePruebas, vaciarYSembrarPruebas } from "./ayudas-db.ts";

const { ta, cantidad } = crearEjecutor();
const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));   // packages/compartido
const MIGRACION = join(RAIZ, "scripts", "migracion");
const rel = (a: string) => relative(RAIZ, a).replace(/\\/g, "/");

const conexion = await abrirPruebas();
const { prisma } = conexion;

try {
  // -------------------------------------------------------------------------------------------------------------
  // T20: la guarda de destinos de escritura
  // -------------------------------------------------------------------------------------------------------------
  await ta("T20: los dos destinos son constantes congeladas y el interruptor del destino real está en false", async () => {
    assert.deepEqual(DESTINO_REAL, { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" });
    assert.deepEqual(DESTINO_PRUEBAS, { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms_test" });
    assert.ok(Object.isFrozen(DESTINO_REAL) && Object.isFrozen(DESTINO_PRUEBAS));
    assert.throws(() => { (DESTINO_PRUEBAS as { base: string }).base = "evaristo_cms"; }, TypeError);
    assert.equal(ESCRITURA_REAL_HABILITADA, false);
    // el interruptor es una constante de código: ni el entorno ni los argumentos lo cambian
    const previa = process.env["ESCRITURA_REAL_HABILITADA"];
    process.env["ESCRITURA_REAL_HABILITADA"] = "true";
    try { assert.throws(() => elegirDestinoEscritura(DESTINO_REAL), /deshabilitada/); } finally { if (previa === undefined) delete process.env["ESCRITURA_REAL_HABILITADA"]; else process.env["ESCRITURA_REAL_HABILITADA"] = previa; }
  });

  await ta("T20: la guarda de escritura acepta solo los dos destinos (por identidad) y rechaza todo lo demás", async () => {
    assert.equal(elegirDestinoEscritura(DESTINO_PRUEBAS), DESTINO_PRUEBAS);
    assert.throws(() => elegirDestinoEscritura(DESTINO_REAL), /deshabilitada/, "con el interruptor en false el destino real se niega");
    const rechazados: unknown[] = [
      { ...DESTINO_PRUEBAS }, { ...DESTINO_REAL }, { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms_shadow" }, { host: "127.0.0.1", puerto: 3306, base: "evaristo_cms_test" },
      { host: "localhost", puerto: 3308, base: "evaristo_cms_test" }, { host: "127.0.0.1", puerto: 3307, base: "evaristo_lectura" },
      "mysql://u:p@127.0.0.1:3308/evaristo_cms_test", "evaristo_cms_test", undefined, null, 3308, {},
    ];
    for (const d of rechazados) assert.throws(() => elegirDestinoEscritura(d), /Destino de escritura no permitido/, JSON.stringify(d));
    // abrirConexionEscritura rechaza antes de conectar
    await assert.rejects(() => abrirConexionEscritura(DESTINO_REAL), /deshabilitada/);
    await assert.rejects(() => abrirConexionEscritura({ ...DESTINO_PRUEBAS }), /no permitido/);
    await assert.rejects(() => abrirConexionEscritura("mysql://u:p@127.0.0.1:3308/evaristo_cms"), /no permitido/);
  });

  await ta("T20: tras conectar se comprueban @@port, DATABASE(), la versión y @@session.transaction_read_only = 0", async () => {
    assert.equal(conexion.destino, DESTINO_PRUEBAS);
    assert.equal(conexion.servidor.puerto, 3308);
    assert.equal(conexion.servidor.base, "evaristo_cms_test");
    assert.match(conexion.servidor.version, /^8\.4\./);
    assert.equal(conexion.servidor.soloLectura, 0);
    const bueno = { puerto: 3308, base: "evaristo_cms_test", version: "8.4.3", soloLectura: 0 };
    assert.deepEqual(verificarServidorEscritura(bueno, DESTINO_PRUEBAS), bueno);
    for (const [mal, texto] of [
      [{ puerto: 3306 }, /@@port = 3306/], [{ base: "evaristo_cms" }, /DATABASE\(\) = evaristo_cms/], [{ base: "" }, /DATABASE\(\) = NULL/],
      [{ version: "8.0.36" }, /@@version = 8\.0\.36/], [{ version: "10.11.2-MariaDB" }, /@@version/], [{ soloLectura: 1 }, /transaction_read_only = 1/],
    ] as const) assert.throws(() => verificarServidorEscritura({ ...bueno, ...mal }, DESTINO_PRUEBAS), (e: Error) => texto.test(e.message), JSON.stringify(mal));
  });

  await ta("T20: el CLI no puede producir DESTINO_PRUEBAS ni llegar a escribir.ts", async () => {
    // por la URL: la guarda de lectura solo devuelve el destino real
    for (const url of ["mysql://u:p@127.0.0.1:3308/evaristo_cms_test", "mysql://u:p@127.0.0.1:3308/evaristo_cms_shadow", "mysql://u:p@127.0.0.1:3306/evaristo_cms"]) {
      assert.throws(() => guardaDestino(url), /Destino no permitido/, url);
    }
    assert.deepEqual(guardaDestino("mysql://u:p@127.0.0.1:3308/evaristo_cms"), { ...DESTINO_REAL });
    // por los argumentos: no hay ninguna opción de destino
    const ids = cargarDatosVersionados().ids;
    for (const flag of ["--pruebas", "--destino=pruebas", "--base=evaristo_cms_test", "--puerto=3308", "--habilitar-escritura-real", "--database-url=mysql://x"]) {
      assert.throws(() => parsearArgumentos(["--muestra", flag], ids), /argumento desconocido/, flag);
    }
    // por el código: migrar.ts no alcanza escribir.ts, DESTINO_PRUEBAS ni las ayudas de los tests
    const { archivos } = grafo(join(MIGRACION, "migrar.ts"));
    const alcanzados = [...archivos].map(rel).sort();
    assert.ok(alcanzados.includes("scripts/migracion/lib/destinos.ts"));
    assert.deepEqual(alcanzados.filter((a) => /escribir|tests\//.test(a)), []);
    const mencionan = (patron: RegExp) => [...archivos].filter((a) => patron.test(readFileSync(a, "utf8"))).map(rel);
    assert.deepEqual(mencionan(/DESTINO_PRUEBAS/), ["scripts/migracion/lib/destinos.ts"]);
    assert.deepEqual(mencionan(/ESCRITURA_REAL_HABILITADA/), ["scripts/migracion/lib/destinos.ts"]);
    // y escribir.ts es el único archivo de scripts/migracion/ que crea un cliente de escritura
    const todos: string[] = [];
    const recorrer = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) recorrer(p); else if (p.endsWith(".ts")) todos.push(p); } };
    recorrer(MIGRACION);
    const crean = todos.filter((a) => /new PrismaClient\(/.test(readFileSync(a, "utf8"))).map(rel).sort();
    assert.deepEqual(crean, ["scripts/migracion/lib/escribir.ts", "scripts/migracion/lib/leer-wordpress.ts"]);
    // leer-wordpress.ts abre siempre con READ ONLY
    assert.equal((readFileSync(join(MIGRACION, "lib", "leer-wordpress.ts"), "utf8").match(/new PrismaClient\(/g) ?? []).length, 2);
    assert.equal((readFileSync(join(MIGRACION, "lib", "leer-wordpress.ts"), "utf8").match(/initSql: SOLO_LECTURA/g) ?? []).length, 2);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Categorías, autores e imágenes
  // -------------------------------------------------------------------------------------------------------------
  await ta("D-categorías-autores-imágenes: cantidades y contenido contra el plan, y es idempotente", async () => {
    await vaciarYSembrarPruebas(prisma);
    assert.equal(await prisma.seccion.count(), 18);
    const { plan } = await planDePruebas(prisma);
    assert.equal(plan.categoriasACrear.length, 8);
    assert.equal(plan.imagenes.length, 200);

    const r = await escribirBase(prisma, plan);
    assert.deepEqual(r.categorias, { enElPlan: 8, creadas: 8, existentes: 0 });
    assert.deepEqual(r.autores, { enElPlan: plan.autores.length, creados: plan.autores.length, existentes: 0, conflictos: 0 });
    assert.deepEqual(r.imagenes, { enElPlan: 200, creadas: 200, existentes: 0, conflictos: 0 });
    assert.deepEqual(r.conflictos, []);
    assert.equal(r.fallidos.size, 0);

    // categorías: slug y nombre del mapeo
    const cats = await prisma.categoria.findMany({ orderBy: { slug: "asc" } });
    assert.deepEqual(cats.map((c) => [c.slug, c.nombre]), plan.categoriasACrear.map((c) => [c.slug, c.nombre]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
    // autores: lo que arma el plan; bioConCorreo no es columna
    const autores = await prisma.autor.findMany({ orderBy: { wpUserId: "asc" } });
    assert.equal(autores.length, plan.autores.length);
    for (const a of plan.autores) {
      const fila = autores.find((x) => x.wpUserId === a.wpUserId)!;
      assert.ok(fila, `autor ${a.wpUserId}`);
      assert.deepEqual([fila.slug, fila.nombre, fila.soloTexto], [a.slug, a.nombre, a.soloTexto]);
      assert.deepEqual(fila.bio ?? null, a.bio ?? null);
      assert.ok(!("bioConCorreo" in fila));
      assert.equal(r.idsAutores.get(a.wpUserId), fila.id);
    }
    assert.equal(autores.filter((a) => a.soloTexto).length, plan.autores.filter((a) => a.soloTexto).length);
    assert.ok(plan.autores.some((a) => a.soloTexto), "la muestra tiene autores de solo texto");
    assert.ok(autores.filter((a) => a.soloTexto).every((a) => a.bio === null));
    assert.ok(!/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(JSON.stringify(autores.map((a) => a.bio))), "ninguna bio guarda un correo (un @usuario de Instagram no lo es)");
    // imágenes: lo medido
    assert.equal(await prisma.imagen.count(), 200);
    for (const i of plan.imagenes) {
      const fila = (await prisma.imagen.findUnique({ where: { wpId: i.wpId } }))!;
      assert.ok(fila, `imagen ${i.wpId}`);
      assert.deepEqual([fila.clave, fila.nombreOriginal, fila.tipoMime, fila.ancho, fila.alto, fila.bytes, fila.hash], [i.clave, i.nombreOriginal, i.tipoMime, i.ancho, i.alto, i.bytes, i.hash]);
    }
    assert.ok(![2464, 22547].some((id) => r.idsImagenes.has(id)), "los dos originales faltantes no tienen fila");

    // segunda corrida: nada se duplica
    const otra = await escribirBase(prisma, plan);
    assert.deepEqual(otra.categorias, { enElPlan: 8, creadas: 0, existentes: 8 });
    assert.equal(otra.autores.creados, 0);
    assert.equal(otra.imagenes.creadas, 0);
    assert.deepEqual([await prisma.categoria.count(), await prisma.autor.count(), await prisma.imagen.count()], [8, plan.autores.length, 200]);
  });

  await ta("D-categorías-autores-imágenes: una clave de imagen de otro wpId es conflicto: no se pisa y sus artículos quedan fallidos", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    const elegida = plan.imagenes.find((i) => i.usos.includes("encabezado"))!;
    // una fila ajena con la misma clave (distinto wpId) y otra distinta para comparar
    const ajena = await prisma.imagen.create({ data: { clave: elegida.clave, nombreOriginal: "ajena.jpg", tipoMime: "image/jpeg", ancho: 1, alto: 1, bytes: 1, hash: "a".repeat(64), wpId: 999999 } });

    const r = await escribirBase(prisma, plan);
    assert.equal(r.imagenes.conflictos, 1);
    assert.equal(r.imagenes.creadas, 199);
    assert.deepEqual(r.conflictos, [{ tabla: "imagenes", clave: elegida.clave, detalle: { wpId: elegida.wpId, existente: { id: ajena.id, wpId: 999999 } } }]);
    // no se pisó la fila ajena ni se creó la del plan
    const intacta = (await prisma.imagen.findUnique({ where: { id: ajena.id } }))!;
    assert.deepEqual([intacta.wpId, intacta.nombreOriginal, intacta.hash], [999999, "ajena.jpg", "a".repeat(64)]);
    assert.equal(await prisma.imagen.findUnique({ where: { wpId: elegida.wpId } }), null);
    assert.equal(await prisma.imagen.count(), 200, "199 del plan + la ajena");
    // los artículos que usan esa imagen quedan como fallidos
    assert.deepEqual([...r.fallidos.keys()].sort((a, b) => a - b), [...elegida.articulos].sort((a, b) => a - b));
    assert.ok([...r.fallidos.values()].every((m) => m.includes(elegida.clave)));
    assert.ok(!r.idsImagenes.has(elegida.wpId));
  });

  await ta("D-categorías-autores-imágenes: un slug de autor de otra fila es conflicto y sus artículos quedan fallidos", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    const autor = plan.autores.find((a) => !a.soloTexto)!;
    const ajeno = await prisma.autor.create({ data: { slug: autor.slug, nombre: "Otra persona", wpUserId: 888888 } });
    const r = await escribirBase(prisma, plan);
    assert.equal(r.autores.conflictos, 1);
    assert.equal(r.autores.creados, plan.autores.length - 1);
    assert.equal((await prisma.autor.findUnique({ where: { id: ajeno.id } }))!.nombre, "Otra persona");
    assert.deepEqual([...r.fallidos.keys()].sort((a, b) => a - b), [...autor.articulosEnMuestra].sort((a, b) => a - b));
  });

  console.log(`${cantidad()} pruebas con base (parte 1) ok`);
} finally {
  await conexion.cerrar();
}
