// Feed RSS 2.0 del sitio en /feed/ (la misma dirección que tenía WordPress; decidido con Mariano el 7/11/2026): los últimos artículos
// publicados, para que los lectores de RSS que estaban suscriptos sigan recibiendo las notas nuevas.
import { rutaArticulo } from "@evaristo/compartido/urls";

export const ARTICULOS_EN_EL_FEED = 20;

export interface ItemFeed {
  titulo: string;
  bajada: string | null;
  slug: string;
  publicadoEn: Date;
  autores: string[];
}

const escapar = (s: string): string =>
  s
    // Fuera los caracteres que XML 1.0 no admite (controles, salvo tabulación y saltos).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Base absoluta del sitio (RSS exige direcciones completas): la variable SITIO_URL si está (por ejemplo https://evaristocultural.com.ar),
 * o el origen del pedido. Sin barra final.
 */
export function baseDelSitio(origenDelPedido: string, sitioUrl: string | undefined = process.env["SITIO_URL"]): string {
  const base = sitioUrl?.trim() && /^https?:\/\/[^/\s]+/i.test(sitioUrl.trim()) ? sitioUrl.trim() : origenDelPedido;
  return base.replace(/\/+$/, "");
}

export function armarFeed(base: string, items: ItemFeed[]): string {
  const ultimo = items[0]?.publicadoEn ?? new Date(0);
  const entradas = items
    .map((a) => {
      const enlace = `${base}${rutaArticulo(a)}`;
      return [
        "    <item>",
        `      <title>${escapar(a.titulo)}</title>`,
        `      <link>${escapar(enlace)}</link>`,
        `      <guid isPermaLink="true">${escapar(enlace)}</guid>`,
        `      <pubDate>${a.publicadoEn.toUTCString()}</pubDate>`,
        ...a.autores.map((n) => `      <dc:creator>${escapar(n)}</dc:creator>`),
        ...(a.bajada ? [`      <description>${escapar(a.bajada)}</description>`] : []),
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    "    <title>Evaristo Cultural</title>",
    `    <link>${escapar(`${base}/`)}</link>`,
    `    <atom:link href="${escapar(`${base}/feed/`)}" rel="self" type="application/rss+xml" />`,
    "    <description>Revista cultural de la editorial Evaristo</description>",
    "    <language>es-AR</language>",
    `    <lastBuildDate>${ultimo.toUTCString()}</lastBuildDate>`,
    entradas,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n")
    .concat("\n");
}
