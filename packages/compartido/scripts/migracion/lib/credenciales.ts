// Usuario y clave de una URL de conexión de MySQL: módulo PURO, sin imports. El host, el puerto y la base de una URL nunca se usan para conectar:
// salen de las constantes de destinos.ts. Los mensajes de error nombran la variable, nunca su valor ni la clave.

export interface Credenciales { user: string; password: string }

export class ErrorDeCredenciales extends Error {}

/**
 * Toma SOLO el usuario y la clave de `texto` (el valor de la variable de entorno `variable`). Falla si falta, si no es una URL mysql:// bien
 * formada o si no trae usuario (ni clave, salvo con exigirClave = false). No hay valores por defecto ni respaldo a otra variable.
 */
export function credencialesDeUrl(texto: string | undefined, variable: string, exigirClave = true): Credenciales {
  if (!texto) throw new ErrorDeCredenciales(`Falta ${variable} en el entorno (de ahí se toman el usuario y la clave)`);
  let u: URL;
  try { u = new URL(texto); } catch { throw new ErrorDeCredenciales(`${variable} no es una URL válida (se espera mysql://usuario:clave@host:puerto/base)`); }
  if (u.protocol !== "mysql:") throw new ErrorDeCredenciales(`${variable} no es una URL mysql://`);
  if (!u.username) throw new ErrorDeCredenciales(`${variable} no trae un usuario de MySQL`);
  const password = decodeURIComponent(u.password);
  if (exigirClave && !password) throw new ErrorDeCredenciales(`${variable} no trae la clave del usuario`);
  return { user: decodeURIComponent(u.username), password };
}
