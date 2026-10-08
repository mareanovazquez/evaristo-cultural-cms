// Crea una migración nueva (sin aplicarla) y le quita la intercalación fija que
// Prisma agrega a cada CREATE TABLE (utf8mb4_unicode_ci), para que las tablas
// hereden la de la base (utf8mb4_es_0900_ai_ci).
//
// Uso: npm run db:nueva -- <nombre_de_la_migracion>
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const carpetaMigraciones = join(raiz, "prisma", "migrations");

const nombre = process.argv[2];
if (!nombre || !/^[A-Za-z0-9_-]+$/.test(nombre)) {
  console.error("Uso: npm run db:nueva -- <nombre>  (solo letras, números, guiones y guiones bajos)");
  process.exit(1);
}

const listarMigraciones = (): string[] =>
  existsSync(carpetaMigraciones)
    ? readdirSync(carpetaMigraciones, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];

const antes = new Set(listarMigraciones());

// (1) Crear la migración sin aplicarla.
const cliPrisma = createRequire(import.meta.url).resolve("prisma/build/index.js");
const resultado = spawnSync(process.execPath, [cliPrisma, "migrate", "dev", "--create-only", "--name", nombre], {
  cwd: raiz,
  stdio: "inherit",
});
if (resultado.status !== 0) {
  console.error(`\n"prisma migrate dev --create-only" terminó con código ${resultado.status ?? "desconocido"}.`);
  process.exit(resultado.status ?? 1);
}

// (2) Localizar la carpeta recién creada (la más reciente por nombre).
const ultima = listarMigraciones().at(-1);
if (!ultima || antes.has(ultima)) {
  console.log("\nNo se creó ninguna migración nueva (¿no hay cambios en el esquema?). No hay nada que limpiar.");
  process.exit(0);
}
const archivoSql = join(carpetaMigraciones, ultima, "migration.sql");

// (3) Quitar la intercalación fija.
const original = readFileSync(archivoSql, "utf8");
const patron = /\s+DEFAULT\s+CHARACTER\s+SET\s+utf8mb4\s+COLLATE\s+utf8mb4_unicode_ci/gi;
const cantidad = original.match(patron)?.length ?? 0;
const limpio = original.replace(patron, "");
if (cantidad > 0) writeFileSync(archivoSql, limpio, "utf8");

// (4) Informar.
console.log(`\nMigración: prisma/migrations/${ultima}/migration.sql`);
console.log(
  cantidad > 0
    ? `Se quitó " DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" en ${cantidad} lugar(es).`
    : "No se encontró ninguna intercalación fija para quitar.",
);
const restantes = limpio
  .split(/\r?\n/)
  .map((linea, i) => ({ linea, numero: i + 1 }))
  .filter(({ linea }) => /COLLATE/i.test(linea));
if (restantes.length > 0) {
  console.warn("\nATENCIÓN: quedan líneas con COLLATE en el SQL. Revisalas a mano antes de aplicar la migración:");
  for (const { linea, numero } of restantes) console.warn(`  línea ${numero}: ${linea.trim()}`);
} else {
  console.log("El SQL resultante no contiene COLLATE.");
}
console.log("\nLa migración NO se aplicó. Para aplicarla: npm run db:deploy");
