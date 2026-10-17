// Pruebas puras de scripts/migracion/lib/conexiones.ts: la guarda del destino (T13) y los argumentos del CLI (T14). Sin base.
import assert from "node:assert/strict";
import { cargarDatosVersionados } from "../lib/entrada-snapshot.ts";
import {
  DESTINO_REAL, ErrorDeArgumentos, guardaDestino, leerDestinoServidor, parsearArgumentos, verificarServidorCms, verificarServidorWordPress,
} from "../lib/conexiones.ts";
import type { OpcionesCli } from "../lib/conexiones.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };
const ta = async (name: string, fn: () => Promise<void>) => { await fn(); ok++; console.log("ok", name); };

const BUENA = "mysql://evaristo:secreto@127.0.0.1:3308/evaristo_cms";

t("T13: la guarda acepta solo 127.0.0.1:3308/evaristo_cms", () => {
  assert.deepEqual(guardaDestino(BUENA), { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" });
  assert.deepEqual(guardaDestino("mysql://u@127.0.0.1:3308/evaristo_cms"), { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" });
  assert.deepEqual(DESTINO_REAL, { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" });
});

t("T13: se niega ante localhost, ::1, el puerto 3306 o 3307, otra base, parámetros, sin base o sin puerto", () => {
  const malas: Array<[string | undefined, RegExp]> = [
    ["mysql://evaristo:x@localhost:3308/evaristo_cms", /host localhost/],
    ["mysql://evaristo:x@[::1]:3308/evaristo_cms", /host/],
    ["mysql://evaristo:x@127.0.0.2:3308/evaristo_cms", /host 127\.0\.0\.2/],
    ["mysql://evaristo:x@0.0.0.0:3308/evaristo_cms", /host/],
    ["mysql://evaristo:x@127.0.0.1:3306/evaristo_cms", /puerto 3306/],
    ["mysql://evaristo:x@127.0.0.1:3307/evaristo_cms", /puerto 3307/],
    ["mysql://evaristo:x@127.0.0.1/evaristo_cms", /puerto/],
    ["mysql://evaristo:x@127.0.0.1:3308/evaristo_cms_test", /base evaristo_cms_test/],
    ["mysql://evaristo:x@127.0.0.1:3308/evaristo_cms_shadow", /base evaristo_cms_shadow/],
    ["mysql://evaristo:x@127.0.0.1:3308/evaristo_lectura", /base evaristo_lectura/],
    ["mysql://evaristo:x@127.0.0.1:3308/Evaristo_CMS", /base/],
    ["mysql://evaristo:x@127.0.0.1:3308/evaristo_cms/", /base/],
    ["mysql://evaristo:x@127.0.0.1:3308/", /base \(ninguna\)/],
    ["mysql://evaristo:x@127.0.0.1:3308", /base/],
    ["mysql://evaristo:x@127.0.0.1:3308/evaristo_cms?connection_limit=5", /parámetros/],
    ["mysql://evaristo:x@127.0.0.1:3308/evaristo_cms#x", /parámetros/],
    ["mariadb://evaristo:x@127.0.0.1:3308/evaristo_cms", /protocolo/],
    ["http://127.0.0.1:3308/evaristo_cms", /protocolo/],
    ["no es una url", /no es una URL válida/],
    ["", /falta DATABASE_URL/],
    [undefined, /falta DATABASE_URL/],
  ];
  for (const [url, motivo] of malas) assert.throws(() => guardaDestino(url), (e: Error) => /Destino no permitido/.test(e.message) && motivo.test(e.message), String(url));
});

t("T13: ni flags ni variables de entorno cambian el destino permitido", () => {
  assert.ok(Object.isFrozen(DESTINO_REAL));
  const previas = { DATABASE_URL: process.env["DATABASE_URL"], DESTINO: process.env["DESTINO"], DB_PORT: process.env["DB_PORT"] };
  try {
    process.env["DESTINO"] = "127.0.0.1:3306/evaristo_cms_test";
    process.env["DB_PORT"] = "3306";
    process.env["DATABASE_URL"] = "mysql://evaristo:x@127.0.0.1:3306/evaristo_cms_test";
    assert.deepEqual(DESTINO_REAL, { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" });
    assert.throws(() => guardaDestino(process.env["DATABASE_URL"]), /Destino no permitido/);
    assert.throws(() => { (DESTINO_REAL as { puerto: number }).puerto = 3306; }, TypeError);
    assert.equal(DESTINO_REAL.puerto, 3308);
    // los argumentos del CLI no tienen ninguna opción de destino
    for (const flag of ["--puerto=3306", "--base=evaristo_cms_test", "--host=localhost", "--destino=otro", "--database-url=mysql://x"]) {
      assert.throws(() => parsearArgumentos(["--muestra", flag], [1]), /argumento desconocido/, flag);
    }
  } finally {
    for (const [k, v] of Object.entries(previas)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

await ta("T13: tras conectar se comprueba @@port, DATABASE(), @@read_only y la versión del servidor", async () => {
  const servidor = (f: Record<string, unknown>) => leerDestinoServidor(async (sql) => { assert.match(sql, /^SELECT @@port .*DATABASE\(\).*@@read_only.*@@version/); return [f]; });
  const bueno = await servidor({ puerto: 3308, base: "evaristo_cms", ro: 0, version: "8.4.3" });
  assert.deepEqual(bueno, { puerto: 3308, base: "evaristo_cms", readOnly: 0, version: "8.4.3" });
  assert.deepEqual(verificarServidorCms(bueno), bueno);
  assert.equal(verificarServidorCms({ ...bueno, version: "8.4" }).version, "8.4");
  for (const [mal, texto] of [
    [{ puerto: 3306 }, /@@port = 3306/], [{ base: "evaristo_cms_test" }, /DATABASE\(\) = evaristo_cms_test/], [{ base: "" }, /DATABASE\(\)/],
    [{ readOnly: 1 }, /@@read_only = 1/], [{ version: "8.0.36" }, /@@version = 8\.0\.36/], [{ version: "8.40.1" }, /@@version/], [{ version: "10.11.2-MariaDB" }, /@@version/],
  ] as const) assert.throws(() => verificarServidorCms({ ...bueno, ...mal }), (e: Error) => texto.test(e.message), JSON.stringify(mal));
  assert.throws(() => verificarServidorCms({ ...bueno, puerto: 3307, base: "x", readOnly: 1, version: "5.7" }), (e: Error) => /@@port/.test(e.message) && /@@read_only/.test(e.message) && /@@version/.test(e.message), "informa todo junto");
  assert.doesNotThrow(() => verificarServidorWordPress({ puerto: 3307, base: "evaristo_lectura", readOnly: 0, version: "10.11.2-MariaDB" }));
  assert.throws(() => verificarServidorWordPress({ puerto: 3308, base: "evaristo_lectura", readOnly: 0, version: "x" }), /WordPress no es el esperado/);
  assert.throws(() => verificarServidorWordPress({ puerto: 3307, base: "evaristo_cms", readOnly: 0, version: "x" }), /WordPress no es el esperado/);
});

// ---------------------------------------------------------------------------------------------------------------
// T14: argumentos
// ---------------------------------------------------------------------------------------------------------------
const MUESTRA = cargarDatosVersionados().ids;
const parsear = (...a: string[]): OpcionesCli => parsearArgumentos(a, MUESTRA);
const falla = (args: string[], texto: RegExp) => assert.throws(() => parsearArgumentos(args, MUESTRA), (e: Error) => e instanceof ErrorDeArgumentos && texto.test(e.message), args.join(" "));

t("T14: --muestra por defecto simula; --simular es lo mismo; los extras se leen", () => {
  assert.deepEqual(parsear("--muestra"), { alcance: { tipo: "muestra" }, modo: "simular", esperarArticulos: null, abortarAlPrimerError: false, sobrescribir: false, originales: null });
  assert.deepEqual(parsear("--muestra", "--simular"), parsear("--muestra"));
  const o = parsear("--simular", "--muestra", "--abortar-al-primer-error", "--originales=C:\\Mis Fotos\\originales");
  assert.equal(o.abortarAlPrimerError, true);
  assert.equal(o.originales, "C:\\Mis Fotos\\originales");
  assert.equal(o.modo, "simular");
  assert.equal(MUESTRA.length, 35);
});

t("T14: --ids acepta solo ids de la muestra; se ordenan como la muestra y no se repiten", () => {
  const [a, b, c] = [MUESTRA[0]!, MUESTRA[10]!, MUESTRA[34]!];
  assert.deepEqual(parsear(`--ids=${c},${a}, ${b}`).alcance, { tipo: "ids", ids: [a, b, c] });
  assert.deepEqual(parsear(`--ids=${a},${a}`).alcance, { tipo: "ids", ids: [a] });
  assert.deepEqual(parsear("--ids=22546").alcance, { tipo: "ids", ids: [22546] });
  falla(["--ids=1"], /no son de la muestra.*: 1$/);
  falla([`--ids=${a},99999,99999`], /: 99999$/);
  falla(["--ids=abc"], /lista de números/);
  falla(["--ids=1,,2"], /lista de números/);
  falla(["--ids=-5"], /lista de números/);
  falla(["--ids="], /necesita un valor/);
  falla(["--ids"], /necesita un valor/);
});

t("T14: exactamente uno de --ids | --muestra | --todos", () => {
  falla([], /exactamente uno/);
  falla(["--simular"], /exactamente uno/);
  falla(["--muestra", "--ids=22546"], /exactamente uno/);
  falla(["--muestra", "--todos"], /exactamente uno/);
  falla(["--ids=22546", "--todos"], /exactamente uno/);
});

t("T14: --esperar-articulos y --sobrescribir exigen --escribir; --simular y --escribir no van juntos", () => {
  falla(["--muestra", "--esperar-articulos=35"], /solo se usa con --escribir/);
  falla(["--muestra", "--sobrescribir"], /--sobrescribir solo se usa con --escribir/);
  falla(["--muestra", "--simular", "--escribir", "--esperar-articulos=35"], /no se pueden usar juntos/);
  falla(["--muestra", "--escribir"], /necesita --esperar-articulos/);
  for (const n of ["abc", "0", "-1", "3.5", "1e3", " 5", "5 ", "035x"]) falla(["--muestra", "--escribir", `--esperar-articulos=${n}`], /entero positivo/);
  falla(["--muestra", "--escribir", "--esperar-articulos="], /necesita un valor/);
  falla(["--muestra", "--escribir", "--esperar-articulos"], /necesita un valor/);
});

t("T14: argumentos desconocidos, repetidos o con valor de más", () => {
  falla(["--muestra", "--rapido"], /argumento desconocido: --rapido/);
  falla(["--muestra", "suelto"], /argumento desconocido: suelto/);
  falla(["--muestra", "-x"], /argumento desconocido: -x/);
  falla(["--muestra=1"], /no lleva valor/);
  falla(["--muestra", "--simular=si"], /no lleva valor/);
  falla(["--muestra", "--muestra"], /repetido/);
  falla(["--muestra", "--originales=a", "--originales=b"], /repetido/);
  falla(["--muestra", "--originales"], /necesita un valor/);
  falla(["--muestra", "--originales="], /necesita un valor/);
  falla(["--muestra", "--abortar-al-primer-error=1"], /no lleva valor/);
});

t("T14: en este tramo --escribir y --todos se rechazan con un mensaje claro", () => {
  falla(["--todos"], /--todos: no implementado en este tramo/);
  falla(["--todos", "--simular"], /no implementado en este tramo/);
  falla(["--muestra", "--escribir", "--esperar-articulos=35"], /--escribir: no implementado en este tramo/);
  falla(["--ids=22546", "--escribir", "--esperar-articulos=1", "--sobrescribir", "--abortar-al-primer-error"], /no implementado en este tramo/);
  // el error de combinación gana al de "no implementado" (se dice primero lo que está mal escrito)
  falla(["--todos", "--esperar-articulos=3"], /solo se usa con --escribir/);
});

console.log(`${ok} pruebas de conexiones ok`);
