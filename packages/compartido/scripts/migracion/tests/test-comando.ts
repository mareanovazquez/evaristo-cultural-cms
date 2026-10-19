// Pruebas puras del comando de escritura (migrar-escribir.ts): sus decisiones previas (T23), las credenciales de DATABASE_URL_MIGRACION y el
// aislamiento del comando (T22). Sin base y sin conexiones: el proceso hijo sale antes de abrir ninguna.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluarComando } from "../lib/comando-escribir.ts";
import { credencialesDeUrl, ErrorDeCredenciales } from "../lib/credenciales.ts";
import { confirmarAntesDeConectar } from "../lib/confirmaciones.ts";
import { DESTINO_PRUEBAS, DESTINO_REAL } from "../lib/destinos.ts";
import { cargarDatosVersionados } from "../lib/entrada-snapshot.ts";
import { correrFlujoEscribir, dependenciasReales, pedirNombreDeBase } from "../lib/flujo-escribir.ts";
import * as flujoEscribir from "../lib/flujo-escribir.ts";
import { dependenciasDePrueba } from "./dependencias-prueba.ts";
import { grafo } from "./grafo-imports.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };
const ta = async (name: string, fn: () => Promise<void>) => { await fn(); ok++; console.log("ok", name); };

const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));   // packages/compartido
const MIGRACION = join(RAIZ, "scripts", "migracion");
const COMANDO = join(MIGRACION, "migrar-escribir.ts");
const rel = (a: string) => relative(RAIZ, a).replace(/\\/g, "/");
const IDS = cargarDatosVersionados().ids;
const CLAVE = "CLAVE-SECRETA-123";
const URL_MIGRACION = `mysql://migrador:${CLAVE}@127.0.0.1:3308/evaristo_cms`;
const BUENOS = ["--muestra", "--esperar-articulos=35", "--originales=carpeta"];

const rechazo = (d: ReturnType<typeof evaluarComando>) => { assert.equal(d.ok, false); return d as Extract<typeof d, { ok: false }>; };

t("T23: los argumentos del comando: exige alcance, N de artículos y carpeta; rechaza --simular, --todos y cualquier opción de destino", () => {
  const ev = (argv: string[]) => evaluarComando(argv, { DATABASE_URL_MIGRACION: URL_MIGRACION }, IDS, true);
  assert.equal(ev(BUENOS).ok, true);
  assert.equal(ev(["--ids=22546", "--esperar-articulos=1", "--originales=c", "--abortar-al-primer-error"]).ok, true);
  assert.equal(ev([...BUENOS, "--escribir"]).ok, true, "--escribir explícito se acepta (es redundante)");
  const d = ev([...BUENOS, "--sobrescribir", "--esperar-sobrescribir=3"]);
  assert.ok(d.ok && d.opciones.modo === "escribir" && d.opciones.sobrescribir && d.opciones.esperarSobrescribir === 3 && d.opciones.esperarArticulos === 35);
  for (const [argv, texto] of [
    [["--esperar-articulos=35", "--originales=c"], /exactamente uno de --ids/],
    [["--muestra", "--originales=c"], /necesita --esperar-articulos/],
    [["--muestra", "--esperar-articulos=35"], /--originales=<carpeta> es obligatorio/],
    [[...BUENOS, "--simular"], /no acepta --simular/],
    [["--todos", "--esperar-articulos=35", "--originales=c"], /--todos: no implementado/],
    [[...BUENOS, "--sobrescribir"], /necesita --esperar-sobrescribir/],
    [[...BUENOS, "--esperar-sobrescribir=1"], /solo se usa con --sobrescribir/],
    [["--ids=1,2", "--esperar-articulos=2", "--originales=c"], /ids que no son de la muestra/],
    [[...BUENOS, "--esperar-articulos=36"], /repetido/],
    [[...BUENOS, "--esperar-articulos=0"], /repetido/],
    [[...BUENOS, "--destino=pruebas"], /argumento desconocido/], [[...BUENOS, "--base=evaristo_cms_test"], /argumento desconocido/],
    [[...BUENOS, "--database-url=mysql://x"], /argumento desconocido/], [[...BUENOS, "--habilitar-escritura-real"], /argumento desconocido/],
  ] as Array<[string[], RegExp]>) {
    const r = rechazo(ev(argv));
    assert.equal(r.codigoDeSalida, 2);
    assert.match(r.mensaje, texto, argv.join(" "));
    assert.match(r.mensaje, /^Error en los argumentos/);
  }
});

t("T23: el orden de las comprobaciones: argumentos, interruptor, credenciales (la primera que falla gana)", () => {
  const sinCredenciales = {};
  const conOtra = { DATABASE_URL: "mysql://evaristo:otraclave@127.0.0.1:3308/evaristo_cms" };
  // con el interruptor en false gana el del interruptor, falten o no las credenciales
  for (const env of [sinCredenciales, conOtra, { DATABASE_URL_MIGRACION: URL_MIGRACION }, { DATABASE_URL_MIGRACION: "no es una url" }]) {
    const r = rechazo(evaluarComando(BUENOS, env, IDS, false));
    assert.match(r.mensaje, /deshabilitada.*ESCRITURA_REAL_HABILITADA = false.*No se abrió ninguna conexión y no se escribió nada/, JSON.stringify(Object.keys(env)));
    assert.ok(!r.mensaje.includes(CLAVE) && !r.mensaje.includes("otraclave"));
  }
  // la constante real está en false: sin el parámetro de prueba también gana el interruptor
  assert.match(rechazo(evaluarComando(BUENOS, { DATABASE_URL_MIGRACION: URL_MIGRACION }, IDS)).mensaje, /deshabilitada/);
  // un argumento mal escrito gana al interruptor
  assert.match(rechazo(evaluarComando(["--muestra"], sinCredenciales, IDS, false)).mensaje, /^Error en los argumentos/);
  // con el interruptor en true, las credenciales
  assert.match(rechazo(evaluarComando(BUENOS, sinCredenciales, IDS, true)).mensaje, /Falta DATABASE_URL_MIGRACION.*No se abrió ninguna conexión/);
});

t("T23: las credenciales salen solo de DATABASE_URL_MIGRACION, nunca de DATABASE_URL, y la clave no aparece en ningún mensaje", () => {
  // DATABASE_URL sola NO sirve: no hay respaldo
  const r = rechazo(evaluarComando(BUENOS, { DATABASE_URL: "mysql://evaristo:clave-de-lectura@127.0.0.1:3308/evaristo_cms" }, IDS, true));
  assert.match(r.mensaje, /Falta DATABASE_URL_MIGRACION/);
  assert.ok(!r.mensaje.includes("clave-de-lectura") && !r.mensaje.includes("evaristo:"));
  // si están las dos, se usan las de migración
  const ambas = evaluarComando(BUENOS, { DATABASE_URL: "mysql://evaristo:clave-de-lectura@127.0.0.1:3308/evaristo_cms", DATABASE_URL_MIGRACION: URL_MIGRACION }, IDS, true);
  assert.ok(ambas.ok);
  assert.deepEqual(ambas.ok && ambas.credenciales, { user: "migrador", password: CLAVE });
  // host, puerto y base de la URL no se usan: solo usuario y clave (la clave se decodifica)
  assert.deepEqual(credencialesDeUrl("mysql://mig%40x:p%40ss@otro-host:1/otra-base", "V"), { user: "mig@x", password: "p@ss" });
  // mal formada o incompleta: error nombrando la variable, sin su valor
  const malas = [undefined, "", "no es una url", "http://u:p@127.0.0.1/x", `mysql://:${CLAVE}@127.0.0.1:3308/evaristo_cms`, "mysql://migrador@127.0.0.1:3308/evaristo_cms", "mysql://migrador:@127.0.0.1:3308/evaristo_cms"];
  for (const valor of malas) {
    assert.throws(() => credencialesDeUrl(valor, "DATABASE_URL_MIGRACION"), (e: unknown) => e instanceof ErrorDeCredenciales && /DATABASE_URL_MIGRACION/.test(e.message) && !e.message.includes(CLAVE) && !e.message.includes("migrador"), String(valor));
    const m = rechazo(evaluarComando(BUENOS, valor === undefined ? {} : { DATABASE_URL_MIGRACION: valor }, IDS, true));
    assert.equal(m.codigoDeSalida, 2);
    assert.match(m.mensaje, /No se abrió ninguna conexión y no se escribió nada/);
    assert.ok(!m.mensaje.includes(CLAVE), "la clave no aparece");
  }
  // las credenciales de los tests (DATABASE_URL) pueden no traer clave; las de migración sí la exigen
  assert.deepEqual(credencialesDeUrl("mysql://evaristo@127.0.0.1:3308/evaristo_cms", "DATABASE_URL", false), { user: "evaristo", password: "" });
});

t("T23: el comando en un proceso hijo, con el interruptor en false: las combinaciones válidas salen con 2 y no abren ninguna conexión", () => {
  // las dos URL apuntan a un puerto sin servidor: si el comando intentara conectar, el mensaje y el tiempo serían otros
  const base = { ...process.env, DATABASE_URL: "mysql://nadie:nada@127.0.0.1:1/evaristo_cms" };
  const sinMigracion = { ...base }; delete (sinMigracion as Record<string, unknown>)["DATABASE_URL_MIGRACION"];
  const entornos = [sinMigracion, { ...base, DATABASE_URL_MIGRACION: `mysql://migrador:${CLAVE}@127.0.0.1:1/evaristo_cms` }];
  const correr = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", COMANDO, ...args], { env, encoding: "utf8", cwd: RAIZ, timeout: 60_000 });
  for (const env of entornos) {
    for (const args of [
      ["--muestra", "--esperar-articulos=35", "--originales=carpeta-que-no-existe"],
      ["--ids=22546", "--esperar-articulos=1", "--originales=carpeta-que-no-existe", "--abortar-al-primer-error"],
      ["--ids=2462,22546", "--esperar-articulos=2", "--originales=carpeta-que-no-existe", "--escribir"],
      ["--muestra", "--esperar-articulos=35", "--sobrescribir", "--esperar-sobrescribir=3", "--originales=carpeta-que-no-existe"],
    ]) {
      const r = correr(env, ...args);
      const salida = r.stdout + r.stderr;
      assert.equal(r.status, 2, `${args.join(" ")}: ${salida}`);
      assert.match(r.stderr, /deshabilitada.*No se abrió ninguna conexión y no se escribió nada/, "gana el mensaje del interruptor, con o sin DATABASE_URL_MIGRACION");
      assert.ok(!/ECONNREFUSED|Plan de escritura|Informe:|Falta DATABASE_URL_MIGRACION/.test(salida), "no intentó conectar, ni armó el plan, ni habló de credenciales");
      assert.ok(!salida.includes(CLAVE) && !salida.includes("nada@"), "no imprime ninguna clave");
    }
    // los errores de argumentos salen con 2 y su propio mensaje
    for (const [args, texto] of [
      [["--muestra", "--escribir"], /necesita --esperar-articulos/], [["--todos", "--esperar-articulos=35", "--originales=c"], /--todos: no implementado/],
      [["--muestra", "--esperar-articulos=35", "--originales=c", "--simular"], /no acepta --simular/], [["--esperar-articulos=1", "--originales=c"], /exactamente uno de/],
    ] as const) {
      const r = correr(env, ...args);
      assert.equal(r.status, 2, args.join(" "));
      assert.match(r.stderr, texto);
    }
  }
});

// -----------------------------------------------------------------------------------------------------------------
// T22: el comando de escritura es el único que alcanza correr-escritura.ts y escribir.ts, y nadie lo importa
// -----------------------------------------------------------------------------------------------------------------
const ts = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (e.name === "node_modules" || e.name === "generated" || e.name === "dist" || e.name === ".astro") return [];
  const p = join(d, e.name);
  return e.isDirectory() ? ts(p) : /\.(ts|tsx|mts|js|mjs|astro)$/.test(e.name) ? [p] : [];
});

t("T22: migrar.ts no alcanza el comando de escritura, correr-escritura.ts ni escribir.ts", () => {
  const { archivos } = grafo(join(MIGRACION, "migrar.ts"));
  const alcanzados = [...archivos].map(rel);
  for (const prohibido of ["scripts/migracion/migrar-escribir.ts", "scripts/migracion/lib/comando-escribir.ts", "scripts/migracion/lib/correr-escritura.ts", "scripts/migracion/lib/escribir.ts", "scripts/migracion/lib/informe-escritura.ts", "scripts/migracion/lib/flujo-escribir.ts"]) {
    assert.ok(!alcanzados.includes(prohibido), `migrar.ts no debe alcanzar ${prohibido}`);
  }
  assert.deepEqual(alcanzados.filter((a) => /escribir|tests\//.test(a)), []);
});

t("T22: solo el comando de escritura (y sus módulos propios) alcanza escribir.ts y correr-escritura.ts; ningún otro programa", () => {
  // grafo calculado por el propio test sobre todos los .ts de scripts/migracion fuera de tests/
  const modulos = ts(MIGRACION).filter((a) => !rel(a).startsWith("scripts/migracion/tests/"));
  const alcanzan = (objetivo: string) => modulos.filter((m) => grafo(m).archivos.has(join(MIGRACION, objetivo))).map(rel).sort();
  assert.deepEqual(alcanzan("lib/correr-escritura.ts"), ["scripts/migracion/lib/correr-escritura.ts", "scripts/migracion/lib/flujo-escribir.ts", "scripts/migracion/migrar-escribir.ts"]);
  assert.deepEqual(alcanzan("lib/escribir.ts"), [
    "scripts/migracion/lib/correr-escritura.ts", "scripts/migracion/lib/escribir.ts", "scripts/migracion/lib/flujo-escribir.ts", "scripts/migracion/lib/informe-escritura.ts", "scripts/migracion/migrar-escribir.ts",
  ]);
  // el flujo nuevo lo alcanzan solo él mismo y el comando
  assert.deepEqual(alcanzan("lib/flujo-escribir.ts"), ["scripts/migracion/lib/flujo-escribir.ts", "scripts/migracion/migrar-escribir.ts"]);
  // los programas de la carpeta (migrar, corrida-en-seco, comparar-snapshot-vivo, generar-snapshot-wp) no llegan ahí
  const programas = readdirSync(MIGRACION).filter((f) => f.endsWith(".ts")).sort();
  assert.ok(programas.includes("migrar.ts") && programas.includes("migrar-escribir.ts"));
  assert.deepEqual(programas.filter((p) => grafo(join(MIGRACION, p)).archivos.has(join(MIGRACION, "lib", "escribir.ts"))), ["migrar-escribir.ts"]);
});

t("T22: ningún módulo importa el comando de escritura (solo se lo corre con el script npm migrar:escribir)", () => {
  const raizRepo = join(RAIZ, "..", "..");
  const fuentes = [RAIZ, join(raizRepo, "apps"), join(raizRepo, "packages")].flatMap((d) => { try { return ts(d); } catch { return []; } });
  const unicos = [...new Set(fuentes)];
  assert.ok(unicos.length > 50, "se recorrió el código");
  const quienes = unicos.filter((f) => /(?:from|import)\s*\(?\s*["'][^"']*migrar-escribir(?:\.[a-z]+)?["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(quienes.map((f) => relative(raizRepo, f).replace(/\\/g, "/")), []);
  // el flujo lo importan solo el comando y los tests; las dependencias de prueba, solo los tests (ningún archivo de producción)
  const importan = (nombre: string) => unicos.filter((f) => new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*${nombre}(?:\\.[a-z]+)?["']`).test(readFileSync(f, "utf8"))).map((f) => relative(raizRepo, f).replace(/\\/g, "/"));
  const noTests = (xs: string[]) => xs.filter((x) => !x.startsWith("packages/compartido/scripts/migracion/tests/"));
  assert.deepEqual(noTests(importan("flujo-escribir")), ["packages/compartido/scripts/migracion/migrar-escribir.ts"]);
  assert.deepEqual(noTests(importan("dependencias-prueba")), [], "ningún archivo de producción importa las dependencias de prueba");
  assert.ok(importan("dependencias-prueba").length > 0, "los tests sí las usan");
  // el script npm lo corre directamente
  const paquete = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(paquete.scripts["migrar:escribir"], "tsx scripts/migracion/migrar-escribir.ts");
  assert.equal(paquete.scripts["migrar"], "tsx scripts/migracion/migrar.ts");
});

t("T22: el comando no tiene otra vía a un destino ni a las credenciales: solo DESTINO_REAL, solo DATABASE_URL_MIGRACION y nunca DATABASE_URL", () => {
  const FLUJO = join(MIGRACION, "lib", "flujo-escribir.ts");
  for (const archivo of [COMANDO, join(MIGRACION, "lib", "comando-escribir.ts"), FLUJO]) {
    const texto = readFileSync(archivo, "utf8");
    assert.ok(!/DATABASE_URL(?!_MIGRACION)/.test(texto), `${rel(archivo)}: no menciona DATABASE_URL`);
    assert.ok(!/abrirConexionLectura/.test(texto), `${rel(archivo)}: no abre la lectura de la base de pruebas`);
    assert.ok(!/^\s*(?:export\s+)?(?:const|let|var)\s+ESCRITURA_REAL_HABILITADA\b|^\s*ESCRITURA_REAL_HABILITADA\s*=[^=]/m.test(texto), `${rel(archivo)}: no asigna el interruptor`);
    assert.ok(!/new PrismaClient\(/.test(texto), `${rel(archivo)}: no crea clientes`);
    // el destino de pruebas solo lo conoce la guarda del flujo (la comparación por identidad), nunca el comando ni sus decisiones
    if (archivo !== FLUJO) assert.ok(!/DESTINO_PRUEBAS/.test(texto), `${rel(archivo)}: no conoce el destino de pruebas`);
  }
  const flujo = readFileSync(FLUJO, "utf8");
  const usosDePruebas = flujo.split("\n").filter((l) => /DESTINO_PRUEBAS/.test(l) && !/^\s*(import|\/\/|\*|\/\*\*|error\()/.test(l)).map((l) => l.trim());
  assert.equal(usosDePruebas.length, 2, "DESTINO_PRUEBAS solo en la guarda del flujo");
  assert.ok(usosDePruebas[0]!.startsWith("if (!real && (deps.destino === DESTINO_REAL || deps.destino !== DESTINO_PRUEBAS))"));
  assert.deepEqual(flujo.match(/abrirConexionEscritura\([^)]*\)/g), ["abrirConexionEscritura(destino, credenciales)"], "la apertura pasa siempre las credenciales de migración");
  assert.equal((flujo.match(/destino: DESTINO_REAL/g) ?? []).length, 1, "las dependencias reales usan DESTINO_REAL una sola vez");
  assert.equal((flujo.match(/interruptor: ESCRITURA_REAL_HABILITADA/g) ?? []).length, 1, "las dependencias reales traen el interruptor de destinos.ts");
  assert.equal((flujo.match(/REALES\.add\(/g) ?? []).length, 1, "solo dependenciasReales() registra dependencias reales");
  // el registro de dependencias reales no se exporta, en ninguna forma: ni `export const|let|var REALES`, ni `export { REALES }` (con o sin `as`), ni `export default`
  assert.ok(!/export\s+(const|let|var)\s+REALES\b/.test(flujo), "el registro de dependencias reales no se exporta (export const)");
  assert.ok(!/export\s*\{[^}]*\bREALES\b/.test(flujo), "el registro de dependencias reales no se exporta (export { REALES } ni con as)");
  assert.ok(!/export\s+default\b/.test(flujo), "el flujo no tiene export default");
  assert.ok(!/export\s*\*/.test(flujo), "el flujo no re-exporta nada con export *");
  // y el registro solo se usa para declararlo, agregarle (dentro de dependenciasReales) y consultarlo: no se pasa, no se devuelve ni se guarda en otro lado
  const sinComentarios = flujo.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l));
  const conRegistro = sinComentarios.filter((l) => /\bREALES\b/.test(l)).map((l) => l.trim());
  assert.equal(conRegistro.length, 3, `REALES aparece solo en su declaración, en add y en has: ${conRegistro.join(" | ")}`);
  assert.ok(/^const REALES = new WeakSet<object>\(\);/.test(conRegistro[0]!) && /^REALES\.add\(deps\);$/.test(conRegistro[1]!) && /^const real = REALES\.has\(deps\);$/.test(conRegistro[2]!), "y cada uso es el esperado");
  assert.ok(!/process\.(env|argv)/.test(flujo), "el flujo no lee el entorno por su cuenta: lo recibe");
  const comando = readFileSync(COMANDO, "utf8");
  assert.deepEqual(comando.match(/process\.env\b[^\n]*/g)?.map((x) => x.slice(0, 13)), ["process.env, "], "process.env solo entra al flujo (que se lo pasa a evaluarComando)");
  assert.deepEqual(comando.match(/dependenciasReales\(\)/g), ["dependenciasReales()"], "el comando arma solo las dependencias reales");
  // migrar-escribir.ts es delgado: lista blanca de imports y nada de conexiones, destinos ni entorno fuera de la llamada al flujo (sin fijar su largo)
  const codigo = comando.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const imports = [...codigo.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)|(?:^|\n)\s*import\s+"([^"]+)"|require\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]!).sort();
  assert.deepEqual(imports, ["./lib/flujo-escribir.ts", "dotenv", "node:url"], "migrar-escribir.ts solo importa el cargador del .env (dotenv), node:url y el flujo");
  assert.ok(!/PrismaClient|abrirConexionEscritura|abrirConexionLectura|DESTINO_REAL|DESTINO_PRUEBAS|ESCRITURA_REAL_HABILITADA/.test(codigo), "migrar-escribir.ts no crea clientes, no abre conexiones ni nombra destinos ni el interruptor");
  assert.ok(!/\b(?:eval|require)\s*\(|new\s+Function|child_process/.test(codigo), "migrar-escribir.ts no carga código por otra vía");
  const usosDeEntorno = codigo.split("\n").filter((l) => /process\.env/.test(l));
  assert.equal(usosDeEntorno.length, 1, "process.env aparece una sola vez");
  assert.match(usosDeEntorno[0]!, /correrFlujoEscribir\(process\.argv\.slice\(2\), process\.env, dependenciasReales\(\)\)/, "y solo como argumento de la llamada al flujo");
  assert.equal(codigo.split("\n").filter((l) => /correrFlujoEscribir\(/.test(l)).length, 1, "una sola llamada al flujo");
  // y comando-escribir.ts no lee el entorno por su cuenta
  assert.ok(!/process\.(env|argv)/.test(readFileSync(join(MIGRACION, "lib", "comando-escribir.ts"), "utf8")));
});

t("T22: el verificador (lib/verificar.ts y verificar-escritura.ts) solo lee: no alcanza el código de escritura y nadie de producción lo importa salvo su script", () => {
  const VERIFICAR = join(MIGRACION, "lib", "verificar.ts"), SCRIPT = join(MIGRACION, "verificar-escritura.ts");
  const prohibidos = ["scripts/migracion/lib/escribir.ts", "scripts/migracion/lib/correr-escritura.ts", "scripts/migracion/lib/flujo-escribir.ts", "scripts/migracion/lib/comando-escribir.ts", "scripts/migracion/lib/informe-escritura.ts", "scripts/migracion/migrar-escribir.ts"];
  for (const entrada of [VERIFICAR, SCRIPT]) {
    const alcanzados = [...grafo(entrada).archivos].map(rel);
    for (const p of prohibidos) assert.ok(!alcanzados.includes(p), `${rel(entrada)} no debe alcanzar ${p}`);
    assert.ok(!alcanzados.some((a) => /tests\//.test(a)), `${rel(entrada)} no alcanza los tests`);
  }
  // migrar.ts y migrar-escribir.ts no lo alcanzan
  for (const programa of ["migrar.ts", "migrar-escribir.ts"]) {
    const alcanzados = [...grafo(join(MIGRACION, programa)).archivos].map(rel);
    assert.ok(!alcanzados.includes("scripts/migracion/lib/verificar.ts") && !alcanzados.includes("scripts/migracion/verificar-escritura.ts"), `${programa} no debe alcanzar el verificador`);
  }
  // quién alcanza la función central y el script (grafo calculado por el test sobre todos los módulos fuera de tests/)
  const modulos = ts(MIGRACION).filter((a) => !rel(a).startsWith("scripts/migracion/tests/"));
  const alcanzan = (objetivo: string) => modulos.filter((m) => grafo(m).archivos.has(join(MIGRACION, objetivo))).map(rel).sort();
  assert.deepEqual(alcanzan("lib/verificar.ts"), ["scripts/migracion/lib/verificar.ts", "scripts/migracion/verificar-escritura.ts"]);
  assert.deepEqual(alcanzan("verificar-escritura.ts"), ["scripts/migracion/verificar-escritura.ts"]);
  // nadie de producción importa ni la función ni el script; los importan solo el script (la función) y los tests
  const raizRepo = join(RAIZ, "..", "..");
  const unicos = [...new Set([RAIZ, join(raizRepo, "apps"), join(raizRepo, "packages")].flatMap((d) => { try { return ts(d); } catch { return []; } }))];
  const importan = (patron: string) => unicos.filter((f) => new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*${patron}["']`).test(readFileSync(f, "utf8"))).map((f) => relative(raizRepo, f).replace(/\\/g, "/"));
  const deProduccion = (xs: string[]) => xs.filter((x) => !x.startsWith("packages/compartido/scripts/migracion/tests/"));
  assert.deepEqual(deProduccion(importan("verificar(?:\\.ts)?")), ["packages/compartido/scripts/migracion/verificar-escritura.ts"], "la función central solo la importa su script");
  assert.deepEqual(deProduccion(importan("verificar-escritura(?:\\.ts)?")), [], "nadie de producción importa el script");
  assert.ok(importan("verificar(?:\\.ts)?").some((x) => x.includes("/tests/")), "los tests con base usan la función");
  // el script npm lo corre directamente
  const paquete = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(paquete.scripts["verificar:escritura"], "tsx scripts/migracion/verificar-escritura.ts");
  // y no tiene otra vía a una base: ni clientes propios, ni escritura, ni el destino de pruebas, ni sentencias que no sean SELECT
  for (const archivo of [VERIFICAR, SCRIPT]) {
    const codigo = readFileSync(archivo, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/new PrismaClient\(|createConnection|createPool|PrismaMariaDb/.test(codigo), `${rel(archivo)}: no abre conexiones propias`);
    assert.ok(!/abrirConexionEscritura|abrirConexionLectura|escribirPlan|DESTINO_PRUEBAS|ESCRITURA_REAL_HABILITADA/.test(codigo), `${rel(archivo)}: no conoce la escritura ni el destino de pruebas`);
    assert.ok(!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|LOCK|CALL)\b/.test(codigo), `${rel(archivo)}: ninguna sentencia que no sea SELECT`);
    assert.ok(!/\$executeRaw|\$queryRawUnsafe|\.query\(|\$transaction/.test(codigo), `${rel(archivo)}: solo pasa por la consulta de solo lectura que recibe`);
    assert.ok(!/DATABASE_URL_MIGRACION|process\.env/.test(codigo), `${rel(archivo)}: no toca el entorno ni las credenciales de migración`);
  }
  const script = readFileSync(SCRIPT, "utf8");
  assert.deepEqual(script.match(/abrirSoloCms\(\)|abrirSoloWordPress\(\)/g), ["abrirSoloCms()", "abrirSoloWordPress()"], "el script abre solo las dos conexiones de solo lectura que ya existen");
  assert.ok(!/--base/.test(script.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "no hay argumento de base");
  assert.equal((script.match(/destino: DESTINO_REAL/g) ?? []).length, 1, "apunta siempre a DESTINO_REAL");
});

t("T26: verificar-escritura.ts rechaza los argumentos inválidos con 2, antes de abrir ninguna conexión (no hay --base ni otra base)", () => {
  // DATABASE_URL apunta a un puerto sin servidor: si el script intentara conectar, la salida sería otra
  const env = { ...process.env, DATABASE_URL: "mysql://nadie:nada@127.0.0.1:1/evaristo_cms" };
  const correr = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(MIGRACION, "verificar-escritura.ts"), ...args], { env, encoding: "utf8", cwd: RAIZ, timeout: 60_000 });
  for (const [args, texto] of [
    [[], /hay que indicar uno de --id, --ids o --muestra/],
    [["--solo-estos"], /hay que indicar uno de --id, --ids o --muestra/],
    [["--base=evaristo_cms", "--muestra"], /argumento desconocido: --base=evaristo_cms/],
    [["--base=evaristo_cms_test", "--id=12526"], /argumento desconocido: --base=evaristo_cms_test/],
    [["--id=12526", "--ids=12526,1555"], /exactamente uno de --id, --ids o --muestra/],
    [["--muestra", "--id=12526"], /exactamente uno de --id, --ids o --muestra/],
    [["--id=12526,1555"], /--id lleva un solo número/],
    [["--id=abc"], /tiene que ser un número/],
    [["--ids=1,2"], /ids que no son de la muestra/],
    [["--id"], /necesita un valor/],
    [["--muestra", "--muestra"], /--muestra está repetido/],
    [["--muestra=1"], /--muestra no lleva valor/],
    [["--muestra", "--solo-estos=1"], /--solo-estos no lleva valor/],
    [["--muestra", "--destino=pruebas"], /argumento desconocido/],
    [["--id=12526", "--originales=carpeta-que-no-existe"], /no se puede leer la carpeta de originales/],
  ] as Array<[string[], RegExp]>) {
    const r = correr(...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, texto, args.join(" "));
    assert.match(r.stderr, /^Error en los argumentos/);
    assert.ok(!/ECONNREFUSED|Base:|comprobaciones/.test(r.stdout + r.stderr), "no intentó conectar");
  }
});

t("T22: ninguna exportación del flujo expone el registro de dependencias reales (comportamiento)", () => {
  const real = dependenciasReales();
  const exportadas = Object.entries(flujoEscribir as Record<string, unknown>);
  assert.ok(exportadas.length >= 3, "el flujo exporta sus funciones");
  for (const [nombre, valor] of exportadas) {
    assert.ok(!(valor instanceof WeakSet) && !(valor instanceof WeakMap) && !(valor instanceof Set) && !(valor instanceof Map), `${nombre}: no es un registro`);
    const tieneHas = (valor !== null && (typeof valor === "object" || typeof valor === "function")) && typeof (valor as { has?: unknown }).has === "function";
    if (tieneHas) assert.notEqual((valor as { has: (x: unknown) => unknown }).has(real), true, `${nombre}: no responde has() true para las dependencias reales`);
    if (typeof valor === "object" && valor !== null) {
      for (const [clave, interno] of Object.entries(valor as Record<string, unknown>)) assert.ok(!(interno instanceof WeakSet) && !(interno instanceof WeakMap), `${nombre}.${clave}: no es un registro`);
    }
  }
});

// -----------------------------------------------------------------------------------------------------------------
// La guarda de las dependencias del flujo y el tipeo del nombre de la base (sin base y sin conexiones)
// -----------------------------------------------------------------------------------------------------------------
const ARGS_FLUJO = ["--muestra", "--esperar-articulos=35", "--originales=carpeta-que-no-existe"];
const ENV_FLUJO = { DATABASE_URL_MIGRACION: URL_MIGRACION };
const SIN_LLAMADAS = { lectura: 0, escritura: 0, linea: 0 };

await ta("T24: dependencias de prueba con DESTINO_REAL e interruptor true se niegan sin leer credenciales ni conectar", async () => {
  const p = dependenciasDePrueba({ destino: DESTINO_REAL, interruptor: true });
  assert.equal(await correrFlujoEscribir(ARGS_FLUJO, ENV_FLUJO, p.deps), 2);
  assert.match(p.error.join("\n"), /solo se admite DESTINO_PRUEBAS.*No se abrió ninguna conexión y no se escribió nada/);
  assert.deepEqual(p.llamadas, SIN_LLAMADAS);
  assert.ok(!p.error.concat(p.log).join("\n").includes(CLAVE));
  // sin credenciales el mensaje es el mismo: la guarda va antes de leerlas
  const q = dependenciasDePrueba({ destino: DESTINO_REAL, interruptor: true });
  assert.equal(await correrFlujoEscribir(ARGS_FLUJO, {}, q.deps), 2);
  assert.match(q.error.join("\n"), /solo se admite DESTINO_PRUEBAS/);
  assert.ok(!/Falta DATABASE_URL_MIGRACION/.test(q.error.join("\n")));
});

await ta("T24: un destino que no es una de las dos constantes se niega: una copia con los mismos valores, un texto, una URL o nada", async () => {
  for (const destino of [{ ...DESTINO_PRUEBAS }, { ...DESTINO_REAL }, "evaristo_cms_test", "mysql://x:y@127.0.0.1:3308/evaristo_cms_test", undefined, null, { host: "127.0.0.1", puerto: 3306, base: "otra" }]) {
    const p = dependenciasDePrueba({ destino });
    assert.equal(await correrFlujoEscribir(ARGS_FLUJO, ENV_FLUJO, p.deps), 2, JSON.stringify(destino));
    assert.match(p.error.join("\n"), /solo se admite DESTINO_PRUEBAS/);
    assert.deepEqual(p.llamadas, SIN_LLAMADAS);
  }
});

await ta("T24: un objeto armado a mano o copiado de las dependencias reales no pasa por real", async () => {
  // copiar las dependencias reales (spread) y cambiarles el destino o el interruptor NO las vuelve reales
  const copia = { ...dependenciasReales(), destino: DESTINO_REAL, interruptor: true };
  const llamadas = { n: 0 }, salida: string[] = [];
  const falsa = { ...copia, abrirLectura: async () => { llamadas.n++; throw new Error("no"); }, abrirEscritura: async () => { llamadas.n++; throw new Error("no"); }, salida: { log: () => {}, error: (x: string) => { salida.push(x); } } };
  assert.equal(await correrFlujoEscribir(ARGS_FLUJO, ENV_FLUJO, falsa), 2);
  assert.match(salida.join("\n"), /solo se admite DESTINO_PRUEBAS/);
  assert.equal(llamadas.n, 0);
  // y las dependencias reales no se pueden modificar
  assert.throws(() => { (dependenciasReales() as { destino: unknown }).destino = DESTINO_PRUEBAS; }, TypeError);
});

await ta("T24: con DESTINO_PRUEBAS el flujo respeta el interruptor, las credenciales, los argumentos y la carpeta, todo antes de conectar", async () => {
  const p = dependenciasDePrueba({ interruptor: false });
  assert.equal(await correrFlujoEscribir(ARGS_FLUJO, ENV_FLUJO, p.deps), 2);
  assert.match(p.error.join("\n"), /deshabilitada.*No se abrió ninguna conexión y no se escribió nada/);
  assert.deepEqual(p.llamadas, SIN_LLAMADAS);
  // con el interruptor en true y sin credenciales: las credenciales, antes de conectar
  const q = dependenciasDePrueba({});
  assert.equal(await correrFlujoEscribir(ARGS_FLUJO, {}, q.deps), 2);
  assert.match(q.error.join("\n"), /Falta DATABASE_URL_MIGRACION/);
  assert.deepEqual(q.llamadas, SIN_LLAMADAS);
  // con argumentos mal escritos, los argumentos
  const r = dependenciasDePrueba({});
  assert.equal(await correrFlujoEscribir(["--muestra"], ENV_FLUJO, r.deps), 2);
  assert.match(r.error.join("\n"), /^Error en los argumentos/);
  assert.deepEqual(r.llamadas, SIN_LLAMADAS);
  // la carpeta de originales ilegible se detecta antes de conectar
  const s = dependenciasDePrueba({});
  assert.equal(await correrFlujoEscribir(ARGS_FLUJO, ENV_FLUJO, s.deps), 2);
  assert.match(s.error.join("\n"), /no se puede leer la carpeta/);
  assert.deepEqual(s.llamadas, SIN_LLAMADAS);
});

await ta("T24: sin DATABASE_URL_MIGRACION el flujo se niega aunque haya DATABASE_URL: no hay respaldo, no abre conexión y no dice su valor", async () => {
  const LECTURA = "clave-de-lectura";
  const env = { DATABASE_URL: `mysql://lector:${LECTURA}@127.0.0.1:3308/evaristo_cms` };
  for (const entorno of [env, { ...env, DATABASE_URL_MIGRACION: "" }]) {
    const p = dependenciasDePrueba({ destino: DESTINO_PRUEBAS, interruptor: true });
    const codigo = await correrFlujoEscribir(ARGS_FLUJO, entorno, p.deps);
    assert.notEqual(codigo, 0);
    assert.equal(codigo, 2);
    assert.match(p.error.join("\n"), /Falta DATABASE_URL_MIGRACION.*No se abrió ninguna conexión y no se escribió nada/);
    assert.deepEqual(p.llamadas, SIN_LLAMADAS, "ninguna conexión, de lectura ni de escritura");
    const todo = p.error.concat(p.log).join("\n");
    assert.ok(!todo.includes(LECTURA) && !todo.includes("lector") && !todo.includes("mysql://"), "no dice el valor de DATABASE_URL");
  }
});

await ta("T25: el tipeo del nombre de la base: lo tipeado se recorta y la pregunta nombra el destino, sin conectar", async () => {
  const llamadas: string[] = [];
  const nombre = await pedirNombreDeBase(DESTINO_REAL, async (pregunta) => { llamadas.push(pregunta); return "  evaristo_cms \n"; });
  assert.equal(nombre, "evaristo_cms");
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0]!, /127\.0\.0\.1:3308.*tipeá el nombre de la base \(evaristo_cms\)/);
});

await ta("T25: para el destino real, sin terminal interactiva se niega; con nombre equivocado se niega; con el correcto no queda ningún motivo de tipeo", async () => {
  const entrada = { destino: DESTINO_REAL, articulosEnElPlan: 1, esperarArticulos: 1, sobrescribir: false, esperarSobrescribir: null };
  const deTerminal = (c: ReturnType<typeof confirmarAntesDeConectar>) => (c.ok ? [] : c.motivos).filter((x) => /terminal|tipear/.test(x));
  // sin terminal interactiva: se niega, aunque se haya "tipeado" el nombre correcto
  const sinTerminal = confirmarAntesDeConectar({ ...entrada, terminalInteractiva: false, baseTipeada: "evaristo_cms" });
  assert.equal(sinTerminal.ok, false);
  assert.equal(deTerminal(sinTerminal).length, 1);
  assert.match(deTerminal(sinTerminal)[0]!, /exige una terminal interactiva/);
  // con terminal y el nombre equivocado (inyectando la lectura de línea): se niega por el tipeo
  for (const tipeado of ["evaristo_cms_test", "Evaristo_cms", "", "si", "evaristo_cms_shadow"]) {
    const baseTipeada = await pedirNombreDeBase(DESTINO_REAL, async () => tipeado);
    const c = confirmarAntesDeConectar({ ...entrada, terminalInteractiva: true, baseTipeada });
    assert.equal(c.ok, false, tipeado);
    assert.match(deTerminal(c).join(), /tipear el nombre de la base \(evaristo_cms\)/, tipeado);
  }
  // sin haber tipeado nada (null) tampoco pasa
  assert.match(deTerminal(confirmarAntesDeConectar({ ...entrada, terminalInteractiva: true, baseTipeada: null })).join(), /tipear el nombre/);
  // con el nombre correcto: no queda ningún motivo de terminal ni de tipeo (con el interruptor en false sigue solo el motivo del interruptor)
  const baseTipeada = await pedirNombreDeBase(DESTINO_REAL, async () => " evaristo_cms ");
  const bien = confirmarAntesDeConectar({ ...entrada, terminalInteractiva: true, baseTipeada });
  assert.deepEqual(deTerminal(bien), []);
  assert.deepEqual((bien.ok ? [] : bien.motivos).filter((x) => !/deshabilitada/.test(x)), [], "el único motivo que queda es el interruptor");
  // el destino de pruebas no pide ni terminal ni tipeo
  assert.deepEqual(confirmarAntesDeConectar({ ...entrada, destino: DESTINO_PRUEBAS, terminalInteractiva: false, baseTipeada: null }), { ok: true });
});

await ta("T25: en el flujo, la lectura de línea inyectada no se usa si algún chequeo previo falla", async () => {
  const p = dependenciasDePrueba({ terminalInteractiva: true }, ["evaristo_cms_test"]);
  assert.equal(await correrFlujoEscribir(ARGS_FLUJO, ENV_FLUJO, p.deps), 2);
  assert.deepEqual(p.llamadas, SIN_LLAMADAS);
  assert.deepEqual(p.preguntas, []);
});

console.log(`${ok} pruebas del comando de escritura ok`);
