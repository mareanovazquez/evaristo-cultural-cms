import nodemailer from "nodemailer";

// Correo saliente del sitio (SMTP del hosting, con nodemailer): lo usan el formulario de contacto (contacto.ts) y la recuperación de
// contraseña del panel (auth/recuperacion.ts). La configuración sale del .env (README, «Variables de entorno»):
//   SMTP_HOST, SMTP_PUERTO (465 por defecto), SMTP_SEGURO (por defecto, sí con el 465), SMTP_USUARIO y SMTP_CLAVE (van juntos), y
//   CORREO_REMITENTE (quién manda los correos: una dirección del dominio del sitio).
// Una configuración incompleta corta el arranque con un mensaje claro.

/** Lo único que se usa de un transporte de nodemailer (así las pruebas pasan uno que no manda nada). */
export interface TransporteCorreo {
  sendMail(mensaje: { from: string; to: string; subject: string; text: string; replyTo?: { name: string; address: string } }): Promise<unknown>;
}

export interface Correo {
  transporte: TransporteCorreo;
  remitente: string;
}

/** El transporte SMTP según el .env, o undefined si no hay SMTP_HOST. */
export function correoDesdeEntorno(entorno: NodeJS.ProcessEnv = process.env): Correo | undefined {
  const host = entorno["SMTP_HOST"]?.trim();
  if (!host) return undefined;

  const remitente = entorno["CORREO_REMITENTE"]?.trim();
  if (!remitente) throw new Error("Con SMTP_HOST hace falta CORREO_REMITENTE (quién manda los correos del sitio).");
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
    // Que un SMTP caído no deje colgado el pedido.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return { transporte, remitente };
}

/** Un texto para un encabezado de correo: sin saltos de línea ni espacios de más. */
export const unaLinea = (s: string): string => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
