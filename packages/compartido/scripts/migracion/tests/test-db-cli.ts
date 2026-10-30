// Tests con base (test:migracion-db), parte 4: confirmaciones (T21), el CLI y la simulación contra la base de pruebas (D08). Escriben solo en
// evaristo_cms_test; antes y después de cada test se comprueba que evaristo_cms no cambió.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { confirmarAntesDeConectar, confirmarSobrescritura, decidirEscrituraCli } from "../lib/confirmaciones.ts";
import { correrEscritura } from "../lib/correr-escritura.ts";
import type { OpcionesCorrida } from "../lib/correr-escritura.ts";
import { DESTINO_PRUEBAS, DESTINO_REAL } from "../lib/destinos.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
import { abrirConexionEscritura, abrirConexionLectura, elegirDestinoLectura } from "../lib/escribir.ts";
import type { ConexionEscritura, ResultadoEscritura } from "../lib/escribir.ts";
import { construirInformeEscritura, nombreDeInformeEscritura, sinCorreos } from "../lib/informe-escritura.ts";
import { simular } from "../lib/simular.ts";
import { leerLargosSchema } from "../lib/validar.ts";
import type { OpcionesCli } from "../lib/conexiones.ts";
import type { Fila } from "../lib/leer-wordpress.ts";
import { abrirPruebas, crearEjecutor, medirSintetico, planDePruebas, vaciarYSembrarPruebas } from "./ayudas-db.ts";

const { ta, cantidad } = crearEjecutor();
const conexion = await abrirPruebas();
const { prisma } = conexion;
const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));   // packages/compartido
const MIGRAR = join(RAIZ, "scripts", "migracion", "migrar.ts");

/** Una apertura de conexión que cuenta cuántas veces se la llama y devuelve la conexión de pruebas (sin cerrarla al final de la corrida). */
function aperturaEspia() {
  const espia = { llamadas: 0 };
  const abrir = async (destino: unknown): Promise<ConexionEscritura> => {
    espia.llamadas++;
    const c = await abrirConexionEscritura(destino);
    return { ...c, cerrar: async () => { await c.cerrar(); } };
  };
  return { espia, abrir };
}

const base = (extra: Partial<OpcionesCorrida> & Pick<OpcionesCorrida, "plan">): OpcionesCorrida => ({
  destino: DESTINO_PRUEBAS, esperarArticulos: extra.plan.articulos.length, sobrescribir: false, esperarSobrescribir: null, abortarAlPrimerError: false,
  terminalInteractiva: false, baseTipeada: null, ...extra,
});

async function conteos() {
  const c = (n: Promise<number>) => n;
  return [await c(prisma.articulo.count()), await c(prisma.categoria.count()), await c(prisma.autor.count()), await c(prisma.imagen.count()), await c(prisma.redireccion.count()),
    await c(prisma.articuloCategoria.count()), await c(prisma.articuloAutor.count()), await c(prisma.galeriaItem.count())];
}

/** conteos, ids e instantes de actualización: lo que D08 y T21 tienen que ver sin cambios */
async function foto() {
  return {
    conteos: await conteos(),
    articulos: (await prisma.articulo.findMany({ orderBy: { id: "asc" }, select: { id: true, titulo: true, actualizadoEn: true } })).map((x) => [x.id, x.titulo, x.actualizadoEn.toISOString()]),
    autores: (await prisma.autor.findMany({ orderBy: { id: "asc" }, select: { id: true, actualizadoEn: true } })).map((x) => [x.id, x.actualizadoEn.toISOString()]),
    imagenes: (await prisma.imagen.findMany({ orderBy: { id: "asc" }, select: { id: true } })).map((x) => x.id),
  };
}

try {
  // -------------------------------------------------------------------------------------------------------------
  // T21: confirmaciones
  // -------------------------------------------------------------------------------------------------------------
  await ta("T21: las confirmaciones puras: N del plan, coherencia de la sobrescritura y destino real", async () => {
    const ok = { destino: DESTINO_PRUEBAS, articulosEnElPlan: 35, esperarArticulos: 35, sobrescribir: false, esperarSobrescribir: null, terminalInteractiva: false, baseTipeada: null };
    assert.deepEqual(confirmarAntesDeConectar(ok), { ok: true });
    for (const n of [34, 36, 0, null]) assert.equal(confirmarAntesDeConectar({ ...ok, esperarArticulos: n }).ok, false, String(n));
    assert.match((confirmarAntesDeConectar({ ...ok, esperarArticulos: 34 }) as { motivos: string[] }).motivos.join(), /34 no coincide con los 35/);
    // sobrescritura: hace falta su N, y el N no se admite sin sobrescritura
    assert.equal(confirmarAntesDeConectar({ ...ok, sobrescribir: true }).ok, false);
    assert.equal(confirmarAntesDeConectar({ ...ok, sobrescribir: true, esperarSobrescribir: 2 }).ok, true);
    assert.equal(confirmarAntesDeConectar({ ...ok, esperarSobrescribir: 2 }).ok, false);
    // el N de la sobrescritura es el TOTAL de filas (artículos + autores + imágenes), no solo de artículos
    const ids = (articulos: number[], autores: number[] = [], imagenes: number[] = []) => ({ articulos, autores, imagenes });
    assert.deepEqual(confirmarSobrescritura(2, ids([10, 20])), { ok: true });
    assert.deepEqual(confirmarSobrescritura(0, ids([])), { ok: true });
    assert.deepEqual(confirmarSobrescritura(4, ids([10], [5, 6], [7])), { ok: true });
    for (const [n, calc] of [[1, ids([10, 20])], [3, ids([10, 20])], [0, ids([10])], [null, ids([])], [1, ids([10], [5], [7])], [0, ids([], [5])], [0, ids([], [], [7])], [2, ids([10], [5], [7])]] as const) {
      assert.equal(confirmarSobrescritura(n, calc).ok, false, `${n} vs ${JSON.stringify(calc)}`);
    }
    assert.match((confirmarSobrescritura(1, ids([10], [5], [7])) as { motivos: string[] }).motivos.join(), /3 filas.*artículos 1 \(10\).*autores 1 \(5\).*imágenes 1 \(7\)/);
    // destino real: sin terminal interactiva se niega; con terminal hay que tipear la base; y además el interruptor
    const real = { ...ok, destino: DESTINO_REAL };
    const motivos = (e: Parameters<typeof confirmarAntesDeConectar>[0]) => { const r = confirmarAntesDeConectar(e); return r.ok ? [] : r.motivos; };
    assert.ok(motivos(real).some((m) => /terminal interactiva/.test(m)));
    assert.ok(motivos({ ...real, terminalInteractiva: true, baseTipeada: "evaristo_cms_test" }).some((m) => /tipear el nombre de la base/.test(m)));
    assert.ok(motivos({ ...real, terminalInteractiva: true, baseTipeada: null }).some((m) => /tipear el nombre de la base/.test(m)));
    assert.ok(motivos({ ...real, terminalInteractiva: true, baseTipeada: "evaristo_cms" }).some((m) => /deshabilitada/.test(m)), "aun tipeando bien, el interruptor en false la niega");
    assert.equal(motivos({ ...real, terminalInteractiva: true, baseTipeada: "evaristo_cms" }).length, 1);
    // la base de pruebas no pide terminal ni tipear
    assert.deepEqual(confirmarAntesDeConectar({ ...ok, terminalInteractiva: false }), { ok: true });
    // el CLI se niega siempre mientras el interruptor esté en false
    const d = decidirEscrituraCli();
    assert.equal(d.permitido, false);
    assert.match(d.mensaje, /deshabilitada.*No se abrió ninguna conexión de escritura/);
  });

  await ta("T21: un N incorrecto no escribe nada, ni siquiera categorías, y ni abre la conexión", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    const vacio = await foto();
    assert.deepEqual(vacio.conteos, [0, 0, 0, 0, 0, 0, 0, 0]);
    const { espia, abrir } = aperturaEspia();
    for (const n of [34, 36, 0, null]) {
      const r = await correrEscritura(base({ plan, esperarArticulos: n, abrir }));
      assert.equal(r.rechazada, true, String(n));
      assert.equal(r.codigoDeSalida, 2);
    }
    assert.equal(espia.llamadas, 0, "no se abrió ninguna conexión");
    assert.deepEqual(await foto(), vacio, "la base quedó vacía: ni categorías");
    // con el N correcto sí escribe
    const bien = await correrEscritura(base({ plan, abrir }));
    assert.equal(bien.rechazada, false);
    assert.equal(espia.llamadas, 1);
    assert.equal(await prisma.articulo.count(), 35);
  });

  await ta("T21: la sobrescritura con cantidad incorrecta no escribe nada", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    assert.equal((await correrEscritura(base({ plan }))).codigoDeSalida, 0);
    const a = plan.articulos[5]!;
    await prisma.articulo.update({ where: { wpId: a.wpId }, data: { titulo: "editado a mano" } });
    const editado = await foto();
    const { espia, abrir } = aperturaEspia();
    // sin --sobrescribir no se admite --esperar-sobrescribir: se rechaza antes de conectar
    assert.equal((await correrEscritura(base({ plan, abrir, esperarSobrescribir: 1 }))).rechazada, true);
    assert.equal(espia.llamadas, 0);
    // con --sobrescribir pero otra cantidad: se conecta para calcular, pero no se escribe nada
    for (const n of [0, 2, null]) {
      const r = await correrEscritura(base({ plan, abrir, sobrescribir: true, esperarSobrescribir: n }));
      assert.equal(r.rechazada, true, String(n));
      if (r.rechazada) assert.match(r.motivos.join(), /(1 filas que se reescribirían|falta --esperar-sobrescribir)/);
    }
    assert.deepEqual(await foto(), editado, "no se escribió nada");
    // la cantidad exacta sí reescribe ese artículo
    const ok = await correrEscritura(base({ plan, abrir, sobrescribir: true, esperarSobrescribir: 1 }));
    assert.equal(ok.rechazada, false);
    if (!ok.rechazada) { const ids = { articulos: [a.wpId], autores: [], imagenes: [] }; assert.deepEqual(ok.resultado.idsSobrescritos, ids); assert.deepEqual(ok.informe.idsSobrescritos, ids); }
    assert.equal((await prisma.articulo.findUnique({ where: { wpId: a.wpId } }))!.titulo, a.titulo);
  });

  await ta("T21: autor o imagen que difiere: con N=0 o con N de solo artículos no se escribe nada; con el total correcto sí, y el informe lista los ids por tipo", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    assert.equal((await correrEscritura(base({ plan }))).codigoDeSalida, 0);
    const a = plan.articulos[5]!;
    const autor = plan.autores.find((x) => !x.soloTexto)!;
    const imagen = plan.imagenes[9]!;
    await prisma.autor.update({ where: { wpUserId: autor.wpUserId }, data: { nombre: "Nombre editado a mano" } });
    await prisma.imagen.update({ where: { wpId: imagen.wpId }, data: { alto: imagen.alto + 3 } });
    const solo = await foto();   // difieren solo un autor y una imagen: ningún artículo
    const { espia, abrir } = aperturaEspia();

    // sin --sobrescribir no se reescribe ninguna fila de ningún tipo: el autor y la imagen se informan como que difieren
    const sin = await correrEscritura(base({ plan, abrir }));
    assert.equal(sin.rechazada, false);
    if (!sin.rechazada) {
      assert.deepEqual(sin.resultado.idsSobrescritos, { articulos: [], autores: [], imagenes: [] });
      assert.deepEqual(sin.informe.difieren.map((d) => [d.tabla, d.clave, d.sobrescrita]), [["autores", String(autor.wpUserId), false], ["imagenes", String(imagen.wpId), false]]);
    }
    assert.deepEqual(await foto(), solo);

    // con --sobrescribir y N=0 (o cualquier otro N): hay 2 filas que se reescribirían, así que se rechaza y no se escribe nada
    const detalle = new RegExp(`no coincide con las 2 filas.*artículos 0 \\(ninguno\\); autores 1 \\(${autor.wpUserId}\\); imágenes 1 \\(${imagen.wpId}\\)`);
    for (const n of [0, 1, 3]) {
      const r = await correrEscritura(base({ plan, abrir, sobrescribir: true, esperarSobrescribir: n }));
      assert.equal(r.rechazada, true, String(n));
      if (r.rechazada) assert.match(r.motivos.join(), detalle);
    }
    assert.deepEqual(await foto(), solo, "no se escribió nada");
    assert.equal((await prisma.autor.findUnique({ where: { wpUserId: autor.wpUserId } }))!.nombre, "Nombre editado a mano");
    assert.equal((await prisma.imagen.findUnique({ where: { wpId: imagen.wpId } }))!.alto, imagen.alto + 3);

    // ahora también difiere un artículo: el N de solo artículos (1) no alcanza; el total (3) sí
    await prisma.articulo.update({ where: { wpId: a.wpId }, data: { titulo: "editado a mano" } });
    const tres = await foto();
    const soloArticulos = await correrEscritura(base({ plan, abrir, sobrescribir: true, esperarSobrescribir: 1 }));
    assert.equal(soloArticulos.rechazada, true);
    if (soloArticulos.rechazada) assert.match(soloArticulos.motivos.join(), /no coincide con las 3 filas/);
    assert.deepEqual(await foto(), tres);
    const carpeta = mkdtempSync(join(tmpdir(), "informe-sobrescribir-"));
    try {
      const ok = await correrEscritura(base({ plan, abrir, sobrescribir: true, esperarSobrescribir: 3, carpetaInformes: carpeta }));
      assert.equal(ok.rechazada, false);
      if (ok.rechazada) return;
      const ids = { articulos: [a.wpId], autores: [autor.wpUserId], imagenes: [imagen.wpId] };
      assert.deepEqual(ok.resultado.idsSobrescritos, ids);
      assert.deepEqual(ok.informe.idsSobrescritos, ids);
      assert.deepEqual(ok.informe.tablas.map((t) => [t.tabla, t.sobrescritas]).filter(([, n]) => n), [["autores", 1], ["imagenes", 1], ["articulos", 1]]);
      // el informe lista los ids por tipo y ningún valor
      for (const archivo of readdirSync(carpeta)) {
        const texto = readFileSync(join(carpeta, archivo), "utf8");
        assert.ok(texto.includes(String(autor.wpUserId)) && texto.includes(String(imagen.wpId)) && texto.includes(String(a.wpId)), `${archivo}: trae los ids`);
        assert.ok(!texto.includes("editado a mano") && !texto.includes(a.titulo) && !texto.includes(autor.nombre), `${archivo}: sin valores`);
      }
      assert.deepEqual(JSON.parse(readFileSync(join(carpeta, readdirSync(carpeta).find((x) => x.endsWith(".json"))!), "utf8")).idsSobrescritos, ids);
    } finally { rmSync(carpeta, { recursive: true, force: true }); }
    assert.equal((await prisma.autor.findUnique({ where: { wpUserId: autor.wpUserId } }))!.nombre, autor.nombre);
    assert.equal((await prisma.imagen.findUnique({ where: { wpId: imagen.wpId } }))!.alto, imagen.alto);
    assert.equal((await prisma.articulo.findUnique({ where: { wpId: a.wpId } }))!.titulo, a.titulo);
    assert.ok(espia.llamadas > 0);
  });

  await ta("T21: el destino real se niega sin terminal interactiva y nunca abre una conexión", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    const { espia, abrir } = aperturaEspia();
    const vacio = await foto();
    for (const extra of [
      { terminalInteractiva: false, baseTipeada: null }, { terminalInteractiva: false, baseTipeada: "evaristo_cms" },
      { terminalInteractiva: true, baseTipeada: "otra" }, { terminalInteractiva: true, baseTipeada: "evaristo_cms" },
    ]) {
      const r = await correrEscritura(base({ plan, destino: DESTINO_REAL, abrir, ...extra }));
      assert.equal(r.rechazada, true, JSON.stringify(extra));
      assert.equal(r.codigoDeSalida, 2);
    }
    // aun sin pasar por la confirmación, la conexión de escritura al destino real se niega
    await assert.rejects(() => abrirConexionEscritura(DESTINO_REAL), /deshabilitada/);
    assert.equal(espia.llamadas, 0);
    assert.deepEqual(await foto(), vacio);
  });

  await ta("T21: el informe de escritura no trae correos ni bios y la salida es 1 si hay fallidos o conflictos", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    const carpeta = mkdtempSync(join(tmpdir(), "informe-escribir-"));
    try {
      const r = await correrEscritura(base({ plan, carpetaInformes: carpeta, ahora: () => new Date("2026-10-18T10:20:30.456Z") }));
      assert.equal(r.rechazada, false);
      if (r.rechazada) return;
      assert.equal(r.codigoDeSalida, 0);
      assert.deepEqual(r.informe.destino, { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms_test" });
      assert.equal(r.informe.servidor.soloLectura, 0);
      const fila = (t: string) => r.informe.tablas.find((x) => x.tabla === t)!;
      assert.deepEqual([fila("articulos").insertadas, fila("categorias").insertadas, fila("imagenes").insertadas, fila("redirecciones").insertadas], [35, 7, 200, 58]);
      assert.deepEqual(readdirSync(carpeta).sort(), [`${nombreDeInformeEscritura("2026-10-18T10:20:30.456Z")}.json`, `${nombreDeInformeEscritura("2026-10-18T10:20:30.456Z")}.md`]);
      assert.equal(nombreDeInformeEscritura("2026-10-18T10:20:30.456Z"), "2026-10-18T102030Z-escribir");
      for (const archivo of readdirSync(carpeta)) {
        const texto = readFileSync(join(carpeta, archivo), "utf8");
        assert.ok(!/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(texto), `${archivo}: sin correos`);
        const bios = plan.autores.flatMap((a) => (a.bio ? [JSON.stringify(a.bio).slice(30, 90)] : []));
        assert.ok(bios.length > 0 && bios.every((b) => !texto.includes(b)), `${archivo}: sin bios`);
        assert.ok(!texto.includes(plan.articulos[0]!.textoPlano.slice(0, 80)), `${archivo}: sin cuerpos`);
      }
      assert.equal(JSON.parse(readFileSync(join(carpeta, readdirSync(carpeta).find((x) => x.endsWith(".json"))!), "utf8")).codigoDeSalida, 0);

      // un conflicto de imagen: artículos fallidos con su motivo y salida 1
      await vaciarYSembrarPruebas(prisma);
      const imagen = plan.imagenes.find((i) => i.usos.includes("encabezado"))!;
      await prisma.imagen.create({ data: { clave: imagen.clave, nombreOriginal: "ajena.jpg", tipoMime: "image/jpeg", ancho: 1, alto: 1, bytes: 1, hash: "d".repeat(64), wpId: 444444 } });
      const mal = await correrEscritura(base({ plan }));
      assert.equal(mal.rechazada, false);
      if (mal.rechazada) return;
      assert.equal(mal.codigoDeSalida, 1);
      assert.deepEqual(mal.informe.fallidos.map((x) => x.wpId).sort((a, b) => a - b), [...imagen.articulos].sort((a, b) => a - b));
      assert.ok(mal.informe.fallidos.every((x) => x.motivo.includes(imagen.clave)));
      assert.equal(mal.informe.conflictos.length, 1);
      assert.equal(mal.informe.tablas.find((x) => x.tabla === "imagenes")!.conflictos, 1);

      // los correos se tachan en cualquier texto del informe
      assert.equal(sinCorreos("falló con a.b+c@dominio.com.ar y listo"), "falló con [correo omitido] y listo");
      const falso = { estado: "error", abortado: false, base: mal.resultado.base, articulos: [{ wpId: 1, slug: "x", resultado: "fallido", motivo: "no se pudo para persona@ejemplo.org" }],
        conteos: { escritos: 0, sinCambios: 0, difieren: 0, sobrescritos: 0, fallidos: 1 }, redirecciones: { creadas: 0, sinCambios: 0, conflictos: 0 }, conflictos: [], idsSobrescritos: { articulos: [], autores: [], imagenes: [] } } as ResultadoEscritura;
      const i2 = construirInformeEscritura({ generadoEn: "2026-10-18T00:00:00.000Z", destino: { ...DESTINO_PRUEBAS }, servidor: mal.informe.servidor, opciones: mal.informe.opciones, plan, resultado: falso });
      assert.equal(i2.fallidos[0]!.motivo, "no se pudo para [correo omitido]");
    } finally { rmSync(carpeta, { recursive: true, force: true }); }
  });

  await ta("T21: el CLI acepta --escribir pero sale con 2 antes de abrir ninguna conexión", async () => {
    // DATABASE_URL apunta a un puerto sin servidor: si el CLI intentara conectar, el mensaje y el tiempo serían otros
    const env = { ...process.env, DATABASE_URL: "mysql://nadie:nada@127.0.0.1:1/evaristo_cms" };
    const correr = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", MIGRAR, ...args], { env, encoding: "utf8", cwd: RAIZ, timeout: 60_000 });
    for (const args of [
      ["--muestra", "--escribir", "--esperar-articulos=35", "--originales=carpeta-que-no-existe"],
      ["--muestra", "--escribir", "--esperar-articulos=35", "--sobrescribir", "--esperar-sobrescribir=1", "--originales=carpeta-que-no-existe"],
      ["--ids=22546", "--escribir", "--esperar-articulos=1"],
    ]) {
      const r = correr(...args);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stderr, /deshabilitada.*No se abrió ninguna conexión de escritura/);
      assert.ok(!/ECONNREFUSED|Simulación|Informe:/.test(r.stdout + r.stderr), "no intentó conectar ni simular");
    }
    // los errores de argumentos siguen saliendo con 2 y su propio mensaje
    for (const [args, texto] of [
      [["--muestra", "--escribir"], /necesita --esperar-articulos/], [["--muestra", "--escribir", "--esperar-articulos=35", "--sobrescribir"], /necesita --esperar-sobrescribir/],
      [["--todos"], /--todos: no implementado/],
    ] as const) { const r = correr(...args); assert.equal(r.status, 2); assert.match(r.stderr, texto); }
  });

  // -------------------------------------------------------------------------------------------------------------
  // D08: la simulación contra la base de pruebas no cambia nada
  // -------------------------------------------------------------------------------------------------------------
  await ta("D08: la conexión de lectura a la base de pruebas solo se abre con la constante y está en READ ONLY", async () => {
    assert.equal(elegirDestinoLectura(DESTINO_PRUEBAS), DESTINO_PRUEBAS);
    for (const d of [DESTINO_REAL, { ...DESTINO_PRUEBAS }, "evaristo_cms_test", undefined, null]) {
      assert.throws(() => elegirDestinoLectura(d), /no permitido/);
      await assert.rejects(() => abrirConexionLectura(d), /no permitido/);
    }
    const lectura = await abrirConexionLectura(DESTINO_PRUEBAS);
    try {
      assert.deepEqual([lectura.servidor.puerto, lectura.servidor.base, lectura.servidor.soloLectura], [3308, "evaristo_cms_test", 1]);
      assert.match(lectura.servidor.version, /^8\.4\./);
      const [f] = await lectura.bd("SELECT DATABASE() AS base, @@session.transaction_read_only AS ro");
      assert.deepEqual([f!["base"], Number(f!["ro"])], ["evaristo_cms_test", 1]);
      await assert.rejects(() => lectura.bd("DELETE FROM articulos"), /Solo se permite un SELECT/);
      await assert.rejects(() => lectura.bd("SELECT 1; DELETE FROM articulos"), /Solo se permite un SELECT/);
    } finally { await lectura.cerrar(); }
  });

  await ta("D08: simular contra evaristo_cms_test no cambia ningún conteo, id ni actualizadoEn", async () => {
    await vaciarYSembrarPruebas(prisma);
    const { plan } = await planDePruebas(prisma);
    assert.equal((await correrEscritura(base({ plan }))).codigoDeSalida, 0);
    const antes = await foto();
    const lectura = await abrirConexionLectura(DESTINO_PRUEBAS);
    try {
      const entrada = entradaDesdeSnapshot();
      // esta prueba no lee WordPress: el único dato que simular() pide de ahí son las cuentas de solo texto
      const wp = async (): Promise<Fila[]> => entrada.cuentas.map((c) => ({ id: c.wpUserId, login: c.user_login, nombre: c.nombre }));
      const sql: string[] = [];
      const bd: typeof lectura.bd = (texto, ...p) => { sql.push(texto); return lectura.bd(texto, ...p); };
      const opciones: OpcionesCli = { alcance: { tipo: "muestra" }, modo: "simular", esperarArticulos: null, esperarSobrescribir: null, abortarAlPrimerError: false, sobrescribir: false, originales: "(sin carpeta)" };
      const { informe } = await simular(opciones, {
        wp, bd, destino: { host: lectura.destino.host, puerto: lectura.servidor.puerto, base: lectura.servidor.base },
        servidorCms: { puerto: lectura.servidor.puerto, base: lectura.servidor.base, readOnly: 0, version: lectura.servidor.version },
        servidorWordPress: { puerto: 3307, base: "evaristo_lectura", readOnly: 0, version: "10.11.2-MariaDB" },
      }, { leerEntrada: async () => entradaDesdeSnapshot(), largos: leerLargosSchema(), medir: medirSintetico });
      assert.ok(sql.length > 10 && sql.every((s) => /^\s*SELECT\b/i.test(s)), "solo SELECT");
      // todo lo del plan ya está: no hay nada que insertar
      const t = (n: string) => informe.tablas.find((x) => x.tabla === n)!;
      assert.deepEqual([t("articulos").enElPlan, t("articulos").insertar, t("articulos").yaExisteSinComparar], [35, 0, 35]);
      assert.deepEqual([t("categorias").insertar, t("autores").insertar, t("imagenes").insertar, t("redirecciones").insertar], [0, 0, 0, 0]);
      // la base de pruebas no es el destino real: la simulación lo marca como bloqueante, y solo eso
      assert.deepEqual(informe.bloqueantes.map((b) => b.codigo), ["destino_no_permitido"]);
    } finally { await lectura.cerrar(); }
    assert.deepEqual(await foto(), antes);
  });

  console.log(`${cantidad()} pruebas con base (parte 4) ok`);
} finally {
  await conexion.cerrar();
}
