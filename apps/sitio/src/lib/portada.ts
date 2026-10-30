import { posicionFocal, rutaArticulo, urlMedia } from "./articulos";
import { NOTAS_POR_PAGINA } from "./paginacion";
import { prisma } from "./prisma";

// Datos de la portada. Se arma sola con lo publicado (el editor no maqueta); ver docs/especificaciones/especificacion-home.md.
//  - Carrusel: las 3 notas más nuevas.
//  - Banda de cuatro columnas: las 3 siguientes (la cuarta celda es la presentación de «Últimas publicaciones»).
//  - Bloques de sección: las secciones con publicaciones más recientes, cada una con sus 2 notas más nuevas que no estén ya arriba.
//    Una sección sin notas para mostrar no aparece. (No caben todas: la portada muestra las más activas.) Textos, el comodín de lo que no
//    tiene formato (decisión 78), no tiene bloque: sus notas pueden salir arriba por ser las más nuevas, pero la sección no se muestra.
// Un artículo se ve solo si está PUBLICADO y su fecha ya llegó (los programados aparecen en su fecha).

export const SECCIONES_EN_PORTADA = 6;
/** Secciones que no tienen bloque en la portada. */
export const SECCIONES_SIN_BLOQUE = ["textos"];
/** Notas de «Novedades» en la portada (un bloque más, si hay). Con novedades, las secciones se reducen en una para que los bloques queden de a pares. */
export const NOVEDADES_EN_PORTADA = 2;
export const NOTAS_POR_BLOQUE = 2;

const visibles = () => ({ estado: "PUBLICADO" as const, publicadoEn: { lte: new Date() } });

const seleccion = {
  id: true,
  slug: true,
  titulo: true,
  bajada: true,
  publicadoEn: true,
  novedadHasta: true,
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

/** Una diapositiva del hero de la portada: solo datos, sin presentación (la dibuja `Carrusel.astro`). */
export interface Diapositiva {
  id: string;
  imagen?: { src: string; alt: string; posicion: string } | undefined;
  titulo: string;
  descripcion?: string | undefined;
  ctaTexto: string;
  href: string;
  seccion?: string | undefined;
}

const DESCRIPCION_MAX = 220;
const recortar = (texto: string, max: number): string => (texto.length <= max ? texto : `${texto.slice(0, max).replace(/\s+\S*$/, "")}…`);

/** La diapositiva de una nota: su imagen de encabezado (con su texto alternativo y punto focal), el título, la bajada si la tiene y «Leer». */
export function diapositivaDeNota(n: NotaDePortada): Diapositiva {
  const bajada = n.bajada?.trim();
  return {
    id: n.slug,
    imagen: n.imagenEncabezado ? { src: urlMedia(n.imagenEncabezado.clave), alt: n.encabezadoAlt ?? "", posicion: posicionFocal(n.encabezadoPuntoFocalX, n.encabezadoPuntoFocalY) } : undefined,
    titulo: n.titulo,
    descripcion: bajada ? recortar(bajada, DESCRIPCION_MAX) : undefined,
    ctaTexto: "Leer",
    href: rutaArticulo({ slug: n.slug, publicadoEn: n.publicadoEn! }),
    seccion: n.seccion.interna ? undefined : n.seccion.nombre,
  };
}

export interface BloqueDeSeccion {
  seccion: { slug: string; nombre: string };
  notas: NotaDePortada[];
}

const vigentes = () => ({ ...visibles(), novedadHasta: { gt: new Date() } });

export async function datosDePortada() {
  const recientes = await ultimas(6);
  const carrusel = recientes.slice(0, 3);
  const banda = recientes.slice(3, 6);
  const yaMostradas = recientes.map((a) => a.id);
  // Novedades: las notas cuya marca todavía no venció, sin repetir lo de arriba
  const novedades = await prisma.articulo.findMany({ where: { ...vigentes(), id: { notIn: yaMostradas } }, orderBy: [{ publicadoEn: "desc" }, { id: "desc" }], take: NOVEDADES_EN_PORTADA, select: seleccion });
  yaMostradas.push(...novedades.map((n) => n.id));
  const cuantasSecciones = novedades.length ? SECCIONES_EN_PORTADA - 1 : SECCIONES_EN_PORTADA;

  // Las secciones con la publicación más reciente (sin la interna), de la más a la menos activa.
  const grupos = await prisma.articulo.groupBy({
    by: ["seccionId"],
    where: { ...visibles(), seccion: { interna: false, slug: { notIn: SECCIONES_SIN_BLOQUE } } },
    _max: { publicadoEn: true },
    orderBy: { _max: { publicadoEn: "desc" } },
    take: SECCIONES_EN_PORTADA * 2,
  });
  const bloques: BloqueDeSeccion[] = [];
  for (const g of grupos) {
    if (bloques.length >= cuantasSecciones) break;
    const notas = await prisma.articulo.findMany({ where: { ...visibles(), seccionId: g.seccionId, id: { notIn: yaMostradas } }, orderBy: [{ publicadoEn: "desc" }, { id: "desc" }], take: NOTAS_POR_BLOQUE, select: seleccion });
    if (!notas.length) continue;
    const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: g.seccionId }, select: { slug: true, nombre: true } });
    bloques.push({ seccion, notas });
  }
  return { carrusel, banda, bloques, novedades };
}

/**
 * La página «Novedades» es el archivo de todo lo que alguna vez fue novedad (`novedadHasta` no nulo): primero las vigentes y después las vencidas,
 * cada grupo de la más nueva a la más vieja. Las vigentes llevan la etiqueta de novedad; las vencidas no.
 */
const alguna = () => ({ ...visibles(), novedadHasta: { not: null } });
const vencidas = () => ({ ...visibles(), novedadHasta: { not: null, lte: new Date() } });
const ordenNovedades = [{ publicadoEn: "desc" as const }, { id: "desc" as const }];
export const contarNovedades = (): Promise<number> => prisma.articulo.count({ where: alguna() });
export async function notasNovedades(pagina: number) {
  const saltear = (pagina - 1) * NOTAS_POR_PAGINA;
  const cuantasVigentes = await prisma.articulo.count({ where: vigentes() });
  const deVigentes = saltear < cuantasVigentes ? await prisma.articulo.findMany({ where: vigentes(), orderBy: ordenNovedades, skip: saltear, take: NOTAS_POR_PAGINA, select: seleccion }) : [];
  const faltan = NOTAS_POR_PAGINA - deVigentes.length;
  if (faltan <= 0) return deVigentes;
  const deVencidas = await prisma.articulo.findMany({ where: vencidas(), orderBy: ordenNovedades, skip: Math.max(0, saltear - cuantasVigentes), take: faltan, select: seleccion });
  return [...deVigentes, ...deVencidas];
}

/** Todas las notas publicadas, de la más nueva a la más vieja (la página «Últimas publicaciones»). */
export const contarUltimas = (): Promise<number> => prisma.articulo.count({ where: visibles() });
export const notasUltimas = (pagina: number) => ultimas(NOTAS_POR_PAGINA, (pagina - 1) * NOTAS_POR_PAGINA);
