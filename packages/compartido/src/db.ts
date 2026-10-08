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
