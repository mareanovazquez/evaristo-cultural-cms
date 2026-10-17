// Imágenes de la migración: medición de los archivos originales (SOLO LECTURA de disco: readdirSync/readFileSync) y las
// funciones PURAS que enlazan el cuerpo con la biblioteca de imágenes. La medición la usan la corrida en seco y la migración;
// armar() no toca el disco: recibe las mediciones ya hechas.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aNFC } from "./utilidades.ts";
import type { Medicion } from "./enlaces-imagenes.ts";

export * from "./enlaces-imagenes.ts";

// ---------------------------------------------------------------------------------------------------------------
// Lectura mínima de imágenes (sin dependencias): tipo por contenido y dimensiones del encabezado
// ---------------------------------------------------------------------------------------------------------------
export function tipoPorContenido(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a")) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.length >= 2 && b.subarray(0, 2).toString("latin1") === "BM") return "image/bmp";
  return null;
}

/** Ancho y alto del encabezado de JPEG, PNG o GIF; null si el archivo no es de esos tipos, está truncado o declara una dimensión nula. */
export function dimensiones(b: Buffer, mime: string | null): { ancho: number; alto: number } | null {
  const medida = ((): { ancho: number; alto: number } | null => {
    if (mime === "image/png") return b.length >= 24 ? { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) } : null;
    if (mime === "image/gif") return b.length >= 10 ? { ancho: b.readUInt16LE(6), alto: b.readUInt16LE(8) } : null;
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marcador = b[i + 1]!;
        if (marcador === 0xff) { i++; continue; }
        if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue; }
        const largo = b.readUInt16BE(i + 2);
        // SOF0..SOF15, salvo DHT (C4), JPG (C8) y DAC (CC)
        if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
          return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
        }
        i += 2 + largo;
      }
    }
    return null;
  })();
  return medida && medida.ancho > 0 && medida.alto > 0 ? medida : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Medición de los originales
// ---------------------------------------------------------------------------------------------------------------
const sinArchivo = (extra: Partial<Medicion> = {}): Medicion => ({ estado: "original faltante", archivo: null, diferenciaDeNombre: null, bytes: null, sha256: null, mime: null, ancho: null, alto: null, ...extra });

/** Formatos con lector de dimensiones: los demás (aunque se reconozcan por contenido) no se pueden medir. */
export const MIMES_SOPORTADOS: readonly string[] = ["image/jpeg", "image/png", "image/gif"];

/** ¿La clave es una ruta relativa de uploads sin trucos (sin "..", sin segmentos vacíos, sin barras invertidas ni unidades)? */
export function claveSegura(clave: string): boolean {
  if (!clave || clave.startsWith("/")) return false;
  return clave.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !/[\\:\u0000]/.test(s));
}

/**
 * Medidor de originales sobre una carpeta. El nombre se compara contra el contenido real de la carpeta, sensible a mayúsculas
 * y con NFC en ambos lados (Windows no distingue mayúsculas, así que nunca se abre un nombre que no coincida exacto).
 * Solo lee: readdirSync y readFileSync.
 */
export function crearMedidor(carpeta: string): (clave: string) => Medicion {
  const cache = new Map<string, string[]>();
  const listar = (d: string) => { if (!cache.has(d)) cache.set(d, readdirSync(d)); return cache.get(d)!; };
  return (clave) => {
    if (!claveSegura(clave)) return sinArchivo({ estado: "ilegible", motivo: "la clave no es una ruta relativa válida" });
    const segmentos = clave.split("/");
    let dir = carpeta;
    let diferenciaDeNombre: Medicion["diferenciaDeNombre"] = null;
    for (let i = 0; i < segmentos.length; i++) {
      const buscado = segmentos[i]!;
      let nombres: string[];
      try { nombres = listar(dir); } catch { return sinArchivo(); }
      let real = nombres.includes(buscado) ? buscado : undefined;
      if (real === undefined) {
        real = nombres.find((n) => aNFC(n) === aNFC(buscado));
        if (real !== undefined) diferenciaDeNombre = "normalizacion_unicode";
      }
      if (real === undefined) {
        const otra = nombres.find((n) => aNFC(n).toLowerCase() === aNFC(buscado).toLowerCase());
        return sinArchivo(otra !== undefined ? { diferenciaDeNombre: "mayusculas", archivoConOtraCapitalizacion: otra } : {});
      }
      dir = join(dir, real);
      if (i === segmentos.length - 1) {
        let b: Buffer;
        try { b = readFileSync(dir); } catch { return sinArchivo({ estado: "ilegible", archivo: real, diferenciaDeNombre, motivo: "no se pudo leer el archivo" }); }
        const mime = tipoPorContenido(b);
        const d = mime !== null && MIMES_SOPORTADOS.includes(mime) ? dimensiones(b, mime) : null;
        const base = { archivo: real, diferenciaDeNombre, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex"), mime, ancho: d?.ancho ?? null, alto: d?.alto ?? null };
        if (d) return { estado: "medida", ...base };
        const motivo = mime === null ? "tipo de contenido no reconocido" : MIMES_SOPORTADOS.includes(mime) ? `no se pudieron leer las dimensiones de ${mime}` : `formato no soportado: ${mime}`;
        return { estado: "ilegible", ...base, motivo };
      }
    }
    return sinArchivo();
  };
}

/** Mide cada clave distinta (clave en NFC -> medición). Es la única parte impura de la preparación del Plan. */
export function medirImagenes(carpeta: string, claves: Iterable<string>): Map<string, Medicion> {
  const medir = crearMedidor(carpeta);
  const res = new Map<string, Medicion>();
  for (const c of claves) { const k = aNFC(c); if (!res.has(k)) res.set(k, medir(k)); }
  return res;
}

