import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { crearClientePrisma } from "./db.js";

// El .env vive en la raíz del repo (../../../ respecto de este archivo).
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

if (!process.env["DATABASE_URL"]) {
  console.error("FALLÓ: falta DATABASE_URL en el .env");
  process.exit(1);
}

const prisma = crearClientePrisma();

const textoOriginal = "Ñandú, canción, “comillas” y ¿tildes?";
let filaId: number | undefined;
let codigoSalida = 0;

try {
  const creada = await prisma.pruebaConexion.create({ data: { mensaje: textoOriginal } });
  filaId = creada.id;

  const leida = await prisma.pruebaConexion.findUniqueOrThrow({ where: { id: filaId } });
  const identico = leida.mensaje === textoOriginal;
  console.log(identico ? "OK: el texto leído es idéntico al insertado" : "FALLÓ: el texto leído difiere del insertado");
  if (!identico) {
    console.log(`  insertado: ${textoOriginal}`);
    console.log(`  leído:     ${leida.mensaje}`);
    codigoSalida = 1;
  }

  const intercalacion = await prisma.$queryRaw<{ TABLE_COLLATION: string }[]>`
    SELECT TABLE_COLLATION FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PruebaConexion'`;
  console.log(`Intercalación de la tabla: ${intercalacion[0]?.TABLE_COLLATION ?? "(sin resultado)"}`);
} catch (error) {
  console.error("FALLÓ:", error instanceof Error ? error.message.replace(/(mysql|mariadb):\/\/\S+/g, "$1://[TACHADO]") : "error desconocido");
  codigoSalida = 1;
} finally {
  if (filaId !== undefined) {
    await prisma.pruebaConexion.delete({ where: { id: filaId } });
    console.log("Fila de prueba borrada");
  }
  await prisma.$disconnect();
}
process.exit(codigoSalida);
