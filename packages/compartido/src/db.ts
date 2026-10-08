import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.js";

export { PrismaClient };
export type { PruebaConexion } from "./generated/prisma/client.js";

// Arma el cliente de Prisma con el adaptador de MariaDB/MySQL.
// Lee DATABASE_URL de process.env: quien lo llame tiene que haber cargado el .env antes
// (por ejemplo con `node --env-file`).
export function crearClientePrisma(): PrismaClient {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("Falta DATABASE_URL en el entorno");
  }
  return new PrismaClient({ adapter: new PrismaMariaDb(url) });
}

const claveClienteUnico = Symbol.for("evaristo.prisma");

// Devuelve siempre el mismo cliente dentro del proceso. Se guarda en globalThis a propósito:
// el build de Astro empaqueta su propia copia de este módulo, y con una variable de módulo
// común la API y el sitio terminarían con un cliente (y un pool de conexiones) cada uno.
export function obtenerClientePrisma(): PrismaClient {
  const global = globalThis as { [clave: symbol]: PrismaClient | undefined };
  return (global[claveClienteUnico] ??= crearClientePrisma());
}
