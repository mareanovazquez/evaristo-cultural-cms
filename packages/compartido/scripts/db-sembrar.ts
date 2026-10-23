// Carga inicial de las secciones de la revista. Es idempotente: crea las que faltan por slug y NO toca las que ya existen
// (desde el 23/10/2026 el administrador las renombra, ordena y borra desde el panel; la lista de src/secciones.ts es solo el punto
// de partida). Ojo: si el administrador borró una de la lista, volver a correrlo la crea de nuevo.
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
  for (const [indice, { slug, nombre, interna }] of SECCIONES.entries()) {
    await prisma.seccion.upsert({
      where: { slug },
      update: {},
      create: { slug, nombre, interna, orden: indice + 1 },
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
