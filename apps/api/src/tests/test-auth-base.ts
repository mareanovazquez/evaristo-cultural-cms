// Prueba del ingreso y las sesiones con la base de verdad, SOLO contra evaristo_cms_dev (se niega a correr contra otra).
// Crea un usuario temporal, ingresa, consulta, sale y lo borra (las sesiones se borran en cascada).
//
// Uso: npm run test:auth-base
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
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
const email = `prueba-auth-${Date.now()}@ejemplo.org`;
const clave = "clave-de-prueba-larga-1";
let server: Server | undefined;
try {
  try {
    await prisma.usuario.count();
    await prisma.sesion.count();
  } catch (e) {
    fallar(`no se puede leer usuarios/sesiones en evaristo_cms_dev: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  const usuario = await prisma.usuario.create({ data: { email, nombre: "Prueba de autenticación", rol: "EDITOR", passwordHash: await hashearClave(clave) }, select: { id: true } });

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, cookie?: string) =>
    new Promise<{ estado: number; json: Record<string, unknown>; cookie: string | undefined }>((resolver, rechazar) => {
      const datos = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
      const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(Buffer.concat(partes).toString("utf8")) as Record<string, unknown>;
          } catch {
            /* no es JSON */
          }
          const set = res.headers["set-cookie"];
          resolver({ estado: res.statusCode ?? 0, json, cookie: Array.isArray(set) ? set[0] : set });
        });
      });
      req.on("error", rechazar);
      if (datos) req.write(datos);
      req.end();
    });

  const mal = await pedir("POST", "/api/auth/ingresar", { email, clave: "equivocada-larga-1" });
  assert.equal(mal.estado, 401);

  const bien = await pedir("POST", "/api/auth/ingresar", { email, clave });
  assert.equal(bien.estado, 200);
  const token = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(bien.cookie ?? "")?.[1] ?? "";
  assert.equal(token.length, 43);
  const cookie = `${NOMBRE_COOKIE}=${token}`;

  const enBase = await prisma.sesion.findMany({ where: { usuarioId: usuario.id }, select: { tokenHash: true, venceEn: true } });
  assert.equal(enBase.length, 1);
  assert.match(enBase[0]!.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(enBase[0]!.tokenHash, token);
  assert.ok(enBase[0]!.venceEn.getTime() > Date.now() + 11 * 3600 * 1000);
  assert.ok((await prisma.usuario.findUnique({ where: { id: usuario.id }, select: { ultimoAccesoEn: true } }))?.ultimoAccesoEn);

  const yo = await pedir("GET", "/api/auth/yo", undefined, cookie);
  assert.equal(yo.estado, 200);
  assert.equal((yo.json["usuario"] as { email: string }).email, email);

  // Una sesión vencida (se fuerza en la base) deja de servir y se borra
  await prisma.sesion.updateMany({ where: { usuarioId: usuario.id }, data: { venceEn: new Date(Date.now() - 1000) } });
  assert.equal((await pedir("GET", "/api/auth/yo", undefined, cookie)).estado, 401);
  assert.equal(await prisma.sesion.count({ where: { usuarioId: usuario.id } }), 0);

  const otra = await pedir("POST", "/api/auth/ingresar", { email, clave });
  const cookie2 = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(otra.cookie ?? "")?.[1] ?? ""}`;
  assert.equal((await pedir("POST", "/api/auth/salir", {}, cookie2)).estado, 200);
  assert.equal(await prisma.sesion.count({ where: { usuarioId: usuario.id } }), 0);
  assert.equal((await pedir("GET", "/api/auth/yo", undefined, cookie2)).estado, 401);

  // Borrar el usuario borra sus sesiones en cascada
  await pedir("POST", "/api/auth/ingresar", { email, clave });
  assert.equal(await prisma.sesion.count({ where: { usuarioId: usuario.id } }), 1);
  await prisma.usuario.delete({ where: { id: usuario.id } });
  assert.equal(await prisma.sesion.count({ where: { usuarioId: usuario.id } }), 0);
  console.log("OK: ingreso, sesión, vencimiento, salida y borrado en cascada funcionan contra evaristo_cms_dev.");
} finally {
  await prisma.usuario.deleteMany({ where: { email } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
