import { prisma } from "./prisma";

// Notas por página en la página de un autor.
export const NOTAS_POR_PAGINA = 12;

// Un artículo se ve solo si está PUBLICADO y su fecha ya llegó.
const visibles = () => ({ estado: "PUBLICADO" as const, publicadoEn: { lte: new Date() } });

/** Autor con página propia: existe y no es de solo texto. select explícito. */
export async function buscarAutor(slug: string) {
  const autor = await prisma.autor.findFirst({
    where: { slug, soloTexto: false },
    select: {
      id: true,
      slug: true,
      nombre: true,
      bio: true,
      instagram: true,
      x: true,
      facebook: true,
      sitioWeb: true,
      fotoAlt: true,
      fotoPuntoFocalX: true,
      fotoPuntoFocalY: true,
      foto: { select: { clave: true } },
    },
  });
  return autor;
}

export async function contarNotasDelAutor(autorId: number): Promise<number> {
  return prisma.articulo.count({ where: { ...visibles(), autores: { some: { autorId } } } });
}

/** Notas del autor, de la más nueva a la más vieja. */
export async function notasDelAutor(autorId: number, pagina: number) {
  return prisma.articulo.findMany({
    where: { ...visibles(), autores: { some: { autorId } } },
    orderBy: [{ publicadoEn: "desc" }, { id: "desc" }],
    skip: (pagina - 1) * NOTAS_POR_PAGINA,
    take: NOTAS_POR_PAGINA,
    select: {
      slug: true,
      titulo: true,
      publicadoEn: true,
      seccion: { select: { nombre: true, interna: true } },
      imagenEncabezado: { select: { clave: true } },
      encabezadoPuntoFocalX: true,
      encabezadoPuntoFocalY: true,
    },
  });
}

/** Autores con página y al menos una nota visible, por nombre, con la cantidad de notas. */
export async function listarAutores() {
  const autores = await prisma.autor.findMany({
    where: { soloTexto: false, articulos: { some: { articulo: visibles() } } },
    select: {
      slug: true,
      nombre: true,
      fotoAlt: true,
      fotoPuntoFocalX: true,
      fotoPuntoFocalY: true,
      foto: { select: { clave: true } },
      _count: { select: { articulos: { where: { articulo: visibles() } } } },
    },
  });
  return autores.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Número de página pedido: entero desde 1; cualquier otra cosa vale 1. */
export function paginaPedida(valor: string | null): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export interface EnlaceRed {
  nombre: string;
  href: string;
}

// Acepta una dirección http(s) completa o un usuario (con o sin @). Lo demás se descarta.
function direccion(valor: string | null, base: string): string | undefined {
  const v = valor?.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) {
    try {
      return new URL(v).href;
    } catch {
      return undefined;
    }
  }
  const usuario = v.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{1,100}$/.test(usuario) ? `${base}${usuario}` : undefined;
}

/** Redes del autor en el orden de la ficha; las vacías o inválidas no salen. */
export function enlacesDeRedes(a: { instagram: string | null; x: string | null; facebook: string | null; sitioWeb: string | null }): EnlaceRed[] {
  const sitio = a.sitioWeb?.trim();
  const web = sitio ? (/^https?:\/\//i.test(sitio) ? direccion(sitio, "") : direccion(`https://${sitio}`, "")) : undefined;
  return [
    { nombre: "Instagram", href: direccion(a.instagram, "https://www.instagram.com/") },
    { nombre: "X", href: direccion(a.x, "https://x.com/") },
    { nombre: "Facebook", href: direccion(a.facebook, "https://www.facebook.com/") },
    { nombre: "Sitio web", href: web },
  ].filter((r): r is EnlaceRed => r.href !== undefined);
}
