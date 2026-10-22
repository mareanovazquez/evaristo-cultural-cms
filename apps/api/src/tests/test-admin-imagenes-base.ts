// Prueba de la biblioteca de imágenes del panel (GET /api/admin/imagenes) con la base de verdad, SOLO contra evaristo_cms_dev.
// Crea un usuario temporal para ingresar y lo borra al terminar. Solo lee las imágenes.
//
// Uso: npm run test:admin-imagenes
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { IMAGENES_POR_PAGINA } from "../admin/imagenes.js";
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
const email = `prueba-imagenes-${Date.now()}@ejemplo.org`;
const clave = "clave-de-prueba-larga-1";
let server: Server | undefined;
try {
  try {
    await prisma.imagen.count();
  } catch (e) {
    fallar(`no se puede leer evaristo_cms_dev: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  await prisma.usuario.create({ data: { email, nombre: "Prueba de imágenes", rol: "EDITOR", passwordHash: await hashearClave(clave) }, select: { id: true } });
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
  assert.equal((await pedir("GET", "/api/admin/imagenes")).estado, 401);

  const ingreso = await pedir("POST", "/api/auth/ingresar", { email, clave });
  assert.equal(ingreso.estado, 200);
  const cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(ingreso.cookie ?? "")?.[1] ?? ""}`;
  const listar = (consulta = "") => pedir("GET", `/api/admin/imagenes${consulta}`, undefined, cookie);

  // Total y páginas, comparados con la base
  const totalBase = await prisma.imagen.count();
  const primera = await listar();
  assert.equal(primera.estado, 200);
  assert.equal(primera.json["total"], totalBase);
  assert.equal(primera.json["paginas"], Math.ceil(totalBase / IMAGENES_POR_PAGINA));
  assert.deepEqual(Object.keys(primera.json["imagenes"][0]).sort(), ["alto", "ancho", "clave", "id", "nombreOriginal"]);
  assert.ok(!/hash|bytes|wpId|tipoMime/.test(primera.texto), "la respuesta trae campos que no corresponden");

  // Todas las páginas, sin repetir, suman el total
  const ids: number[] = [];
  for (let p = 1; p <= primera.json["paginas"]; p++) {
    const r = await listar(`?pagina=${p}`);
    assert.equal(r.estado, 200);
    assert.ok(r.json["imagenes"].length <= IMAGENES_POR_PAGINA);
    ids.push(...r.json["imagenes"].map((i: { id: number }) => i.id));
  }
  assert.equal(ids.length, totalBase);
  assert.equal(new Set(ids).size, totalBase);
  assert.equal((await listar(`?pagina=${primera.json["paginas"] + 1}`)).json["imagenes"].length, 0);

  // Búsqueda por nombre de archivo y sin resultados
  const ejemplo = await prisma.imagen.findFirst({ select: { nombreOriginal: true }, orderBy: { id: "asc" } });
  const trozo = ejemplo!.nombreOriginal.slice(0, 5);
  const buscada = await listar(`?q=${encodeURIComponent(trozo)}`);
  assert.ok(buscada.json["total"] >= 1);
  for (const i of buscada.json["imagenes"]) assert.ok(i.nombreOriginal.toLowerCase().includes(trozo.toLowerCase()), i.nombreOriginal);
  assert.equal((await listar(`?q=${encodeURIComponent("zzzz-no-existe-xyz")}`)).json["total"], 0);

  // Filtros inválidos, y los caracteres de LIKE no rompen
  for (const mal of ["?pagina=0", "?pagina=-1", "?pagina=abc", `?q=${"x".repeat(101)}`]) assert.equal((await listar(mal)).estado, 400, mal);
  assert.equal((await listar(`?q=${encodeURIComponent("%")}`)).estado, 200);

  console.log(`OK: la biblioteca responde bien (${totalBase} imágenes, ${primera.json["paginas"]} páginas, búsqueda y sin campos de más) contra evaristo_cms_dev.`);
} finally {
  await prisma.usuario.deleteMany({ where: { email } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
