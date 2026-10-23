// Pruebas de la autenticación (src/auth) sin base de datos: repositorio en memoria y reloj controlable.
// Levanta un servidor HTTP efímero en 127.0.0.1 con puerto asignado por el sistema y lo cierra al terminar.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { crearApp } from "../app.js";
import { hashearClave, problemaDeClave, verificarClave } from "../auth/clave.js";
import { crearAuth, DURACION_SESION_MS, NOMBRE_COOKIE } from "../auth/rutas.js";
import type { Repositorio, SesionFila, UsuarioFila } from "../auth/repositorio.js";

let ok = 0;
const pruebas: Array<[string, () => Promise<void>]> = [];
const t = (name: string, fn: () => Promise<void>) => pruebas.push([name, fn]);

// ---------- Repositorio en memoria ----------
const usuarios: UsuarioFila[] = [];
const sesiones = new Map<string, { venceEn: Date; usuarioId: number }>();
const accesos = new Map<number, Date>();
const repo: Repositorio = {
  usuarioPorEmail: async (email) => usuarios.find((u) => u.email === email) ?? null,
  usuarioPorId: async (id) => usuarios.find((u) => u.id === id) ?? null,
  cambiarClave: async (id, hash, debeCambiar) => {
    const u = usuarios.find((x) => x.id === id)!;
    u.passwordHash = hash;
    u.debeCambiarClave = debeCambiar;
  },
  cambiarNombre: async (id, nombre) => void (usuarios.find((x) => x.id === id)!.nombre = nombre),
  borrarSesionesDeUsuario: async (id, excepto) => {
    let n = 0;
    for (const [hash, s] of sesiones) if (s.usuarioId === id && hash !== excepto) (sesiones.delete(hash), n++);
    return n;
  },
  registrarAcceso: async (id, cuando) => void accesos.set(id, cuando),
  crearSesion: async (tokenHash, usuarioId, venceEn) => void sesiones.set(tokenHash, { venceEn, usuarioId }),
  sesionPorHash: async (tokenHash): Promise<SesionFila | null> => {
    const s = sesiones.get(tokenHash);
    const usuario = s && usuarios.find((u) => u.id === s.usuarioId);
    return s && usuario ? { venceEn: s.venceEn, usuario } : null;
  },
  borrarSesion: async (tokenHash) => void sesiones.delete(tokenHash),
  borrarSesionesVencidas: async () => 0,
};
let reloj = new Date("2026-10-21T12:00:00Z");

const CLAVE_ANA = "una-clave-larga-1";
usuarios.push(
  { id: 1, email: "ana@ejemplo.org", nombre: "Ana", rol: "ADMINISTRADOR", activo: true, debeCambiarClave: false, passwordHash: await hashearClave(CLAVE_ANA) },
  { id: 2, email: "beto@ejemplo.org", nombre: "Beto", rol: "EDITOR", activo: true, debeCambiarClave: false, passwordHash: await hashearClave("otra-clave-larga-2") },
  { id: 4, email: "rita@ejemplo.org", nombre: "Rita", rol: "REDACTOR", activo: true, debeCambiarClave: true, passwordHash: await hashearClave("clave-de-rita-4444") },
  { id: 3, email: "inactivo@ejemplo.org", nombre: "Inactivo", rol: "EDITOR", activo: false, debeCambiarClave: false, passwordHash: await hashearClave("clave-del-inactivo-3") },
);

// ---------- Servidores ----------
async function levantar(app: express.Express): Promise<{ server: Server; puerto: number }> {
  const server = await new Promise<Server>((listo) => {
    const s = app.listen(0, "127.0.0.1", () => listo(s));
  });
  return { server, puerto: (server.address() as AddressInfo).port };
}
// Fake de Prisma: la autenticación usa el repositorio inyectado; las demás rutas no se tocan.
const sinPrisma = {} as never;
const principal = await levantar(crearApp(sinPrisma, { auth: { repo, ahora: () => reloj, limiteIngresos: { ventanaMs: 60_000, max: 1000 } } }));
const conLimite = await levantar(crearApp(sinPrisma, { auth: { repo, ahora: () => reloj, limiteIngresos: { ventanaMs: 60_000, max: 3 } } }));
const seguro = await levantar(crearApp(sinPrisma, { auth: { repo, ahora: () => reloj, seguro: true } }));
// Rutas de prueba para los roles
const authRoles = crearAuth({ repo, seguro: false, ahora: () => reloj });
const appRoles = express();
appRoles.use(express.json());
appRoles.use("/api/auth", authRoles.router);
appRoles.get("/api/solo-admin", authRoles.cargarSesion, authRoles.exigirRol("ADMINISTRADOR"), (_req, res) => void res.json({ estado: "ok" }));
appRoles.get("/api/solo-usuarios", authRoles.cargarSesion, authRoles.exigirPermiso("usuarios.gestionar"), (_req, res) => void res.json({ estado: "ok" }));
appRoles.get("/api/solo-revision", authRoles.cargarSesion, authRoles.exigirPermiso("revision.usar"), (_req, res) => void res.json({ estado: "ok" }));
appRoles.get("/api/con-clave-al-dia", authRoles.cargarSesion, authRoles.exigirSesion, authRoles.exigirClaveAlDia, (_req, res) => void res.json({ estado: "ok" }));
appRoles.get("/api/editores", authRoles.cargarSesion, authRoles.exigirRol("EDITOR"), (_req, res) => void res.json({ estado: "ok" }));
const roles = await levantar(appRoles);

interface Respuesta {
  estado: number;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo: string;
  json: Record<string, unknown>;
  cookie: string | undefined;
}
function pedir(puerto: number, metodo: string, ruta: string, opciones: { cuerpo?: unknown; crudo?: string | Buffer; cookie?: string; cabeceras?: Record<string, string> } = {}): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const datos = opciones.crudo ?? (opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo));
    const cabeceras: Record<string, string> = { ...(datos !== undefined ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(opciones.cookie ? { Cookie: opciones.cookie } : {}), ...opciones.cabeceras };
    const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: cabeceras }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p: Buffer) => partes.push(p));
      res.on("end", () => {
        const cuerpo = Buffer.concat(partes).toString("utf8");
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(cuerpo) as Record<string, unknown>;
        } catch {
          /* no es JSON */
        }
        const set = res.headers["set-cookie"];
        resolver({ estado: res.statusCode ?? 0, cabeceras: res.headers, cuerpo, json, cookie: Array.isArray(set) ? set[0] : set });
      });
    });
    req.on("error", rechazar);
    if (datos !== undefined) req.write(datos);
    req.end();
  });
}
const ingresar = (puerto: number, email: string, clave: string, cab?: Record<string, string>) => pedir(puerto, "POST", "/api/auth/ingresar", { cuerpo: { email, clave }, ...(cab ? { cabeceras: cab } : {}) });
const tokenDe = (cookie: string | undefined) => new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(cookie ?? "")?.[1] ?? "";
const cookieDe = (r: Respuesta) => `${NOMBRE_COOKIE}=${tokenDe(r.cookie)}`;

// ---------- Contraseñas ----------
t("hash: formato scrypt con parámetros, sal distinta cada vez y verificación correcta", async () => {
  const a = await hashearClave("mi-clave-larga-1");
  const b = await hashearClave("mi-clave-larga-1");
  assert.match(a, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b);
  assert.equal(await verificarClave("mi-clave-larga-1", a), true);
  assert.equal(await verificarClave("mi-clave-larga-2", a), false);
  assert.equal(await verificarClave("Mi-clave-larga-1", a), false);
  assert.ok(!a.includes("mi-clave-larga-1"));
});
t("hash: los formatos inválidos o alterados nunca coinciden", async () => {
  const h = await hashearClave("mi-clave-larga-1");
  const partes = h.split("$");
  for (const malo of ["", "texto", "scrypt$1$2", "bcrypt$a$b$c$d$e", `scrypt$0$8$1$${partes[4]}$${partes[5]}`, `scrypt$32768$8$1$$${partes[5]}`, `scrypt$99999999$8$1$${partes[4]}$${partes[5]}`, `scrypt$32768$8$1$${partes[4]}$`, h.slice(0, -4) + "AAAA"]) {
    assert.equal(await verificarClave("mi-clave-larga-1", malo), false, malo);
  }
});
t("hash: una contraseña con tildes y ñ se normaliza igual", async () => {
  const h = await hashearClave("contraseña-ñandú-ñ");
  assert.equal(await verificarClave("contraseña-ñandú-ñ".normalize("NFC"), await hashearClave("contraseña-ñandú-ñ")), true);
  assert.equal(await verificarClave("contraseña-ñandú-ñ", h), true);
});
t("problemaDeClave: mínimo de 10 y máximo de 200 caracteres", async () => {
  assert.ok(problemaDeClave("corta"));
  assert.equal(problemaDeClave("a".repeat(10)), undefined);
  assert.ok(problemaDeClave("a".repeat(201)));
});

// ---------- Ingreso y sesión ----------
t("ingreso correcto: cookie httpOnly, SameSite=Strict, solo para /api, 12 horas; sin Secure en desarrollo", async () => {
  const r = await ingresar(principal.puerto, "ana@ejemplo.org", CLAVE_ANA);
  assert.equal(r.estado, 200);
  assert.deepEqual({ ...(r.json["usuario"] as object), permisos: undefined }, { id: 1, email: "ana@ejemplo.org", nombre: "Ana", rol: "ADMINISTRADOR", debeCambiarClave: false, permisos: undefined });
  assert.ok(!r.cuerpo.includes("passwordHash") && !r.cuerpo.includes("scrypt"));
  const c = r.cookie ?? "";
  assert.match(c, new RegExp(`^${NOMBRE_COOKIE}=[A-Za-z0-9_-]{43};`));
  for (const atributo of ["HttpOnly", "SameSite=Strict", "Path=/api", `Max-Age=${DURACION_SESION_MS / 1000}`]) assert.ok(c.includes(atributo), atributo);
  assert.ok(!c.includes("Secure"));
  assert.equal(r.cabeceras["cache-control"], "no-store");
  assert.deepEqual(accesos.get(1), reloj);
});
t("con HTTPS (producción) la cookie lleva Secure", async () => {
  const r = await ingresar(seguro.puerto, "ana@ejemplo.org", CLAVE_ANA);
  assert.equal(r.estado, 200);
  assert.ok((r.cookie ?? "").includes("; Secure"));
});
t("en la base solo queda el SHA-256 del código, nunca el código", async () => {
  const r = await ingresar(principal.puerto, "ana@ejemplo.org", CLAVE_ANA);
  const token = tokenDe(r.cookie);
  assert.ok(!sesiones.has(token));
  assert.ok(sesiones.has(createHash("sha256").update(token).digest("hex")));
});
t("el email se acepta en mayúsculas y con espacios", async () => {
  const r = await ingresar(principal.puerto, "  ANA@Ejemplo.ORG ", CLAVE_ANA);
  assert.equal(r.estado, 200);
});
t("contraseña incorrecta, email inexistente y usuario inactivo: el mismo 401 y el mismo mensaje, sin cookie", async () => {
  const casos: Array<[string, string]> = [["ana@ejemplo.org", "clave-equivocada"], ["nadie@ejemplo.org", CLAVE_ANA], ["inactivo@ejemplo.org", "clave-del-inactivo-3"]];
  const mensajes = new Set<unknown>();
  for (const [email, clave] of casos) {
    const r = await ingresar(principal.puerto, email, clave);
    assert.equal(r.estado, 401, email);
    assert.equal(r.cookie, undefined);
    mensajes.add(r.json["mensaje"]);
  }
  assert.equal(mensajes.size, 1);
});
t("pedidos mal formados: 400 con mensaje común", async () => {
  for (const cuerpo of [{}, { email: "ana@ejemplo.org" }, { clave: "x" }, { email: "no-es-email", clave: "x" }, { email: 5, clave: 5 }, { email: "ana@ejemplo.org", clave: "x".repeat(201) }, { email: "ana@ejemplo.org", clave: "" }]) {
    const r = await pedir(principal.puerto, "POST", "/api/auth/ingresar", { cuerpo });
    assert.equal(r.estado, 400, JSON.stringify(cuerpo));
  }
  assert.equal((await pedir(principal.puerto, "POST", "/api/auth/ingresar", { crudo: "{esto no es json", cabeceras: { "Content-Type": "application/json" } })).estado, 400);
  assert.equal((await pedir(principal.puerto, "POST", "/api/auth/ingresar", { crudo: "email=a&clave=b", cabeceras: { "Content-Type": "application/x-www-form-urlencoded" } })).estado, 400);
  assert.equal((await pedir(principal.puerto, "POST", "/api/auth/ingresar", { crudo: JSON.stringify({ email: "a@b.co", clave: "x".repeat(3 * 1024 * 1024) }) })).estado, 413);
});
t("/yo: con sesión devuelve el usuario; sin cookie o con cookie falsa, 401", async () => {
  const r = await ingresar(principal.puerto, "beto@ejemplo.org", "otra-clave-larga-2");
  const yo = await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie: cookieDe(r) });
  assert.equal(yo.estado, 200);
  assert.deepEqual({ ...(yo.json["usuario"] as object), permisos: undefined }, { id: 2, email: "beto@ejemplo.org", nombre: "Beto", rol: "EDITOR", debeCambiarClave: false, permisos: undefined });
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo")).estado, 401);
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie: `${NOMBRE_COOKIE}=${"A".repeat(43)}` })).estado, 401);
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie: `${NOMBRE_COOKIE}=` })).estado, 401);
});
t("salir: borra la sesión y limpia la cookie; el código viejo ya no sirve", async () => {
  const r = await ingresar(principal.puerto, "ana@ejemplo.org", CLAVE_ANA);
  const cookie = cookieDe(r);
  const salida = await pedir(principal.puerto, "POST", "/api/auth/salir", { cookie });
  assert.equal(salida.estado, 200);
  assert.ok((salida.cookie ?? "").includes("Max-Age=0"));
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie })).estado, 401);
});
t("una sesión vencida deja de servir y se borra", async () => {
  const antes = reloj;
  const r = await ingresar(principal.puerto, "ana@ejemplo.org", CLAVE_ANA);
  const cookie = cookieDe(r);
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie })).estado, 200);
  reloj = new Date(antes.getTime() + DURACION_SESION_MS + 1000);
  const hash = createHash("sha256").update(tokenDe(r.cookie)).digest("hex");
  assert.ok(sesiones.has(hash));
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie })).estado, 401);
  assert.ok(!sesiones.has(hash));
  reloj = antes;
});
t("si el usuario se desactiva, su sesión deja de servir", async () => {
  const r = await ingresar(principal.puerto, "beto@ejemplo.org", "otra-clave-larga-2");
  const cookie = cookieDe(r);
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie })).estado, 200);
  usuarios[1]!.activo = false;
  try {
    assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie })).estado, 401);
  } finally {
    usuarios[1]!.activo = true;
  }
});

// ---------- Límite de intentos ----------
t("límite de intentos: tras 3 fallos, el cuarto da 429; los ingresos correctos no cuentan", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await ingresar(conLimite.puerto, "ana@ejemplo.org", CLAVE_ANA)).estado, 200, `ingreso correcto ${i}`);
  for (let i = 0; i < 3; i++) assert.equal((await ingresar(conLimite.puerto, "ana@ejemplo.org", "mal")).estado, 401, `fallo ${i}`);
  const bloqueado = await ingresar(conLimite.puerto, "ana@ejemplo.org", "mal");
  assert.equal(bloqueado.estado, 429);
  assert.match(String(bloqueado.json["mensaje"]), /demasiados intentos/i);
  assert.equal((await ingresar(conLimite.puerto, "ana@ejemplo.org", CLAVE_ANA)).estado, 429, "mientras dura el bloqueo ni la clave correcta entra");
});

// ---------- Origen (CSRF) ----------
t("los pedidos que cambian datos tienen que venir del mismo sitio", async () => {
  const host = `127.0.0.1:${principal.puerto}`;
  const bueno = await ingresar(principal.puerto, "ana@ejemplo.org", CLAVE_ANA, { Origin: `http://${host}`, "Sec-Fetch-Site": "same-origin" });
  assert.equal(bueno.estado, 200);
  const ajenos: Array<Record<string, string>> = [{ Origin: "http://sitio-malicioso.example" }, { Origin: "null" }, { Origin: `http://${host}.evil.example` }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }];
  for (const cab of ajenos) {
    const r = await ingresar(principal.puerto, "ana@ejemplo.org", CLAVE_ANA, cab);
    assert.equal(r.estado, 403, JSON.stringify(cab));
    assert.equal(r.cookie, undefined);
  }
  const salida = await pedir(principal.puerto, "POST", "/api/auth/salir", { cookie: cookieDe(bueno), cabeceras: { Origin: "http://sitio-malicioso.example" } });
  assert.equal(salida.estado, 403);
  assert.equal((await pedir(principal.puerto, "GET", "/api/auth/yo", { cookie: cookieDe(bueno), cabeceras: { Origin: "http://sitio-malicioso.example" } })).estado, 200, "los GET no se bloquean por origen");
});

// ---------- Roles y cabeceras ----------
t("roles: sin sesión 401; editor no entra a lo del administrador (403); el administrador entra a todo", async () => {
  const ana = cookieDe(await ingresar(roles.puerto, "ana@ejemplo.org", CLAVE_ANA));
  const beto = cookieDe(await ingresar(roles.puerto, "beto@ejemplo.org", "otra-clave-larga-2"));
  assert.equal((await pedir(roles.puerto, "GET", "/api/solo-admin")).estado, 401);
  assert.equal((await pedir(roles.puerto, "GET", "/api/solo-admin", { cookie: beto })).estado, 403);
  assert.equal((await pedir(roles.puerto, "GET", "/api/solo-admin", { cookie: ana })).estado, 200);
  assert.equal((await pedir(roles.puerto, "GET", "/api/editores", { cookie: beto })).estado, 200);
  assert.equal((await pedir(roles.puerto, "GET", "/api/editores", { cookie: ana })).estado, 200);
});
t("permisos con nombre: el redactor no entra a usuarios ni a la revisión, el editor entra a la revisión pero no a usuarios, el administrador a todo", async () => {
  const ana = cookieDe(await ingresar(roles.puerto, "ana@ejemplo.org", CLAVE_ANA));
  const beto = cookieDe(await ingresar(roles.puerto, "beto@ejemplo.org", "otra-clave-larga-2"));
  const rita = cookieDe(await ingresar(roles.puerto, "rita@ejemplo.org", "clave-de-rita-4444"));
  assert.equal((await pedir(roles.puerto, "GET", "/api/solo-usuarios")).estado, 401);
  for (const [cookie, usuarios_, revision] of [[rita, 403, 403], [beto, 403, 200], [ana, 200, 200]] as const) {
    assert.equal((await pedir(roles.puerto, "GET", "/api/solo-usuarios", { cookie })).estado, usuarios_);
    assert.equal((await pedir(roles.puerto, "GET", "/api/solo-revision", { cookie })).estado, revision);
  }
});
t("/yo devuelve los permisos del rol y nunca la contraseña", async () => {
  const rita = await pedir(roles.puerto, "GET", "/api/auth/yo", { cookie: cookieDe(await ingresar(roles.puerto, "rita@ejemplo.org", "clave-de-rita-4444")) });
  const u = rita.json["usuario"] as Record<string, unknown>;
  assert.deepEqual(u["permisos"], ["articulos.crear"]);
  assert.equal(u["debeCambiarClave"], true);
  assert.ok(!rita.cuerpo.includes("scrypt") && !rita.cuerpo.includes("passwordHash"));
  const ana = await pedir(roles.puerto, "GET", "/api/auth/yo", { cookie: cookieDe(await ingresar(roles.puerto, "ana@ejemplo.org", CLAVE_ANA)) });
  assert.ok((((ana.json["usuario"] as Record<string, unknown>)["permisos"]) as string[]).includes("usuarios.gestionar"));
});
t("con la contraseña puesta por el administrador solo se puede cambiarla: lo demás da 403 cambiar_clave", async () => {
  const rita = cookieDe(await ingresar(roles.puerto, "rita@ejemplo.org", "clave-de-rita-4444"));
  const r = await pedir(roles.puerto, "GET", "/api/con-clave-al-dia", { cookie: rita });
  assert.equal(r.estado, 403);
  assert.equal(r.json["codigo"], "cambiar_clave");
  assert.equal((await pedir(roles.puerto, "GET", "/api/con-clave-al-dia", { cookie: cookieDe(await ingresar(roles.puerto, "beto@ejemplo.org", "otra-clave-larga-2")) })).estado, 200);
});
t("Mi cuenta: cambiar el nombre; la contraseña pide la actual, valida la nueva, corta las otras sesiones y levanta la marca", async () => {
  const puerto = principal.puerto;
  const una = cookieDe(await ingresar(puerto, "rita@ejemplo.org", "clave-de-rita-4444"));
  const otra = cookieDe(await ingresar(puerto, "rita@ejemplo.org", "clave-de-rita-4444"));
  assert.equal((await pedir(puerto, "PATCH", "/api/auth/yo", { cuerpo: { nombre: "Rita Gómez" } })).estado, 401);
  assert.equal((await pedir(puerto, "PATCH", "/api/auth/yo", { cookie: una, cuerpo: { nombre: "  " } })).estado, 400);
  assert.equal((await pedir(puerto, "PATCH", "/api/auth/yo", { cookie: una, cuerpo: { nombre: "Rita Gómez", rol: "ADMINISTRADOR" } })).estado, 400, "no acepta campos de más (el rol no se cambia solo)");
  const nombre = await pedir(puerto, "PATCH", "/api/auth/yo", { cookie: una, cuerpo: { nombre: "Rita Gómez" } });
  assert.equal(nombre.estado, 200);
  assert.equal((nombre.json["usuario"] as Record<string, unknown>)["nombre"], "Rita Gómez");
  assert.equal(usuarios.find((u) => u.id === 4)!.rol, "REDACTOR");

  const cambiar = (cuerpo: unknown, cookie = una) => pedir(puerto, "POST", "/api/auth/clave", { cookie, cuerpo });
  assert.equal((await cambiar({ claveActual: "clave-de-rita-4444", claveNueva: "x" })).estado, 400, "contraseña nueva corta");
  assert.equal((await cambiar({ claveActual: "equivocada", claveNueva: "clave-nueva-larga-5" })).json["mensaje"], "La contraseña actual no es correcta.");
  assert.equal((await cambiar({ claveActual: "clave-de-rita-4444", claveNueva: "clave-de-rita-4444" })).estado, 400, "igual a la actual");
  assert.equal((await pedir(puerto, "POST", "/api/auth/clave", { cuerpo: { claveActual: "a", claveNueva: "clave-nueva-larga-5" } })).estado, 401);
  const bien = await cambiar({ claveActual: "clave-de-rita-4444", claveNueva: "clave-nueva-larga-5" });
  assert.equal(bien.estado, 200);
  assert.equal((bien.json["usuario"] as Record<string, unknown>)["debeCambiarClave"], false);
  assert.ok(!bien.cuerpo.includes("scrypt"));
  assert.equal((await pedir(puerto, "GET", "/api/auth/yo", { cookie: una })).estado, 200, "esta sesión sigue");
  assert.equal((await pedir(puerto, "GET", "/api/auth/yo", { cookie: otra })).estado, 401, "la otra sesión se cortó");
  assert.equal((await ingresar(puerto, "rita@ejemplo.org", "clave-de-rita-4444")).estado, 401, "la contraseña vieja ya no sirve");
  assert.equal((await ingresar(puerto, "rita@ejemplo.org", "clave-nueva-larga-5")).estado, 200);
});
t("la API manda las cabeceras de seguridad de helmet", async () => {
  const r = await pedir(principal.puerto, "GET", "/api/auth/yo");
  assert.equal(r.cabeceras["x-content-type-options"], "nosniff");
  assert.ok(r.cabeceras["content-security-policy"]);
  assert.equal(r.cabeceras["x-powered-by"], undefined);
});

let fallo: unknown;
try {
  for (const [name, fn] of pruebas) {
    await fn();
    ok++;
    console.log("ok", name);
  }
} catch (e) {
  fallo = e;
} finally {
  for (const s of [principal, conLimite, seguro, roles]) {
    s.server.closeAllConnections();
    s.server.close();
  }
}
if (fallo) {
  console.error("FALLÓ:", fallo);
  process.exit(1);
}
console.log(`\n${ok} pruebas de autenticación ok`);
