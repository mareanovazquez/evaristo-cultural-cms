import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@evaristo/compartido/db";
import { ROLES } from "@evaristo/compartido/permisos";
import { hashearClave, problemaDeClave, CLAVE_MAXIMA } from "../auth/clave.js";
import { rutaAutor } from "@evaristo/compartido/urls";
import { slugDesdeTitulo } from "./publicacion.js";

// Usuarios del panel (solo administrador). Decisiones del 22/10/2026:
//  - Desactivar ("revocar el acceso") no borra nada: corta las sesiones, y la ficha de autor y los artículos de la persona quedan como estaban.
//    Los usuarios nunca se borran.
//  - La contraseña inicial la escribe el administrador; la persona la cambia en su primer ingreso (`debeCambiarClave`). Restablecer la
//    de otro funciona igual. No hay envío de correos todavía.
//  - Un Redactor firma solo con su propia ficha de autor: se crea o se elige una al dar de alta.
//  - Nunca puede quedar el sistema sin un administrador activo.
// select explícito: el hash de la contraseña no sale de acá.

const Id = z.coerce.number().int().positive();
const MENSAJE_ULTIMO = "Tiene que quedar al menos un administrador con acceso.";

const seleccionUsuario = {
  id: true,
  email: true,
  nombre: true,
  rol: true,
  activo: true,
  debeCambiarClave: true,
  ultimoAccesoEn: true,
  creadoEn: true,
  autor: { select: { id: true, nombre: true, slug: true } },
  _count: { select: { articulosCreados: true } },
} as const;

type FilaUsuario = Prisma.UsuarioGetPayload<{ select: typeof seleccionUsuario }>;

const paraElPanel = (u: FilaUsuario) => ({
  id: u.id,
  email: u.email,
  nombre: u.nombre,
  rol: u.rol,
  activo: u.activo,
  debeCambiarClave: u.debeCambiarClave,
  ultimoAccesoEn: u.ultimoAccesoEn,
  creadoEn: u.creadoEn,
  autor: u.autor,
  articulos: u._count.articulosCreados,
});

const EmailSchema = z.string().trim().toLowerCase().email("Escribí un email válido.").max(255, "El email es demasiado largo.");
const NombreSchema = z.string().trim().min(1, "Escribí el nombre.").max(255, "El nombre es demasiado largo.");
const RolSchema = z.enum(ROLES, { error: "Elegí un rol de la lista." });
const ClaveSchema = z.string().max(CLAVE_MAXIMA + 1, "La contraseña es demasiado larga.");

// La ficha de autor del usuario: crear una con su nombre o enlazar una existente (que no sea de otra persona).
const FichaSchema = z.discriminatedUnion("modo", [z.object({ modo: z.literal("crear") }).strict(), z.object({ modo: z.literal("vincular"), autorId: z.number().int().positive() }).strict()]);

const AltaSchema = z.object({ email: EmailSchema, nombre: NombreSchema, rol: RolSchema, clave: ClaveSchema, ficha: FichaSchema.optional() }).strict();
const EdicionSchema = z.object({ nombre: NombreSchema.optional(), rol: RolSchema.optional() }).strict();
const ClaveNuevaSchema = z.object({ clave: ClaveSchema }).strict();

class Rechazo extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Dirección libre para la ficha de un autor nuevo, a partir de su nombre. */
async function slugLibreDeAutor(tx: Prisma.TransactionClient, nombre: string): Promise<string> {
  const base = slugDesdeTitulo(nombre);
  for (let n = 1; n < 200; n++) {
    const candidato = n === 1 ? base : `${base}-${n}`;
    const hay = (await tx.autor.findUnique({ where: { slug: candidato }, select: { id: true } })) ?? (await tx.redireccion.findFirst({ where: { origen: rutaAutor(candidato) }, select: { origen: true } }));
    if (!hay) return candidato;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Crea o enlaza la ficha de autor de un usuario. Lanza Rechazo si la elegida no existe o ya es de otra persona. */
async function asegurarFicha(tx: Prisma.TransactionClient, usuarioId: number, nombre: string, ficha: z.infer<typeof FichaSchema>): Promise<void> {
  if (ficha.modo === "crear") {
    await tx.autor.create({ data: { nombre, slug: await slugLibreDeAutor(tx, nombre), usuarioId }, select: { id: true } });
    return;
  }
  const autor = await tx.autor.findUnique({ where: { id: ficha.autorId }, select: { id: true, usuarioId: true, soloTexto: true } });
  if (!autor) throw new Rechazo(422, "El autor elegido no existe.");
  if (autor.soloTexto) throw new Rechazo(422, "Esa ficha es de un autor que no es una persona: elegí otra.");
  if (autor.usuarioId !== null && autor.usuarioId !== usuarioId) throw new Rechazo(422, "Esa ficha de autor ya pertenece a otro usuario.");
  await tx.autor.update({ where: { id: autor.id }, data: { usuarioId }, select: { id: true } });
}

/** ¿Queda otro administrador activo además de este usuario? */
async function hayOtroAdministrador(tx: Prisma.TransactionClient, usuarioId: number): Promise<boolean> {
  return (await tx.usuario.count({ where: { rol: "ADMINISTRADOR", activo: true, id: { not: usuarioId } } })) > 0;
}

export function crearRutasAdminUsuarios(prisma: PrismaClient, permiso: RequestHandler): express.Router {
  const router = express.Router();
  router.use("/usuarios", permiso);

  const manejar = (res: Response, next: NextFunction, e: unknown): void => {
    if (e instanceof Rechazo) {
      res.status(e.estado).json({ estado: "error", mensaje: e.message });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      res.status(409).json({ estado: "error", mensaje: "Ya hay un usuario con ese email." });
      return;
    }
    next(e);
  };
  const problemas = (res: Response, error: z.ZodError): void => {
    res.status(422).json({ estado: "error", mensaje: error.issues[0]?.message ?? "Revisá los datos.", problemas: [...new Set(error.issues.map((i) => i.message))].slice(0, 10) });
  };
  const noEncontrado = (res: Response): void => void res.status(404).json({ estado: "error", mensaje: "No encontramos a ese usuario." });
  const leer = (id: number) => prisma.usuario.findUnique({ where: { id }, select: seleccionUsuario });

  // ---------- Listar ----------
  router.get("/usuarios", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const filas = await prisma.usuario.findMany({ orderBy: [{ activo: "desc" }, { nombre: "asc" }], select: seleccionUsuario });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", usuarios: filas.map(paraElPanel) });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Autores que se pueden enlazar a un usuario (personas sin usuario), con búsqueda ----------
  router.get("/usuarios/autores-disponibles", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z.string().trim().max(100).optional().parse(typeof req.query["q"] === "string" ? req.query["q"] : undefined);
      const autores = await prisma.autor.findMany({
        where: { usuarioId: null, soloTexto: false, ...(q ? { nombre: { contains: q } } : {}) },
        orderBy: { nombre: "asc" },
        take: 30,
        select: { id: true, nombre: true, slug: true },
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ estado: "ok", autores });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Alta ----------
  router.post("/usuarios", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const datos = AltaSchema.safeParse(req.body);
      if (!datos.success) return void problemas(res, datos.error);
      const { email, nombre, rol, clave, ficha } = datos.data;
      const problemaClave = problemaDeClave(clave);
      if (problemaClave) return void res.status(422).json({ estado: "error", mensaje: problemaClave });
      // Un Redactor firma solo con su ficha: sin ficha no puede ni crear una nota.
      if (rol === "REDACTOR" && !ficha) return void res.status(422).json({ estado: "error", mensaje: "Un redactor necesita su ficha de autor: elegí una existente o creala con su nombre." });
      const passwordHash = await hashearClave(clave);
      const id = await prisma.$transaction(async (tx) => {
        const creado = await tx.usuario.create({ data: { email, nombre, rol, passwordHash, debeCambiarClave: true }, select: { id: true } });
        if (ficha) await asegurarFicha(tx, creado.id, nombre, ficha);
        return creado.id;
      });
      res.status(201).json({ estado: "ok", usuario: paraElPanel((await leer(id))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // ---------- Cambiar nombre y rol ----------
  router.patch("/usuarios/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Id.safeParse(req.params["id"]);
      if (!id.success) return void noEncontrado(res);
      const datos = EdicionSchema.safeParse(req.body);
      if (!datos.success) return void problemas(res, datos.error);
      await prisma.$transaction(async (tx) => {
        const u = await tx.usuario.findUnique({ where: { id: id.data }, select: { id: true, rol: true, activo: true, autor: { select: { id: true } } } });
        if (!u) throw new Rechazo(404, "No encontramos a ese usuario.");
        if (datos.data.rol && datos.data.rol !== u.rol) {
          if (u.rol === "ADMINISTRADOR" && u.activo && !(await hayOtroAdministrador(tx, u.id))) throw new Rechazo(409, MENSAJE_ULTIMO);
          if (datos.data.rol === "REDACTOR" && !u.autor) throw new Rechazo(422, "Un redactor necesita su ficha de autor: enlazale una antes de cambiarle el rol.");
        }
        await tx.usuario.update({ where: { id: u.id }, data: { ...(datos.data.nombre ? { nombre: datos.data.nombre } : {}), ...(datos.data.rol ? { rol: datos.data.rol } : {}) }, select: { id: true } });
      });
      res.json({ estado: "ok", usuario: paraElPanel((await leer(id.data))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // ---------- Revocar el acceso / volver a darlo ----------
  router.post("/usuarios/:id/desactivar", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Id.safeParse(req.params["id"]);
      if (!id.success) return void noEncontrado(res);
      await prisma.$transaction(async (tx) => {
        const u = await tx.usuario.findUnique({ where: { id: id.data }, select: { id: true, rol: true, activo: true } });
        if (!u) throw new Rechazo(404, "No encontramos a ese usuario.");
        if (u.rol === "ADMINISTRADOR" && u.activo && !(await hayOtroAdministrador(tx, u.id))) throw new Rechazo(409, MENSAJE_ULTIMO);
        await tx.usuario.update({ where: { id: u.id }, data: { activo: false }, select: { id: true } });
        // Pierde las sesiones en el acto. Su ficha de autor y sus artículos no se tocan.
        await tx.sesion.deleteMany({ where: { usuarioId: u.id } });
      });
      res.json({ estado: "ok", usuario: paraElPanel((await leer(id.data))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  router.post("/usuarios/:id/activar", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Id.safeParse(req.params["id"]);
      if (!id.success) return void noEncontrado(res);
      const r = await prisma.usuario.updateMany({ where: { id: id.data }, data: { activo: true } });
      if (r.count !== 1) return void noEncontrado(res);
      res.json({ estado: "ok", usuario: paraElPanel((await leer(id.data))!) });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Restablecer la contraseña de otro ----------
  router.post("/usuarios/:id/clave", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Id.safeParse(req.params["id"]);
      if (!id.success) return void noEncontrado(res);
      const datos = ClaveNuevaSchema.safeParse(req.body);
      if (!datos.success) return void problemas(res, datos.error);
      if (id.data === req.usuario!.id) return void res.status(422).json({ estado: "error", mensaje: "Para cambiar tu propia contraseña usá \"Mi cuenta\"." });
      const problemaClave = problemaDeClave(datos.data.clave);
      if (problemaClave) return void res.status(422).json({ estado: "error", mensaje: problemaClave });
      const passwordHash = await hashearClave(datos.data.clave);
      await prisma.$transaction(async (tx) => {
        const r = await tx.usuario.updateMany({ where: { id: id.data }, data: { passwordHash, debeCambiarClave: true } });
        if (r.count !== 1) throw new Rechazo(404, "No encontramos a ese usuario.");
        await tx.sesion.deleteMany({ where: { usuarioId: id.data } });
      });
      res.json({ estado: "ok", usuario: paraElPanel((await leer(id.data))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  // ---------- Cerrar todas sus sesiones ----------
  router.post("/usuarios/:id/cerrar-sesiones", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Id.safeParse(req.params["id"]);
      if (!id.success || !(await leer(id.data))) return void noEncontrado(res);
      // Si es la propia, se conserva la sesión actual (para no echarse a uno mismo).
      const cerradas = await prisma.sesion.deleteMany({ where: { usuarioId: id.data, ...(id.data === req.usuario!.id && req.sesionHash ? { tokenHash: { not: req.sesionHash } } : {}) } });
      res.json({ estado: "ok", cerradas: cerradas.count });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Darle una ficha de autor a quien no la tiene (crearla o enlazar una) ----------
  router.post("/usuarios/:id/ficha", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Id.safeParse(req.params["id"]);
      if (!id.success) return void noEncontrado(res);
      const ficha = FichaSchema.safeParse(req.body);
      if (!ficha.success) return void problemas(res, ficha.error);
      await prisma.$transaction(async (tx) => {
        const u = await tx.usuario.findUnique({ where: { id: id.data }, select: { id: true, nombre: true, autor: { select: { id: true } } } });
        if (!u) throw new Rechazo(404, "No encontramos a ese usuario.");
        if (u.autor) throw new Rechazo(409, "Esta persona ya tiene su ficha de autor.");
        await asegurarFicha(tx, u.id, u.nombre, ficha.data);
      });
      res.json({ estado: "ok", usuario: paraElPanel((await leer(id.data))!) });
    } catch (e) {
      manejar(res, next, e);
    }
  });

  return router;
}
