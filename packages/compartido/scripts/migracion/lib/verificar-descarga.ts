// Verificación de la descarga de `wp-content/uploads` (fase 7, etapa 0). Funciones puras más la lectura de la carpeta; no toca ninguna base.
//
// Dos comparaciones, que responden a preguntas distintas:
//  - contra la BASE de WordPress (`_wp_attached_file`): ¿están todos los originales que la migración va a buscar, con el nombre exacto?
//    La migración compara el nombre exacto (NFC, sensible a mayúsculas), así que un nombre alterado equivale a un original faltante.
//  - contra la LISTA DEL SERVIDOR (`find ... -printf '%s\t%P\n'`): ¿llegó todo lo que había, con el mismo nombre y el mismo tamaño?
//    Detecta descargas cortadas y nombres alterados sin depender de la base.
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AdjuntoWp {
  id: number;
  /** `_wp_attached_file`: la ruta del original relativa a `uploads`, con barras `/`. */
  clave: string;
  /** `filesize` de `_wp_attachment_metadata`, si WordPress lo declara (no todas las versiones lo guardan). */
  bytesDeclarados: number | null;
  /** Rutas de las derivadas (miniaturas y tamaños) que WordPress declara en `_wp_attachment_metadata`. */
  derivadas: string[];
}
export interface ArchivoEnDisco { ruta: string; bytes: number }

/**
 * Cómo difiere el nombre de lo que hay en disco del que pide la base o el servidor. La migración compara en NFC (crearMedidor, lib/imagenes.ts):
 * una diferencia de `normalizacion` Unicode la tolera (es informativa); `mayusculas` y `tildes` no, y el original se daría por faltante.
 */
export type TipoDeAlteracion = "normalizacion" | "mayusculas" | "tildes";
export type AlteracionGrave = "mayusculas" | "tildes";

const aNFC = (s: string) => s.normalize("NFC");
const sinMayusculas = (s: string) => aNFC(s).toLowerCase();
const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Lista los archivos de una carpeta (y sus subcarpetas) con su tamaño. Las rutas van con `/`, tal como las nombra WordPress. */
export function listarCarpeta(carpeta: string): ArchivoEnDisco[] {
  const salida: ArchivoEnDisco[] = [];
  const recorrer = (dir: string, prefijo: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = prefijo ? `${prefijo}/${e.name}` : e.name;
      if (e.isDirectory()) recorrer(join(dir, e.name), ruta);
      else if (e.isFile()) salida.push({ ruta, bytes: statSync(join(dir, e.name)).size });
    }
  };
  recorrer(carpeta, "");
  return salida;
}

/** Busca `ruta` en los archivos: exacta (NFC) o, si no, la que más se le parece; null si no hay nada parecido. */
function crearBuscador(archivos: readonly ArchivoEnDisco[]) {
  const exacto = new Map<string, ArchivoEnDisco>(), crudo = new Set<string>();
  const porNfcMin = new Map<string, ArchivoEnDisco>(), porNfc = new Map<string, ArchivoEnDisco>(), porTildes = new Map<string, ArchivoEnDisco>();
  for (const a of archivos) {
    crudo.add(a.ruta);
    exacto.set(aNFC(a.ruta), a);
    if (!porNfc.has(aNFC(a.ruta))) porNfc.set(aNFC(a.ruta), a);
    if (!porNfcMin.has(sinMayusculas(a.ruta))) porNfcMin.set(sinMayusculas(a.ruta), a);
    if (!porTildes.has(sinTildes(a.ruta))) porTildes.set(sinTildes(a.ruta), a);
  }
  return (ruta: string): { archivo: ArchivoEnDisco; alteracion: null | TipoDeAlteracion } | null => {
    // Idéntico byte a byte
    if (crudo.has(ruta)) return { archivo: exacto.get(aNFC(ruta))!, alteracion: null };
    const nfc = porNfc.get(aNFC(ruta));
    if (nfc) return { archivo: nfc, alteracion: "normalizacion" };
    const min = porNfcMin.get(sinMayusculas(ruta));
    if (min) return { archivo: min, alteracion: "mayusculas" };
    const t = porTildes.get(sinTildes(ruta));
    if (t) return { archivo: t, alteracion: "tildes" };
    return null;
  };
}

/** `mayusculas`: solo difieren en la capitalización (chocan en Windows y en el CMS). `tildes`: difieren también en un acento (chocan solo en el CMS). */
export interface GrupoDeColision { claves: string[]; ids: number[]; tipo: "mayusculas" | "tildes" }

/** La clave como la compara `imagenes.clave` (colación utf8mb4_es_0900_ai_ci): sin mayúsculas y sin acentos, pero la ñ sigue siendo una letra distinta de la n. */
const claveDelCms = (s: string) => {
  const d = s.normalize("NFD");
  let salida = "";
  for (let i = 0; i < d.length; i++) {
    const c = d[i]!;
    if (/\p{M}/u.test(c) && !(c === "\u0303" && /[nN]/.test(d[i - 1] ?? ""))) continue;
    salida += c;
  }
  return salida.normalize("NFC").toLowerCase();
};

/**
 * Grupos de adjuntos cuyas claves el CMS no distingue entre sí: `TAPA.jpg` y `tapa.jpg`, o `Perón.jpg` y `peron.jpg`. En el servidor (Linux) conviven; en la
 * base del CMS chocan en `imagenes.clave` (única, con la colación es_0900_ai_ci); y los que solo difieren en mayúsculas tampoco caben en una carpeta de Windows.
 */
export function colisionesDeNombres(adjuntos: readonly AdjuntoWp[]): GrupoDeColision[] {
  const grupos = new Map<string, { claves: Set<string>; ids: number[] }>();
  for (const a of adjuntos) {
    const k = claveDelCms(a.clave);
    const g = grupos.get(k) ?? { claves: new Set<string>(), ids: [] };
    g.claves.add(aNFC(a.clave));
    g.ids.push(a.id);
    grupos.set(k, g);
  }
  return [...grupos.values()].filter((g) => g.claves.size > 1).map((g) => ({
    claves: [...g.claves].sort(),
    ids: g.ids.sort((x, y) => x - y),
    tipo: new Set([...g.claves].map(sinMayusculas)).size === 1 ? "mayusculas" as const : "tildes" as const,
  }));
}

const esDerivadaPorNombre = (ruta: string) => /-(?:\d+x\d+|scaled|e\d+)\.[A-Za-z0-9]+$/.test(ruta);

export interface ResultadoContraBase {
  adjuntos: number;
  /** Con el archivo en disco y un nombre que la migración reconoce (idéntico, o igual salvo la normalización Unicode). */
  exactos: number;
  /** Del total de `exactos`, los que solo difieren en la normalización Unicode (NFC/NFD): informativo, la migración los encuentra. */
  normalizados: Array<{ id: number; clave: string; archivo: string }>;
  /** Hay un archivo parecido pero el nombre cambió de mayúsculas o tildes: para la migración es un original faltante. */
  /** `colisionaCon`: las otras claves que el CMS no distingue de esta, si las hay (ver `colisionesDeNombres`). */
  alterados: Array<{ id: number; clave: string; archivo: string; alteracion: AlteracionGrave; colisionaCon?: string[] }>;
  faltantes: Array<{ id: number; clave: string; colisionaCon?: string[] }>;
  tamanoCero: Array<{ id: number; clave: string }>;
  /** El tamaño en disco no es el que declara WordPress: descarga cortada o archivo cambiado. */
  tamanoDistinto: Array<{ id: number; clave: string; declarado: number; enDisco: number }>;
  conTamanoDeclarado: number;
  /** Los grupos de claves que el CMS no distingue (mayúsculas o tildes); los de mayúsculas tampoco caben todos en una carpeta de Windows. */
  colisiones: GrupoDeColision[];
  /** Adjuntos que se dejaron aparte a propósito (por ejemplo, en `colisiones.tar`): no cuentan como faltantes. */
  apartados: Array<{ id: number; clave: string }>;
  /** Rutas de la lista de apartados que no corresponden a ningún adjunto de la base: la lista es de otra descarga o tiene un error. */
  apartadosSinAdjunto: string[];
  /** Archivos en la carpeta que ninguna fila de la base pide. */
  sobrantes: { derivadas: number; otros: string[] };
  bytesTotales: number;
}

export function compararConBase(adjuntos: readonly AdjuntoWp[], archivos: readonly ArchivoEnDisco[], apartados: ReadonlySet<string> = new Set()): ResultadoContraBase {
  const buscar = crearBuscador(archivos);
  const usados = new Set<string>();
  const r: ResultadoContraBase = { adjuntos: adjuntos.length, exactos: 0, normalizados: [], alterados: [], faltantes: [], tamanoCero: [], tamanoDistinto: [], conTamanoDeclarado: 0, colisiones: colisionesDeNombres(adjuntos), apartados: [], apartadosSinAdjunto: [], sobrantes: { derivadas: 0, otros: [] }, bytesTotales: 0 };
  const derivadasDeclaradas = new Set<string>();
  for (const a of adjuntos) for (const d of a.derivadas) derivadasDeclaradas.add(aNFC(d));
  const colisionaCon = new Map<string, string[]>();
  for (const g of r.colisiones) for (const c of g.claves) colisionaCon.set(c, g.claves.filter((x) => x !== c));
  const otras = (clave: string) => { const o = colisionaCon.get(aNFC(clave)); return o ? { colisionaCon: o } : {}; };
  const apartadosNFC = new Set([...apartados].map(aNFC));
  const clavesConocidas = new Set(adjuntos.map((a) => aNFC(a.clave)));
  r.apartadosSinAdjunto = [...apartadosNFC].filter((p) => !clavesConocidas.has(p)).sort();
  for (const a of adjuntos) {
    if (apartadosNFC.has(aNFC(a.clave))) { r.apartados.push({ id: a.id, clave: a.clave }); continue; }
    const m = buscar(a.clave);
    if (!m) { r.faltantes.push({ id: a.id, clave: a.clave, ...otras(a.clave) }); continue; }
    usados.add(m.archivo.ruta);
    if (m.alteracion === "mayusculas" || m.alteracion === "tildes") { r.alterados.push({ id: a.id, clave: a.clave, archivo: m.archivo.ruta, alteracion: m.alteracion, ...otras(a.clave) }); continue; }
    if (m.alteracion === "normalizacion") r.normalizados.push({ id: a.id, clave: a.clave, archivo: m.archivo.ruta });
    r.exactos++;
    r.bytesTotales += m.archivo.bytes;
    if (m.archivo.bytes === 0) r.tamanoCero.push({ id: a.id, clave: a.clave });
    if (a.bytesDeclarados !== null) {
      r.conTamanoDeclarado++;
      if (a.bytesDeclarados !== m.archivo.bytes && m.archivo.bytes > 0) r.tamanoDistinto.push({ id: a.id, clave: a.clave, declarado: a.bytesDeclarados, enDisco: m.archivo.bytes });
    }
  }
  for (const f of archivos) {
    if (usados.has(f.ruta)) continue;
    if (derivadasDeclaradas.has(aNFC(f.ruta)) || esDerivadaPorNombre(f.ruta)) r.sobrantes.derivadas++;
    else r.sobrantes.otros.push(f.ruta);
  }
  return r;
}

export interface ArchivoDelServidor { ruta: string; bytes: number }

export interface ResultadoContraServidor {
  enServidor: number;
  /** Llegaron con el nombre idéntico o igual salvo la normalización Unicode. */
  exactos: number;
  normalizados: Array<{ ruta: string; archivo: string }>;
  alterados: Array<{ ruta: string; archivo: string; alteracion: AlteracionGrave }>;
  faltantes: string[];
  tamanoDistinto: Array<{ ruta: string; servidor: number; enDisco: number }>;
  /** Archivos locales que el servidor no tiene (algo ajeno dejado en la carpeta). */
  sobrantes: string[];
  bytesServidor: number;
  bytesEnDisco: number;
}

export function compararConServidor(servidor: readonly ArchivoDelServidor[], archivos: readonly ArchivoEnDisco[]): ResultadoContraServidor {
  const buscar = crearBuscador(archivos);
  const usados = new Set<string>();
  const r: ResultadoContraServidor = { enServidor: servidor.length, exactos: 0, normalizados: [], alterados: [], faltantes: [], tamanoDistinto: [], sobrantes: [], bytesServidor: 0, bytesEnDisco: archivos.reduce((s, a) => s + a.bytes, 0) };
  for (const s of servidor) {
    r.bytesServidor += s.bytes;
    const m = buscar(s.ruta);
    if (!m) { r.faltantes.push(s.ruta); continue; }
    usados.add(m.archivo.ruta);
    if (m.alteracion === "mayusculas" || m.alteracion === "tildes") { r.alterados.push({ ruta: s.ruta, archivo: m.archivo.ruta, alteracion: m.alteracion }); continue; }
    if (m.alteracion === "normalizacion") r.normalizados.push({ ruta: s.ruta, archivo: m.archivo.ruta });
    r.exactos++;
    if (m.archivo.bytes !== s.bytes) r.tamanoDistinto.push({ ruta: s.ruta, servidor: s.bytes, enDisco: m.archivo.bytes });
  }
  for (const f of archivos) if (!usados.has(f.ruta)) r.sobrantes.push(f.ruta);
  return r;
}

/** Lee una lista de rutas, una por línea (por ejemplo `colisiones.txt`): ignora las líneas vacías y el BOM. */
export function leerListaDeRutas(texto: string): string[] {
  return texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l !== "");
}

/** Lee la lista del servidor (`find . -type f -printf '%s\t%P\n'`): una línea por archivo, tamaño, tabulación y ruta relativa. */
export function leerListaDelServidor(texto: string): ArchivoDelServidor[] {
  const salida: ArchivoDelServidor[] = [];
  for (const linea of texto.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!linea) continue;
    const i = linea.indexOf("\t");
    const bytes = i > 0 ? Number(linea.slice(0, i)) : NaN;
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error(`línea inválida en la lista del servidor (se esperaba «tamaño<TAB>ruta»): ${linea.slice(0, 60)}`);
    salida.push({ ruta: linea.slice(i + 1), bytes });
  }
  return salida;
}

/** Las rutas de las derivadas que declara `_wp_attachment_metadata` (PHP serializado), junto a la carpeta del original. */
export function derivadasDeMetadatos(serializado: string, clave: string): string[] {
  const dir = dirname(clave) === "." ? "" : `${dirname(clave)}/`;
  const salida: string[] = [];
  for (const m of serializado.matchAll(/s:4:"file";s:\d+:"([^"]+)"/g)) salida.push(`${dir}${m[1]!.split("/").pop()}`);
  return salida.filter((r) => r !== clave);
}

// Argumentos del comando (ver scripts/migracion/verificar-descarga.ts).
export interface Argumentos { uploads: string; listaServidor: string | null; apartados: string | null; base: string; prefijo: string; sinBase: boolean }

export function parsearArgumentos(argv: readonly string[]): Argumentos | string {
  let uploads: string | null = null, listaServidor: string | null = null, apartados: string | null = null, base = "evaristo_lectura", prefijo = "wp_", sinBase = false;
  for (const a of argv) {
    const [clave, ...resto] = a.split("=");
    const valor = resto.length ? resto.join("=") : null;
    switch (clave) {
      case "--uploads": if (!valor) return "--uploads necesita un valor"; uploads = valor; break;
      case "--lista-servidor": if (!valor) return "--lista-servidor necesita un valor"; listaServidor = valor; break;
      case "--apartados": if (!valor) return "--apartados necesita un valor"; apartados = valor; break;
      case "--base": if (!valor || !/^[A-Za-z0-9_]+$/.test(valor)) return "--base: solo letras, números y guion bajo"; base = valor; break;
      case "--prefijo": if (!valor || !/^[A-Za-z0-9_]+$/.test(valor)) return "--prefijo: solo letras, números y guion bajo"; prefijo = valor; break;
      case "--sin-base": if (valor !== null) return "--sin-base no lleva valor"; sinBase = true; break;
      default: return `argumento desconocido: ${a}`;
    }
  }
  if (uploads === null) return "falta --uploads=<carpeta>";
  if (sinBase && listaServidor === null) return "--sin-base necesita --lista-servidor (si no, no hay con qué comparar)";
  return { uploads, listaServidor, apartados, base, prefijo, sinBase };
}
