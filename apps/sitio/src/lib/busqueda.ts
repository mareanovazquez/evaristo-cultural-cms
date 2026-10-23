import { Prisma } from "@evaristo/compartido/db";
import { NOTAS_POR_PAGINA } from "./paginacion";
import { prisma } from "./prisma";
import { seleccionTarjeta } from "./articulos";

// Buscador del sitio (fase 6). Búsqueda de texto completo de MySQL (FULLTEXT, modo booleano) sobre título, bajada y texto plano del cuerpo,
// y también por el nombre de los autores. Sin dependencias nuevas.
//  - Todas las palabras tienen que estar (AND) y se aceptan al principio de una palabra: «garcia mar» encuentra «García Márquez».
//  - Ignora tildes y mayúsculas (lo hace la intercalación de la base, `utf8mb4_es_0900_ai_ci`).
//  - Entre comillas se busca una frase exacta: «"cien años"».
//  - Las palabras de menos de 3 letras no se buscan (el índice de MySQL las ignora). Se quita el guion blando (U+00AD) y otros caracteres invisibles.
//  - Ordena por relevancia (el título pesa 5 veces más que el resto) y, a igual relevancia, por la más nueva. Solo se ven las notas publicadas.

export const LARGO_MINIMO = 3;
export const MAX_PALABRAS = 8;
const LARGO_MAXIMO_CONSULTA = 120;
const LARGO_MAXIMO_PALABRA = 40;
// Guion blando, caracteres de ancho cero y marcas de dirección: no se ven y rompen la coincidencia
const INVISIBLES = /[­​-‏‪-‮⁠﻿]/g;

export interface Consulta {
  /** Lo que se escribió, ya limpio (para mostrarlo y para los enlaces de paginación). */
  texto: string;
  palabras: string[];
  frases: string[];
  /** La consulta para MATCH … AGAINST (… IN BOOLEAN MODE). */
  booleana: string;
}

/** Entiende lo que escribió la persona. Devuelve null si no hay nada que buscar (vacío o solo palabras demasiado cortas). */
export function interpretarConsulta(entrada: string | null | undefined): Consulta | null {
  const limpio = (entrada ?? "").normalize("NFC").replace(INVISIBLES, "").replace(/\s+/g, " ").trim().slice(0, LARGO_MAXIMO_CONSULTA);
  if (!limpio) return null;
  const separar = (t: string): string[] => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= LARGO_MINIMO).map((p) => p.slice(0, LARGO_MAXIMO_PALABRA));

  const frases: string[] = [];
  const sinFrases = limpio.replace(/"([^"]*)"/g, (_m, dentro: string) => {
    const palabras = separar(dentro);
    if (palabras.length) frases.push(palabras.join(" "));
    return " ";
  });
  const palabras = [...new Set(separar(sinFrases))].slice(0, MAX_PALABRAS);
  if (!palabras.length && !frases.length) return null;
  const booleana = [...frases.slice(0, 3).map((f) => `+"${f}"`), ...palabras.map((p) => `+${p}*`)].join(" ");
  return { texto: limpio, palabras, frases: frases.slice(0, 3), booleana };
}

export interface Resultado {
  nota: Awaited<ReturnType<typeof notasPorId>>[number];
  /** Un pedazo del texto donde aparece lo buscado (null si la coincidencia está en el título o en el autor). */
  extracto: string | null;
  /** ¿El extracto arranca en el comienzo del texto (sin puntos suspensivos antes)? */
  alInicio: boolean;
}

const notasPorId = (ids: number[]) => prisma.articulo.findMany({ where: { id: { in: ids } }, select: seleccionTarjeta });

/** ¿El error es que falta el índice de texto completo (la base todavía no tiene la migración de la fase 6)? */
export const faltaElIndice = (e: unknown): boolean => /1191|FULLTEXT index/i.test(String((e as { message?: string } | null)?.message ?? "")) || /1191/.test(JSON.stringify((e as { cause?: unknown } | null)?.cause ?? ""));

/** Texto sin tildes ni mayúsculas, con la posición que ocupa cada carácter en el original (para ubicar lo buscado en el texto tal como se escribió). */
function sinTildesConMapa(texto: string): { plano: string; origen: number[] } {
  let plano = "";
  const origen: number[] = [];
  let i = 0;
  for (const letra of texto) {
    const base = letra.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const c of base) {
      plano += c;
      origen.push(i);
    }
    i += letra.length;
  }
  return { plano, origen };
}

const LARGO_EXTRACTO = 260;
const ANTES = 90;

/** Un pedazo del texto donde aparece lo buscado, o null si no se encuentra (la coincidencia estaba en el título, la bajada o el autor). */
export function extractoDe(texto: string, consulta: Consulta): { extracto: string; alInicio: boolean } | null {
  const { plano, origen } = sinTildesConMapa(texto);
  const buscado = consulta.frases[0] ?? consulta.palabras[0];
  if (!buscado) return null;
  const en = plano.indexOf(sinTildesConMapa(buscado).plano);
  if (en < 0) return null;
  let desde = Math.max(0, (origen[en] ?? 0) - ANTES);
  // Se empieza en el comienzo de una palabra
  if (desde > 0) {
    const espacio = texto.indexOf(" ", desde);
    if (espacio >= 0 && espacio < (origen[en] ?? 0)) desde = espacio + 1;
  }
  return { extracto: texto.slice(desde, desde + LARGO_EXTRACTO), alInicio: desde === 0 };
}

export async function buscar(consulta: Consulta, pagina: number): Promise<{ total: number; resultados: Resultado[] }> {
  const ahora = new Date();
  const comodines = [...consulta.palabras, ...consulta.frases].map((t) => `%${t.replace(/[\%_]/g, "\$&")}%`);
  // Coincide por el texto o porque todas las palabras están en el nombre de algún autor
  const porAutor = Prisma.sql`EXISTS (SELECT 1 FROM articulos_autores aa JOIN autores au ON au.id = aa.autorId WHERE aa.articuloId = a.id AND ${Prisma.join(comodines.map((c) => Prisma.sql`au.nombre LIKE ${c}`), " AND ")})`;
  const donde = Prisma.sql`a.estado = 'PUBLICADO' AND a.publicadoEn <= ${ahora} AND (MATCH(a.titulo, a.bajada, a.textoPlano) AGAINST (${consulta.booleana} IN BOOLEAN MODE) OR ${porAutor})`;

  const [contados, filas] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) AS n FROM articulos a WHERE ${donde}`),
    prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT a.id
      FROM articulos a
      WHERE ${donde}
      ORDER BY (MATCH(a.titulo) AGAINST (${consulta.booleana} IN BOOLEAN MODE) * 5 + MATCH(a.titulo, a.bajada, a.textoPlano) AGAINST (${consulta.booleana} IN BOOLEAN MODE)) DESC, a.publicadoEn DESC, a.id DESC
      LIMIT ${NOTAS_POR_PAGINA} OFFSET ${(pagina - 1) * NOTAS_POR_PAGINA}`),
  ]);
  const ids = filas.map((f) => Number(f.id));
  if (!ids.length) return { total: Number(contados[0]?.n ?? 0), resultados: [] };
  // Para los extractos solo hace falta el comienzo del texto de las notas de esta página
  const [notas, textos] = await Promise.all([
    notasPorId(ids),
    prisma.$queryRaw<Array<{ id: number; texto: string }>>(Prisma.sql`SELECT id, SUBSTRING(textoPlano, 1, 60000) AS texto FROM articulos WHERE id IN (${Prisma.join(ids)})`),
  ]);
  const porId = new Map(notas.map((n) => [n.id, n]));
  const textoDe = new Map(textos.map((t) => [Number(t.id), t.texto]));
  return {
    total: Number(contados[0]?.n ?? 0),
    resultados: ids.flatMap((id) => {
      const nota = porId.get(id);
      if (!nota) return [];
      const e = extractoDe(textoDe.get(id) ?? "", consulta);
      return [{ nota, extracto: e?.extracto ?? null, alInicio: e?.alInicio ?? false }];
    }),
  };
}

const escapar = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sinTildes = (t: string): string => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** El extracto como HTML seguro, con lo buscado entre <mark> (sin distinguir tildes ni mayúsculas) y puntos suspensivos si se cortó. */
export function extractoConResaltado(extracto: string, consulta: Consulta, completo: boolean): string {
  const terminos = [...consulta.palabras, ...consulta.frases.flatMap((f) => f.split(" "))].map(sinTildes);
  const limpio = extracto.replace(/\s+/g, " ").trim();
  // Se parte en palabras y no-palabras para marcar las palabras que empiezan con lo buscado
  const html = limpio
    .split(/([\p{L}\p{N}]+)/u)
    .map((trozo) => (/^[\p{L}\p{N}]+$/u.test(trozo) && terminos.some((t) => sinTildes(trozo).startsWith(t)) ? `<mark>${escapar(trozo)}</mark>` : escapar(trozo)))
    .join("");
  return `${completo ? "" : "…"}${html}${limpio.length >= 255 ? "…" : ""}`;
}
