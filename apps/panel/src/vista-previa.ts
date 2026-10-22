import { escapeHtml, renderArticleBody, type JSONNode } from "@evaristo/compartido/render";
import type { FichaDatos } from "./api";

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
  /** Ficha técnica del libro (se ve después de las notas). */
  ficha?: FichaDatos | null | undefined;
  /** Imágenes de la galería (se ve después de la ficha). El visor ampliado no está en la vista previa (no ejecuta scripts). */
  galeria?: Array<{ src: string; alt: string; epigrafe: string | null }> | undefined;
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

/**
 * La vista previa no ejecuta scripts (iframe con sandbox y sin allow-scripts), y el reproductor de YouTube o Vimeo los necesita:
 * un iframe adentro de otro con sandbox hereda sus restricciones. En su lugar se muestra un recuadro 16:9 con la miniatura (YouTube)
 * y un enlace para abrir el video. El reproductor real se ve en el sitio.
 */
const VIDEO_EMBEBIDO = /<figure class="video"><iframe src="(https:\/\/(?:www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]+)|player\.vimeo\.com\/video\/(\d+)))"[^>]*><\/iframe><\/figure>/g;

export function videosSinScripts(html: string): string {
  return html.replace(VIDEO_EMBEBIDO, (_todo, _src: string, idYoutube: string | undefined, idVimeo: string | undefined) => {
    const youtube = idYoutube !== undefined;
    const id = (youtube ? idYoutube : idVimeo)!;
    const proveedor = youtube ? "YouTube" : "Vimeo";
    const enlace = youtube ? `https://www.youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`;
    const miniatura = youtube ? `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` : "none";
    return (
      `<figure class="video"><a class="video-previa" href="${escapeHtml(enlace)}" target="_blank" rel="noopener noreferrer" ` +
      `style="display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:16/9;background:#111 ${miniatura} center/cover no-repeat;color:#fff;text-decoration:none;text-align:center;font:600 16px/1.4 system-ui,sans-serif">` +
      `<span style="background:rgba(0,0,0,.7);padding:.6rem 1rem;border-radius:4px">▶ Video de ${proveedor}<br>` +
      `<small style="font-weight:400">En la vista previa no se reproduce; en el sitio sí. Hacé clic para abrirlo.</small></span></a></figure>`
    );
  });
}

/** La ficha técnica como la arma el sitio (components/FichaTecnica.astro): solo los campos que tienen algo; nada si no hay ninguno. */
export function htmlFicha(ficha: FichaDatos | null | undefined): string {
  if (!ficha) return "";
  const campos: Array<[string, string | number | null]> = [["Título", ficha.titulo], ["Autor", ficha.autor], ["Traductor", ficha.traductor], ["Editorial", ficha.editorial], ["Colección", ficha.coleccion], ["Año", ficha.anio], ["Páginas", ficha.paginas], ["ISBN", ficha.isbn], ["Precio", ficha.precio]];
  const filas = campos.filter(([, valor]) => valor !== null && String(valor).trim() !== "");
  if (filas.length === 0) return "";
  return `<section class="col ficha-tecnica" aria-labelledby="ficha-titulo"><h2 id="ficha-titulo">Ficha técnica</h2><dl>${filas.map(([e, val]) => `<div><dt>${escapeHtml(e)}</dt><dd>${escapeHtml(String(val))}</dd></div>`).join("")}</dl></section>`;
}

/** La galería como la arma el sitio (components/Galeria.astro), sin el visor ampliado. */
export function htmlGaleria(items: Array<{ src: string; alt: string; epigrafe: string | null }>): string {
  if (items.length === 0) return "";
  const lista = items.map((i) => `<li><figure><a class="galeria-abrir" href="${escapeHtml(i.src)}"><img src="${escapeHtml(i.src)}" alt="${escapeHtml(i.alt)}"></a>${i.epigrafe ? `<figcaption>${escapeHtml(i.epigrafe)}</figcaption>` : ""}</figure></li>`).join("");
  return `<section class="wide galeria" aria-labelledby="galeria-titulo"><h2 id="galeria-titulo">Galería</h2><ul class="galeria-grilla">${lista}</ul></section>`;
}

export function htmlVistaPrevia(d: DatosVistaPrevia, hojas: string): string {
  const { html: cuerpoHtml, notesHtml } = renderArticleBody(d.cuerpo, { conCapital: d.conCapital });
  const html = videosSinScripts(cuerpoHtml);
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
${htmlFicha(d.ficha)}
${htmlGaleria(d.galeria ?? [])}
</article>
</main>
</body>
</html>`;
}
