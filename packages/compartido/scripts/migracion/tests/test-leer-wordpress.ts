// Pruebas puras de consultar() / validarSoloSelect() de scripts/migracion/lib/leer-wordpress.ts.
// No hay conexión: el "cliente" es un doble que anota las consultas y nunca toca una base.
import assert from "node:assert/strict";
import { consultar, validarSoloSelect } from "../lib/leer-wordpress.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };
const ta = async (name: string, fn: () => Promise<void>) => { await fn(); ok++; console.log("ok", name); };

const rechazadas = [
  "INSERT INTO articulos (slug) VALUES ('x')",
  "UPDATE articulos SET slug = 'x'",
  "DELETE FROM articulos",
  "DROP TABLE articulos",
  "ALTER TABLE articulos ADD COLUMN x INT",
  "CREATE TABLE x (id INT)",
  "TRUNCATE TABLE articulos",
  "REPLACE INTO articulos (slug) VALUES ('x')",
  "CALL algo()",
  "SET SESSION TRANSACTION READ WRITE",
  "insert into articulos values (1)",
  "dElEtE FROM articulos",
  "   \n\t DROP TABLE articulos",
  "/* comentario */ DELETE FROM articulos",
  "-- comentario\nDROP TABLE articulos",
  "# comentario\nDROP TABLE articulos",
  "/* comentario */ SELECT 1",
  "SELECT 1; DROP TABLE articulos",
  "SELECT 1;DELETE FROM articulos",
  "select 1 ;  select 2",
  "SELECT 1;",
  "SELECT 1 /* ; */",
  "",
  "   ",
  "SELECTED 1",
  "(SELECT 1)",
  "SELECT * FROM articulos INTO OUTFILE '/tmp/x'",
  "select * from articulos into   dumpfile '/tmp/x'",
  "SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */",
  "SELECT * FROM articulos FOR UPDATE",
  "SELECT * FROM articulos LOCK IN SHARE MODE",
];
const aceptadas = [
  "SELECT 1",
  "select 1",
  "  \n SELECT\n slug FROM articulos WHERE wpId = ?",
  "SELECT COUNT(*) AS n FROM articulos",
  "SELECT 0 AS i, (? = ? COLLATE utf8mb4_es_0900_ai_ci) AS eq UNION ALL SELECT 1 AS i, (? = ? COLLATE utf8mb4_es_0900_ai_ci) AS eq",
  "SELECT meta_id FROM `wp_postmeta` WHERE meta_key LIKE '\\_webdados\\_fb\\_open\\_graph\\_%'",
];

t("validarSoloSelect rechaza todo lo que no es un único SELECT", () => {
  for (const sql of rechazadas) assert.throws(() => validarSoloSelect(sql), /Solo se permite un SELECT/, JSON.stringify(sql));
});
t("validarSoloSelect acepta SELECT simples (mayúsculas, minúsculas, espacios, saltos de línea)", () => {
  for (const sql of aceptadas) assert.doesNotThrow(() => validarSoloSelect(sql), JSON.stringify(sql));
});

await ta("consultar rechaza sin llegar a tocar el cliente", async () => {
  const llamadas: string[] = [];
  const doble = { $queryRawUnsafe: async (sql: string) => { llamadas.push(sql); return []; } } as never;
  for (const sql of rechazadas) await assert.rejects(() => consultar(doble, sql), /Solo se permite un SELECT/, JSON.stringify(sql));
  assert.deepEqual(llamadas, []);
});
await ta("consultar pasa el SELECT y sus parámetros al cliente", async () => {
  const llamadas: Array<{ sql: string; params: unknown[] }> = [];
  const doble = { $queryRawUnsafe: async (sql: string, ...params: unknown[]) => { llamadas.push({ sql, params }); return [{ n: 1 }]; } } as never;
  const filas = await consultar(doble, "SELECT COUNT(*) AS n FROM articulos WHERE wpId = ?", 7);
  assert.deepEqual(filas, [{ n: 1 }]);
  assert.deepEqual(llamadas, [{ sql: "SELECT COUNT(*) AS n FROM articulos WHERE wpId = ?", params: [7] }]);
});

console.log(`${ok} pruebas de consultar ok`);
