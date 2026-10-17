// Parte PURA de las imágenes de la migración (sin disco): la forma de una medición, qué pasa con una imagen según su medición y el
// enlace del cuerpo con la biblioteca. armar() importa de acá, nunca de imagenes.ts (que lee el disco).
import type { DocNode } from "../../../src/conversor/types.ts";
import { aNFC } from "./utilidades.ts";

export interface Medicion {
  estado: "medida" | "original faltante" | "ilegible";
  /** Nombre real en disco del archivo que se abrió (null si no se abrió ninguno). */
  archivo: string | null;
  /** "normalizacion_unicode": el nombre de WordPress y el de disco difieren solo en NFC/NFD (se abre). "mayusculas": solo en mayúsculas (NO se abre). */
  diferenciaDeNombre: "mayusculas" | "normalizacion_unicode" | null;
  bytes: number | null; sha256: string | null; mime: string | null; ancho: number | null; alto: number | null; motivo?: string;
  /** Nombre que existe en la carpeta con otra capitalización (solo cuando no se abrió por eso). */
  archivoConOtraCapitalizacion?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Resolución de una imagen contra las mediciones (pura)
// ---------------------------------------------------------------------------------------------------------------
export type MedicionMedida = Medicion & { estado: "medida"; bytes: number; sha256: string; mime: string; ancho: number; alto: number };
export type ResultadoImagen =
  | { codigo: "con_fila"; clave: string; medicion: MedicionMedida }
  | { codigo: "original_faltante"; clave: string | null }
  | { codigo: "imagen_sin_medir"; clave: string; motivo: string };

/** Qué pasa con una imagen: tiene fila (medida), no tiene original o existe pero no se pudo medir. Una clave sin medición es un error del que llama. */
export function resolverImagen(clave: string | null, mediciones: ReadonlyMap<string, Medicion>): ResultadoImagen {
  if (clave === null) return { codigo: "original_faltante", clave: null };
  const k = aNFC(clave);
  const m = mediciones.get(k);
  if (!m) throw new Error(`Falta la medición de la imagen ${k}: hay que medir todas las claves del plan antes de armar`);
  if (m.estado === "original faltante") return { codigo: "original_faltante", clave: k };
  if (m.estado === "ilegible") return { codigo: "imagen_sin_medir", clave: k, motivo: m.motivo ?? "no se pudo medir" };
  return { codigo: "con_fila", clave: k, medicion: m as MedicionMedida };
}

// ---------------------------------------------------------------------------------------------------------------
// Enlace del cuerpo con la biblioteca (puro)
// ---------------------------------------------------------------------------------------------------------------
/** src de un nodo imagen del cuerpo para una clave: /media/ + cada segmento con percent-encoding, sin codificar las barras. */
export const srcDeClave = (clave: string) => `/media/${aNFC(clave).split("/").map(encodeURIComponent).join("/")}`;

/**
 * El Plan usa claves naturales: el nodo lleva `imagenWpId` (id del adjunto de WordPress, que es la clave natural de la fila de
 * `imagenes`) y el ejecutor lo reemplaza por `imagenId` (id numérico de la fila) antes de guardar. Un `imagenId` ya presente en el
 * plan sería un id inventado: se detecta como inconsistencia.
 */
export function reescribirImagenes(nodo: DocNode, f: (attrs: Record<string, unknown>) => Record<string, unknown>): DocNode {
  const copia: DocNode = { ...nodo };
  if (nodo.type === "imagen") copia.attrs = f({ ...(nodo.attrs ?? {}) });
  if (nodo.content) copia.content = nodo.content.map((c) => reescribirImagenes(c, f));
  return copia;
}

export function nodosImagen(nodo: DocNode, acc: DocNode[] = []): DocNode[] {
  if (nodo.type === "imagen") acc.push(nodo);
  for (const c of nodo.content ?? []) nodosImagen(c, acc);
  return acc;
}

/**
 * Comprueba que cada nodo imagen enlazado sea coherente con las filas del plan: `imagenWpId` con fila, `src` igual a /media/<clave de esa fila>
 * y ningún `imagenId` literal. (El validador no hace estas comprobaciones.) Devuelve los motivos; vacío si todo coincide.
 * `clavePorAdjunto`: id del adjunto -> clave de las filas de imagenes del plan.
 */
export function verificarEnlacesCuerpo(doc: DocNode, clavePorAdjunto: ReadonlyMap<number, string>): string[] {
  const motivos: string[] = [];
  for (const n of nodosImagen(doc)) {
    const a = n.attrs ?? {};
    if ("imagenId" in a) motivos.push(`el nodo imagen ya trae imagenId (${JSON.stringify(a["imagenId"])}): los ids numéricos los resuelve el ejecutor`);
    if (!("imagenWpId" in a)) continue;
    const wpId = a["imagenWpId"];
    const clave = typeof wpId === "number" ? clavePorAdjunto.get(wpId) : undefined;
    if (clave === undefined) { motivos.push(`el nodo imagen apunta al adjunto ${JSON.stringify(wpId)}, que no tiene fila en imagenes`); continue; }
    if (a["src"] !== srcDeClave(clave)) motivos.push(`src ${JSON.stringify(a["src"])} no coincide con la imagen ${wpId} (se esperaba ${srcDeClave(clave)})`);
  }
  return motivos;
}
