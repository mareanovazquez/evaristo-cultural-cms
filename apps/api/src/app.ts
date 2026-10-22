import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import helmet from "helmet";
import { obtenerClientePrisma, type PrismaClient } from "@evaristo/compartido/db";
import { crearAuth, type OpcionesAuth } from "./auth/rutas.js";
import { repositorioPrisma } from "./auth/repositorio.js";
import { crearRutasAdminArticulos } from "./admin/articulos.js";
import { crearRutasAdminEdicion } from "./admin/edicion.js";
import { crearRutasAdminImagenes } from "./admin/imagenes.js";
import { crearRutasAdminPublicacion } from "./admin/publicacion.js";
import { crearManejadorMedia } from "./media.js";
import { crearManejadorRedirecciones } from "./redirecciones.js";

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
  /** Carpeta de las imágenes subidas desde el panel. Por defecto, la variable MEDIA_DIR_SUBIDAS. */
  dirSubidas?: string | undefined;
  /** Para las pruebas: reemplaza partes de la autenticación (repositorio, límite de intentos, cookie Secure). */
  auth?: Partial<OpcionesAuth>;
}

export function crearApp(prisma: PrismaClient = obtenerClientePrisma(), opciones: OpcionesApp = {}): express.Express {
  const app = express();
  const dirSubidas = "dirSubidas" in opciones ? opciones.dirSubidas : process.env["MEDIA_DIR_SUBIDAS"] || undefined;

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

  // (2) API: cabeceras de seguridad, JSON con límite (un cuerpo grande de artículo ronda los 120 KB) e ingreso/sesiones.
  app.use("/api", helmet());
  app.use("/api", express.json({ limit: "2mb" }));
  const auth = crearAuth({ repo: repositorioPrisma(prisma), seguro: process.env["NODE_ENV"] === "production", ...opciones.auth });
  app.use("/api/auth", auth.router);
  // Rutas del panel: hace falta una sesión (editor o administrador) y que el pedido venga del propio sitio.
  app.use("/api/admin", auth.protegerOrigen, auth.cargarSesion, auth.exigirSesion, crearRutasAdminArticulos(prisma), crearRutasAdminEdicion(prisma), crearRutasAdminPublicacion(prisma), crearRutasAdminImagenes(prisma, { dirSubidas }));

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
      dirSubidas,
      // select explícito: solo lo que la ruta necesita
      buscar: (clave) => prisma.imagen.findMany({ where: { clave }, select: { clave: true, tipoMime: true, hash: true } }),
    }),
  );

  // (4) Archivos estáticos del cliente de Astro y, para todo lo demás, el SSR de Astro.
  app.use(express.static(dirCliente));

  // (4b) Redirecciones 301 de las URLs viejas de WordPress. Después de los estáticos (los archivos no consultan la base) y antes del SSR.
  app.use(
    crearManejadorRedirecciones((candidatos) =>
      prisma.redireccion.findMany({
        where: { origen: { in: candidatos } },
        select: {
          origen: true,
          tipo: true,
          codigo: true,
          destino: true,
          articulo: { select: { slug: true, estado: true, publicadoEn: true } },
          autor: { select: { slug: true, soloTexto: true } },
        },
      }),
    ),
  );
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

  // (5) Cualquier otra ruta: la página 404 del sitio. En modo middleware, Astro pasa a Express lo que no reconoce;
  // acá se le pide su página /404 (que responde con estado 404).
  app.use(async (req, res, next) => {
    const manejador = req.method === "GET" || req.method === "HEAD" ? await cargarManejadorAstro() : undefined;
    if (!manejador) {
      res.status(404).type("text/plain; charset=utf-8").send("No encontrado");
      return;
    }
    req.url = "/404";
    req.originalUrl = "/404";
    manejador(req, res, next);
  });

  // Errores no previstos: sin detalles hacia afuera.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const tipo = (error as { type?: string } | null)?.type;
    if (tipo === "entity.parse.failed" || tipo === "entity.too.large") {
      res.status(tipo === "entity.too.large" ? 413 : 400).json({ estado: "error", mensaje: "El pedido no se pudo leer." });
      return;
    }
    console.error("Error no controlado:", error instanceof Error ? error.message : "error desconocido");
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ estado: "error" });
  });

  return app;
}
