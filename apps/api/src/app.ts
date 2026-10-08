import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { obtenerClientePrisma, type PrismaClient } from "@evaristo/compartido/db";

// Salida de `npm run build:sitio` (adaptador de Node de Astro, modo middleware).
const dirSitioCompilado = fileURLToPath(new URL("../../sitio/dist/", import.meta.url));
const dirCliente = `${dirSitioCompilado}client/`;
const entradaServidor = `${dirSitioCompilado}server/entry.mjs`;

type ManejadorAstro = (req: Request, res: Response, next: NextFunction) => void;

export function crearApp(prisma: PrismaClient = obtenerClientePrisma()): express.Express {
  const app = express();

  // Se carga una sola vez, la primera vez que hace falta y existe el build.
  let manejadorAstro: ManejadorAstro | undefined;
  async function cargarManejadorAstro(): Promise<ManejadorAstro | undefined> {
    if (manejadorAstro) return manejadorAstro;
    if (!existsSync(entradaServidor)) return undefined;
    const modulo = (await import(pathToFileURL(entradaServidor).href)) as { handler: ManejadorAstro };
    manejadorAstro = modulo.handler;
    return manejadorAstro;
  }

  // (1) No anunciar el framework.
  app.use((_req, res, next) => {
    res.removeHeader("X-Powered-By");
    next();
  });

  // (2) API.
  app.get("/api/salud", async (_req, res) => {
    try {
      const filas = await prisma.pruebaConexion.count();
      res.json({ estado: "ok", filas });
    } catch {
      res.status(503).json({ estado: "error" });
    }
  });

  // (3) Cualquier otra ruta bajo /api: 404 en JSON.
  app.use("/api", (_req, res) => {
    res.status(404).json({ estado: "error", mensaje: "No encontrado" });
  });

  // (4) Archivos estáticos del cliente de Astro y, para todo lo demás, el SSR de Astro.
  app.use(express.static(dirCliente));
  const ssr: RequestHandler = async (req, res, next) => {
    const manejador = await cargarManejadorAstro();
    if (!manejador) {
      res
        .status(503)
        .type("text/plain; charset=utf-8")
        .send("Falta compilar el sitio: corré npm run build:sitio");
      return;
    }
    manejador(req, res, next);
  };
  app.use(ssr);

  // Errores no previstos: sin detalles hacia afuera.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    console.error("Error no controlado:", error instanceof Error ? error.message : "error desconocido");
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ estado: "error" });
  });

  return app;
}
