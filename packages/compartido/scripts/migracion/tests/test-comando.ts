// Pruebas puras del comando de escritura (migrar-escribir.ts): sus decisiones previas (T23), las credenciales de DATABASE_URL_MIGRACION y el
// aislamiento del comando (T22). Sin base y sin conexiones: el proceso hijo sale antes de abrir ninguna.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluarComando } from "../lib/comando-escribir.ts";
import { credencialesDeUrl, ErrorDeCredenciales } from "../lib/credenciales.ts";
import { cargarDatosVersionados } from "../lib/entrada-snapshot.ts";
import { grafo } from "./grafo-imports.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };

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
  for (const prohibido of ["scripts/migracion/migrar-escribir.ts", "scripts/migracion/lib/comando-escribir.ts", "scripts/migracion/lib/correr-escritura.ts", "scripts/migracion/lib/escribir.ts", "scripts/migracion/lib/informe-escritura.ts"]) {
    assert.ok(!alcanzados.includes(prohibido), `migrar.ts no debe alcanzar ${prohibido}`);
  }
  assert.deepEqual(alcanzados.filter((a) => /escribir|tests\//.test(a)), []);
});

t("T22: solo el comando de escritura (y sus módulos propios) alcanza escribir.ts y correr-escritura.ts; ningún otro programa", () => {
  // grafo calculado por el propio test sobre todos los .ts de scripts/migracion fuera de tests/
  const modulos = ts(MIGRACION).filter((a) => !rel(a).startsWith("scripts/migracion/tests/"));
  const alcanzan = (objetivo: string) => modulos.filter((m) => grafo(m).archivos.has(join(MIGRACION, objetivo))).map(rel).sort();
  assert.deepEqual(alcanzan("lib/correr-escritura.ts"), ["scripts/migracion/lib/correr-escritura.ts", "scripts/migracion/migrar-escribir.ts"]);
  assert.deepEqual(alcanzan("lib/escribir.ts"), [
    "scripts/migracion/lib/correr-escritura.ts", "scripts/migracion/lib/escribir.ts", "scripts/migracion/lib/informe-escritura.ts", "scripts/migracion/migrar-escribir.ts",
  ]);
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
  // el script npm lo corre directamente
  const paquete = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(paquete.scripts["migrar:escribir"], "tsx scripts/migracion/migrar-escribir.ts");
  assert.equal(paquete.scripts["migrar"], "tsx scripts/migracion/migrar.ts");
});

t("T22: el comando no tiene otra vía a un destino ni a las credenciales: solo DESTINO_REAL, solo DATABASE_URL_MIGRACION y nunca DATABASE_URL", () => {
  for (const archivo of [COMANDO, join(MIGRACION, "lib", "comando-escribir.ts")]) {
    const texto = readFileSync(archivo, "utf8");
    assert.ok(!/DATABASE_URL(?!_MIGRACION)/.test(texto), `${rel(archivo)}: no menciona DATABASE_URL`);
    assert.ok(!/DESTINO_PRUEBAS|abrirConexionLectura/.test(texto), `${rel(archivo)}: no conoce el destino de pruebas`);
    assert.ok(!/^\s*(?:export\s+)?(?:const|let|var)\s+ESCRITURA_REAL_HABILITADA\b|^\s*ESCRITURA_REAL_HABILITADA\s*=[^=]/m.test(texto), `${rel(archivo)}: no asigna el interruptor`);
    assert.ok(!/new PrismaClient\(/.test(texto), `${rel(archivo)}: no crea clientes`);
  }
  const comando = readFileSync(COMANDO, "utf8");
  assert.deepEqual(comando.match(/abrirConexionEscritura\([^)]*\)/g), ["abrirConexionEscritura(destino, credenciales)"], "la apertura pasa siempre las credenciales de migración");
  assert.equal((comando.match(/destino: DESTINO_REAL/g) ?? []).length, 1);
  assert.deepEqual(comando.match(/process\.env\b[^\n]*/g)?.map((x) => x.slice(0, 13)), ["process.env, "], "process.env solo entra a evaluarComando");
  // y comando-escribir.ts no lee el entorno por su cuenta
  assert.ok(!/process\.(env|argv)/.test(readFileSync(join(MIGRACION, "lib", "comando-escribir.ts"), "utf8")));
});

console.log(`${ok} pruebas del comando de escritura ok`);
