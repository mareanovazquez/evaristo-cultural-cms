// Verifica que la base actual, sus tablas y sus columnas de texto usen la
// intercalación del proyecto. Sale con código 1 si algo difiere.
//
// Uso: npm run db:verificar
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const ESPERADA = "utf8mb4_es_0900_ai_ci";
// Tabla que crea Prisma por su cuenta: se informa, pero no se exige.
const TABLA_PRISMA = "_prisma_migrations";

const urlBase = process.env["DATABASE_URL"];
if (!urlBase) {
  console.error("FALLÓ: falta DATABASE_URL en el .env");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(urlBase) });
const diferencias: string[] = [];

try {
  const [base] = await prisma.$queryRaw<{ nombre: string; intercalacion: string }[]>`
    SELECT SCHEMA_NAME AS nombre, DEFAULT_COLLATION_NAME AS intercalacion
    FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()`;
  console.log(`Base ${base?.nombre}: ${base?.intercalacion}`);
  if (base?.intercalacion !== ESPERADA) diferencias.push(`base ${base?.nombre}: ${base?.intercalacion}`);

  const tablas = await prisma.$queryRaw<{ tabla: string; intercalacion: string | null }[]>`
    SELECT TABLE_NAME AS tabla, TABLE_COLLATION AS intercalacion
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`;
  const columnas = await prisma.$queryRaw<{ tabla: string; columna: string; intercalacion: string }[]>`
    SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLLATION_NAME AS intercalacion
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL ORDER BY TABLE_NAME, ORDINAL_POSITION`;

  const esPrisma = (t: string) => t.toLowerCase() === TABLA_PRISMA;

  for (const t of tablas) {
    if (esPrisma(t.tabla)) {
      console.log(`Tabla ${t.tabla} (informativo, no se exige): ${t.intercalacion}`);
    } else if (t.intercalacion !== ESPERADA) {
      diferencias.push(`tabla ${t.tabla}: ${t.intercalacion}`);
    }
  }
  for (const c of columnas) {
    if (esPrisma(c.tabla)) {
      console.log(`Columna ${c.tabla}.${c.columna} (informativo, no se exige): ${c.intercalacion}`);
    } else if (c.intercalacion !== ESPERADA) {
      diferencias.push(`columna ${c.tabla}.${c.columna}: ${c.intercalacion}`);
    }
  }

  const propias = tablas.filter((t) => !esPrisma(t.tabla)).length;
  if (diferencias.length > 0) {
    console.error(`\nFALLÓ: hay elementos con una intercalación distinta de ${ESPERADA}:`);
    for (const d of diferencias) console.error(`  - ${d}`);
    process.exitCode = 1;
  } else {
    console.log(`\nOK: la base, ${propias} tabla(s) y sus columnas de texto usan ${ESPERADA}`);
  }
} catch (error) {
  console.error("FALLÓ:", error instanceof Error ? error.message.replace(/(mysql|mariadb):\/\/\S+/g, "$1://[TACHADO]") : "error desconocido");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
