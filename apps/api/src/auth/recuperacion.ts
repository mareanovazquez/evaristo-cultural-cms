import { correoDesdeEntorno, unaLinea, type TransporteCorreo } from "../correo.js";

// Recuperación de contraseña del panel (11/11/2026). Las rutas están en rutas.ts (POST /api/auth/recuperar, /restablecer y
// /restablecer/verificar); acá, el correo con el enlace y cómo se manda según el entorno.
//  - El enlace lleva un código aleatorio de 256 bits después de un «#» (/admin/restablecer#<código>): lo que va después del «#» el
//    navegador no lo manda al servidor, así que no queda en registros ni en el Referer. En la base se guarda solo su SHA-256.
//  - Vale DURACION_RECUPERACION_MS y una sola vez. Pedir otro dentro de ESPERA_ENTRE_PEDIDOS_MS no manda un correo nuevo.

export const DURACION_RECUPERACION_MS = 60 * 60 * 1000;
export const ESPERA_ENTRE_PEDIDOS_MS = 60 * 1000;

export interface DestinatarioRecuperacion {
  email: string;
  nombre: string;
}
export type EnviarRecuperacion = (destinatario: DestinatarioRecuperacion, enlace: string) => Promise<void>;

/** El correo con el enlace. */
export function armarCorreoRecuperacion(destinatario: DestinatarioRecuperacion, enlace: string, remitente: string) {
  const minutos = Math.round(DURACION_RECUPERACION_MS / 60_000);
  return {
    from: remitente,
    to: destinatario.email,
    subject: "Elegí una contraseña nueva para el panel de Evaristo Cultural",
    text: [
      `Hola, ${unaLinea(destinatario.nombre)}:`,
      "",
      "Pediste elegir una contraseña nueva para el panel de Evaristo Cultural. Para hacerlo, abrí este enlace:",
      "",
      enlace,
      "",
      `Vale ${minutos === 60 ? "una hora" : `${minutos} minutos`} y sirve una sola vez. Al cambiar la contraseña se cierran las sesiones abiertas en otras computadoras.`,
      "",
      "Si no lo pediste vos, ignorá este correo: tu contraseña no cambia.",
    ].join("\n"),
  };
}

/** El envío por SMTP. */
export function crearEnvioRecuperacion(remitente: string, transporte: TransporteCorreo): EnviarRecuperacion {
  return async (destinatario, enlace) => {
    await transporte.sendMail(armarCorreoRecuperacion(destinatario, enlace, remitente));
  };
}

// Solo en desarrollo: el enlace se anota en la consola del servidor, para probar la recuperación sin servidor de correo.
const anotarEnConsola: EnviarRecuperacion = async (destinatario, enlace) => {
  console.log(`[recuperación] Desarrollo: no se manda ningún correo. Enlace para ${destinatario.email}: ${enlace}`);
};

/** Con SMTP (correo.ts), por correo. Sin SMTP_HOST: en desarrollo, a la consola; en producción, ninguno (la ruta responde 503). */
export function recuperacionDesdeEntorno(entorno: NodeJS.ProcessEnv = process.env): EnviarRecuperacion | undefined {
  const correo = correoDesdeEntorno(entorno);
  if (correo) return crearEnvioRecuperacion(correo.remitente, correo.transporte);
  return entorno["NODE_ENV"] === "production" ? undefined : anotarEnConsola;
}
