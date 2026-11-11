import type { PrismaClient } from "@evaristo/compartido/db";
import type { Rol } from "@evaristo/compartido/permisos";

export type { Rol };

export interface UsuarioFila {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  debeCambiarClave: boolean;
  passwordHash: string;
}

export interface SesionFila {
  venceEn: Date;
  usuario: UsuarioFila;
}

export interface RecuperacionFila {
  id: number;
  venceEn: Date;
  usadoEn: Date | null;
  usuario: UsuarioFila;
}

/** Lo que la autenticación necesita de la base. Se inyecta para poder probarla sin base de datos. */
export interface Repositorio {
  usuarioPorEmail(email: string): Promise<UsuarioFila | null>;
  usuarioPorId(id: number): Promise<UsuarioFila | null>;
  /** Guarda la contraseña nueva; `debeCambiar` indica si la persona todavía tiene que elegir una propia. */
  cambiarClave(usuarioId: number, passwordHash: string, debeCambiar: boolean): Promise<void>;
  cambiarNombre(usuarioId: number, nombre: string): Promise<void>;
  /** Cierra las sesiones de un usuario, menos la indicada (si se pasa). */
  borrarSesionesDeUsuario(usuarioId: number, excepto?: string): Promise<number>;
  registrarAcceso(usuarioId: number, cuando: Date): Promise<void>;
  crearSesion(tokenHash: string, usuarioId: number, venceEn: Date): Promise<void>;
  sesionPorHash(tokenHash: string): Promise<SesionFila | null>;
  borrarSesion(tokenHash: string): Promise<void>;
  borrarSesionesVencidas(ahora: Date): Promise<number>;
  // Recuperación de contraseña (auth/recuperacion.ts)
  crearRecuperacion(tokenHash: string, usuarioId: number, venceEn: Date): Promise<void>;
  /** Cuándo pidió esta persona el último enlace (para no mandar correos seguidos). */
  ultimaRecuperacionDe(usuarioId: number): Promise<Date | null>;
  recuperacionPorHash(tokenHash: string): Promise<RecuperacionFila | null>;
  /** Marca el enlace como usado si todavía no lo estaba. false: ya se había usado (dos pedidos a la vez). */
  usarRecuperacion(id: number, cuando: Date): Promise<boolean>;
  borrarRecuperacionesDeUsuario(usuarioId: number): Promise<number>;
  borrarRecuperacionesVencidas(ahora: Date): Promise<number>;
}

const seleccionUsuario = { id: true, email: true, nombre: true, rol: true, activo: true, debeCambiarClave: true, passwordHash: true } as const;

export function repositorioPrisma(prisma: PrismaClient): Repositorio {
  return {
    usuarioPorEmail: (email) => prisma.usuario.findUnique({ where: { email }, select: seleccionUsuario }),
    usuarioPorId: (id) => prisma.usuario.findUnique({ where: { id }, select: seleccionUsuario }),
    cambiarClave: async (usuarioId, passwordHash, debeCambiar) => {
      await prisma.usuario.update({ where: { id: usuarioId }, data: { passwordHash, debeCambiarClave: debeCambiar }, select: { id: true } });
    },
    cambiarNombre: async (usuarioId, nombre) => {
      await prisma.usuario.update({ where: { id: usuarioId }, data: { nombre }, select: { id: true } });
    },
    borrarSesionesDeUsuario: async (usuarioId, excepto) =>
      (await prisma.sesion.deleteMany({ where: { usuarioId, ...(excepto ? { tokenHash: { not: excepto } } : {}) } })).count,
    registrarAcceso: async (usuarioId, cuando) => {
      await prisma.usuario.update({ where: { id: usuarioId }, data: { ultimoAccesoEn: cuando }, select: { id: true } });
    },
    crearSesion: async (tokenHash, usuarioId, venceEn) => {
      await prisma.sesion.create({ data: { tokenHash, usuarioId, venceEn }, select: { id: true } });
    },
    sesionPorHash: (tokenHash) => prisma.sesion.findUnique({ where: { tokenHash }, select: { venceEn: true, usuario: { select: seleccionUsuario } } }),
    borrarSesion: async (tokenHash) => {
      await prisma.sesion.deleteMany({ where: { tokenHash } });
    },
    borrarSesionesVencidas: async (ahora) => (await prisma.sesion.deleteMany({ where: { venceEn: { lt: ahora } } })).count,
    crearRecuperacion: async (tokenHash, usuarioId, venceEn) => {
      await prisma.recuperacionClave.create({ data: { tokenHash, usuarioId, venceEn }, select: { id: true } });
    },
    ultimaRecuperacionDe: async (usuarioId) =>
      (await prisma.recuperacionClave.findFirst({ where: { usuarioId }, orderBy: { creadoEn: "desc" }, select: { creadoEn: true } }))?.creadoEn ?? null,
    recuperacionPorHash: (tokenHash) =>
      prisma.recuperacionClave.findUnique({ where: { tokenHash }, select: { id: true, venceEn: true, usadoEn: true, usuario: { select: seleccionUsuario } } }),
    usarRecuperacion: async (id, cuando) => (await prisma.recuperacionClave.updateMany({ where: { id, usadoEn: null }, data: { usadoEn: cuando } })).count === 1,
    borrarRecuperacionesDeUsuario: async (usuarioId) => (await prisma.recuperacionClave.deleteMany({ where: { usuarioId } })).count,
    borrarRecuperacionesVencidas: async (ahora) => (await prisma.recuperacionClave.deleteMany({ where: { venceEn: { lt: ahora } } })).count,
  };
}
