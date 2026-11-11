// Conexiones a MySQL 8.4 que tienen que funcionar también después de un reinicio (decisión 91, amplía la 46).
//
// MySQL 8.4 autentica con caching_sha2_password. Después de reiniciar el servicio (o de un FLUSH PRIVILEGES), la caché de
// autenticación está fría y la primera conexión de cada usuario necesita la clave pública RSA del servidor para mandar la contraseña.
// Sin `allowPublicKeyRetrieval`, el driver falla con ER_CANNOT_RETRIEVE_RSA_KEY y Prisma no conecta (en el sitio: «pool timeout»)
// hasta que alguien entra a mano con la clave. En el servidor eso significa que el sitio no vuelve solo después de un reinicio.
//
// Pedirle la clave pública al servidor es seguro solo si el pedido no sale de la máquina: por la red, alguien en el medio podría
// mandar una clave suya y leer la contraseña. Por eso se activa únicamente con la base en el mismo equipo (127.0.0.1, localhost,
// ::1), que es el caso de la máquina de desarrollo y del VPS previsto. Con una base en otro servidor no se activa: ahí hace falta TLS.
// Funciones puras, sin dependencias: las usan db.ts y los scripts que arman su propia conexión.

const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Si el host es de la misma máquina. */
export function esHostLocal(host: string): boolean {
  return HOSTS_LOCALES.has(host.trim().toLowerCase());
}

/**
 * La URL de conexión con `allowPublicKeyRetrieval=true` si la base está en la misma máquina. Si la URL ya trae ese parámetro (por
 * ejemplo en false a propósito), se respeta. Una URL que no se puede leer se devuelve tal cual (el adaptador dará su propio error).
 */
export function urlDeConexion(texto: string): string {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return texto;
  }
  if (!esHostLocal(url.hostname) || url.searchParams.has("allowPublicKeyRetrieval")) return texto;
  url.searchParams.set("allowPublicKeyRetrieval", "true");
  return url.toString();
}
