import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";

// Procesamiento de una imagen subida desde el panel (decisiones del 22/10/2026):
//  - el tipo se decide por el contenido real del archivo, no por su nombre ni por lo que diga el navegador: JPEG, PNG, WebP o GIF;
//  - tamaño máximo de 10 MB y 8000 píxeles por lado;
//  - se guarda una versión normalizada: se aplica la rotación de la foto (EXIF) y se borran todos los metadatos (ubicación GPS, cámara,
//    fechas), conservando el perfil de color para que los colores no cambien. Las imágenes animadas (GIF o WebP con varios cuadros) se
//    guardan tal cual, porque volver a codificarlas rompería la animación;
//  - se mide el resultado y se calcula su SHA-256 (sirve de ETag y para reconocer una imagen repetida).

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_LADO = 8000;

export type FormatoImagen = "jpeg" | "png" | "webp" | "gif";

const FORMATOS: Record<FormatoImagen, { mime: string; extension: string }> = {
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  png: { mime: "image/png", extension: "png" },
  webp: { mime: "image/webp", extension: "webp" },
  gif: { mime: "image/gif", extension: "gif" },
};

/** Un problema con la imagen, con el estado HTTP que le corresponde y un mensaje listo para mostrar. */
export class ErrorImagen extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export interface ImagenProcesada {
  buffer: Buffer;
  formato: FormatoImagen;
  mime: string;
  extension: string;
  ancho: number;
  alto: number;
  bytes: number;
  hash: string;
}

const esFormato = (f: string | undefined): f is FormatoImagen => f !== undefined && f in FORMATOS;

export async function procesarImagen(entrada: Buffer): Promise<ImagenProcesada> {
  if (entrada.length === 0) throw new ErrorImagen(400, "El archivo está vacío. Elegí otra imagen.");
  if (entrada.length > MAX_BYTES) throw new ErrorImagen(413, `La imagen pesa más de ${MAX_BYTES / 1024 / 1024} MB. Reducila y probá de nuevo.`);

  const opciones = { limitInputPixels: MAX_LADO * MAX_LADO, animated: true } as const;
  let meta: Metadata;
  try {
    meta = await sharp(entrada, opciones).metadata();
  } catch {
    throw new ErrorImagen(422, "No se pudo leer la imagen. Probá con otro archivo.");
  }
  if (!esFormato(meta.format)) throw new ErrorImagen(415, "Solo se pueden subir imágenes JPEG, PNG, WebP o GIF.");
  const formato = meta.format;

  // En una imagen animada, height es la suma de los cuadros: el alto real es pageHeight.
  const animada = (meta.pages ?? 1) > 1;
  const anchoOriginal = meta.width ?? 0;
  const altoOriginal = (animada ? meta.pageHeight : meta.height) ?? 0;
  if (anchoOriginal < 1 || altoOriginal < 1) throw new ErrorImagen(422, "No se pudo leer la imagen. Probá con otro archivo.");
  if (anchoOriginal > MAX_LADO || altoOriginal > MAX_LADO) {
    throw new ErrorImagen(422, `La imagen es demasiado grande (${anchoOriginal} × ${altoOriginal} píxeles). El máximo es ${MAX_LADO} píxeles por lado.`);
  }

  let buffer: Buffer;
  let ancho = anchoOriginal;
  let alto = altoOriginal;
  if (animada) {
    buffer = entrada;
  } else {
    try {
      // Sin withMetadata(): sharp descarta EXIF, XMP e IPTC. keepIccProfile() conserva solo el perfil de color.
      const base = sharp(entrada, { limitInputPixels: MAX_LADO * MAX_LADO }).rotate().keepIccProfile();
      const salida =
        formato === "jpeg" ? base.jpeg({ quality: 90 }) : formato === "png" ? base.png({ compressionLevel: 9 }) : formato === "webp" ? base.webp({ quality: 90 }) : base.gif();
      const { data, info } = await salida.toBuffer({ resolveWithObject: true });
      buffer = data;
      ancho = info.width;
      alto = info.height;
    } catch {
      throw new ErrorImagen(422, "No se pudo procesar la imagen. Probá con otro archivo.");
    }
  }
  if (buffer.length > MAX_BYTES) throw new ErrorImagen(413, `La imagen pesa más de ${MAX_BYTES / 1024 / 1024} MB. Reducila y probá de nuevo.`);

  return {
    buffer,
    formato,
    mime: FORMATOS[formato].mime,
    extension: FORMATOS[formato].extension,
    ancho,
    alto,
    bytes: buffer.length,
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
}

/**
 * Nombre del archivo tal como lo mandó el navegador. multer lo decodifica como latin1: un nombre con tildes llega con los
 * bytes de UTF-8 mal leídos ("Ã\u0081ngel") y acá se corrige. Sin carpetas, sin caracteres de control, hasta 255 caracteres.
 */
export function nombreOriginalLimpio(nombre: string | undefined): string {
  let n = nombre ?? "";
  const reinterpretado = Buffer.from(n, "latin1").toString("utf8");
  if (/^[\u0000-ÿ]*$/.test(n) && !reinterpretado.includes("�")) n = reinterpretado;
  n = (n.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (n || "imagen").slice(0, 255);
}

/** Clave segura de un archivo subido: un solo tramo, sin tildes ni símbolos, con parte del hash para que no se repita. */
export function claveParaSubida(nombreOriginal: string, hash: string, extension: string): string {
  const base = nombreOriginal
    .replace(/\.[^.]*$/, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${base || "imagen"}-${hash.slice(0, 12)}.${extension}`;
}
