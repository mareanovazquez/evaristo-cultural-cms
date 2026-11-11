// Formulario de contacto del sitio (decisión 90: un formulario en lugar de una página con datos). Límites, validación y avisos compartidos
// por el sitio (que avisa al salir de cada campo) y la API (que valida de nuevo antes de mandar el correo). Funciones puras.

export const CONTACTO_LIMITES = {
  nombre: 120,
  /** El largo máximo de una dirección de correo (RFC 5321). */
  correo: 254,
  mensajeMinimo: 10,
  mensaje: 5000,
} as const;

export const CAMPOS_CONTACTO = ["nombre", "correo", "mensaje"] as const;
export type CampoContacto = (typeof CAMPOS_CONTACTO)[number];
export type DatosContacto = Record<CampoContacto, string>;

// Lo justo para atrapar errores de tipeo; la prueba de verdad es que la respuesta llegue.
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

/** El mensaje de error de un campo, o undefined si está bien. Los espacios de los extremos no cuentan. */
export function errorDeCampo(campo: CampoContacto, valor: string): string | undefined {
  const v = valor.trim();
  switch (campo) {
    case "nombre":
      if (!v) return "Escribí tu nombre.";
      if (v.length > CONTACTO_LIMITES.nombre) return `El nombre puede tener hasta ${CONTACTO_LIMITES.nombre} caracteres.`;
      return undefined;
    case "correo":
      if (!v) return "Escribí tu correo, así podemos responderte.";
      if (v.length > CONTACTO_LIMITES.correo || !FORMA_CORREO.test(v)) return "Revisá el correo: tiene que tener la forma nombre@ejemplo.com.";
      return undefined;
    case "mensaje":
      if (!v) return "Escribí tu mensaje.";
      if (v.length < CONTACTO_LIMITES.mensajeMinimo) return `El mensaje es muy corto: escribí al menos ${CONTACTO_LIMITES.mensajeMinimo} caracteres.`;
      if (v.length > CONTACTO_LIMITES.mensaje) return `El mensaje puede tener hasta ${CONTACTO_LIMITES.mensaje} caracteres (tiene ${v.length}).`;
      return undefined;
  }
}

export type ResultadoContacto = { ok: true; datos: DatosContacto } | { ok: false; errores: Partial<Record<CampoContacto, string>> };

/** Valida los tres campos. Lo que no sea texto cuenta como vacío. Devuelve los datos sin los espacios de los extremos. */
export function validarContacto(entrada: Partial<Record<CampoContacto, unknown>>): ResultadoContacto {
  const errores: Partial<Record<CampoContacto, string>> = {};
  const datos = {} as DatosContacto;
  for (const campo of CAMPOS_CONTACTO) {
    const valor = typeof entrada[campo] === "string" ? entrada[campo] : "";
    const error = errorDeCampo(campo, valor);
    if (error) errores[campo] = error;
    datos[campo] = valor.trim();
  }
  return Object.keys(errores).length > 0 ? { ok: false, errores } : { ok: true, datos };
}

/**
 * Resultado de un envío. Con JavaScript, la página lo muestra según la respuesta de la API; sin JavaScript, la API vuelve a
 * /contacto/?estado=<clave>.
 */
export const AVISOS_CONTACTO = {
  enviado: { tipo: "exito", titulo: "Mensaje enviado", texto: "Gracias por escribirnos. Te vamos a responder al correo que dejaste." },
  datos: { tipo: "peligro", titulo: "Faltan datos", texto: "Revisá que estén tu nombre, un correo válido y el mensaje." },
  limite: { tipo: "peligro", titulo: "Demasiados mensajes seguidos", texto: "Esperá un rato y probá de nuevo." },
  error: { tipo: "peligro", titulo: "No pudimos enviar el mensaje", texto: "Probá de nuevo más tarde." },
} as const satisfies Record<string, { tipo: "exito" | "peligro"; titulo: string; texto: string }>;
export type EstadoContacto = keyof typeof AVISOS_CONTACTO;

export const esEstadoContacto = (valor: string | null): valor is EstadoContacto => valor !== null && Object.hasOwn(AVISOS_CONTACTO, valor);
