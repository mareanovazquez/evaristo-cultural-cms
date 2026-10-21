import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { obtenerClientePrisma, type PrismaClient } from "@evaristo/compartido/db";
import { crearManejadorMedia } from "./media.js";

// Salida de `npm run build:sitio` (adaptador de Node de Astro, modo middleware).
const dirSitioCompilado = fileURLToPath(new URL("../../sitio/dist/", import.meta.url));
const dirCliente = `${dirSitioCompilado}client/`;
const entradaServidor = `${dirSitioCompilado}server/entry.mjs`;

// Salida de `npm run build:panel` (Vite). Se comprueba en cada pedido, así no hace falta reiniciar.
const dirPanelCompilado = fileURLToPath(new URL("../../panel/dist/", import.meta.url));
const indicePanel = `${dirPanelCompilado}index.html`;

type ManejadorAstro = (req: Request, res: Response, next: NextFunction) => void;

export interface OpcionesApp {
  /** Carpeta de los originales de las imágenes. Por defecto, la variable MEDIA_DIR. */
  dirMedia?: string | undefined;
}

export function crearApp(prisma: PrismaClient = obtenerClientePrisma(), opciones: OpcionesApp = {}): express.Express {
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

  // (2b) Cualquier otra ruta bajo /api: 404 en JSON.
  app.use("/api", (_req, res) => {
    res.status(404).json({ estado: "error", mensaje: "No encontrado" });
  });

  // (3) Panel de administración (React + Vite) en /admin. Va antes que Astro.
  const archivosPanel = express.static(dirPanelCompilado, { index: false, fallthrough: true });
  app.use("/admin", (req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    // /admin sin barra final redirige a /admin/ (conservando la consulta).
    const [ruta = "", consulta] = req.originalUrl.split("?");
    if (ruta === "/admin") {
      res.redirect(301, consulta === undefined ? "/admin/" : `/admin/?${consulta}`);
      return;
    }

    if (!existsSync(indicePanel)) {
      res
        .status(503)
        .type("text/plain; charset=utf-8")
        .send("Falta compilar el panel: corré npm run build:panel");
      return;
    }

    archivosPanel(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      // Rutas internas del panel (sin extensión): siempre el index.html.
      const esLectura = req.method === "GET" || req.method === "HEAD";
      if (!esLectura || extname(req.path) !== "") {
        res.status(404).type("text/plain; charset=utf-8").send("No encontrado");
        return;
      }
      res.sendFile(indicePanel, (errorEnvio) => {
        if (errorEnvio) next(errorEnvio);
      });
    });
  });

  // (3b) Imágenes de la biblioteca: /media/<clave>. Va antes que los estáticos y el SSR.
  app.use(
    "/media",
    crearManejadorMedia({
      dirMedia: "dirMedia" in opciones ? opciones.dirMedia : process.env["MEDIA_DIR"] || undefined,
      // select explícito: solo lo que la ruta necesita
      buscar: (clave) => prisma.imagen.findMany({ where: { clave }, select: { clave: true, tipoMime: true, hash: true } }),
    }),
  );

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
