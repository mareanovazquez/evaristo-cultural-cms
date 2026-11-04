// Extracción de los originales del paquete de `uploads` (fase 7, etapa 0b). Funciones puras más la lectura del `.tar`; no toca ninguna base.
//
// El paquete se lee en bytes (el `tar` de Windows altera los nombres con tildes). Cada adjunto de WordPress (`_wp_attached_file`) se busca entre los
// archivos del paquete en este orden, y gana el primer nivel con un solo candidato:
//   1. exacto       el nombre UTF-8 del paquete es la clave (comparando en NFC).
//   2. cp850        el nombre está en la codificación vieja CP850 (`rese¤a.jpg` es `reseña.jpg`) y, decodificado, es la clave.
//   3. cola         el nombre tiene ceros pegados a la extensión (`.jpg0`, `.png000`) y, sin ellos, es la clave.
//   4. mayusculas   el nombre es la clave salvo mayúsculas (los pares `Mankell.jpg` / `mankell.jpg`, que en el paquete tienen un solo archivo).
// Dos candidatos en un mismo nivel es un error (ambiguo): no se adivina. Un adjunto sin candidato es un error (faltante).
// Los archivos que quedan compartidos por dos adjuntos se resuelven con `resolverCompartidos` (más abajo).
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { asignarClavesCms, claveComparable, type AdjuntoConClave, type ResultadoClavesCms } from "./claves-cms.ts";

// ---------------------------------------------------------------- CP850

const CP850_ALTO = [
  "ÇüéâäàåçêëèïîìÄÅ", "ÉæÆôöòûùÿÖÜø£Ø×ƒ", "áíóúñÑªº¿®¬½¼¡«»", "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐",
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤", "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀", "ÓßÔÒõÕµþÞÚÛÙýÝ¯´", "­±‗¾¶§÷¸°¨·¹³²■ ",
].join("");
if ([...CP850_ALTO].length !== 128) throw new Error("tabla CP850 mal armada");
const CP850 = [...CP850_ALTO];

/** Decodifica bytes en CP850 (la página de códigos de la consola de Windows en español): 0x00-0x7F es ASCII. */
export function decodificarCp850(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : CP850[x - 0x80]!;
  return s;
}

const utf8Estricto = new TextDecoder("utf-8", { fatal: true });
/** El nombre en UTF-8, o null si sus bytes no son UTF-8 válido. */
export function decodificarUtf8(b: Uint8Array): string | null {
  try { return utf8Estricto.decode(b); } catch { return null; }
}

// ---------------------------------------------------------------- tar

export interface EntradaTar {
  /** El nombre tal como está en el paquete (bytes), sin el `./` inicial. */
  nombre: Buffer;
  /** Posición del contenido dentro del paquete. */
  inicio: number;
  bytes: number;
}
export interface LectorTar { total: number; leer(posicion: number, largo: number): Buffer }
export interface IndiceTar { archivos: EntradaTar[]; carpetas: number; otros: Array<{ nombre: string; tipo: string }> }

const octal = (b: Buffer, o: number, l: number): number => {
  if (b[o]! & 0x80) { // base 256 (GNU, para tamaños grandes)
    let v = BigInt(b[o]! & 0x7f);
    for (let i = 1; i < l; i++) v = (v << 8n) | BigInt(b[o + i]!);
    return Number(v);
  }
  const s = b.subarray(o, o + l).toString("latin1").replace(/\0.*$/s, "").trim();
  if (s === "") return 0;
  if (!/^[0-7]+$/.test(s)) throw new Error(`campo octal inválido: «${s}»`);
  return parseInt(s, 8);
};
const hastaCero = (b: Buffer): Buffer => { const z = b.indexOf(0); return z < 0 ? b : b.subarray(0, z); };
const sinPuntoBarra = (b: Buffer): Buffer => (b[0] === 0x2e && b[1] === 0x2f ? b.subarray(2) : b);

/**
 * Recorre los encabezados del paquete (ustar, GNU con nombres largos `L` y POSIX con `path` en pax). Comprueba la suma de control de cada encabezado y que
 * el contenido no pase el final del archivo. Solo devuelve los archivos comunes; las carpetas se cuentan y los demás tipos (enlaces, etc.) se listan.
 */
export function indexarTar(lector: LectorTar): IndiceTar {
  const r: IndiceTar = { archivos: [], carpetas: 0, otros: [] };
  let pos = 0, nombreLargo: Buffer | null = null, rutaPax: Buffer | null = null, ceros = 0;
  while (pos + 512 <= lector.total) {
    const h = lector.leer(pos, 512);
    if (h.every((x) => x === 0)) { pos += 512; if (++ceros === 2) return r; continue; }
    ceros = 0;
    let suma = 0;
    for (let i = 0; i < 512; i++) suma += i >= 148 && i < 156 ? 0x20 : h[i]!;
    if (suma !== octal(h, 148, 8)) throw new Error(`encabezado dañado en la posición ${pos} (la suma de control no coincide)`);
    const bytes = octal(h, 124, 12), tipo = h[156] === 0 ? "0" : String.fromCharCode(h[156]!), inicio = pos + 512;
    if (inicio + bytes > lector.total) throw new Error(`el paquete está cortado: la entrada en la posición ${pos} pide ${bytes} bytes y el archivo termina antes`);
    pos = inicio + Math.ceil(bytes / 512) * 512;
    if (tipo === "L") { nombreLargo = hastaCero(lector.leer(inicio, bytes)); continue; }
    if (tipo === "x") {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(lector.leer(inicio, bytes).toString("latin1"));
      if (m) rutaPax = Buffer.from(m[1]!, "latin1");
      continue;
    }
    if (tipo === "g") continue;
    const posix = h.subarray(257, 263).toString("latin1") === "ustar\0" && h[345] !== 0;
    let nombre = rutaPax ?? nombreLargo ?? (posix ? Buffer.concat([hastaCero(h.subarray(345, 500)), Buffer.from("/"), hastaCero(h.subarray(0, 100))]) : hastaCero(h.subarray(0, 100)));
    nombreLargo = null; rutaPax = null;
    nombre = sinPuntoBarra(nombre);
    if (tipo === "5") { r.carpetas++; continue; }
    if (tipo === "0" || tipo === "7") r.archivos.push({ nombre: Buffer.from(nombre), inicio, bytes });
    else r.otros.push({ nombre: decodificarUtf8(nombre) ?? decodificarCp850(nombre), tipo });
  }
  if (pos < lector.total) throw new Error(`el paquete termina a mitad de un encabezado (posición ${pos})`);
  return r; // sin los dos bloques de ceros del final: se acepta, pero todo lo leído estaba completo
}

/** Lector de un `.tar` en disco, con lecturas posicionales (no carga el paquete en memoria). */
export function abrirTar(ruta: string): LectorTar & { cerrar(): void } {
  const fd = openSync(ruta, "r");
  return {
    total: fstatSync(fd).size,
    leer(posicion, largo) {
      const b = Buffer.alloc(largo);
      let leidos = 0;
      while (leidos < largo) {
        const n = readSync(fd, b, leidos, largo - leidos, posicion + leidos);
        if (n === 0) throw new Error(`lectura corta en la posición ${posicion + leidos}`);
        leidos += n;
      }
      return b;
    },
    cerrar: () => closeSync(fd),
  };
}

// ---------------------------------------------------------------- emparejamiento

export type Coincidencia = "exacto" | "cp850" | "cola" | "mayusculas";
export const NIVELES: readonly Coincidencia[] = ["exacto", "cp850", "cola", "mayusculas"];

export interface AdjuntoParaExtraer { id: number; clave: string }

export interface Emparejado { id: number; clave: string; entrada: EntradaTar; nombreEnPaquete: string; coincidencia: Coincidencia }
export interface ResultadoEmparejar {
  emparejados: Emparejado[];
  faltantes: AdjuntoParaExtraer[];
  /** Más de un archivo candidato en el primer nivel que encontró algo: no se adivina. */
  ambiguos: Array<AdjuntoParaExtraer & { nivel: Coincidencia; candidatos: string[] }>;
}

const nfc = (s: string) => s.normalize("NFC");
const quitarCola = (s: string) => s.replace(/(\.[A-Za-z]{2,5})0+$/, "$1");

/** El nombre legible de una entrada: UTF-8 si lo es, si no CP850. */
export const nombreLegible = (e: EntradaTar) => decodificarUtf8(e.nombre) ?? decodificarCp850(e.nombre);

export function emparejar(adjuntos: readonly AdjuntoParaExtraer[], entradas: readonly EntradaTar[]): ResultadoEmparejar {
  const indices = new Map<Coincidencia, Map<string, EntradaTar[]>>(NIVELES.map((n) => [n, new Map()]));
  const agregar = (nivel: Coincidencia, clave: string, e: EntradaTar) => {
    const m = indices.get(nivel)!, lista = m.get(clave);
    if (!lista) m.set(clave, [e]); else if (!lista.includes(e)) lista.push(e);
  };
  for (const e of entradas) {
    const utf8 = decodificarUtf8(e.nombre), cp850 = e.nombre.some((x) => x >= 0x80) ? decodificarCp850(e.nombre) : null;
    const lecturas = [utf8, cp850].filter((x): x is string => x !== null).map(nfc);
    if (utf8 !== null) agregar("exacto", nfc(utf8), e);
    if (cp850 !== null) agregar("cp850", nfc(cp850), e);
    for (const l of lecturas) { const sc = quitarCola(l); if (sc !== l) agregar("cola", sc, e); }
    for (const l of lecturas) { agregar("mayusculas", l.toLowerCase(), e); agregar("mayusculas", quitarCola(l).toLowerCase(), e); }
  }
  const r: ResultadoEmparejar = { emparejados: [], faltantes: [], ambiguos: [] };
  for (const a of adjuntos) {
    const c = nfc(a.clave);
    let hecho = false;
    for (const nivel of NIVELES) {
      const cand = indices.get(nivel)!.get(nivel === "mayusculas" ? c.toLowerCase() : c);
      if (!cand) continue;
      if (cand.length > 1) r.ambiguos.push({ ...a, nivel, candidatos: cand.map(nombreLegible) });
      else r.emparejados.push({ id: a.id, clave: a.clave, entrada: cand[0]!, nombreEnPaquete: nombreLegible(cand[0]!), coincidencia: nivel });
      hecho = true;
      break;
    }
    if (!hecho) r.faltantes.push(a);
  }
  return r;
}

// ---------------------------------------------------------------- plan de extracción

/** Un archivo a escribir en el destino, con el nombre de la clave del adjunto que lo representa. */
export interface ArchivoAExtraer { nombreDestino: string; entrada: EntradaTar; adjuntos: Emparejado[] }
export interface PlanExtraccion {
  archivos: ArchivoAExtraer[];
  /** Archivos del paquete que usan dos adjuntos o más (los pares que solo difieren en mayúsculas): se escriben una vez, con la clave del mejor emparejado. */
  compartidos: ArchivoAExtraer[];
}

const RESERVADOS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/** null si la clave sirve como nombre de archivo plano en Windows; si no, el motivo. */
export function motivoNombreInvalido(clave: string): string | null {
  if (clave === "" || clave === "." || clave === "..") return "vacío o especial";
  if (/[\\/]/.test(clave)) return "tiene una barra (las claves de esta base son planas)";
  if (/[<>:"|?*\u0000-\u001f]/.test(clave)) return "tiene un carácter que Windows no admite";
  if (/[. ]$/.test(clave)) return "termina en punto o espacio";
  if (RESERVADOS.test(clave)) return "es un nombre reservado de Windows";
  return null;
}

export function planificar(emparejados: readonly Emparejado[]): PlanExtraccion {
  const porEntrada = new Map<EntradaTar, Emparejado[]>();
  for (const e of emparejados) { const l = porEntrada.get(e.entrada); if (l) l.push(e); else porEntrada.set(e.entrada, [e]); }
  const plan: PlanExtraccion = { archivos: [], compartidos: [] };
  for (const [entrada, lista] of porEntrada) {
    lista.sort((x, y) => NIVELES.indexOf(x.coincidencia) - NIVELES.indexOf(y.coincidencia) || x.id - y.id);
    const a: ArchivoAExtraer = { nombreDestino: nfc(lista[0]!.clave), entrada, adjuntos: lista };
    plan.archivos.push(a);
    if (lista.length > 1) plan.compartidos.push(a);
  }
  plan.archivos.sort((x, y) => x.entrada.inicio - y.entrada.inicio); // lectura en orden: el paquete se recorre de punta a punta una vez
  return plan;
}

// ---------------------------------------------------------------- archivos compartidos (decisión de Mariano, 4/11/2026)
//
// En el servidor hubo pares de adjuntos cuyos nombres solo difieren en mayúsculas (`Tapa-libro.jpg` / `tapa-libro.jpg`) y quedó un solo archivo.
// El dueño del archivo es el adjunto cuyas medidas declaradas coinciden con las del archivo (tiene que haber exactamente uno). Para cada uno de los
// demás, el original perdido se reemplaza por su miniatura más grande que conserva la proporción (una reducción, no un recorte), con la medida comprobada.
// Si algo de esto no se cumple, el par queda sin resolver y no se extrae nada: no se adivina.

export interface Medida { ancho: number; alto: number }
export interface DatosAdjunto { ancho?: number | null; alto?: number | null; tamanos?: ReadonlyArray<{ archivo: string; ancho: number; alto: number }> }
export interface Reemplazo {
  id: number; clave: string; nombreDestino: string;
  /** La miniatura que se usa como original y su posición en el paquete. */
  miniatura: string; entrada: EntradaTar; medida: Medida;
  /** Lo que declaraba WordPress para el original perdido. */
  original: Medida;
  /** El adjunto que se quedó con el archivo compartido. */
  dueno: { id: number; clave: string };
}
export interface ResolucionCompartidos { reemplazos: Reemplazo[]; sinResolver: Array<{ archivo: string; ids: number[]; motivo: string }> }

/** ¿La miniatura conserva la proporción del original (con 1,5 % de tolerancia por el redondeo)? */
export const esProporcional = (m: Medida, o: Medida) => Math.abs(m.ancho / m.alto - o.ancho / o.alto) / (o.ancho / o.alto) < 0.015;

/**
 * Decide cada archivo compartido del plan. Cambia el plan: el archivo queda con el nombre y el adjunto de su dueño; los demás adjuntos pasan a `reemplazos`.
 * `medir` lee las dimensiones de una entrada del paquete; `buscar` encuentra una entrada por su nombre (NFC).
 */
export function resolverCompartidos(
  plan: PlanExtraccion, datos: ReadonlyMap<number, DatosAdjunto>, medir: (e: EntradaTar) => Medida | null, buscar: (nombre: string) => EntradaTar | undefined,
): ResolucionCompartidos {
  const r: ResolucionCompartidos = { reemplazos: [], sinResolver: [] };
  for (const a of plan.compartidos) {
    const ids = a.adjuntos.map((x) => x.id), falla = (motivo: string) => r.sinResolver.push({ archivo: a.nombreDestino, ids, motivo });
    const m = medir(a.entrada);
    if (!m) { falla("no se pudieron leer las medidas del archivo"); continue; }
    const duenos = a.adjuntos.filter((x) => { const d = datos.get(x.id); return d?.ancho === m.ancho && d?.alto === m.alto; });
    if (duenos.length !== 1) { falla(duenos.length ? "las medidas coinciden con más de un adjunto" : `las medidas del archivo (${m.ancho}×${m.alto}) no coinciden con ningún adjunto`); continue; }
    const dueno = duenos[0]!, propios: Reemplazo[] = [];
    let ok = true;
    for (const x of a.adjuntos) {
      if (x === dueno) continue;
      const d = datos.get(x.id);
      if (!d?.ancho || !d.alto) { falla(`el adjunto ${x.id} no declara las medidas de su original`); ok = false; break; }
      const original = { ancho: d.ancho, alto: d.alto };
      let mejor: { miniatura: string; entrada: EntradaTar; medida: Medida } | null = null;
      for (const t of d.tamanos ?? []) {
        if (!esProporcional(t, original)) continue;
        const e = buscar(nfc(t.archivo));
        const mt = e ? medir(e) : null;
        if (!e || !mt || mt.ancho !== t.ancho || mt.alto !== t.alto) continue;
        if (!mejor || mt.ancho * mt.alto > mejor.medida.ancho * mejor.medida.alto) mejor = { miniatura: nfc(t.archivo), entrada: e, medida: mt };
      }
      if (!mejor) { falla(`el adjunto ${x.id} no tiene en el paquete ninguna miniatura proporcional con su medida`); ok = false; break; }
      propios.push({ id: x.id, clave: x.clave, nombreDestino: nfc(x.clave), ...mejor, original, dueno: { id: dueno.id, clave: dueno.clave } });
    }
    if (!ok) continue;
    a.nombreDestino = nfc(dueno.clave);
    a.adjuntos = [dueno];
    r.reemplazos.push(...propios);
  }
  return r;
}

// ---------------------------------------------------------------- escrituras con la clave del CMS (decisión 81)
//
// Todo va a una sola carpeta, con el nombre de la clave que el adjunto tiene en el CMS (lib/claves-cms.ts): así esa carpeta sirve tal cual de
// carpeta de imágenes del CMS. En los pares que el CMS no distingue, conserva la clave el dueño del archivo compartido (decisión 79) o, si no lo
// hay (los de tildes), el de id más bajo; el otro lleva el sufijo `-wp<id>`. Los nombres finales se comprueban acá: válidos en Windows y sin
// choques ni por mayúsculas ni por tildes.

export interface FilaDeEscritura { id: number; clave: string; nombreEnPaquete: string; coincidencia: Coincidencia | "miniatura"; comparteCon: string }
export interface Escritura { nombre: string; entrada: EntradaTar; filas: FilaDeEscritura[] }
export interface PlanEscrituras {
  escrituras: Escritura[];
  /** id -> clave en el CMS, solo de los renombrados. */
  renombradas: ReadonlyMap<number, string>;
  grupos: ResultadoClavesCms["grupos"];
  errores: string[];
}

export function armarEscrituras(plan: PlanExtraccion, res: ResolucionCompartidos): PlanEscrituras {
  const duenos = new Set(res.reemplazos.map((x) => x.dueno.id));
  const todos: AdjuntoConClave[] = [...plan.archivos.flatMap((a) => a.adjuntos.map((x) => ({ id: x.id, clave: x.clave }))), ...res.reemplazos.map((x) => ({ id: x.id, clave: x.clave }))];
  const cms = asignarClavesCms(todos, (ids) => ids.find((i) => duenos.has(i)) ?? Math.min(...ids));
  const claveCms = (id: number, clave: string) => cms.renombradas.get(id) ?? nfc(clave);
  const reemplazoDe = new Map(res.reemplazos.map((x) => [x.dueno.id, x.clave]));
  const errores = [...cms.errores];
  const escrituras: Escritura[] = [];
  for (const a of plan.archivos) {
    if (a.adjuntos.length !== 1) { errores.push(`el archivo «${a.nombreDestino}» sigue compartido por ${a.adjuntos.map((x) => x.id).join(", ")}`); continue; }
    const x = a.adjuntos[0]!;
    escrituras.push({ nombre: claveCms(x.id, x.clave), entrada: a.entrada, filas: [{ id: x.id, clave: x.clave, nombreEnPaquete: x.nombreEnPaquete, coincidencia: x.coincidencia, comparteCon: reemplazoDe.get(x.id) ?? "" }] });
  }
  for (const x of res.reemplazos) {
    escrituras.push({ nombre: claveCms(x.id, x.clave), entrada: x.entrada, filas: [{ id: x.id, clave: x.clave, nombreEnPaquete: x.miniatura, coincidencia: "miniatura", comparteCon: x.dueno.clave }] });
  }
  for (const e of escrituras) { const m = motivoNombreInvalido(e.nombre); if (m) errores.push(`«${e.nombre}» (adjunto ${e.filas[0]!.id}) ${m}`); }
  const vistos = new Map<string, string>();
  for (const e of escrituras) {
    const k = claveComparable(e.nombre), otro = vistos.get(k);
    if (otro !== undefined) errores.push(`«${e.nombre}» choca con «${otro}» (el CMS no los distingue)`); else vistos.set(k, e.nombre);
  }
  escrituras.sort((x, y) => x.entrada.inicio - y.entrada.inicio);
  return { escrituras, renombradas: cms.renombradas, grupos: cms.grupos, errores };
}

// ---------------------------------------------------------------- fotos de autor (decisión 80)
//
// BuddyPress guarda el avatar de cada usuario en `avatars/<id de usuario>/<único>-bpfull.<ext>` (300 × 300) y una miniatura `-bpthumb`. Se extrae
// solo el `bpfull`, a la misma carpeta que los originales, como `avatar-<id de usuario>.<ext>`: así `/media/` lo sirve igual que cualquier imagen.

export interface Avatar { wpUserId: number; nombre: string; nombreEnPaquete: string; entrada: EntradaTar }
export interface PlanAvatares { avatares: Avatar[]; errores: string[] }

const AVATAR = /^avatars\/(\d+)\/[^/]+-bpfull\.(jpe?g|png|gif|webp)$/i;

/** Los avatares del paquete. `usados`: los nombres que ya van a la carpeta (los originales); un avatar no puede chocar con ninguno. */
export function planAvatares(entradas: readonly EntradaTar[], usados: readonly string[]): PlanAvatares {
  const porUsuario = new Map<number, EntradaTar[]>();
  for (const e of entradas) {
    const m = AVATAR.exec(nombreLegible(e).normalize("NFC"));
    if (m) porUsuario.set(Number(m[1]), [...(porUsuario.get(Number(m[1])) ?? []), e]);
  }
  const r: PlanAvatares = { avatares: [], errores: [] };
  const vistos = new Map(usados.map((n) => [claveComparable(n), n]));
  for (const [wpUserId, lista] of [...porUsuario].sort((a, b) => a[0] - b[0])) {
    if (lista.length > 1) { r.errores.push(`el usuario ${wpUserId} tiene ${lista.length} avatares bpfull: ${lista.map(nombreLegible).join(" | ")}`); continue; }
    const e = lista[0]!, ext = AVATAR.exec(nombreLegible(e))![2]!.toLowerCase().replace("jpeg", "jpg");
    const nombre = `avatar-${wpUserId}.${ext}`, otro = vistos.get(claveComparable(nombre));
    if (otro !== undefined) { r.errores.push(`«${nombre}» choca con «${otro}»`); continue; }
    vistos.set(claveComparable(nombre), nombre);
    r.avatares.push({ wpUserId, nombre, nombreEnPaquete: nombreLegible(e), entrada: e });
  }
  return r;
}

export interface FilaMapaAvatar { wpUserId: number; claveCms: string; nombreEnPaquete: string; bytes: number; sha256: string }
const CABECERA_AVATARES = ["wp_user_id", "clave_cms", "nombre_en_paquete", "bytes", "sha256"] as const;

/** `mapa-avatares.csv`: una fila por usuario con avatar, ordenada por id. Con BOM para Excel. */
export function mapaAvataresCsv(filas: readonly FilaMapaAvatar[]): string {
  const cuerpo = [...filas].sort((a, b) => a.wpUserId - b.wpUserId).map((f) => [f.wpUserId, f.claveCms, f.nombreEnPaquete, f.bytes, f.sha256].map(celda).join(","));
  return "﻿" + [CABECERA_AVATARES.join(","), ...cuerpo].join("\r\n") + "\r\n";
}

/** Lee `mapa-avatares.csv` (id de usuario -> clave en el CMS). Falla si la cabecera no es la esperada o una fila está mal. */
export function leerMapaAvataresCsv(texto: string): Map<number, string> {
  const filas = filasCsv(texto);
  if (filas[0]?.join(",") !== CABECERA_AVATARES.join(",")) throw new Error(`el mapa de avatares no tiene la cabecera esperada (${CABECERA_AVATARES.join(",")})`);
  const r = new Map<number, string>();
  for (const [n, f] of filas.slice(1).entries()) {
    const id = Number(f[0]);
    if (f.length !== CABECERA_AVATARES.length || !Number.isInteger(id) || id <= 0 || !f[1]) throw new Error(`fila ${n + 2} del mapa de avatares inválida`);
    if (r.has(id)) throw new Error(`el usuario ${id} está dos veces en el mapa de avatares`);
    r.set(id, f[1]);
  }
  return r;
}

// ---------------------------------------------------------------- mapa

export interface FilaMapa extends FilaDeEscritura { claveCms: string; bytes: number; sha256: string }

const CABECERA_MAPA = ["id_adjunto", "clave", "clave_cms", "nombre_en_paquete", "coincidencia", "comparte_archivo_con", "bytes", "sha256"] as const;
const celda = (v: string | number) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** `mapa-originales.csv`: una fila por adjunto, ordenada por id. `clave_cms` es el nombre del archivo en la carpeta. Con BOM para Excel. */
export function mapaCsv(filas: readonly FilaMapa[]): string {
  const cuerpo = [...filas].sort((a, b) => a.id - b.id).map((f) => [f.id, f.clave, f.claveCms, f.nombreEnPaquete, f.coincidencia, f.comparteCon, f.bytes, f.sha256].map(celda).join(","));
  return "﻿" + [CABECERA_MAPA.join(","), ...cuerpo].join("\r\n") + "\r\n";
}

/** Lo que la migración necesita del mapa: la clave en el CMS de cada adjunto y si su original es una miniatura (decisión 79). */
export interface EntradaMapa { clave: string; claveCms: string; coincidencia: string }

/** Las filas de un CSV (sin BOM ni líneas vacías), con comillas dobles como en Excel. */
function filasCsv(texto: string): string[][] {
  const lineas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l !== "");
  return lineas.map((l) => {
    const c: string[] = []; let s = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { s += '"'; i++; } else q = false; } else s += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { c.push(s); s = ""; } else s += ch;
    }
    c.push(s);
    return c;
  });
}

/** Lee `mapa-originales.csv` (id de adjunto -> entrada). Falla si la cabecera no es la esperada o una fila está mal. */
export function leerMapaCsv(texto: string): Map<number, EntradaMapa> {
  const filas = filasCsv(texto);
  if (filas[0]?.join(",") !== CABECERA_MAPA.join(",")) throw new Error(`el mapa no tiene la cabecera esperada (${CABECERA_MAPA.join(",")})`);
  const r = new Map<number, EntradaMapa>();
  for (const [n, f] of filas.slice(1).entries()) {
    const id = Number(f[0]);
    if (f.length !== CABECERA_MAPA.length || !Number.isInteger(id) || id <= 0 || !f[1] || !f[2]) throw new Error(`fila ${n + 2} del mapa inválida`);
    if (r.has(id)) throw new Error(`el adjunto ${id} está dos veces en el mapa`);
    r.set(id, { clave: f[1], claveCms: f[2], coincidencia: f[4]! });
  }
  return r;
}

// ---------------------------------------------------------------- argumentos

export interface Argumentos { paquete: string; base: string; prefijo: string; destino: string | null; mapa: string | null }

export function parsearArgumentos(argv: readonly string[]): Argumentos | string {
  let paquete: string | null = null, base: string | null = null, prefijo = "wp_", destino: string | null = null, mapa: string | null = null;
  for (const a of argv) {
    const [clave, ...resto] = a.split("=");
    const valor = resto.length ? resto.join("=") : null;
    switch (clave) {
      case "--paquete": if (!valor) return "--paquete necesita un valor"; paquete = valor; break;
      case "--base": if (!valor || !/^[A-Za-z0-9_]+$/.test(valor)) return "--base: solo letras, números y guion bajo"; base = valor; break;
      case "--prefijo": if (!valor || !/^[A-Za-z0-9_]+$/.test(valor)) return "--prefijo: solo letras, números y guion bajo"; prefijo = valor; break;
      case "--destino": if (!valor) return "--destino necesita un valor"; destino = valor; break;
      case "--mapa": if (!valor) return "--mapa necesita un valor"; mapa = valor; break;
      default: return `argumento desconocido: ${a}`;
    }
  }
  if (paquete === null) return "falta --paquete=<uploads-completo.tar>";
  if (base === null) return "falta --base=<base de WordPress en la 3307> (no hay valor por defecto: tiene que ser la del mismo día que el paquete)";
  if (mapa !== null && destino === null) return "--mapa solo tiene sentido con --destino";
  return { paquete, base, prefijo, destino, mapa };
}
