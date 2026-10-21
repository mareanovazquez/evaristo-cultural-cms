import { prisma } from "./prisma";

// URL canónica del artículo: /AAAA/MM/DD/slug/ (decidido el 21/10/2026). La fecha sale de publicadoEn en UTC.
const dos = (n: number): string => String(n).padStart(2, "0");

export function rutaArticulo(a: { slug: string; publicadoEn: Date }): string {
  const d = a.publicadoEn;
  return `/${d.getUTCFullYear()}/${dos(d.getUTCMonth() + 1)}/${dos(d.getUTCDate())}/${encodeURIComponent(a.slug)}/`;
}

/** Ruta pública de un archivo de la biblioteca (la sirve apps/api en /media/<clave>). */
export const urlMedia = (clave: string): string => `/media/${encodeURIComponent(clave)}`;

const formatoFecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" });
export const fechaLarga = (d: Date): string => formatoFecha.format(d);

/** Foco de una imagen recortada, en porcentaje, para object-position. */
export const posicionFocal = (x: number, y: number): string => {
  const limitar = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
  return `${Math.round(limitar(x) * 100)}% ${Math.round(limitar(y) * 100)}%`;
};

// Un artículo se ve solo si está PUBLICADO y su fecha ya llegó.
const visibles = () => ({ estado: "PUBLICADO" as const, publicadoEn: { lte: new Date() } });

// select explícito en todas las consultas: nunca se trae visitasWp ni nada que la vista no use.
export async function buscarArticulo(slug: string) {
  return prisma.articulo.findFirst({
    where: { slug, ...visibles() },
    select: {
      id: true,
      slug: true,
      titulo: true,
      bajada: true,
      cuerpo: true,
      publicadoEn: true,
      seccionId: true,
      seccion: { select: { nombre: true, slug: true, interna: true } },
      categoriaPrincipal: { select: { nombre: true, slug: true } },
      categorias: { select: { categoriaId: true } },
      imagenEncabezado: { select: { clave: true } },
      encabezadoAlt: true,
      encabezadoCredito: true,
      encabezadoPuntoFocalX: true,
      encabezadoPuntoFocalY: true,
      autores: {
        orderBy: { orden: "asc" },
        select: {
          autor: {
            select: {
              slug: true,
              nombre: true,
              soloTexto: true,
              bio: true,
              fotoAlt: true,
              fotoPuntoFocalX: true,
              fotoPuntoFocalY: true,
              foto: { select: { clave: true } },
            },
          },
        },
      },
    },
  });
}

/** Medidas de las imágenes del cuerpo, por imagenId, para width y height. */
export async function medidasDeImagenes(ids: number[]): Promise<Map<number, { ancho: number; alto: number }>> {
  if (!ids.length) return new Map();
  const filas = await prisma.imagen.findMany({ where: { id: { in: ids } }, select: { id: true, ancho: true, alto: true } });
  return new Map(filas.map((f) => [f.id, { ancho: f.ancho, alto: f.alto }]));
}

const seleccionTarjeta = {
  slug: true,
  titulo: true,
  publicadoEn: true,
  seccion: { select: { nombre: true, interna: true } },
  imagenEncabezado: { select: { clave: true } },
  encabezadoPuntoFocalX: true,
  encabezadoPuntoFocalY: true,
  autores: { orderBy: { orden: "asc" as const }, select: { autor: { select: { nombre: true } } } },
};

/** Hasta 3 artículos: primero los que comparten categoría, y si faltan, los de la misma sección. */
export async function articulosRelacionados(art: { id: number; seccionId: number; categorias: Array<{ categoriaId: number }> }) {
  const base = { ...visibles(), id: { not: art.id } };
  const categorias = art.categorias.map((c) => c.categoriaId);
  const porCategoria = categorias.length
    ? await prisma.articulo.findMany({
        where: { ...base, categorias: { some: { categoriaId: { in: categorias } } } },
        orderBy: { publicadoEn: "desc" },
        take: 3,
        select: seleccionTarjeta,
      })
    : [];
  if (porCategoria.length >= 3) return porCategoria;
  const yaElegidos = [art.id, ...(await prisma.articulo.findMany({ where: { slug: { in: porCategoria.map((a) => a.slug) } }, select: { id: true } })).map((a) => a.id)];
  const porSeccion = await prisma.articulo.findMany({
    where: { ...visibles(), seccionId: art.seccionId, id: { notIn: yaElegidos } },
    orderBy: { publicadoEn: "desc" },
    take: 3 - porCategoria.length,
    select: seleccionTarjeta,
  });
  return [...porCategoria, ...porSeccion];
}
