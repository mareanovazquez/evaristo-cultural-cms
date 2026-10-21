import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { crearApp } from "./app.js";
import { elegirBase } from "./entorno.js";

const puerto = Number(process.env["PORT"] ?? 3000);

// --base-dev usa evaristo_cms_dev (desarrollo de la fase 4). Tiene que ir antes de crear el cliente de Prisma.
elegirBase();
const prisma = obtenerClientePrisma();
const app = crearApp(prisma);
const servidor = app.listen(puerto, "127.0.0.1", () => {
  console.log(`Servidor escuchando en http://127.0.0.1:${puerto}`);
});

let cerrando = false;
function apagar(senal: string): void {
  if (cerrando) return;
  cerrando = true;
  console.log(`Recibida ${senal}: cerrando`);
  servidor.close(() => {
    prisma
      .$disconnect()
      .catch(() => console.error("No se pudo desconectar Prisma"))
      .finally(() => process.exit(0));
  });
  servidor.closeIdleConnections();
}
process.on("SIGINT", () => apagar("SIGINT"));
process.on("SIGTERM", () => apagar("SIGTERM"));
