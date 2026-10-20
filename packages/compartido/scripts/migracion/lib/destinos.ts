// Destinos de la migración: módulo puro, sin imports, que comparten conexiones.ts, leer-wordpress.ts y escribir.ts (así no hay ciclo).
// Los destinos son constantes de este módulo y nada más: ningún flag ni variable de entorno construye uno (DATABASE_URL solo se COMPARA).
// La lectura y el CLI solo conocen DESTINO_REAL. DESTINO_PRUEBAS lo usan únicamente los tests, a través de escribir.ts.

export const DESTINO_REAL = Object.freeze({ host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" });
export const DESTINO_PRUEBAS = Object.freeze({ host: "127.0.0.1", puerto: 3308, base: "evaristo_cms_test" });
/** Mientras sea false, abrir una conexión de escritura al destino real se niega siempre. Es una constante de código, no una opción. */
export const ESCRITURA_REAL_HABILITADA = false;

export interface DestinoUrl { host: string; puerto: number; base: string }

/**
 * Comprueba que una URL de conexión apunte exactamente a 127.0.0.1:3308/evaristo_cms, sin parámetros. Se niega ante cualquier otro destino
 * (localhost, ::1, el puerto 3306, evaristo_cms_test, evaristo_cms_shadow...). Lanza un Error; si todo coincide devuelve el destino.
 */
export function guardaDestino(url: string | undefined): DestinoUrl {
  const negar = (motivo: string): never => { throw new Error(`Destino no permitido (${motivo}): solo se acepta ${DESTINO_REAL.host}:${DESTINO_REAL.puerto}/${DESTINO_REAL.base}. La corrida se niega a seguir.`); };
  if (!url) return negar("falta DATABASE_URL");
  let u: URL;
  try { u = new URL(url); } catch { return negar("DATABASE_URL no es una URL válida"); }
  if (u.protocol !== "mysql:") negar(`protocolo ${u.protocol}`);
  if (u.hostname !== DESTINO_REAL.host) negar(`host ${u.hostname || "(vacío)"}`);
  if (u.port !== String(DESTINO_REAL.puerto)) negar(`puerto ${u.port || "(el predeterminado)"}`);
  if (u.pathname !== `/${DESTINO_REAL.base}`) negar(`base ${u.pathname.slice(1) || "(ninguna)"}`);
  if (u.search || u.hash) negar("la URL trae parámetros");
  return { host: u.hostname, puerto: Number(u.port), base: u.pathname.slice(1) };
}
