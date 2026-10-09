// Carga las secciones de la revista. Es idempotente: hace upsert por slug, así que no duplica
// ni cambia el id de las secciones que ya existen.
//
// Uso: npm run db:sembrar
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { crearClientePrisma } from "../src/db.js";
import { SECCIONES } from "../src/secciones.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

if (!process.env["DATABASE_URL"]) {
  console.error("FALLÓ: falta DATABASE_URL en el .env");
  process.exit(1);
}

const prisma = crearClientePrisma();

try {
  for (const { slug, nombre, interna } of SECCIONES) {
    await prisma.seccion.upsert({
      where: { slug },
      update: { nombre, interna },
      create: { slug, nombre, interna },
    });
  }
  const total = await prisma.seccion.count();
  const internas = await prisma.seccion.count({ where: { interna: true } });
  console.log(`Secciones en la base: ${total} (internas: ${internas})`);
} catch (error) {
  console.error("FALLÓ:", error instanceof Error ? error.message.replace(/(mysql|mariadb):\/\/\S+/g, "$1://[TACHADO]") : "error desconocido");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
