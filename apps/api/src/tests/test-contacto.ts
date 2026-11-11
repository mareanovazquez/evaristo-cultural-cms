// Pruebas del formulario de contacto (POST /api/contacto, src/contacto.ts) y de su validación (@evaristo/compartido/contacto), sin base
// de datos ni servidor de correo: el envío es una función de prueba que guarda lo que recibe (o falla a pedido).
// Levanta servidores HTTP efímeros en 127.0.0.1 con puerto asignado por el sistema y los cierra al terminar.
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CONTACTO_LIMITES, errorDeCampo, esEstadoContacto, validarContacto, type DatosContacto } from "@evaristo/compartido/contacto";
import { crearApp } from "../app.js";
import nodemailer from "nodemailer";
import { armarCorreoContacto, crearEnvioSmtp, envioDesdeEntorno, type OpcionesContacto } from "../contacto.js";

let ok = 0;
const pruebas: Array<[string, () => Promise<void> | void]> = [];
const t = (nombre: string, fn: () => Promise<void> | void) => pruebas.push([nombre, fn]);

// ---------- Servidores ----------
const enviados: DatosContacto[] = [];
let fallarEnvio = false;
const enviar = async (datos: DatosContacto) => {
  if (fallarEnvio) throw new Error("el SMTP no respondió");
  enviados.push(datos);
};
// Fake de Prisma: el contacto no usa la base; las demás rutas no se tocan.
const sinPrisma = {} as never;
const servidores: Server[] = [];
async function levantar(contacto: OpcionesContacto): Promise<number> {
  const server = await new Promise<Server>((listo) => {
    const s = crearApp(sinPrisma, { contacto }).listen(0, "127.0.0.1", () => listo(s));
  });
  servidores.push(server);
  return (server.address() as AddressInfo).port;
}
const principal = await levantar({ enviar, limite: { ventanaMs: 60_000, max: 1000 } });
const conLimite = await levantar({ enviar, limite: { ventanaMs: 60_000, max: 2 } });
const sinEnvio = await levantar({ enviar: undefined });

interface Respuesta {
  estado: number;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo: string;
}
function pedir(puerto: number, metodo: string, ruta: string, cuerpo?: string, cabeceras: Record<string, string> = {}): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: cabeceras }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p: Buffer) => partes.push(p));
      res.on("end", () => resolver({ estado: res.statusCode ?? 0, cabeceras: res.headers, cuerpo: Buffer.concat(partes).toString("utf8") }));
    });
    req.on("error", rechazar);
    if (cuerpo !== undefined) req.write(cuerpo);
    req.end();
  });
}
const BIEN = { nombre: "  Roxana  ", correo: "roxana@ejemplo.com", mensaje: "Hola, quería consultar por una colaboración.", sitio: "" };
const json = (puerto: number, datos: object, cabeceras: Record<string, string> = {}) =>
  pedir(puerto, "POST", "/api/contacto", JSON.stringify(datos), { "Content-Type": "application/json", ...cabeceras });
const formulario = (puerto: number, datos: Record<string, string>, cabeceras: Record<string, string> = {}) =>
  pedir(puerto, "POST", "/api/contacto", new URLSearchParams(datos).toString(), { "Content-Type": "application/x-www-form-urlencoded", ...cabeceras });

// ---------- Validación (compartida con la página) ----------
t("validarContacto: datos bien, sin los espacios de los extremos", () => {
  const r = validarContacto(BIEN);
  assert.ok(r.ok);
  assert.deepEqual(r.datos, { nombre: "Roxana", correo: "roxana@ejemplo.com", mensaje: "Hola, quería consultar por una colaboración." });
});
t("validarContacto: vacíos, espacios y lo que no es texto cuentan como faltantes", () => {
  const r = validarContacto({ nombre: "   ", correo: 42, mensaje: null });
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errores).sort(), ["correo", "mensaje", "nombre"]);
});
t("errorDeCampo: correos", () => {
  for (const malo of ["roxana", "roxana@", "@ejemplo.com", "roxana@ejemplo", "rox ana@ejemplo.com", "roxana@ejemplo.c", "a@b.com\nBcc: otro@x.com"]) assert.ok(errorDeCampo("correo", malo), malo);
  for (const bueno of ["roxana@ejemplo.com", "r.artal+revista@evaristo.com.ar", "  roxana@ejemplo.com  "]) assert.equal(errorDeCampo("correo", bueno), undefined, bueno);
  assert.ok(errorDeCampo("correo", `${"a".repeat(250)}@b.com`), "más de 254");
});
t("errorDeCampo: largos del nombre y del mensaje", () => {
  assert.equal(errorDeCampo("nombre", "a".repeat(CONTACTO_LIMITES.nombre)), undefined);
  assert.ok(errorDeCampo("nombre", "a".repeat(CONTACTO_LIMITES.nombre + 1)));
  assert.ok(errorDeCampo("mensaje", "a".repeat(CONTACTO_LIMITES.mensajeMinimo - 1)));
  assert.equal(errorDeCampo("mensaje", "a".repeat(CONTACTO_LIMITES.mensajeMinimo)), undefined);
  assert.equal(errorDeCampo("mensaje", "a".repeat(CONTACTO_LIMITES.mensaje)), undefined);
  assert.match(errorDeCampo("mensaje", "a".repeat(CONTACTO_LIMITES.mensaje + 1))!, /tiene 5001/);
});
t("esEstadoContacto: solo los cuatro estados", () => {
  for (const e of ["enviado", "datos", "limite", "error"]) assert.ok(esEstadoContacto(e));
  for (const e of [null, "", "toString", "__proto__", "<script>"]) assert.ok(!esEstadoContacto(e));
});

// ---------- La ruta, con JavaScript (JSON) ----------
t("JSON bien: 200 y se manda una vez, con los datos limpios", async () => {
  enviados.length = 0;
  const r = await json(principal, BIEN);
  assert.equal(r.estado, 200);
  assert.deepEqual(JSON.parse(r.cuerpo), { estado: "ok" });
  assert.deepEqual(enviados, [{ nombre: "Roxana", correo: "roxana@ejemplo.com", mensaje: BIEN.mensaje }]);
});
t("JSON con datos mal: 400 con el error de cada campo y no se manda nada", async () => {
  enviados.length = 0;
  const r = await json(principal, { nombre: "", correo: "roxana@", mensaje: "corto" });
  assert.equal(r.estado, 400);
  const c = JSON.parse(r.cuerpo);
  assert.equal(c.motivo, "datos");
  assert.deepEqual(Object.keys(c.errores).sort(), ["correo", "mensaje", "nombre"]);
  assert.equal(enviados.length, 0);
});
t("JSON con la trampa llena: 200 como si se mandara, pero no se manda", async () => {
  enviados.length = 0;
  const r = await json(principal, { ...BIEN, sitio: "http://spam.example" });
  assert.equal(r.estado, 200);
  assert.equal(enviados.length, 0);
});
t("Falla el envío: 502 con motivo error", async () => {
  fallarEnvio = true;
  try {
    const r = await json(principal, BIEN);
    assert.equal(r.estado, 502);
    assert.equal(JSON.parse(r.cuerpo).motivo, "error");
  } finally {
    fallarEnvio = false;
  }
});
t("Sin envío configurado: 503 con motivo error", async () => {
  const r = await json(sinEnvio, BIEN);
  assert.equal(r.estado, 503);
  assert.equal(JSON.parse(r.cuerpo).motivo, "error");
});

// ---------- La ruta, sin JavaScript (formulario común) ----------
t("Formulario bien: 303 a /contacto/?estado=enviado", async () => {
  enviados.length = 0;
  const r = await formulario(principal, BIEN);
  assert.equal(r.estado, 303);
  assert.equal(r.cabeceras["location"], "/contacto/?estado=enviado");
  assert.equal(enviados.length, 1);
});
t("Formulario con datos mal: 303 a ?estado=datos", async () => {
  const r = await formulario(principal, { nombre: "Roxana", correo: "no", mensaje: "Un mensaje de prueba." });
  assert.equal(r.estado, 303);
  assert.equal(r.cabeceras["location"], "/contacto/?estado=datos");
});
t("Formulario sin envío configurado: 303 a ?estado=error", async () => {
  const r = await formulario(sinEnvio, BIEN);
  assert.equal(r.cabeceras["location"], "/contacto/?estado=error");
});

// ---------- Origen ----------
t("Pedido desde otro sitio (Origin ajeno): 403 y no se manda", async () => {
  enviados.length = 0;
  const r = await json(principal, BIEN, { Origin: "https://otro-sitio.example" });
  assert.equal(r.estado, 403);
  assert.equal(enviados.length, 0);
});
t("Pedido con Sec-Fetch-Site: cross-site: 403", async () => {
  const r = await formulario(principal, BIEN, { "Sec-Fetch-Site": "cross-site" });
  assert.equal(r.estado, 403);
});
t("Pedido desde el propio sitio (Origin igual al Host): pasa", async () => {
  const r = await json(principal, BIEN, { Origin: `http://127.0.0.1:${principal}`, "Sec-Fetch-Site": "same-origin" });
  assert.equal(r.estado, 200);
});

// ---------- Límite por dirección ----------
t("Límite: los datos mal no gastan el cupo; el tercer mensaje enviado en la ventana es 429", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await json(conLimite, { ...BIEN, correo: "mal" })).estado, 400);
  assert.equal((await json(conLimite, BIEN)).estado, 200);
  assert.equal((await json(conLimite, BIEN)).estado, 200);
  const r = await json(conLimite, BIEN);
  assert.equal(r.estado, 429);
  assert.equal(JSON.parse(r.cuerpo).motivo, "limite");
  const f = await formulario(conLimite, BIEN);
  assert.equal(f.cabeceras["location"], "/contacto/?estado=limite");
});

// ---------- Otros ----------
t("GET /api/contacto: 404 en JSON (solo acepta POST)", async () => {
  const r = await pedir(principal, "GET", "/api/contacto");
  assert.equal(r.estado, 404);
});
t("Cuerpo de formulario de más de 100 KB: se rechaza", async () => {
  const r = await formulario(principal, { ...BIEN, mensaje: "a".repeat(120_000) });
  assert.equal(r.estado, 413);
});

// ---------- El correo ----------
t("armarCorreoContacto: Reply-To a quien escribió y el nombre en una sola línea", () => {
  const c = armarCorreoContacto(
    { nombre: "Roxana\r\nBcc: otro@x.com", correo: "roxana@ejemplo.com", mensaje: "Hola.\nSegundo renglón." },
    { destino: "revista@evaristo.example", remitente: "web@evaristo.example" },
    new Date("2026-11-11T18:30:00Z"),
  );
  assert.equal(c.to, "revista@evaristo.example");
  assert.equal(c.from, "web@evaristo.example");
  assert.deepEqual(c.replyTo, { name: "Roxana Bcc: otro@x.com", address: "roxana@ejemplo.com" });
  assert.ok(!/[\r\n]/.test(c.subject));
  assert.equal(c.subject, "Contacto desde la revista: Roxana Bcc: otro@x.com");
  assert.ok(c.text.startsWith("Hola.\nSegundo renglón.\n"));
  assert.match(c.text, /el 11 de noviembre de 2026 a las 15:30\.\n/);
});
t("envioDesdeEntorno: sin SMTP_HOST, en producción no hay envío; en desarrollo, la consola", () => {
  assert.equal(envioDesdeEntorno({ NODE_ENV: "production" }), undefined);
  assert.equal(typeof envioDesdeEntorno({}), "function");
});
t("envioDesdeEntorno: con SMTP_HOST arma el envío (sin conectarse todavía)", () => {
  const smtp = { SMTP_HOST: "smtp.ejemplo.com", SMTP_USUARIO: "web@ejemplo.com", SMTP_CLAVE: "x", CONTACTO_DESTINO: "revista@ejemplo.com", CORREO_REMITENTE: "web@ejemplo.com" };
  assert.equal(typeof envioDesdeEntorno({ ...smtp, NODE_ENV: "production" }), "function");
  assert.equal(typeof envioDesdeEntorno({ ...smtp, SMTP_PUERTO: "587" }), "function");
});
t("envioDesdeEntorno: una configuración incompleta o mal escrita corta el arranque", () => {
  const smtp = { SMTP_HOST: "smtp.ejemplo.com", CONTACTO_DESTINO: "revista@ejemplo.com", CORREO_REMITENTE: "web@ejemplo.com" };
  assert.throws(() => envioDesdeEntorno({ ...smtp, CONTACTO_DESTINO: "" }), /CONTACTO_DESTINO/);
  assert.throws(() => envioDesdeEntorno({ ...smtp, CORREO_REMITENTE: " " }), /CORREO_REMITENTE/);
  assert.throws(() => envioDesdeEntorno({ ...smtp, SMTP_PUERTO: "abc" }), /SMTP_PUERTO/);
  assert.throws(() => envioDesdeEntorno({ ...smtp, SMTP_SEGURO: "si" }), /SMTP_SEGURO/);
  assert.throws(() => envioDesdeEntorno({ ...smtp, SMTP_USUARIO: "web@ejemplo.com" }), /SMTP_USUARIO y SMTP_CLAVE/);
});
t("crearEnvioSmtp: el correo que arma nodemailer (sin mandarlo) lleva los encabezados bien y el nombre no cuela encabezados", async () => {
  const transporte = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  let crudo = "";
  const envio = crearEnvioSmtp(
    { destino: "revista@evaristo.example", remitente: "Evaristo Cultural <web@evaristo.example>" },
    { sendMail: async (m) => (crudo = String(((await transporte.sendMail(m)) as { message: Buffer }).message)) },
    () => new Date("2026-11-11T18:30:00Z"),
  );
  await envio({ nombre: "José Pérez\r\nBcc: espia@x.com", correo: "jose@ejemplo.com", mensaje: "Hola, ¿cómo están?\nSaludos." });
  const [plegados = "", cuerpo = ""] = crudo.split("\n\n");
  // Los encabezados largos van partidos en varios renglones (los que siguen empiezan con espacio): se unen para revisarlos.
  const encabezados = plegados.replace(/\n[ \t]+/g, " ");
  assert.match(encabezados, /^To: revista@evaristo\.example$/m);
  assert.match(encabezados, /^From: Evaristo Cultural <web@evaristo\.example>$/m);
  assert.match(encabezados, /^Reply-To: .+ <jose@ejemplo\.com>$/m);
  assert.match(encabezados, /^Subject: =\?UTF-8\?/m, "el asunto con tildes va codificado");
  assert.doesNotMatch(encabezados, /^Bcc:/im);
  assert.match(cuerpo, /Hola, =C2=BFc=C3=B3mo est=C3=A1n\?|Hola, ¿cómo están\?/);
});

// ---------- Correr ----------
try {
  for (const [nombre, fn] of pruebas) {
    try {
      await fn();
      ok++;
      console.log(`  ok   ${nombre}`);
    } catch (e) {
      console.error(`  MAL  ${nombre}\n${e instanceof Error ? e.stack : String(e)}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${ok} de ${pruebas.length} pruebas bien.`);
} finally {
  for (const s of servidores) {
    s.close();
    s.closeAllConnections();
  }
}
