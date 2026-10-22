import { escapeHtml, renderArticleBody, type JSONNode } from "@evaristo/compartido/render";

// Vista previa del artículo: arma el mismo HTML que la página pública (apps/sitio/src/components/Articulo.astro) con el mismo
// renderizador del cuerpo. Es una función pura (recibe las hojas de estilo del sitio como texto) para poder probarla sin navegador.
// Si cambia la estructura de Articulo.astro, hay que cambiarla acá también.

export interface DatosVistaPrevia {
  titulo: string;
  bajada: string | null;
  /** Nombre de la sección (no las internas). */
  seccion?: string | undefined;
  /** Nombre de la categoría principal. */
  volanta?: string | undefined;
  autores: string[];
  /** Fecha ya formateada, o un texto que diga que todavía no tiene. */
  fecha: string;
  encabezado?: { src: string; alt: string; credito: string | null; posicion: string } | undefined;
  cuerpo: JSONNode;
  conCapital: boolean;
}

/** Foco de una imagen recortada, en porcentaje, para object-position (igual que el sitio). */
export const posicionFocal = (x: number, y: number): string => {
  const limitar = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
  return `${Math.round(limitar(x) * 100)}% ${Math.round(limitar(y) * 100)}%`;
};

const FUENTES =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=Roboto:wght@600;900&display=swap";

/** Los enlaces del texto se abren en otra pestaña (la vista previa no tiene a dónde navegar); los internos (#nota) quedan. */
const enlacesAfuera = (html: string): string => html.replace(/<a href="(?!#)/g, '<a target="_blank" rel="noopener noreferrer" href="');

export function htmlVistaPrevia(d: DatosVistaPrevia, hojas: string): string {
  const { html, notesHtml } = renderArticleBody(d.cuerpo, { conCapital: d.conCapital });
  const autores = d.autores.length > 0 ? `Por ${escapeHtml(d.autores.length > 1 ? `${d.autores.slice(0, -1).join(", ")} y ${d.autores[d.autores.length - 1]}` : d.autores[0]!)}` : "";
  const meta = [autores, d.fecha ? `<time>${escapeHtml(d.fecha)}</time>` : ""].filter(Boolean).join(" · ");
  const encabezado = d.encabezado
    ? `<figure class="wide encabezado"><img class="hero-img" src="${escapeHtml(d.encabezado.src)}" alt="${escapeHtml(d.encabezado.alt)}" style="object-position: ${escapeHtml(d.encabezado.posicion)}">${d.encabezado.credito ? `<figcaption>${escapeHtml(d.encabezado.credito)}</figcaption>` : ""}</figure>`
    : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FUENTES}" rel="stylesheet">
<style>${hojas.replace(/<\/style/gi, "<\\/style")}</style>
</head>
<body>
<main id="contenido" class="page">
<article class="section nota">
<header class="col">
${d.seccion ? `<p class="rotulos"><span class="etiqueta">${escapeHtml(d.seccion)}</span></p>` : ""}
${d.volanta ? `<p class="volanta"><a>${escapeHtml(d.volanta)}</a></p>` : ""}
<h1>${escapeHtml(d.titulo)}</h1>
${d.bajada ? `<p class="bajada">${escapeHtml(d.bajada)}</p>` : ""}
${meta ? `<p class="meta">${meta}</p>` : ""}
</header>
${encabezado}
<div class="col nota-cuerpo">${enlacesAfuera(html)}</div>
${notesHtml ? `<div class="col">${enlacesAfuera(notesHtml)}</div>` : ""}
</article>
</main>
</body>
</html>`;
}
