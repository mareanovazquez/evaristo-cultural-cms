// Prueba del listado de artículos del panel (GET /api/admin/articulos) con la base de verdad, SOLO contra evaristo_cms_dev.
// Crea un usuario temporal para ingresar y lo borra al terminar. Solo lee los artículos.
//
// Uso: npm run test:admin-articulos
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { ARTICULOS_POR_PAGINA } from "../admin/articulos.js";
import { crearApp } from "../app.js";
import { hashearClave } from "../auth/clave.js";
import { NOMBRE_COOKIE } from "../auth/rutas.js";
import { elegirBase } from "../entorno.js";

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

try {
  if (elegirBase(["--base-dev"]) !== "dev") fallar("no se pudo elegir la base de desarrollo");
} catch (e) {
  fallar(e instanceof Error ? e.message : String(e));
}
const url = new URL(process.env["DATABASE_URL"]!);
if (url.port !== "3308" || decodeURIComponent(url.pathname.slice(1)) !== "evaristo_cms_dev") fallar("esta prueba solo corre contra evaristo_cms_dev en el 3308");

const prisma = obtenerClientePrisma();
const email = `prueba-listado-${Date.now()}@ejemplo.org`;
const clave = "clave-de-prueba-larga-1";
let server: Server | undefined;
try {
  try {
    await prisma.articulo.count();
  } catch (e) {
    fallar(`no se puede leer evaristo_cms_dev: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  await prisma.usuario.create({ data: { email, nombre: "Prueba del listado", rol: "EDITOR", passwordHash: await hashearClave(clave) }, select: { id: true } });
  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, cookie?: string) =>
    new Promise<{ estado: number; json: Record<string, any>; cookie: string | undefined; texto: string }>((resolver, rechazar) => {
      const datos = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
      const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let json: Record<string, any> = {};
          try {
            json = JSON.parse(texto) as Record<string, any>;
          } catch {
            /* no es JSON */
          }
          const set = res.headers["set-cookie"];
          resolver({ estado: res.statusCode ?? 0, json, texto, cookie: Array.isArray(set) ? set[0] : set });
        });
      });
      req.on("error", rechazar);
      if (datos) req.write(datos);
      req.end();
    });

  // Sin sesión
  assert.equal((await pedir("GET", "/api/admin/articulos")).estado, 401);
  assert.equal((await pedir("GET", "/api/admin/articulos", undefined, `${NOMBRE_COOKIE}=${"A".repeat(43)}`)).estado, 401);

  const ingreso = await pedir("POST", "/api/auth/ingresar", { email, clave });
  assert.equal(ingreso.estado, 200);
  const cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(ingreso.cookie ?? "")?.[1] ?? ""}`;
  const listar = (consulta = "") => pedir("GET", `/api/admin/articulos${consulta}`, undefined, cookie);

  // Totales y solapas, comparados con la base
  const totalBase = await prisma.articulo.count();
  const porEstadoBase = Object.fromEntries(await Promise.all((["BORRADOR", "PUBLICADO", "PROGRAMADO"] as const).map(async (e) => [e, await prisma.articulo.count({ where: { estado: e } })])));
  const todos = await listar();
  assert.equal(todos.estado, 200);
  assert.equal(todos.json["total"], totalBase);
  assert.deepEqual(todos.json["conteos"], porEstadoBase);
  assert.equal(todos.json["paginas"], Math.ceil(totalBase / ARTICULOS_POR_PAGINA));

  // La respuesta no trae nada de más
  assert.ok(!/cuerpo|visitasWp|textoPlano|passwordHash|avisosMigracion/.test(todos.texto), "la respuesta trae campos que no corresponden");
  assert.deepEqual(Object.keys(todos.json["articulos"][0]).sort(), ["actualizadoEn", "altPendientes", "autores", "estado", "id", "publicadoEn", "ruta", "seccion", "titulo", "wpId"]);

  // Paginación: todas las páginas, sin repetir, suman el total
  const ids: number[] = [];
  for (let p = 1; p <= todos.json["paginas"]; p++) {
    const r = await listar(`?pagina=${p}`);
    assert.equal(r.estado, 200);
    assert.ok(r.json["articulos"].length <= ARTICULOS_POR_PAGINA);
    ids.push(...r.json["articulos"].map((a: { id: number }) => a.id));
  }
  assert.equal(ids.length, totalBase);
  assert.equal(new Set(ids).size, totalBase);
  assert.equal((await listar(`?pagina=${todos.json["paginas"] + 1}`)).json["articulos"].length, 0);

  // Orden: lo último modificado primero
  const fechas = todos.json["articulos"].map((a: { actualizadoEn: string }) => new Date(a.actualizadoEn).getTime());
  assert.deepEqual([...fechas].sort((a, b) => b - a), fechas);

  // Filtro por estado y ruta pública
  for (const estado of ["PUBLICADO", "BORRADOR", "PROGRAMADO"] as const) {
    const r = await listar(`?estado=${estado}&pagina=1`);
    assert.equal(r.json["total"], porEstadoBase[estado]);
    for (const a of r.json["articulos"]) {
      assert.equal(a.estado, estado);
      if (estado === "PUBLICADO") assert.match(a.ruta, /^\/\d{4}\/\d{2}\/\d{2}\/.+\/$/);
      else assert.equal(a.ruta, null);
    }
  }

  // Búsqueda por título (sin distinguir mayúsculas ni tildes) y sin resultados
  const ejemplo = await prisma.articulo.findFirst({ select: { titulo: true }, orderBy: { id: "asc" } });
  const palabra = (ejemplo!.titulo.split(/\s+/).find((w) => w.length >= 5) ?? ejemplo!.titulo).replace(/[^\p{L}]/gu, "");
  const buscada = await listar(`?q=${encodeURIComponent(palabra.toUpperCase())}`);
  assert.ok(buscada.json["total"] >= 1);
  const normal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  for (const a of buscada.json["articulos"]) assert.ok(normal(a.titulo).includes(normal(palabra)), a.titulo);
  const nada = await listar(`?q=${encodeURIComponent("zzzz-no-existe-xyz")}`);
  assert.equal(nada.json["total"], 0);
  assert.deepEqual(nada.json["conteos"], { BORRADOR: 0, PUBLICADO: 0, PROGRAMADO: 0 });
  assert.equal(nada.json["paginas"], 1);

  // Filtros inválidos
  for (const mal of ["?estado=OTRO", "?pagina=0", "?pagina=-1", "?pagina=abc", `?q=${"x".repeat(101)}`]) assert.equal((await listar(mal)).estado, 400, mal);

  // La búsqueda con caracteres de LIKE no rompe (% y _ se tratan como texto)
  assert.equal((await listar(`?q=${encodeURIComponent("%")}`)).estado, 200);

  console.log(`OK: el listado responde bien (${totalBase} artículos, ${todos.json["paginas"]} páginas, filtros, búsqueda y sin campos de más) contra evaristo_cms_dev.`);
} finally {
  await prisma.usuario.deleteMany({ where: { email } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
