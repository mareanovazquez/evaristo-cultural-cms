// Imágenes del cuerpo que apuntan a otros sitios (decisión 90, 7/11/2026): se bajan y se guardan como imágenes propias del CMS.
//
// La migración dejó tal cual 11 nodos `imagen` cuyo src no era de WordPress. Acá están TODOS, uno por uno, con de dónde se baja cada uno
// (revisado a mano el 7/11/2026): siete siguen en su sitio, dos solo están en el Internet Archive (revistaseda.com.ar ya no existe) y uno
// es el píxel de seguimiento de Gmail (1 × 1, invisible), que se quita en vez de bajarse. Un src externo que no esté en esta lista no se
// toca y se informa: la herramienta nunca baja una dirección que no se haya revisado.
//
// Cada imagen pasa por `procesarImagen` (lo mismo que una subida del panel: tipo por el contenido, 10 MB y 8000 px como máximo, sin
// metadatos) y se guarda en `<carpeta>/<nombre>-<hash>.<ext>` (la misma forma de clave que una subida del panel; las claves son de un solo tramo), con su fila en `imagenes`. El nodo queda con src `/media/<clave>`
// y su `imagenId`; el texto alternativo, el epígrafe y las demás marcas no cambian.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { PrismaClient } from "@evaristo/compartido/db";
import { contarImagenesPendientes, validateArticleBodyDetallado, type JSONNode } from "@evaristo/compartido/schema";
import { urlMedia } from "@evaristo/compartido/urls";
import { claveParaSubida, MAX_BYTES, procesarImagen, type ImagenProcesada } from "../admin/procesar-imagen.js";

export type Fuente = { quitar: true; motivo: string } | { quitar?: false; descarga: string; nombre: string };

const archivo = (fecha: string, url: string) => `https://web.archive.org/web/${fecha}id_/${url}`;

/** src tal como está en el cuerpo → qué hacer con él. */
export const FUENTES: ReadonlyMap<string, Fuente> = new Map<string, Fuente>([
  ["https://ssl.gstatic.com/ui/v1/icons/mail/images/cleardot.gif", { quitar: true, motivo: "píxel de seguimiento de Gmail (1 × 1, invisible)" }],
  ["http://sedamagazine.files.wordpress.com/2013/04/sang-1.jpg", { descarga: "https://sedamagazine.wordpress.com/wp-content/uploads/2013/04/sang-1.jpg", nombre: "sang-1.jpg" }],
  ["http://sedamagazine.files.wordpress.com/2013/04/poema-kenji-1.jpg", { descarga: "https://sedamagazine.wordpress.com/wp-content/uploads/2013/04/poema-kenji-1.jpg", nombre: "poema-kenji-1.jpg" }],
  ["http://sedamagazine.files.wordpress.com/2013/04/poema-kenji-autor.jpg", { descarga: "https://sedamagazine.wordpress.com/wp-content/uploads/2013/04/poema-kenji-autor.jpg", nombre: "poema-kenji-autor.jpg" }],
  ["http://www.revistaseda.com.ar/images/stories/revista27/Lafcadio%201.jpg", { descarga: archivo("20160601174811", "http://www.revistaseda.com.ar/images/stories/revista27/Lafcadio%201.jpg"), nombre: "Lafcadio 1.jpg" }],
  ["http://revistaseda.com.ar/wp/wp-content/uploads/2013/03/budismo-2.jpg", { descarga: archivo("20131008201422", "http://revistaseda.com.ar/wp/wp-content/uploads/2013/03/budismo-2.jpg"), nombre: "budismo-2.jpg" }],
  ["http://sedamagazine.files.wordpress.com/2013/04/grossman-autor.jpg", { descarga: "https://sedamagazine.wordpress.com/wp-content/uploads/2013/04/grossman-autor.jpg", nombre: "grossman-autor.jpg" }],
  ["http://sedamagazine.files.wordpress.com/2013/04/grossman-1.jpg", { descarga: "https://sedamagazine.wordpress.com/wp-content/uploads/2013/04/grossman-1.jpg", nombre: "grossman-1.jpg" }],
  [
    "https://ci5.googleusercontent.com/proxy/fRaGVJPHEpo8tIG9stafTYcy26aXOWyaLH3fnSiL-vDZaRGOFLypV_KB9PGCcWSnjgxOtrFP1zc4StqcU339E8WLHDhyGurqRvUsb5csjwrIg712j9QpAsJ-Ze-D2KCinNlL2qWNcJIRaWvdDLC4LCdvNK0CAFnzHKnw77U=s0-d-e1-ft#https://gallery.mailchimp.com/758bad6c99afe20a17c9beadd/images/39729096-262d-4a41-a27a-9180e4695f59.jpg",
    { descarga: "https://mcusercontent.com/758bad6c99afe20a17c9beadd/images/39729096-262d-4a41-a27a-9180e4695f59.jpg", nombre: "39729096-262d-4a41-a27a-9180e4695f59.jpg" },
  ],
  ["https://sonaglioni.files.wordpress.com/2020/10/image.jpeg?w=318&h=222", { descarga: "https://sonaglioni.wordpress.com/wp-content/uploads/2020/10/image.jpeg", nombre: "image.jpeg" }],
  ["https://sonaglioni.files.wordpress.com/2020/10/pelo.jpg?w=235&h=307", { descarga: "https://sonaglioni.wordpress.com/wp-content/uploads/2020/10/pelo.jpg", nombre: "pelo.jpg" }],
]);

export const esExterno = (src: unknown): src is string => typeof src === "string" && src !== "" && !src.startsWith("/media/");

/** src externos de los nodos imagen de un cuerpo, en orden y con repetidos. */
export function srcExternos(doc: JSONNode): string[] {
  const salida: string[] = [];
  const recorrer = (n: JSONNode | undefined) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "imagen" && esExterno(n.attrs?.["src"])) salida.push(n.attrs["src"] as string);
    n.content?.forEach(recorrer);
  };
  recorrer(doc);
  return salida;
}

export interface Reemplazo {
  imagenId: number;
  clave: string;
}

/**
 * Cuerpo nuevo: cada nodo imagen con un src de `reemplazos` pasa a `/media/<clave>` con su imagenId (el resto de los atributos igual) y
 * cada uno de `quitar` desaparece. Los demás nodos quedan idénticos. No modifica el cuerpo que recibe.
 */
export function reescribirCuerpo(doc: JSONNode, reemplazos: ReadonlyMap<string, Reemplazo>, quitar: ReadonlySet<string>): { cuerpo: JSONNode; reemplazados: number; quitados: number } {
  let reemplazados = 0;
  let quitados = 0;
  const copiar = (n: JSONNode): JSONNode | null => {
    if (n.type === "imagen") {
      const src = n.attrs?.["src"];
      if (typeof src === "string" && quitar.has(src)) {
        quitados++;
        return null;
      }
      const r = typeof src === "string" ? reemplazos.get(src) : undefined;
      if (r) {
        reemplazados++;
        const attrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(n.attrs ?? {})) {
          if (k === "imagenId") continue;
          attrs[k] = v;
          if (k === "src") {
            attrs["src"] = urlMedia(r.clave);
            attrs["imagenId"] = r.imagenId;
          }
        }
        return { ...n, attrs };
      }
    }
    if (!n.content) return n;
    return { ...n, content: n.content.map(copiar).filter((x): x is JSONNode => x !== null) };
  };
  return { cuerpo: copiar(doc) ?? { type: "doc", content: [] }, reemplazados, quitados };
}

/** Baja una imagen con límite de tiempo y de tamaño. No sigue más que las redirecciones HTTP normales. */
export async function descargarImagen(url: string): Promise<Buffer> {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "evaristo-cms (recuperación de imágenes de la revista)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const largo = Number(r.headers.get("content-length") ?? "0");
  if (largo > MAX_BYTES) throw new Error(`pesa ${largo} bytes (máximo ${MAX_BYTES})`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > MAX_BYTES) throw new Error(`pesa ${b.length} bytes (máximo ${MAX_BYTES})`);
  return b;
}

export interface OpcionesTraer {
  prisma: PrismaClient;
  /** Carpeta de los originales (la de MEDIA_DIR del servidor): los archivos van ahí, junto a los de WordPress. */
  carpeta: string;
  escribir: boolean;
  descargar?: (url: string) => Promise<Buffer>;
  fuentes?: ReadonlyMap<string, Fuente>;
  /** Solo para las pruebas: limita los artículos que se miran. */
  articuloIds?: number[];
  log?: (linea: string) => void;
}

export interface ResultadoTraer {
  articulos: number;
  nodos: number;
  sinFuente: Array<{ articuloId: number; src: string }>;
  fallidas: Array<{ src: string; error: string }>;
  imagenesCreadas: number;
  imagenesReusadas: number;
  articulosCambiados: number;
  saltados: Array<{ articuloId: number; motivo: string }>;
}

/** Busca, baja y (con `escribir`) guarda. Sin `escribir` no toca ni la base ni el disco. Repetirla después no hace nada. */
export async function traerImagenesExternas(o: OpcionesTraer): Promise<ResultadoTraer> {
  const log = o.log ?? ((l: string) => console.log(l));
  const fuentes = o.fuentes ?? FUENTES;
  const descargar = o.descargar ?? descargarImagen;
  const res: ResultadoTraer = { articulos: 0, nodos: 0, sinFuente: [], fallidas: [], imagenesCreadas: 0, imagenesReusadas: 0, articulosCambiados: 0, saltados: [] };

  // 1. Qué artículos tienen imágenes externas (lectura)
  const filas = await o.prisma.articulo.findMany({
    where: o.articuloIds ? { id: { in: o.articuloIds } } : {},
    select: { id: true, cuerpo: true, actualizadoEn: true, borrador: { select: { articuloId: true } } },
    orderBy: { id: "asc" },
  });
  const afectados = filas.map((a) => ({ ...a, externos: srcExternos(a.cuerpo as JSONNode) })).filter((a) => a.externos.length > 0);
  res.articulos = afectados.length;
  res.nodos = afectados.reduce((s, a) => s + a.externos.length, 0);
  const necesarios = new Set<string>();
  for (const a of afectados) {
    for (const src of a.externos) {
      const f = fuentes.get(src);
      if (!f) res.sinFuente.push({ articuloId: a.id, src });
      else if (!f.quitar) necesarios.add(src);
    }
    log(`  artículo ${a.id}: ${a.externos.length} imagen(es) externa(s)${a.borrador ? " (tiene un borrador de cambios abierto: se saltea)" : ""}`);
  }

  // 2. Bajar y procesar cada una (red; nada se guarda todavía)
  const procesadas = new Map<string, { p: ImagenProcesada; nombre: string; clave: string }>();
  for (const src of necesarios) {
    const f = fuentes.get(src) as Extract<Fuente, { descarga: string }>;
    try {
      const p = await procesarImagen(await descargar(f.descarga));
      const clave = claveParaSubida(f.nombre, p.hash, p.extension);
      procesadas.set(src, { p, nombre: f.nombre, clave });
      log(`  bajada: ${f.nombre} → ${clave} (${p.ancho} × ${p.alto}, ${p.bytes} bytes)`);
    } catch (e) {
      res.fallidas.push({ src, error: e instanceof Error ? e.message : String(e) });
      log(`  NO se pudo bajar ${f.descarga}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const [src, f] of fuentes) if (f.quitar && afectados.some((a) => a.externos.includes(src))) log(`  se quita: ${src.slice(0, 80)} (${f.motivo})`);
  if (!o.escribir) return res;

  // 3. Archivos: temporal + rename, nunca un archivo a medias con la clave final. Si ya está (una corrida anterior), tiene que ser igual.
  for (const { p, clave } of procesadas.values()) {
    const destino = join(o.carpeta, clave);
    const previo = await readFile(destino).catch(() => undefined);
    if (previo) {
      if (!previo.equals(p.buffer)) throw new Error(`ya existe ${destino} con otro contenido; no se pisa`);
      continue;
    }
    await mkdir(dirname(destino), { recursive: true });
    const temporal = join(dirname(destino), `.externa-${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(temporal, p.buffer, { flag: "wx" });
    try {
      await rename(temporal, destino);
    } catch (e) {
      await rm(temporal, { force: true });
      throw e;
    }
  }

  // 4. Base: filas de imagen y cuerpos, todo junto o nada
  const quitar = new Set([...fuentes].filter(([, f]) => f.quitar).map(([src]) => src));
  await o.prisma.$transaction(async (tx) => {
    const reemplazos = new Map<string, Reemplazo>();
    for (const [src, { p, nombre, clave }] of procesadas) {
      const igual = await tx.imagen.findFirst({ where: { OR: [{ clave }, { hash: p.hash }] }, orderBy: { id: "asc" }, select: { id: true, clave: true } });
      if (igual) {
        reemplazos.set(src, { imagenId: igual.id, clave: igual.clave });
        res.imagenesReusadas++;
        continue;
      }
      const creada = await tx.imagen.create({ data: { clave, nombreOriginal: nombre, tipoMime: p.mime, ancho: p.ancho, alto: p.alto, bytes: p.bytes, hash: p.hash }, select: { id: true } });
      reemplazos.set(src, { imagenId: creada.id, clave });
      res.imagenesCreadas++;
    }
    for (const a of afectados) {
      if (a.borrador) {
        res.saltados.push({ articuloId: a.id, motivo: "tiene un borrador de cambios abierto" });
        continue;
      }
      const viejo = a.cuerpo as JSONNode;
      const { cuerpo, reemplazados, quitados } = reescribirCuerpo(viejo, reemplazos, quitar);
      if (reemplazados + quitados === 0) continue;
      const erroresAntes = validateArticleBodyDetallado(viejo, { modo: "migracion" }).errores.length;
      const erroresDespues = validateArticleBodyDetallado(cuerpo, { modo: "migracion" }).errores;
      if (erroresDespues.length > erroresAntes) throw new Error(`el cuerpo nuevo del artículo ${a.id} no valida: ${erroresDespues.join("; ")}`);
      const menos = contarImagenesPendientes(viejo) - contarImagenesPendientes(cuerpo);
      // Solo si nadie lo cambió desde que se leyó (actualizadoEn igual)
      const n = await tx.articulo.updateMany({
        where: { id: a.id, actualizadoEn: a.actualizadoEn },
        data: { cuerpo: cuerpo as object, ...(menos > 0 ? { altPendientes: { decrement: menos } } : {}) },
      });
      if (n.count !== 1) throw new Error(`el artículo ${a.id} cambió mientras corría la herramienta; no se tocó nada`);
      res.articulosCambiados++;
      log(`  artículo ${a.id}: ${reemplazados} imagen(es) ahora en /media/${quitados ? `, ${quitados} quitada(s)` : ""}`);
    }
  });
  return res;
}
