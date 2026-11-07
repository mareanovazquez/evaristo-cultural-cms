import { BANNER_MAX_IMAGENES, enlaceValido } from "@evaristo/compartido/sitio";
import { urlMedia } from "./articulos";
import { prisma } from "./prisma";

export interface SlideDeBanner {
  src: string;
  alt: string;
  /** `http(s)://…` o interno (`/…`); null si la imagen no es clickeable. */
  enlace: string | null;
}

/** Imágenes del banner de la portada, en el orden en que rotan; vacío si está apagado o no tiene ninguna (decisión 77). */
export async function leerBanner(): Promise<SlideDeBanner[]> {
  const config = await prisma.configuracionSitio.findUnique({ where: { id: 1 }, select: { bannerActivo: true } });
  if (!config?.bannerActivo) return [];
  const filas = await prisma.bannerImagen.findMany({
    orderBy: [{ orden: "asc" }, { id: "asc" }],
    take: BANNER_MAX_IMAGENES,
    select: { enlace: true, alt: true, imagen: { select: { clave: true } } },
  });
  // Aunque la API ya lo valida, un enlace raro que llegara a la base no se dibuja (la imagen sí, sin enlace).
  return filas.map((f) => ({ src: urlMedia(f.imagen.clave), alt: f.alt, enlace: f.enlace !== null && enlaceValido(f.enlace) ? f.enlace : null }));
}
