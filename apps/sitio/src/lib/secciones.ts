import { prisma } from "./prisma";
import { NOTAS_POR_PAGINA } from "./paginacion";

// Un artículo se ve solo si está PUBLICADO y su fecha ya llegó.
const visibles = () => ({ estado: "PUBLICADO" as const, publicadoEn: { lte: new Date() } });

/** Secciones del menú: las que no son internas, en el orden que les dio el administrador en el panel. */
export async function listarSeccionesMenu() {
  return prisma.seccion.findMany({ where: { interna: false }, orderBy: [{ orden: "asc" }, { id: "asc" }], select: { slug: true, nombre: true } });
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
      novedadHasta: true,
      imagenEncabezado: { select: { clave: true } },
      encabezadoPuntoFocalX: true,
      encabezadoPuntoFocalY: true,
      autores: { orderBy: { orden: "asc" }, select: { autor: { select: { nombre: true } } } },
    },
  });
}
