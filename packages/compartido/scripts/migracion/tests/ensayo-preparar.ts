// ENSAYO GENERAL (Etapa 2 de la fase 7; decidido con Mariano el 7/11/2026: el ensayo va en la base de pruebas, sin agregar destinos al comando).
// Paso A: deja en evaristo_cms_test una copia de la real con el esquema de hoy, lista para correr la migración completa con `ensayo:migrar`.
// Son los pasos 1 a 3 de la decisión 87, sobre la copia:
//   1. respaldo de evaristo_cms con mysqldump --result-file (solo lee la real: --single-transaction);
//   2. vacía evaristo_cms_test (borra todas sus tablas) y carga ahí ese respaldo;
//   3. aplica las migraciones pendientes (prisma migrate deploy) y siembra las secciones (db:sembrar), las dos contra evaristo_cms_test.
//
// Seguridad: la base que se vacía es la constante DESTINO_PRUEBAS (no hay opción para elegir otra) y antes de borrar se le pregunta al servidor qué
// base y qué puerto son. Las credenciales son el usuario y la clave de DATABASE_URL (el usuario evaristo); el host, el puerto y las bases salen de las
// constantes. La clave va en un archivo de opciones temporal que se borra al terminar: nunca en la línea de comandos ni en la salida.
// Ojo: test:migracion-db y test:migracion-flujo vacían evaristo_cms_test. No correrlas hasta terminar el ensayo.
//
// Uso (con la 3308 levantada): npm run ensayo:preparar -w @evaristo/compartido
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { credencialesDeUrl } from "../lib/credenciales.ts";
import { DESTINO_PRUEBAS, DESTINO_REAL } from "../lib/destinos.ts";

config({ path: fileURLToPath(new URL("../../../../../.env", import.meta.url)), quiet: true });

const BIN = process.env["MYSQL_BIN"] ?? "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin";
const RESPALDOS = fileURLToPath(new URL("../../../../../../CMS-EVARISTO(ASSETS)/respaldos/", import.meta.url));
const PAQUETE = fileURLToPath(new URL("../../../", import.meta.url));
const { user, password } = credencialesDeUrl(process.env["DATABASE_URL"], "DATABASE_URL");

const fallar = (m: string): never => {
  console.error(`FALLÓ: ${m}`);
  process.exit(1);
};
for (const exe of ["mysqldump.exe", "mysql.exe"]) if (!existsSync(join(BIN, exe))) fallar(`no está ${join(BIN, exe)} (se puede indicar otra carpeta con MYSQL_BIN)`);

const tmp = mkdtempSync(join(tmpdir(), "evaristo-ensayo-"));
const opciones = join(tmp, "cliente.cnf");
writeFileSync(opciones, `[client]\nuser=${user}\npassword=${password}\nhost=${DESTINO_PRUEBAS.host}\nport=${DESTINO_PRUEBAS.puerto}\n`, { encoding: "utf8", mode: 0o600 });
const conOpciones = (...args: string[]) => [`--defaults-extra-file=${opciones}`, "--default-character-set=utf8mb4", ...args];
const sinClave = (t: string) => t.split(password).join("[clave]");

/** Corre mysql.exe contra una base con el SQL por la entrada estándar; devuelve la salida (tabulada). */
function mysql(base: string, sql: string): string {
  const r = spawnSync(join(BIN, "mysql.exe"), conOpciones(`--database=${base}`, "--batch", "--skip-column-names"), { input: sql, encoding: "utf8" });
  if (r.status !== 0) fallar(`mysql (${base}): ${sinClave(r.stderr || String(r.error))}`);
  return r.stdout;
}

/** Carga un archivo SQL en una base, por la entrada estándar (sin shell ni rutas en la línea de comandos). */
function cargar(base: string, archivo: string): Promise<void> {
  return new Promise((listo, mal) => {
    const p = spawn(join(BIN, "mysql.exe"), conOpciones(`--database=${base}`), { stdio: ["pipe", "inherit", "pipe"] });
    let errores = "";
    p.stderr.on("data", (d: Buffer) => (errores += d.toString()));
    p.on("error", mal);
    p.on("close", (codigo) => (codigo === 0 ? listo() : mal(new Error(`mysql salió con ${codigo}: ${sinClave(errores)}`))));
    createReadStream(archivo).pipe(p.stdin);
  });
}

/** Un programa de Node del paquete (la CLI de prisma, db-sembrar con tsx) con DATABASE_URL apuntando a la base de pruebas. Sin shell. */
const requerir = createRequire(import.meta.url);
function nodeContraPruebas(...args: string[]): void {
  const url = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${DESTINO_PRUEBAS.host}:${DESTINO_PRUEBAS.puerto}/${DESTINO_PRUEBAS.base}`;
  const r = spawnSync(process.execPath, args, { cwd: PAQUETE, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  const salida = sinClave(`${r.stdout ?? ""}${r.stderr ?? ""}`).split(url).join("[url]");
  if (r.status !== 0) fallar(`${args.slice(1).join(" ")}:\n${salida}`);
  console.log(salida.split("\n").filter((l) => /migrat|Secciones|applied|aplic|No pending/i.test(l)).map((l) => `   ${l.trim()}`).join("\n"));
}

const t0 = Date.now();
try {
  // 0. Las dos bases son las que tienen que ser.
  const real = mysql(DESTINO_REAL.base, "SELECT DATABASE(), @@port, (SELECT COUNT(*) FROM articulos);").trim().split("\t");
  if (real[0] !== DESTINO_REAL.base || Number(real[1]) !== DESTINO_REAL.puerto) fallar(`la real no es la esperada: ${real.join(" ")}`);
  const pruebas = mysql(DESTINO_PRUEBAS.base, "SELECT DATABASE(), @@port;").trim().split("\t");
  if (pruebas[0] !== DESTINO_PRUEBAS.base || Number(pruebas[1]) !== DESTINO_PRUEBAS.puerto) fallar(`la de pruebas no es la esperada: ${pruebas.join(" ")}`);
  console.log(`Real: ${DESTINO_REAL.base} (${real[2]} artículos). Copia: ${DESTINO_PRUEBAS.base}.`);

  // 1. Respaldo de la real (solo lectura). Nunca pisa uno anterior.
  mkdirSync(RESPALDOS, { recursive: true });
  const fecha = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const respaldo = join(RESPALDOS, `evaristo_cms-ensayo-${fecha}Z.sql`);
  if (existsSync(respaldo)) fallar(`ya existe ${respaldo}`);
  const dump = spawnSync(join(BIN, "mysqldump.exe"), conOpciones("--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF", "--triggers", `--result-file=${respaldo}`, DESTINO_REAL.base), { encoding: "utf8" });
  if (dump.status !== 0) fallar(`mysqldump: ${sinClave(dump.stderr || String(dump.error))}`);
  console.log(`1. Respaldo de la real: ${respaldo} (${(statSync(respaldo).size / 1024).toFixed(0)} KB)`);

  // 2. Vaciar la base de pruebas (todas sus tablas, en la misma sesión, sin claves foráneas) y cargar la copia.
  const tablas = mysql(DESTINO_PRUEBAS.base, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE';").trim().split("\n").filter(Boolean).map((l) => l.split("\t")[0]!);
  if (tablas.some((t) => !/^\w+$/.test(t))) fallar(`nombre de tabla inesperado en la base de pruebas: ${tablas.join(", ")}`);
  if (tablas.length) mysql(DESTINO_PRUEBAS.base, `SET FOREIGN_KEY_CHECKS = 0;\n${tablas.map((t) => `DROP TABLE \`${t}\`;`).join("\n")}\nSET FOREIGN_KEY_CHECKS = 1;`);
  await cargar(DESTINO_PRUEBAS.base, respaldo);
  const migraciones = mysql(DESTINO_PRUEBAS.base, "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;").trim();
  console.log(`2. ${DESTINO_PRUEBAS.base}: ${tablas.length} tablas borradas y la copia cargada (${migraciones} migraciones aplicadas, como la real).`);

  // 3. Las migraciones que faltan y las secciones del modelo nuevo.
  console.log("3. prisma migrate deploy y db:sembrar contra la copia:");
  nodeContraPruebas(requerir.resolve("prisma/build/index.js"), "migrate", "deploy");
  nodeContraPruebas(requerir.resolve("tsx/cli"), "scripts/db-sembrar.ts");

  const c = mysql(DESTINO_PRUEBAS.base, "SELECT (SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL), (SELECT COUNT(*) FROM articulos), (SELECT COUNT(*) FROM secciones), (SELECT COUNT(*) FROM categorias), (SELECT COUNT(*) FROM imagenes), (SELECT COUNT(*) FROM redirecciones);").trim().split("\t");
  console.log(`\nOK en ${((Date.now() - t0) / 1000).toFixed(0)} s: la copia tiene ${c[0]} migraciones, ${c[1]} artículos, ${c[2]} secciones (las viejas y las nuevas), ${c[3]} categorías, ${c[4]} imágenes y ${c[5]} redirecciones.`);
  console.log("Siguiente: npm run ensayo:migrar -w @evaristo/compartido -- <los mismos argumentos que migrar:escribir>. No correr test:migracion-db ni test:migracion-flujo hasta terminar (vacían esta base).");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
