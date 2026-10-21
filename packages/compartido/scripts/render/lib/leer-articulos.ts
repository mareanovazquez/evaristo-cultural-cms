// Lectura de solo lectura de los artículos de evaristo_cms (puerto 3308) para las pruebas y la vista previa del renderizador.
// Solo SELECT, sobre una conexión única con la sesión en READ ONLY (se comprueba antes de leer).
// No trae visitasWp ni nada más que wpId, título, cuerpo y las medidas de la tabla imagenes.
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../../src/generated/prisma/client.js";
import type { JSONNode } from "../../../src/schema/validate.ts";

config({ path: fileURLToPath(new URL("../../../../../.env", import.meta.url)), quiet: true });

export interface ArticuloLeido {
  wpId: number;
  titulo: string;
  cuerpo: JSONNode;
}

export interface DatosLeidos {
  articulos: ArticuloLeido[];
  dimensiones: Map<number, { ancho: number; alto: number }>;
}

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

export async function leerArticulosYDimensiones(): Promise<DatosLeidos> {
  const texto = process.env["DATABASE_URL"];
  if (!texto) fallar("falta DATABASE_URL en el .env");
  const url = new URL(texto);
  const base = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.port !== "3308" || base !== "evaristo_cms") {
    fallar(`DATABASE_URL apunta a ${url.hostname}:${url.port}/${base}; esta lectura solo corre contra evaristo_cms en el 3308`);
  }

  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: base,
    connectionLimit: 1,
    initSql: "SET SESSION TRANSACTION READ ONLY",
    connectTimeout: 5000,
  });
  const prisma = new PrismaClient({ adapter });
  try {
    try {
      const sesion = await prisma.$queryRaw<Array<{ ro: number | bigint }>>`SELECT @@session.transaction_read_only AS ro`;
      if (Number(sesion[0]?.ro) !== 1) fallar("la sesión no quedó en READ ONLY; no se lee nada");
    } catch (e) {
      fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)}). Verificá con Test-NetConnection 127.0.0.1 -Port 3308`);
    }
    const filas = await prisma.$queryRaw<Array<{ wpId: number | bigint; titulo: string; cuerpo: unknown }>>`
      SELECT wpId, titulo, cuerpo FROM articulos WHERE wpId IS NOT NULL ORDER BY wpId`;
    const imagenes = await prisma.$queryRaw<Array<{ id: number | bigint; ancho: number | bigint; alto: number | bigint }>>`
      SELECT id, ancho, alto FROM imagenes`;
    return {
      articulos: filas.map((f) => ({
        wpId: Number(f.wpId),
        titulo: f.titulo,
        cuerpo: (typeof f.cuerpo === "string" ? JSON.parse(f.cuerpo) : f.cuerpo) as JSONNode,
      })),
      dimensiones: new Map(imagenes.map((i) => [Number(i.id), { ancho: Number(i.ancho), alto: Number(i.alto) }])),
    };
  } finally {
    await prisma.$disconnect();
  }
}
