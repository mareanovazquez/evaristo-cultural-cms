import { prisma } from "./prisma";
import { NOTAS_POR_PAGINA } from "./paginacion";

// Datos de la portada. Se arma sola con lo publicado (el editor no maqueta); ver docs/especificaciones/especificacion-home.md.
//  - Carrusel: las 3 notas más nuevas.
//  - Banda de cuatro columnas: las 3 siguientes (la cuarta celda es la presentación de «Últimas publicaciones»).
//  - Bloques de sección: las secciones con publicaciones más recientes, cada una con sus 2 notas más nuevas que no estén ya arriba.
//    Una sección sin notas para mostrar no aparece. (Con 17 secciones no caben todas: la portada muestra las más activas.)
// Un artículo se ve solo si está PUBLICADO y su fecha ya llegó (los programados aparecen en su fecha).

export const SECCIONES_EN_PORTADA = 6;
export const NOTAS_POR_BLOQUE = 2;

const visibles = () => ({ estado: "PUBLICADO" as const, publicadoEn: { lte: new Date() } });

const seleccion = {
  id: true,
  slug: true,
  titulo: true,
  publicadoEn: true,
  seccion: { select: { nombre: true, interna: true } },
  imagenEncabezado: { select: { clave: true } },
  encabezadoAlt: true,
  encabezadoPuntoFocalX: true,
  encabezadoPuntoFocalY: true,
  autores: { orderBy: { orden: "asc" as const }, select: { autor: { select: { nombre: true } } } },
};

export type NotaDePortada = Awaited<ReturnType<typeof ultimas>>[number];

function ultimas(cantidad: number, saltear = 0) {
  return prisma.articulo.findMany({ where: visibles(), orderBy: [{ publicadoEn: "desc" }, { id: "desc" }], skip: saltear, take: cantidad, select: seleccion });
}

export interface BloqueDeSeccion {
  seccion: { slug: string; nombre: string };
  notas: NotaDePortada[];
}

export async function datosDePortada() {
  const recientes = await ultimas(6);
  const carrusel = recientes.slice(0, 3);
  const banda = recientes.slice(3, 6);
  const yaMostradas = recientes.map((a) => a.id);

  // Las secciones con la publicación más reciente (sin la interna), de la más a la menos activa.
  const grupos = await prisma.articulo.groupBy({
    by: ["seccionId"],
    where: { ...visibles(), seccion: { interna: false } },
    _max: { publicadoEn: true },
    orderBy: { _max: { publicadoEn: "desc" } },
    take: SECCIONES_EN_PORTADA * 2,
  });
  const bloques: BloqueDeSeccion[] = [];
  for (const g of grupos) {
    if (bloques.length >= SECCIONES_EN_PORTADA) break;
    const notas = await prisma.articulo.findMany({ where: { ...visibles(), seccionId: g.seccionId, id: { notIn: yaMostradas } }, orderBy: [{ publicadoEn: "desc" }, { id: "desc" }], take: NOTAS_POR_BLOQUE, select: seleccion });
    if (!notas.length) continue;
    const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: g.seccionId }, select: { slug: true, nombre: true } });
    bloques.push({ seccion, notas });
  }
  return { carrusel, banda, bloques };
}

/** Todas las notas publicadas, de la más nueva a la más vieja (la página «Últimas publicaciones»). */
export const contarUltimas = (): Promise<number> => prisma.articulo.count({ where: visibles() });
export const notasUltimas = (pagina: number) => ultimas(NOTAS_POR_PAGINA, (pagina - 1) * NOTAS_POR_PAGINA);
