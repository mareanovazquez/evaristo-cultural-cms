// Prueba de punta a punta del flujo de migrar:escribir (lib/flujo-escribir.ts, el MISMO código del comando real) contra evaristo_cms_test, con las
// credenciales de evaristo_migracion (DATABASE_URL_MIGRACION), la lectura en vivo de WordPress (3307) y los originales de la muestra.
// Necesita: los servidores 3307 y 3308 arriba, DATABASE_URL_MIGRACION en el .env, el GRANT SELECT/INSERT/UPDATE/DELETE de ese usuario sobre
// evaristo_cms_test y la carpeta de originales (uploads-muestra/originales, o la de ORIGINALES_PRUEBA). Es una suite aparte de test:migracion-db para
// que esa no dependa del usuario evaristo_migracion. El flujo se ejecuta con dependencias de PRUEBA (DESTINO_PRUEBAS, interruptor true): el comando
// real sigue usando siempre las constantes. Antes y después de cada caso se comprueba que evaristo_cms no cambió.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { credencialesDeUrl } from "../lib/credenciales.ts";
import { DESTINO_PRUEBAS } from "../lib/destinos.ts";
import { abrirConexionEscritura } from "../lib/escribir.ts";
import { correrFlujoEscribir } from "../lib/flujo-escribir.ts";
import { abrirPruebas, crearEjecutor, planDePruebas, vaciarYSembrarPruebas } from "./ayudas-db.ts";
import { dependenciasDePruebaEnVivo } from "./dependencias-prueba.ts";

const URL_MIGRACION = process.env["DATABASE_URL_MIGRACION"];
assert.ok(URL_MIGRACION, "falta DATABASE_URL_MIGRACION en el .env: esta suite usa las credenciales de evaristo_migracion");
const CREDENCIALES = credencialesDeUrl(URL_MIGRACION, "DATABASE_URL_MIGRACION");
const ORIGINALES = process.env["ORIGINALES_PRUEBA"] ?? fileURLToPath(new URL("../../../../../../CMS-EVARISTO(ASSETS)/uploads-muestra/originales", import.meta.url));
assert.ok(existsSync(ORIGINALES), `no está la carpeta de originales: ${ORIGINALES} (se puede indicar otra con ORIGINALES_PRUEBA)`);

const { ta, cantidad } = crearEjecutor();
const conexion = await abrirPruebas();
const { prisma } = conexion;
const CARPETA_INFORMES = mkdtempSync(join(tmpdir(), "flujo-escribir-"));
const ID_CORTO = 12526;   // ensayo, sin imágenes de cuerpo: 1 artículo, 1 autor (278), 1 categoría, 3 redirecciones (artículo, slug anterior y autor)
const ID_EDITADO = 1555;  // un artículo con una sola categoría
const AUTOR_EDITADO = 278;

/** Todo lo que el flujo y este test imprimen: al final se revisa que no haya claves, correos ni bios. */
const salidas: string[] = [];

async function correr(args: string[]) {
  const r = dependenciasDePruebaEnVivo({ carpetaInformes: CARPETA_INFORMES });
  const codigo = await correrFlujoEscribir([...args, `--originales=${ORIGINALES}`], { DATABASE_URL_MIGRACION: URL_MIGRACION }, r.deps);
  const texto = [...r.log, ...r.error].join("\n");
  salidas.push(texto);
  const m = texto.match(/Artículos: (\{[^}]*\})/);
  const redir = texto.match(/redirecciones: (\{[^}]*\})/);
  return { codigo, r, texto, conteos: m ? JSON.parse(m[1]!) as Record<string, number> : null, redirecciones: redir ? JSON.parse(redir[1]!) as Record<string, number> : null };
}

async function totales() {
  return {
    articulos: await prisma.articulo.count(), autores: await prisma.autor.count(), categorias: await prisma.categoria.count(), imagenes: await prisma.imagen.count(),
    redirecciones: await prisma.redireccion.count(), articulosCategorias: await prisma.articuloCategoria.count(), articulosAutores: await prisma.articuloAutor.count(),
    galeria: await prisma.galeriaItem.count(),
  };
}
const COMPLETA = { articulos: 35, autores: 25, categorias: 8, imagenes: 200, redirecciones: 58, articulosCategorias: 12, articulosAutores: 35, galeria: 0 };

/** conteos e instantes de actualización de todo lo que tiene: lo que "sin cambios" y "no se escribió nada" tienen que dejar igual */
async function foto() {
  return {
    totales: await totales(),
    articulos: (await prisma.articulo.findMany({ orderBy: { id: "asc" }, select: { id: true, titulo: true, creadoEn: true, actualizadoEn: true } })).map((x) => [x.id, x.titulo, x.creadoEn.toISOString(), x.actualizadoEn.toISOString()]),
    autores: (await prisma.autor.findMany({ orderBy: { id: "asc" }, select: { id: true, nombre: true, creadoEn: true, actualizadoEn: true } })).map((x) => [x.id, x.nombre, x.creadoEn.toISOString(), x.actualizadoEn.toISOString()]),
    imagenes: (await prisma.imagen.findMany({ orderBy: { id: "asc" }, select: { id: true, creadoEn: true } })).map((x) => [x.id, x.creadoEn.toISOString()]),
    relaciones: (await prisma.articuloCategoria.findMany({ orderBy: [{ articuloId: "asc" }, { categoriaId: "asc" }] })).map((x) => [x.articuloId, x.categoriaId]),
  };
}

try {
  // a. un artículo solo, con --abortar-al-primer-error
  await ta("F-a: --ids=12526 --esperar-articulos=1 --abortar-al-primer-error: sale con 0, escribe lo suyo y la conexión de escritura es evaristo_migracion", async () => {
    await vaciarYSembrarPruebas(prisma);
    const r = await correr([`--ids=${ID_CORTO}`, "--esperar-articulos=1", "--abortar-al-primer-error"]);
    assert.equal(r.codigo, 0, r.texto);
    assert.deepEqual(r.conteos, { escritos: 1, sinCambios: 0, difieren: 0, sobrescritos: 0, fallidos: 0 });
    assert.deepEqual(r.redirecciones, { creadas: 3, sinCambios: 0, conflictos: 0 });
    assert.deepEqual(await totales(), { articulos: 1, autores: 1, categorias: 1, imagenes: 1, redirecciones: 3, articulosCategorias: 1, articulosAutores: 1, galeria: 0 });
    const porTipo = await prisma.redireccion.groupBy({ by: ["tipo"], _count: { _all: true }, orderBy: { tipo: "asc" } });
    assert.deepEqual(porTipo.map((x) => [x.tipo as string, x._count._all]).sort((p, q) => (p[0]! < q[0]! ? -1 : 1)), [["ARTICULO", 1], ["AUTOR", 1], ["SLUG_ANTERIOR", 1]]);
    assert.equal((await prisma.autor.findFirst())!.wpUserId, AUTOR_EDITADO);
    // la conexión de escritura fue evaristo_migracion y la apertura no falló (ni por la clave RSA)
    assert.equal(r.r.llamadas.escritura, 1);
    assert.deepEqual(r.r.erroresDeApertura, []);
    assert.equal(r.r.usuariosDeEscritura.length, 1);
    assert.match(r.r.usuariosDeEscritura[0]!, new RegExp(`^${CREDENCIALES.user}@`));
    console.log(`   la conexión de escritura fue ${r.r.usuariosDeEscritura[0]} (sin errores de apertura)`);
  });

  // b. sobre eso, la muestra completa
  await ta("F-b: --muestra --esperar-articulos=35: el 12526 figura sin cambios y los otros 34 se crean; los conteos son los de la carga completa", async () => {
    const r = await correr(["--muestra", "--esperar-articulos=35"]);
    assert.equal(r.codigo, 0, r.texto);
    assert.deepEqual(r.conteos, { escritos: 34, sinCambios: 1, difieren: 0, sobrescritos: 0, fallidos: 0 });
    assert.deepEqual(r.redirecciones, { creadas: 55, sinCambios: 3, conflictos: 0 });
    assert.deepEqual(await totales(), COMPLETA);
    assert.deepEqual(r.r.erroresDeApertura, []);
    assert.match(r.r.usuariosDeEscritura.join(), new RegExp(`^${CREDENCIALES.user}@`));
  });

  // c. repetir b
  await ta("F-c: repetir la muestra: todo sin cambios y ningún actualizadoEn cambia", async () => {
    const antes = await foto();
    const r = await correr(["--muestra", "--esperar-articulos=35"]);
    assert.equal(r.codigo, 0, r.texto);
    assert.deepEqual(r.conteos, { escritos: 0, sinCambios: 35, difieren: 0, sobrescritos: 0, fallidos: 0 });
    assert.deepEqual(r.redirecciones, { creadas: 0, sinCambios: 58, conflictos: 0 });
    assert.deepEqual(await foto(), antes);
  });

  // d. N de artículos incorrecto
  await ta("F-d: --esperar-articulos con un N incorrecto: sale con 2, no abre la conexión de escritura y ningún conteo cambia", async () => {
    const antes = await foto();
    for (const n of [34, 36, 1]) {
      const r = await correr(["--muestra", `--esperar-articulos=${n}`]);
      assert.equal(r.codigo, 2, `${n}: ${r.texto}`);
      assert.match(r.texto, new RegExp(`--esperar-articulos=${n} no coincide con los 35 artículos del plan`));
      assert.equal(r.r.llamadas.escritura, 0);
    }
    assert.deepEqual(await foto(), antes);
  });

  // e. sobrescritura: UPDATE y DELETE con evaristo_migracion
  await ta("F-e: sobrescritura: se restauran el título, el autor y las categorías editados; las relaciones se reemplazan; id y creadoEn se conservan", async () => {
    await vaciarYSembrarPruebas(prisma);
    assert.equal((await correr(["--muestra", "--esperar-articulos=35"])).codigo, 0);
    const articulo0 = (await prisma.articulo.findUnique({ where: { wpId: ID_EDITADO }, include: { categorias: true } }))!;
    const autor0 = (await prisma.autor.findUnique({ where: { wpUserId: AUTOR_EDITADO } }))!;
    assert.equal(articulo0.categorias.length, 1);
    const otraCategoria = (await prisma.categoria.findFirst({ where: { id: { not: articulo0.categorias[0]!.categoriaId } } }))!;
    const categoriaOriginal = articulo0.categorias[0]!.categoriaId;

    // lo editado "a mano", con el usuario evaristo
    await prisma.articulo.update({ where: { wpId: ID_EDITADO }, data: { titulo: "Título editado a mano" } });
    await prisma.autor.update({ where: { wpUserId: AUTOR_EDITADO }, data: { nombre: "Nombre editado a mano" } });
    await prisma.articuloCategoria.deleteMany({ where: { articuloId: articulo0.id } });
    await prisma.articuloCategoria.create({ data: { articuloId: articulo0.id, categoriaId: otraCategoria.id } });
    const editado = await foto();

    // sin --sobrescribir no se pisa nada: se informa que difieren
    const sin = await correr(["--muestra", "--esperar-articulos=35"]);
    assert.equal(sin.codigo, 0, sin.texto);
    assert.deepEqual(sin.conteos, { escritos: 0, sinCambios: 34, difieren: 1, sobrescritos: 0, fallidos: 0 });
    assert.deepEqual(await foto(), editado, "sin sobrescritura no se escribe nada");

    // con un N incorrecto no se escribe nada (el total real es 2: el artículo y el autor)
    for (const n of [0, 1, 3]) {
      const r = await correr(["--muestra", "--esperar-articulos=35", "--sobrescribir", `--esperar-sobrescribir=${n}`]);
      assert.equal(r.codigo, 2, `${n}: ${r.texto}`);
      assert.match(r.texto, new RegExp(`--esperar-sobrescribir=${n} no coincide con las 2 filas.*artículos 1 \\(${ID_EDITADO}\\); autores 1 \\(${AUTOR_EDITADO}\\); imágenes 0`));
      assert.deepEqual(await foto(), editado, `N=${n}: no se escribió nada`);
    }

    // con el N correcto
    const ok = await correr(["--muestra", "--esperar-articulos=35", "--sobrescribir", "--esperar-sobrescribir=2"]);
    assert.equal(ok.codigo, 0, ok.texto);
    assert.deepEqual(ok.conteos, { escritos: 0, sinCambios: 34, difieren: 0, sobrescritos: 1, fallidos: 0 });
    assert.match(ok.texto, new RegExp(`Sobrescritura \\(solo ids\\): \\{"articulos":\\[${ID_EDITADO}\\],"autores":\\[${AUTOR_EDITADO}\\],"imagenes":\\[\\]\\}`));
    assert.match(ok.r.usuariosDeEscritura.join(), new RegExp(`^${CREDENCIALES.user}@`));
    const articulo1 = (await prisma.articulo.findUnique({ where: { wpId: ID_EDITADO }, include: { categorias: true } }))!;
    const autor1 = (await prisma.autor.findUnique({ where: { wpUserId: AUTOR_EDITADO } }))!;
    assert.equal(articulo1.titulo, articulo0.titulo, "UPDATE: el título se restauró");
    assert.equal(autor1.nombre, autor0.nombre, "UPDATE: el nombre del autor se restauró");
    assert.deepEqual(articulo1.categorias.map((x) => x.categoriaId), [categoriaOriginal], "DELETE + INSERT: la relación editada se reemplazó por la del plan");
    assert.equal(await prisma.articuloCategoria.count({ where: { articuloId: articulo0.id, categoriaId: otraCategoria.id } }), 0, "DELETE: la relación editada ya no está");
    assert.equal(articulo1.id, articulo0.id);
    assert.equal(articulo1.creadoEn.getTime(), articulo0.creadoEn.getTime(), "creadoEn del artículo se conserva");
    assert.equal(autor1.id, autor0.id);
    assert.equal(autor1.creadoEn.getTime(), autor0.creadoEn.getTime(), "creadoEn del autor se conserva");
    assert.ok(articulo1.actualizadoEn.getTime() > articulo0.actualizadoEn.getTime(), "actualizadoEn del artículo se movió");
    assert.deepEqual(await totales(), COMPLETA);
  });

  // f. permisos negativos del usuario de migración
  await ta("F-f: evaristo_migracion no puede crear tablas en evaristo_cms_test ni leer evaristo_cms_shadow", async () => {
    const c = await abrirConexionEscritura(DESTINO_PRUEBAS, CREDENCIALES);
    try {
      const [f] = await c.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("SELECT CURRENT_USER() AS u");
      assert.match(String(f?.["u"]), new RegExp(`^${CREDENCIALES.user}@`));
      let creada = false, errorCrear: unknown = null;
      try { await c.prisma.$executeRawUnsafe("CREATE TABLE zz_permiso_negado (id INT)"); creada = true; } catch (e) { errorCrear = e; }
      if (creada) {
        await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS zz_permiso_negado");   // con el usuario evaristo
        assert.fail("evaristo_migracion pudo crear una tabla en evaristo_cms_test: tiene más privilegios que SELECT, INSERT, UPDATE y DELETE");
      }
      const mensajeCrear = errorCrear instanceof Error ? errorCrear.message : String(errorCrear);
      assert.match(mensajeCrear, /denied/i, "CREATE TABLE: permiso denegado");
      const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'evaristo_cms_test' AND TABLE_NAME = 'zz_permiso_negado'");
      assert.equal(Number(n), 0, "la tabla no quedó creada");
      let mensajeShadow = "";
      try { await c.prisma.$queryRawUnsafe("SELECT 1 FROM evaristo_cms_shadow.secciones LIMIT 1"); } catch (e) { mensajeShadow = e instanceof Error ? e.message : String(e); }
      assert.match(mensajeShadow, /denied/i, "SELECT en evaristo_cms_shadow: permiso denegado");
      console.log(`   CREATE TABLE: ${mensajeCrear.split("\n").pop()!.slice(0, 160)}`);
      console.log(`   SELECT en shadow: ${mensajeShadow.split("\n").pop()!.slice(0, 160)}`);
    } finally { await c.cerrar(); }
  });

  // g. los informes y las salidas
  await ta("F-g: los informes y las salidas del flujo no tienen @, texto de bio ni la clave", async () => {
    const hojas = (v: unknown, acc: string[] = []): string[] => { if (typeof v === "string") acc.push(v); else if (Array.isArray(v)) v.forEach((x) => hojas(x, acc)); else if (v && typeof v === "object") Object.values(v).forEach((x) => hojas(x, acc)); return acc; };
    const { plan } = await planDePruebas(prisma);
    const autor39 = plan.autores.find((a) => a.wpUserId === 39)!;
    const fragmentos39 = hojas(autor39.bio).map((s) => s.trim()).filter((s) => s.length >= 10);
    const fragmentos = plan.autores.flatMap((a) => hojas(a.bio)).map((s) => s.trim()).filter((s) => s.length >= 15);
    assert.ok(autor39.bioConCorreo && fragmentos39.length > 0 && fragmentos.length > 0, "el patrón de la bio del autor 39 existe");
    const archivos = readdirSync(CARPETA_INFORMES);
    assert.ok(archivos.filter((x) => x.endsWith("-escribir.json")).length >= 5 && archivos.filter((x) => x.endsWith("-escribir.md")).length >= 5, `informes generados: ${archivos.length}`);
    const textos = [...archivos.map((a) => readFileSync(join(CARPETA_INFORMES, a), "utf8")), ...salidas];
    for (const t of textos) {
      assert.ok(!t.includes("@"), "sin el carácter @");
      assert.ok(!fragmentos.some((s) => t.includes(s)) && !fragmentos39.some((s) => t.includes(s)), "sin texto de bio");
      assert.ok(!t.includes(CREDENCIALES.password) && !t.includes(URL_MIGRACION), "sin la clave ni la URL");
    }
    console.log(`   revisados ${archivos.length} informes y ${salidas.length} salidas`);
  });

  console.log(`${cantidad()} pruebas del flujo de punta a punta ok`);
} finally {
  await conexion.cerrar();
  rmSync(CARPETA_INFORMES, { recursive: true, force: true });
}
