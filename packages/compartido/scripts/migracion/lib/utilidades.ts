// Utilidades PURAS de la migración: sin base de datos ni sistema de archivos. Las usan la corrida en seco y,
// más adelante, el armado y la escritura.
import type { DocNode } from "../../../src/conversor/types.ts";
import { MARCADOR_CORREO_OMITIDO } from "./snapshot-tipos.ts";

// Caracteres invisibles que se buscan; solo U+200E se limpia (en slug y título).
export const INVISIBLES: Array<[string, string]> = [["U+200B", "\u200B"], ["U+200E", "\u200E"], ["U+200F", "\u200F"], ["U+FEFF", "\uFEFF"], ["U+00AD", "\u00AD"]];

export const num = (v: unknown) => Number(v);
export const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** Marcas `?` separadas por coma para un IN (...) con n parámetros. */
export const marcas = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** decodeURIComponent que no lanza: si falla, conserva el texto crudo. */
export const decodificar = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
/** Igual que `decodificar` pero dice si el decode falló (percent-encoding inválido). */
export function decodificarPostName(postName: string): { valor: string; fallo: boolean } {
  try { return { valor: decodeURIComponent(postName), fallo: false }; } catch { return { valor: postName, fallo: true }; }
}
export const aNFC = (s: string) => s.normalize("NFC");
export const claveJs = (s: string) => decodificar(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
export const decEntidades = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export const quitarU200E = (s: string) => s.replace(/\u200E/g, "");

/**
 * Limpia el U+200E del slug ya decodificado. Solo si la limpieza CAMBIÓ el slug se colapsan los guiones consecutivos
 * y se recortan los de los extremos; si no, el slug se devuelve tal cual (un "a--b" legítimo no se toca).
 */
export function limpiarSlug(slugDecodificado: string): { slug: string; limpio: boolean } {
  const sin = quitarU200E(slugDecodificado);
  if (sin === slugDecodificado) return { slug: slugDecodificado, limpio: false };
  return { slug: sin.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, ""), limpio: true };
}

export const slugBorrador = (wpId: number) => `borrador-${wpId}`;

/** Slug final de un artículo: los borradores (y el privado aceptado) llevan `borrador-<wpId>`; el resto, el post_name limpio. */
export function slugFinal(esBorrador: boolean, wpId: number, slugDecodificado: string): { slug: string; limpio: boolean } {
  return esBorrador ? { slug: slugBorrador(wpId), limpio: false } : limpiarSlug(slugDecodificado);
}

/** Cuántas veces aparece cada carácter invisible buscado (solo los que aparecen). */
export function contarInvisibles(texto: string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [nombre, ch] of INVISIBLES) { const n = texto.split(ch).length - 1; if (n) o[nombre] = n; }
  return o;
}
export const cuentaDe = (xs: string[]) => { const o: Record<string, number> = {}; for (const x of xs) o[x] = (o[x] ?? 0) + 1; return o; };

export function textoDe(n: DocNode, acc: string[] = []): string[] {
  if (n.text) acc.push(n.text);
  if (n.type === "footnote" && n.attrs?.["content"]) textoDe(n.attrs["content"] as DocNode, acc);
  for (const c of n.content ?? []) textoDe(c, acc);
  return acc;
}
export const textoPlanoDe = (doc: DocNode) => (doc.content ?? []).map((b) => textoDe(b).join("")).filter(Boolean).join("\n");

export function contarAltPendiente(n: DocNode): number {
  return (n.type === "imagen" && n.attrs?.["altPendiente"] === true ? 1 : 0) + (n.content ?? []).reduce((s, c) => s + contarAltPendiente(c), 0);
}

export function docDeTexto(texto: string): DocNode | null {
  const parrafos = texto.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (!parrafos.length) return null;
  return { type: "doc", content: parrafos.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) };
}

/** Ruta de uploads de una URL, o null si no es de la biblioteca de medios propia. */
export function rutaUploads(url: string): string | null {
  const m = decodificar(url).match(/\/wp-content\/uploads\/(.+?)(?:[?#].*)?$/);
  return m ? m[1]! : null;
}

/** Id del adjunto que corresponde a una URL: exacta, o sin el sufijo de tamaño (-300x200) / -scaled / -eN. `mapa` es clave (_wp_attached_file) -> id. */
export function adjuntoDeUrl(url: string, mapa: ReadonlyMap<string, number>): { id: number; via: "exacta" | "sin-sufijo" } | null {
  const ruta = rutaUploads(url);
  if (ruta === null) return null;
  const exacta = mapa.get(ruta);
  if (exacta !== undefined) return { id: exacta, via: "exacta" };
  const base = ruta.replace(/-(?:\d+x\d+|scaled|e\d+)(\.[A-Za-z0-9]+)$/, "$1");
  const alt = base !== ruta ? mapa.get(base) : undefined;
  return alt !== undefined ? { id: alt, via: "sin-sufijo" } : null;
}

const REGEX_CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** Reemplaza las direcciones de correo de un texto por el marcador (para que no viajen en los snapshots versionados). */
export const ocultarCorreos = (texto: string) => texto.replace(new RegExp(REGEX_CORREO.source, "g"), MARCADOR_CORREO_OMITIDO);

/** ¿Hay una dirección de correo en el texto, o el marcador que la reemplazó en el snapshot? */
export const contieneCorreo = (texto: string) => REGEX_CORREO.test(texto) || texto.includes(MARCADOR_CORREO_OMITIDO);
