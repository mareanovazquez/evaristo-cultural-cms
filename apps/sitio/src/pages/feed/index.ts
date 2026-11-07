import type { APIRoute } from "astro";
import { prisma } from "../../lib/prisma";
import { ARTICULOS_EN_EL_FEED, armarFeed, baseDelSitio } from "../../lib/feed";

// /feed/: RSS con los últimos artículos publicados (ver lib/feed.ts). select explícito: nunca visitasWp.
export const GET: APIRoute = async ({ url }) => {
  const filas = await prisma.articulo.findMany({
    where: { estado: "PUBLICADO", publicadoEn: { lte: new Date() } },
    orderBy: [{ publicadoEn: "desc" }, { id: "desc" }],
    take: ARTICULOS_EN_EL_FEED,
    select: {
      titulo: true,
      bajada: true,
      slug: true,
      publicadoEn: true,
      autores: { orderBy: { orden: "asc" }, select: { autor: { select: { nombre: true } } } },
    },
  });
  const items = filas.flatMap((f) =>
    f.publicadoEn ? [{ titulo: f.titulo, bajada: f.bajada, slug: f.slug, publicadoEn: f.publicadoEn, autores: f.autores.map((a) => a.autor.nombre) }] : [],
  );
  return new Response(armarFeed(baseDelSitio(url.origin), items), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=900" },
  });
};
