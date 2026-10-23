import { prisma } from "./prisma";
import { NOTAS_POR_PAGINA } from "./paginacion";

// Un artículo se ve solo si está PUBLICADO y su fecha ya llegó.
const visibles = () => ({ estado: "PUBLICADO" as const, publicadoEn: { lte: new Date() } });

/** Secciones del menú: las que no son internas, en el orden que les dio el administrador en el panel. */
export async function listarSeccionesMenu() {
  const donde = { interna: false };
  const campos = { slug: true, nombre: true } as const;
  try {
    return await prisma.seccion.findMany({ where: donde, orderBy: [{ orden: "asc" }, { id: "asc" }], select: campos });
  } catch (error) {
    // Provisorio: la base real todavía no tiene la columna `orden` (la migración `secciones_orden` se aplica en la fase 7). Sin ella, el
    // menú sale en el orden de carga (por id), que es el mismo con el que se numeró. Borrar este respaldo cuando la real tenga la migración.
    if ((error as { code?: string } | null)?.code !== "P2022" && !/Unknown column|orden/i.test(String((error as Error | null)?.message))) throw error;
    return prisma.seccion.findMany({ where: donde, orderBy: { id: "asc" }, select: campos });
  }
}

/** Sección con página pública: existe y no es interna (sin-asignar). */
export async function buscarSeccion(slug: string) {
  return prisma.seccion.findFirst({ where: { slug, interna: false }, select: { id: true, slug: true, nombre: true } });
}

export async function contarNotasDeSeccion(seccionId: number): Promise<number> {
  return prisma.articulo.count({ where: { ...visibles(), seccionId } });
}

/** Notas de la sección, de la más nueva a la más vieja. select explícito. */
export async function notasDeSeccion(seccionId: number, pagina: number) {
  return prisma.articulo.findMany({
    where: { ...visibles(), seccionId },
    orderBy: [{ publicadoEn: "desc" }, { id: "desc" }],
    skip: (pagina - 1) * NOTAS_POR_PAGINA,
    take: NOTAS_POR_PAGINA,
    select: {
      slug: true,
      titulo: true,
      publicadoEn: true,
      imagenEncabezado: { select: { clave: true } },
      encabezadoPuntoFocalX: true,
      encabezadoPuntoFocalY: true,
      autores: { orderBy: { orden: "asc" }, select: { autor: { select: { nombre: true } } } },
    },
  });
}
