import { createHash, randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { CLAVE_MAXIMA, hashFalso, verificarClave } from "./clave.js";
import type { Repositorio, Rol, UsuarioFila } from "./repositorio.js";

// Ingreso, sesiones y roles del panel.
//  - El navegador recibe un código aleatorio en una cookie httpOnly; en la base solo queda su SHA-256.
//  - La cookie vale solo para /api (las páginas públicas no llevan cookies) y es SameSite=Strict.
//  - Los pedidos que cambian datos tienen que venir del mismo sitio (se revisa Origin y Sec-Fetch-Site).
//  - Un email que no existe, un usuario inactivo y una contraseña mal escrita dan el mismo mensaje y tardan parecido.

export const NOMBRE_COOKIE = "evaristo_sesion";
export const DURACION_SESION_MS = 12 * 60 * 60 * 1000;

export interface UsuarioPublico {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioPublico;
      sesionHash?: string;
    }
  }
}

export interface OpcionesAuth {
  repo: Repositorio;
  /** Marca la cookie como Secure (sitio con HTTPS). En desarrollo local va en false. */
  seguro: boolean;
  /** Intentos fallidos de ingreso permitidos por dirección en la ventana. */
  limiteIngresos?: { ventanaMs: number; max: number };
  ahora?: () => Date;
}

const hashDelToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const publico = (u: UsuarioFila): UsuarioPublico => ({ id: u.id, email: u.email, nombre: u.nombre, rol: u.rol });

function leerCookie(req: Request, nombre: string): string | undefined {
  for (const parte of (req.headers.cookie ?? "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return undefined;
}

const error = (res: Response, estado: number, mensaje: string): void => {
  res.status(estado).json({ estado: "error", mensaje });
};

const IngresoSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  clave: z.string().min(1).max(CLAVE_MAXIMA),
});

export function crearAuth({ repo, seguro, limiteIngresos = { ventanaMs: 15 * 60 * 1000, max: 10 }, ahora = () => new Date() }: OpcionesAuth) {
  const atributosCookie = (maxAgeSeg: number) => `Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeg}${seguro ? "; Secure" : ""}`;

  /** Rechaza los pedidos que cambian datos y no vienen del propio sitio. */
  const protegerOrigen: RequestHandler = (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const origen = req.headers.origin;
    const mismoSitio = req.headers["sec-fetch-site"];
    const host = req.headers.host;
    if (mismoSitio === "cross-site" || mismoSitio === "same-site") {
      error(res, 403, "El pedido no viene de este sitio.");
      return;
    }
    if (origen !== undefined) {
      let hostOrigen: string | undefined;
      try {
        hostOrigen = new URL(origen).host;
      } catch {
        /* Origin inválido */
      }
      if (!hostOrigen || hostOrigen !== host) {
        error(res, 403, "El pedido no viene de este sitio.");
        return;
      }
    }
    next();
  };

  /** Si hay una sesión vigente, deja el usuario en req.usuario. No corta el pedido. */
  const cargarSesion: RequestHandler = async (req, _res, next) => {
    try {
      const token = leerCookie(req, NOMBRE_COOKIE);
      if (token) {
        const tokenHash = hashDelToken(token);
        const sesion = await repo.sesionPorHash(tokenHash);
        if (sesion && sesion.venceEn > ahora() && sesion.usuario.activo) {
          req.usuario = publico(sesion.usuario);
          req.sesionHash = tokenHash;
        } else if (sesion) {
          await repo.borrarSesion(tokenHash);
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };

  const exigirSesion: RequestHandler = (req, res, next) => {
    if (!req.usuario) {
      error(res, 401, "Tenés que ingresar para continuar.");
      return;
    }
    next();
  };

  const exigirRol =
    (rol: Rol): RequestHandler =>
    (req, res, next) => {
      if (!req.usuario) {
        error(res, 401, "Tenés que ingresar para continuar.");
      } else if (req.usuario.rol !== rol && req.usuario.rol !== "ADMINISTRADOR") {
        error(res, 403, "No tenés permiso para hacer esto.");
      } else {
        next();
      }
    };

  const limiteDeIntentos = rateLimit({
    windowMs: limiteIngresos.ventanaMs,
    limit: limiteIngresos.max,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => error(res, 429, "Hubo demasiados intentos. Esperá unos minutos y probá de nuevo."),
  });

  const router = express.Router();
  router.use(protegerOrigen);
  router.use(cargarSesion);

  router.post("/ingresar", limiteDeIntentos, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = IngresoSchema.safeParse(req.body);
      if (!datos.success) {
        error(res, 400, "Escribí un email y una contraseña.");
        return;
      }
      const { email, clave } = datos.data;
      const usuario = await repo.usuarioPorEmail(email);
      // Se verifica siempre contra un hash (el real o uno de mentira): así no se nota si el email existe.
      const coincide = await verificarClave(clave, usuario?.passwordHash ?? (await hashFalso()));
      if (!usuario || !usuario.activo || !coincide) {
        error(res, 401, "El email o la contraseña no son correctos.");
        return;
      }
      const token = randomBytes(32).toString("base64url");
      const cuando = ahora();
      await repo.crearSesion(hashDelToken(token), usuario.id, new Date(cuando.getTime() + DURACION_SESION_MS));
      await repo.registrarAcceso(usuario.id, cuando);
      res.setHeader("Set-Cookie", `${NOMBRE_COOKIE}=${token}; ${atributosCookie(DURACION_SESION_MS / 1000)}`);
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", usuario: publico(usuario) });
    } catch (e) {
      next(e);
    }
  });

  router.post("/salir", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.sesionHash) await repo.borrarSesion(req.sesionHash);
      res.setHeader("Set-Cookie", `${NOMBRE_COOKIE}=; ${atributosCookie(0)}`);
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok" });
    } catch (e) {
      next(e);
    }
  });

  router.get("/yo", exigirSesion, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ estado: "ok", usuario: req.usuario });
  });

  return { router, cargarSesion, exigirSesion, exigirRol, protegerOrigen };
}
