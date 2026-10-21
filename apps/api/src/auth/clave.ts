import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Hash de contraseñas con scrypt de node:crypto (decisión del 21/10/2026: sin dependencias nuevas).
// Formato guardado en `usuarios.passwordHash`: scrypt$N$r$p$sal(base64)$hash(base64). Los parámetros viajan con el hash,
// así se pueden subir más adelante sin invalidar las contraseñas ya guardadas.

const PARAMETROS = { N: 2 ** 15, r: 8, p: 1 } as const;
const LARGO_HASH = 64;
const LARGO_SAL = 16;

export const CLAVE_MINIMA = 10;
export const CLAVE_MAXIMA = 200;

function derivar(clave: string, sal: Buffer, N: number, r: number, p: number, largo: number): Promise<Buffer> {
  // scrypt pide memoria 128 * N * r bytes; maxmem tiene que ser mayor.
  const opciones: ScryptOptions = { N, r, p, maxmem: 128 * N * r * 2 };
  return new Promise((resolver, rechazar) => {
    scrypt(clave.normalize("NFKC"), sal, largo, opciones, (error, clave_) => (error ? rechazar(error) : resolver(clave_)));
  });
}

/** Error de validación de una contraseña nueva, o undefined si sirve. */
export function problemaDeClave(clave: string): string | undefined {
  if (clave.length < CLAVE_MINIMA) return `La contraseña tiene que tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (clave.length > CLAVE_MAXIMA) return `La contraseña no puede tener más de ${CLAVE_MAXIMA} caracteres.`;
  return undefined;
}

export async function hashearClave(clave: string): Promise<string> {
  const sal = randomBytes(LARGO_SAL);
  const { N, r, p } = PARAMETROS;
  const hash = await derivar(clave, sal, N, r, p, LARGO_HASH);
  return `scrypt$${N}$${r}$${p}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

/** Compara en tiempo constante. Un formato inválido nunca coincide. */
export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, sal64, hash64] = partes as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((v) => Number.isInteger(v) && v > 0) || N > 2 ** 20 || R > 32 || P > 16) return false;
  const sal = Buffer.from(sal64, "base64");
  const esperado = Buffer.from(hash64, "base64");
  if (!sal.length || !esperado.length) return false;
  const obtenido = await derivar(clave, sal, N, R, P, esperado.length);
  return timingSafeEqual(obtenido, esperado);
}

// Un hash de mentira para gastar el mismo tiempo cuando el email no existe (no revela qué emails están dados de alta).
let falso: Promise<string> | undefined;
export const hashFalso = (): Promise<string> => (falso ??= hashearClave(randomBytes(12).toString("hex")));
