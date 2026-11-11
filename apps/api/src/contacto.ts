import express, { type Request, type Response, type Router } from "express";
import { rateLimit } from "express-rate-limit";
import nodemailer from "nodemailer";
import { validarContacto, type DatosContacto, type EstadoContacto } from "@evaristo/compartido/contacto";
import { protegerOrigen } from "./auth/rutas.js";

// Formulario de contacto del sitio (decisión 90): POST /api/contacto. No usa la base: el mensaje se manda por correo a la editorial.
//  - Valida con validarContacto (@evaristo/compartido/contacto), la misma función que usa la página para avisar al salir de cada campo.
//  - Solo pedidos del propio sitio (protegerOrigen, como el panel).
//  - Límite por dirección: por defecto 5 mensajes por hora. Los pedidos con datos mal no cuentan.
//  - Trampa para robots: si viene el campo oculto «sitio» con algo, se contesta como si se hubiera mandado, sin mandar nada.
//  - Con JavaScript, la página manda JSON y recibe JSON (200 ok, 400 datos, 429 límite, 502/503 error). Sin JavaScript, manda el
//    formulario común y la respuesta es una redirección 303 a /contacto/?estado=enviado|datos|limite|error.
//  - El envío es una función que se pasa desde afuera (EnviarContacto). La de siempre sale de envioDesdeEntorno: por SMTP (nodemailer)
//    si el .env tiene SMTP_HOST; si no, en desarrollo se anota en la consola y en producción la ruta responde 503.

export type EnviarContacto = (datos: DatosContacto) => Promise<void>;

export interface OpcionesContacto {
  /** Cómo se manda el mensaje. Sin esto, la ruta responde 503: no hay envío de correo configurado. */
  enviar?: EnviarContacto | undefined;
  /** Mensajes por dirección en la ventana. Por defecto, 5 por hora. */
  limite?: { ventanaMs: number; max: number };
}

const CODIGO: Record<EstadoContacto, number> = { enviado: 200, datos: 400, limite: 429, error: 503 };

function responder(req: Request, res: Response, estado: EstadoContacto, extra: { codigo?: number; errores?: object } = {}): void {
  if (estado === "enviado") res.locals["contactoEnviado"] = true;
  if (req.is("application/json")) {
    res.status(extra.codigo ?? CODIGO[estado]).json(estado === "enviado" ? { estado: "ok" } : { estado: "error", motivo: estado, ...(extra.errores ? { errores: extra.errores } : {}) });
    return;
  }
  res.redirect(303, `/contacto/?estado=${estado}`);
}

export function crearRutasContacto({ enviar, limite = { ventanaMs: 60 * 60 * 1000, max: 5 } }: OpcionesContacto = {}): Router {
  const limitar = rateLimit({
    windowMs: limite.ventanaMs,
    limit: limite.max,
    // Solo cuentan los mensajes que salieron (o que la trampa dio por enviados): equivocarse en un campo no gasta el cupo.
    skipFailedRequests: true,
    requestWasSuccessful: (_req, res) => res.locals["contactoEnviado"] === true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req: Request, res: Response) => responder(req, res, "limite"),
  });

  const router = express.Router();
  router.post("/", protegerOrigen, express.urlencoded({ extended: false, limit: "100kb" }), limitar, async (req: Request, res: Response) => {
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    if (typeof cuerpo["sitio"] === "string" && cuerpo["sitio"].trim() !== "") {
      responder(req, res, "enviado");
      return;
    }
    const resultado = validarContacto(cuerpo);
    if (!resultado.ok) {
      responder(req, res, "datos", { errores: resultado.errores });
      return;
    }
    if (!enviar) {
      console.error("/api/contacto: no hay envío de correo configurado; el mensaje no se mandó.");
      responder(req, res, "error");
      return;
    }
    try {
      await enviar(resultado.datos);
    } catch (e) {
      console.error("/api/contacto: no se pudo mandar el mensaje.", e instanceof Error ? e.message : e);
      responder(req, res, "error", { codigo: 502 });
      return;
    }
    responder(req, res, "enviado");
  });
  return router;
}

// ---------------------------------------------------------------- el correo

export interface ConfigCorreoContacto {
  /** A quién le llega: el correo de la editorial. */
  destino: string;
  /** Quién lo manda: una dirección del dominio del sitio (el SMTP del hosting no deja mandar en nombre de otro). */
  remitente: string;
}

const unaLinea = (s: string): string => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

/**
 * El correo que recibe la editorial. «Responder» le contesta a quien escribió (Reply-To). Los saltos de línea del nombre se sacan
 * (van en encabezados). Lo usa el envío por SMTP.
 */
export function armarCorreoContacto(datos: DatosContacto, config: ConfigCorreoContacto, ahora: Date = new Date()) {
  const nombre = unaLinea(datos.nombre);
  const zona = "America/Argentina/Buenos_Aires";
  const fecha = `${ahora.toLocaleDateString("es-AR", { timeZone: zona, dateStyle: "long" })} a las ${ahora.toLocaleTimeString("es-AR", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  return {
    from: config.remitente,
    to: config.destino,
    replyTo: { name: nombre, address: datos.correo },
    subject: `Contacto desde la revista: ${nombre}`.slice(0, 150),
    text: [datos.mensaje, "", "—", `De: ${nombre} <${datos.correo}>`, `Llegó desde el formulario de contacto de Evaristo Cultural, el ${fecha}.`, `Para contestar, usá «Responder»: le llega a ${datos.correo}.`].join("\n"),
  };
}

// ---------------------------------------------------------------- el envío

/** Lo único que se usa de un transporte de nodemailer (así las pruebas pasan uno que no manda nada). */
export interface TransporteCorreo {
  sendMail(mensaje: ReturnType<typeof armarCorreoContacto>): Promise<unknown>;
}

/** El envío por SMTP: arma el correo y lo pasa al transporte. */
export function crearEnvioSmtp(config: ConfigCorreoContacto, transporte: TransporteCorreo, ahora: () => Date = () => new Date()): EnviarContacto {
  return async (datos) => {
    await transporte.sendMail(armarCorreoContacto(datos, config, ahora()));
  };
}

const anotarEnConsola: EnviarContacto = async (datos) => {
  console.log(`[contacto] Desarrollo: no se manda ningún correo. De ${unaLinea(datos.nombre)} <${datos.correo}>, ${datos.mensaje.length} caracteres.`);
};

/**
 * El envío que corresponde al entorno (variables del .env):
 *   SMTP_HOST, SMTP_PUERTO (465 por defecto), SMTP_SEGURO (TLS desde el principio; por defecto, sí con el 465), SMTP_USUARIO, SMTP_CLAVE:
 *     el servidor de correo del hosting. Con SMTP_HOST, se manda de verdad y hacen falta además:
 *   CONTACTO_DESTINO: a quién le llegan los mensajes (el correo de la editorial).
 *   CORREO_REMITENTE: quién los manda; una dirección del dominio del sitio (por ejemplo «Evaristo Cultural <web@…>»).
 * Sin SMTP_HOST: en desarrollo, el mensaje se anota en la consola; en producción no hay envío y la ruta responde 503.
 * Una configuración incompleta corta el arranque con un mensaje claro (mejor que descubrirlo cuando alguien escribe).
 */
export function envioDesdeEntorno(entorno: NodeJS.ProcessEnv = process.env): EnviarContacto | undefined {
  const host = entorno["SMTP_HOST"]?.trim();
  if (!host) return entorno["NODE_ENV"] === "production" ? undefined : anotarEnConsola;

  const destino = entorno["CONTACTO_DESTINO"]?.trim();
  const remitente = entorno["CORREO_REMITENTE"]?.trim();
  if (!destino || !remitente) throw new Error("Con SMTP_HOST hacen falta CONTACTO_DESTINO (a quién le llegan los mensajes) y CORREO_REMITENTE (quién los manda).");
  const puerto = Number(entorno["SMTP_PUERTO"]?.trim() || 465);
  if (!Number.isInteger(puerto) || puerto <= 0 || puerto > 65535) throw new Error(`SMTP_PUERTO no es un puerto válido: «${entorno["SMTP_PUERTO"]}».`);
  const seguroTexto = entorno["SMTP_SEGURO"]?.trim().toLowerCase();
  if (seguroTexto && seguroTexto !== "true" && seguroTexto !== "false") throw new Error("SMTP_SEGURO tiene que ser true o false.");
  const seguro = seguroTexto ? seguroTexto === "true" : puerto === 465;
  const usuario = entorno["SMTP_USUARIO"]?.trim();
  const clave = entorno["SMTP_CLAVE"];
  if (Boolean(usuario) !== Boolean(clave)) throw new Error("SMTP_USUARIO y SMTP_CLAVE van juntos (o ninguno de los dos).");

  const transporte = nodemailer.createTransport({
    host,
    port: puerto,
    secure: seguro,
    // Sin TLS desde el principio (587), igual se exige STARTTLS: la clave nunca viaja sin cifrar.
    requireTLS: !seguro,
    ...(usuario && clave ? { auth: { user: usuario, pass: clave } } : {}),
    // Que un SMTP caído no deje colgado el pedido de quien escribe.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return crearEnvioSmtp({ destino, remitente }, transporte);
}
