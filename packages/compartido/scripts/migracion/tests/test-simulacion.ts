// T16: la simulación no escribe. Corre simular() de punta a punta con un cliente simulado que registra TODO el SQL (pasa por el consultar()
// real, que solo admite SELECT) y comprueba que no hay nada que no sea SELECT; además recorre el grafo de imports de migrar.ts y
// comprueba que no alcanza ningún cliente Prisma con permiso de escritura.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DESTINO_REAL } from "../lib/conexiones.ts";
import type { OpcionesCli } from "../lib/conexiones.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
import { informeAMarkdown, nombreDeInforme } from "../lib/informe.ts";
import type { Medicion } from "../lib/imagenes.ts";
import { COLACION, SOLO_LECTURA, consultar, validarSoloSelect } from "../lib/leer-wordpress.ts";
import type { Consulta, Fila } from "../lib/leer-wordpress.ts";
import { simular } from "../lib/simular.ts";
import { grafo } from "./grafo-imports.ts";
import { leerLargosSchema } from "../lib/validar.ts";

let ok = 0;
const ta = async (name: string, fn: () => Promise<void>) => { await fn(); ok++; console.log("ok", name); };

const entrada = entradaDesdeSnapshot();
const clave = (s: string) => s.normalize("NFC").toLowerCase().replace(/ñ/g, "\u0001").normalize("NFD").replace(/\p{M}/gu, "");

/** Cliente simulado (con la forma que usa consultar()): anota cada SQL y responde lo mínimo. Nunca toca una base. */
function clienteSimulado(existentes: Record<string, string[]> = {}) {
  const sql: string[] = [];
  const cliente = {
    $queryRawUnsafe: async (texto: string, ...p: unknown[]): Promise<Fila[]> => {
      sql.push(texto);
      if (/DENSE_RANK/.test(texto)) {
        const claves = new Map<string, number>();
        return Array.from({ length: p.length / 2 }, (_, k) => { const c = clave(String(p[2 * k + 1])); if (!claves.has(c)) claves.set(c, claves.size + 1); return { i: p[2 * k] as number, g: claves.get(c)! }; });
      }
      if (/information_schema\.COLUMNS/.test(texto)) return [["articulos", "slug"], ["redirecciones", "origen"], ["imagenes", "clave"]].map(([tabla, columna]) => ({ tabla, columna, colacion: COLACION }));
      if (/FROM articulos WHERE slug|FROM autores WHERE/.test(texto)) return [];
      const m = texto.match(/SELECT (\w+) AS clave FROM (\w+) WHERE/);
      if (m) return (existentes[m[2]!] ?? []).filter((v) => p.map(String).includes(v)).map((v) => ({ clave: v }));
      if (/FROM `wp_users`/.test(texto)) return entrada.cuentas.map((c) => ({ id: c.wpUserId, login: c.user_login, nombre: c.nombre }));
      throw new Error(`consulta inesperada en la simulación: ${texto.slice(0, 80)}`);
    },
  };
  const consulta: Consulta = (texto, ...p) => consultar(cliente as never, texto, ...p);
  return { consulta, sql };
}

const medirFalso = (_carpeta: string, claves: Iterable<string>) => new Map<string, Medicion>([...claves].map((c) => [c.normalize("NFC"),
  ["escanear0006.jpg", "mankell.jpg"].includes(c)
    ? { estado: "original faltante", archivo: null, diferenciaDeNombre: null, bytes: null, sha256: null, mime: null, ancho: null, alto: null }
    : { estado: "medida", archivo: c, diferenciaDeNombre: null, bytes: 1000, sha256: "e".repeat(64), mime: "image/jpeg", ancho: 800, alto: 600 }] as const));

const opciones: OpcionesCli = { alcance: { tipo: "muestra" }, modo: "simular", esperarArticulos: null, esperarSobrescribir: null, abortarAlPrimerError: false, sobrescribir: false, originales: "carpeta-que-no-se-abre" };
const servidorCms = { puerto: 3308, base: "evaristo_cms", readOnly: 0, version: "8.4.3" };
const servidorWordPress = { puerto: 3307, base: "evaristo_lectura", readOnly: 0, version: "10.11.2-MariaDB" };

await ta("T16: la simulación de los 35 solo emite SELECT y devuelve el informe esperado", async () => {
  const bd = clienteSimulado({ categorias: ["ensayo"] }), wp = clienteSimulado();
  const { informe } = await simular(opciones, { wp: wp.consulta, bd: bd.consulta, destino: { ...DESTINO_REAL }, servidorCms, servidorWordPress }, {
    leerEntrada: async () => entradaDesdeSnapshot(), largos: leerLargosSchema(), medir: medirFalso, ahora: () => new Date("2026-10-17T14:03:22.123Z"),
  });
  const todo = [...bd.sql, ...wp.sql];
  assert.ok(todo.length > 10, "hubo consultas");
  assert.ok(todo.every((s) => /^\s*SELECT\b/i.test(s)), `solo SELECT: ${todo.filter((s) => !/^\s*SELECT\b/i.test(s)).join(" | ")}`);
  assert.ok(todo.every((s) => { try { validarSoloSelect(s); return true; } catch { return false; } }));
  // el informe
  assert.deepEqual(informe.resumen.estados, { PUBLICADO: 34, BORRADOR: 1 });
  assert.equal(informe.resumen.convertidos, 35);
  assert.equal(informe.resumen.invalidos, 0);
  assert.equal(informe.resumen.excluidos, 0);
  assert.equal(informe.redirecciones.total, 58);
  assert.equal(informe.categoriasACrear.length, 8);
  assert.equal(informe.imagenes.referenciadas, 202);
  assert.equal(informe.imagenes.conFila, 200);
  assert.equal(informe.imagenes.bytesTotales, 200 * 1000);
  assert.deepEqual(informe.imagenes.originalesFaltantes.map((x) => x.adjuntoWpId), [2464, 22547]);
  assert.deepEqual(informe.imagenes.sinMedir, []);
  assert.equal(informe.avisosPorCodigo["migracion:fecha_borrador"]!.articulos, 1);
  assert.equal(informe.avisosPorCodigo["migracion:original_faltante"]!.articulos, 2);
  assert.deepEqual(informe.biosConCorreo, [{ wpUserId: 39, nombre: "Osvaldo Gallone", articulos: 1 }]);
  assert.deepEqual(informe.bloqueantes, []);
  const tabla = (n: string) => informe.tablas.find((t) => t.tabla === n)!;
  assert.equal(tabla("articulos").insertar, 35);
  assert.equal(tabla("categorias").enElPlan, 8);
  assert.deepEqual([tabla("categorias").insertar, tabla("categorias").yaExisteSinComparar], [7, 1], "ensayo ya existe en el CMS simulado");
  assert.equal(tabla("imagenes").insertar, 200);
  assert.equal(tabla("redirecciones").insertar, 58);
  assert.ok(informe.tablas.every((t) => t.actualizar === 0 && t.omitir === 0));
  assert.equal(nombreDeInforme(informe.generadoEn), "2026-10-17T140322Z-simular");
  assert.match(informeAMarkdown(informe), /Bios con correo \(el correo no se copia\)/);
  assert.ok(!/@/.test(JSON.stringify(informe)), "el informe no contiene ningún correo");
});

await ta("T16: lo que ya existe por clave natural se informa como \"ya existe (sin comparar)\" y no se actualiza", async () => {
  const bd = clienteSimulado({ articulos: ["22546", "2462"], categorias: ["poesia", "ensayo"], redirecciones: [] });
  const { informe } = await simular(opciones, { wp: clienteSimulado().consulta, bd: bd.consulta, destino: { ...DESTINO_REAL }, servidorCms, servidorWordPress }, {
    leerEntrada: async () => entradaDesdeSnapshot(), largos: leerLargosSchema(), medir: medirFalso,
  });
  const art = informe.tablas.find((t) => t.tabla === "articulos")!;
  assert.deepEqual([art.enElPlan, art.insertar, art.actualizar, art.omitir, art.yaExisteSinComparar], [35, 33, 0, 0, 2]);
  assert.deepEqual(art.existentes.sort(), ["22546", "2462"]);
  const cat = informe.tablas.find((t) => t.tabla === "categorias")!;
  assert.deepEqual([cat.enElPlan, cat.insertar, cat.yaExisteSinComparar], [8, 6, 2]);
  assert.ok(bd.sql.every((s) => /^\s*SELECT\b/i.test(s)));
});

await ta("T16: --ids limita la simulación; un bloqueante queda en el informe sin escribir nada", async () => {
  const bd = clienteSimulado();
  const una = await simular({ ...opciones, alcance: { tipo: "ids", ids: [22546] } }, { wp: clienteSimulado().consulta, bd: bd.consulta, destino: { ...DESTINO_REAL }, servidorCms, servidorWordPress }, {
    leerEntrada: async () => entradaDesdeSnapshot(), largos: leerLargosSchema(), medir: medirFalso,
  });
  assert.deepEqual(una.informe.ids, [22546]);
  assert.equal(una.informe.resumen.convertidos, 1);
  assert.equal(una.informe.articulos[0]!.slug, "borrador-22546");
  // destino equivocado en el servidor: bloqueante
  const mal = await simular(opciones, { wp: clienteSimulado().consulta, bd: clienteSimulado().consulta, destino: { ...DESTINO_REAL }, servidorCms: { ...servidorCms, puerto: 3307 }, servidorWordPress }, {
    leerEntrada: async () => entradaDesdeSnapshot(), largos: leerLargosSchema(), medir: medirFalso,
  });
  assert.deepEqual(mal.informe.bloqueantes.map((b) => b.codigo), ["destino_no_permitido"]);
  await assert.rejects(() => simular({ ...opciones, originales: null }, { wp: bd.consulta, bd: bd.consulta, destino: { ...DESTINO_REAL }, servidorCms, servidorWordPress }), /--originales/);
  await assert.rejects(() => simular({ ...opciones, modo: "escribir" }, { wp: bd.consulta, bd: bd.consulta, destino: { ...DESTINO_REAL }, servidorCms, servidorWordPress }), /solo corre en modo simular/);
  await assert.rejects(() => simular({ ...opciones, alcance: { tipo: "todos" } }, { wp: bd.consulta, bd: bd.consulta, destino: { ...DESTINO_REAL }, servidorCms, servidorWordPress }), /no implementado/);
});

// ---------------------------------------------------------------------------------------------------------------
// Las sesiones se abren en READ ONLY y el grafo de imports de migrar.ts no llega a ningún cliente de escritura
// ---------------------------------------------------------------------------------------------------------------
const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));   // packages/compartido
const MIGRAR = join(RAIZ, "scripts", "migracion", "migrar.ts");

await ta("T16: las dos conexiones abren la sesión en READ ONLY y la verifican", async () => {
  assert.equal(SOLO_LECTURA, "SET SESSION TRANSACTION READ ONLY");
  const texto = readFileSync(join(RAIZ, "scripts", "migracion", "lib", "leer-wordpress.ts"), "utf8");
  assert.equal((texto.match(/initSql: SOLO_LECTURA/g) ?? []).length, 2, "los dos clientes (WordPress y CMS) abren con initSql READ ONLY");
  assert.match(texto, /transaction_read_only[\s\S]*Las sesiones no están en solo lectura/);
});

await ta("T16: el grafo de imports de migrar.ts no alcanza ningún cliente Prisma de escritura", async () => {
  const { archivos, externos, generados } = grafo(MIGRAR);
  const rel = [...archivos].map((a) => relative(RAIZ, a).replace(/\\/g, "/")).sort();
  for (const esperado of ["scripts/migracion/migrar.ts", "scripts/migracion/lib/simular.ts", "scripts/migracion/lib/ejecutor.ts", "scripts/migracion/lib/leer-wordpress.ts", "scripts/migracion/lib/validar.ts", "src/conversor/convert.ts"]) {
    assert.ok(rel.includes(esperado), `el recorrido llegó a ${esperado}`);
  }
  // nada que escriba: ni el cliente de la app (src/db.ts, src/index.ts) ni un ejecutor de escritura ni la corrida en seco
  for (const prohibido of ["src/db.ts", "src/index.ts", "src/db-probar.ts"]) assert.ok(!rel.includes(prohibido), `no alcanza ${prohibido}`);
  assert.deepEqual(rel.filter((a) => /escribir|ejecutor-prisma|prisma-ejecutor|corrida-en-seco|generar-snapshot|\/db-/.test(a)), []);
  // el único módulo que toca el cliente generado de Prisma o su adaptador es leer-wordpress.ts, que abre las sesiones en READ ONLY
  const importan = (patron: RegExp) => [...archivos].filter((a) => patron.test(readFileSync(a, "utf8"))).map((a) => relative(RAIZ, a).replace(/\\/g, "/"));
  assert.deepEqual(importan(/generated\/prisma\/client/), ["scripts/migracion/lib/leer-wordpress.ts"]);
  assert.deepEqual(importan(/@prisma\/adapter-mariadb/), ["scripts/migracion/lib/leer-wordpress.ts"]);
  assert.deepEqual(importan(/@prisma\/client/), []);
  assert.equal(generados.size, 1);
  assert.deepEqual([...externos].filter((e) => e.startsWith("@prisma")).sort(), ["@prisma/adapter-mariadb"]);
  // y ningún archivo alcanzado usa la API de escritura de Prisma ni escribe SQL de escritura
  const ESCRITURA = /\$execute|\$transaction|\b(?:createMany|updateMany|deleteMany|upsert)\(|\b(?:INSERT\s+INTO|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE|ALTER\s+TABLE)\b/;
  const culpables = [...archivos].filter((a) => ESCRITURA.test(readFileSync(a, "utf8"))).map((a) => relative(RAIZ, a).replace(/\\/g, "/"));
  assert.deepEqual(culpables, []);
  // los únicos módulos que escriben en disco lo hacen en la carpeta de informes (informe.ts) o leen (imagenes.ts, entradas)
  assert.deepEqual(importan(/\bwriteFileSync|\bappendFileSync|\brmSync|\bunlinkSync|\brenameSync|\bcopyFileSync/), ["scripts/migracion/lib/informe.ts"]);
});

console.log(`${ok} pruebas de simulación ok`);
