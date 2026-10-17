// Lectura de WordPress (127.0.0.1:3307, evaristo_lectura) y de la base del CMS (DATABASE_URL, puerto 3308).
// SOLO LECTURA: las dos conexiones abren la sesión con SET SESSION TRANSACTION READ ONLY y todas las consultas pasan por
// `consultar()`, que rechaza todo lo que no sea un único SELECT. Este módulo no arma registros ni decide nada de negocio:
// solo ejecuta las consultas y devuelve las filas con los mismos nombres de campo de siempre.
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../../src/generated/prisma/client.js";
import { guardaDestino } from "./destinos.ts";
import { marcas, num, str } from "./utilidades.ts";

export type Fila = Record<string, unknown>;
/** Una consulta ya ligada a una conexión (`wp` o `bd`). */
export type Consulta = (sql: string, ...params: unknown[]) => Promise<Fila[]>;

export const SOLO_LECTURA = "SET SESSION TRANSACTION READ ONLY";
export const COLACION = "utf8mb4_es_0900_ai_ci";
export const PREFIJO = "wp_";
export const T = (tabla: string) => `\`${PREFIJO}${tabla}\``;

// ---------------------------------------------------------------------------------------------------------------
// Conexiones de solo lectura
// ---------------------------------------------------------------------------------------------------------------
function clienteWordPress(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaMariaDb({ host: "127.0.0.1", port: 3307, user: "root", database: "evaristo_lectura", connectionLimit: 2, initSql: SOLO_LECTURA }),
  });
}

function clienteCms(): PrismaClient {
  // Misma guarda que la de conexiones.ts: solo 127.0.0.1:3308/evaristo_cms
  guardaDestino(process.env["DATABASE_URL"]);
  const u = new URL(process.env["DATABASE_URL"]!);
  return new PrismaClient({
    adapter: new PrismaMariaDb({
      host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: u.pathname.slice(1), connectionLimit: 2, initSql: SOLO_LECTURA,
    }),
  });
}

/**
 * Valida que `sql` sea UN solo SELECT. Rechaza: cualquier otra sentencia, varias sentencias (`;`), comentarios ejecutables
 * de MySQL, SELECT ... INTO OUTFILE/DUMPFILE y los SELECT con bloqueo (FOR UPDATE, LOCK IN SHARE MODE).
 * Es deliberadamente conservadora: un SELECT con un comentario antepuesto o con `;` dentro de un texto también se rechaza.
 */
export function validarSoloSelect(sql: string): void {
  const rechazar = (): never => { throw new Error(`Solo se permite un SELECT: ${sql.slice(0, 60)}`); };
  if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) rechazar();
  if (sql.includes("/*!")) rechazar();
  if (/\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(sql) || /\bFOR\s+UPDATE\b/i.test(sql) || /\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(sql)) rechazar();
}

/** Única puerta de entrada a las bases: solo SELECT, una sentencia. */
export async function consultar(cliente: Pick<PrismaClient, "$queryRawUnsafe">, sql: string, ...params: unknown[]): Promise<Fila[]> {
  validarSoloSelect(sql);
  return cliente.$queryRawUnsafe<Fila[]>(sql, ...params);
}

export interface Conexiones {
  /** Consulta a WordPress. */
  wp: Consulta;
  /** Consulta a la base del CMS. */
  bd: Consulta;
  cerrar: () => Promise<void>;
}

/** Abre solo la conexión de lectura al CMS real (para comprobar que nada lo cambió), sin WordPress. Sesión READ ONLY verificada. */
export async function abrirSoloCms(): Promise<{ bd: Consulta; cerrar: () => Promise<void> }> {
  const cms = clienteCms();
  const bd: Consulta = (sql, ...p) => consultar(cms, sql, ...p);
  const [{ ro }] = (await bd("SELECT @@session.transaction_read_only AS ro")) as [Fila];
  if (num(ro) !== 1) { await cms.$disconnect(); throw new Error("La sesión no está en solo lectura: se aborta"); }
  return { bd, cerrar: () => cms.$disconnect() };
}

/** Abre las dos conexiones de solo lectura y comprueba que las sesiones lo estén; si no, aborta. */
export async function abrirConexiones(): Promise<Conexiones> {
  const clienteWp = clienteWordPress();
  const cms = clienteCms();
  const wp: Consulta = (sql, ...p) => consultar(clienteWp, sql, ...p);
  const bd: Consulta = (sql, ...p) => consultar(cms, sql, ...p);
  const [{ ro }] = (await bd("SELECT @@session.transaction_read_only AS ro")) as [Fila];
  const [{ ro: roWp }] = (await wp("SELECT @@session.transaction_read_only AS ro")) as [Fila];
  if (num(ro) !== 1 || num(roWp) !== 1) throw new Error("Las sesiones no están en solo lectura: se aborta");
  return { wp, bd, cerrar: async () => { await clienteWp.$disconnect(); await cms.$disconnect(); } };
}

// ---------------------------------------------------------------------------------------------------------------
// Lecturas de WordPress
// ---------------------------------------------------------------------------------------------------------------
export const leerOpciones = (wp: Consulta) =>
  wp(`SELECT option_name AS k, option_value AS v FROM ${T("options")} WHERE option_name IN ('permalink_structure','gmt_offset','timezone_string')`);

export const leerPosts = (wp: Consulta, ids: number[]) => wp(
  `SELECT ID AS id, post_type AS tipo, post_status AS estado, post_author AS autor, post_name AS nombre, post_title AS titulo, post_content AS contenido,
          DATE_FORMAT(post_date, '%Y-%m-%d %H:%i:%s') AS fecha, DATE_FORMAT(post_date_gmt, '%Y-%m-%d %H:%i:%s') AS fechaGmt
   FROM ${T("posts")} WHERE ID IN (${marcas(ids.length)})`, ...ids);

export const leerUsuarios = (wp: Consulta, ids: number[]) =>
  wp(`SELECT ID AS id, user_nicename AS nicename, display_name AS nombre FROM ${T("users")} WHERE ID IN (${marcas(ids.length)})`, ...ids);

export const leerBios = (wp: Consulta, ids: number[]) =>
  wp(`SELECT user_id AS id, meta_value AS bio FROM ${T("usermeta")} WHERE meta_key='description' AND user_id IN (${marcas(ids.length)})`, ...ids);

export const leerCuentas = (wp: Consulta, ids: number[]) =>
  wp(`SELECT ID AS id, user_login AS login, display_name AS nombre FROM ${T("users")} WHERE ID IN (${marcas(ids.length)})`, ...ids);

export const leerMeta = (wp: Consulta, ids: number[]) => wp(
  `SELECT meta_id AS metaId, post_id AS postId, meta_key AS k, meta_value AS v FROM ${T("postmeta")}
   WHERE post_id IN (${marcas(ids.length)}) AND (meta_key IN ('cb_visit_counter','_wp_old_slug','cb_image_credit','_thumbnail_id') OR meta_key LIKE '\\_webdados\\_fb\\_open\\_graph\\_%')
   ORDER BY meta_id`, ...ids);

export const leerTerminos = (wp: Consulta, taxonomia: string, ids: number[]) => wp(
  `SELECT tr.object_id AS id, t.name AS nombre, t.slug AS slug FROM ${T("term_relationships")} tr
   JOIN ${T("term_taxonomy")} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = '${taxonomia}'
   JOIN ${T("terms")} t ON t.term_id = tt.term_id WHERE tr.object_id IN (${marcas(ids.length)})`, ...ids);

/** Adjuntos: clave (_wp_attached_file) -> id del adjunto, de toda la base. */
export const leerAdjuntosPorClave = (wp: Consulta) =>
  wp(`SELECT post_id AS id, meta_value AS clave FROM ${T("postmeta")} WHERE meta_key='_wp_attached_file'`);

/** Lee ancho, alto y tamaño que WordPress declara en _wp_attachment_metadata (PHP serializado). No son medidas verificadas. */
export function metadatosAdjunto(serializado: string) {
  const ancho = serializado.match(/^a:\d+:\{s:5:"width";i:(\d+);s:6:"height";i:(\d+);/);
  const bytes = serializado.match(/s:4:"file";s:\d+:"[^"]*";s:8:"filesize";i:(\d+);/);
  return { ancho: ancho ? Number(ancho[1]) : null, alto: ancho ? Number(ancho[2]) : null, bytes: bytes ? Number(bytes[1]) : null };
}

export interface DetalleAdjunto { id: number; tipoPost: string; tipoMime: string; guid: string; clave: string | null; alt: string; ancho: number | null; alto: number | null; bytes: number | null }

export async function detalleAdjuntos(wp: Consulta, idsAdj: number[]) {
  const mapa = new Map<number, DetalleAdjunto>();
  if (!idsAdj.length) return mapa;
  const filas = await wp(`SELECT ID AS id, post_type AS tipoPost, post_mime_type AS mime, guid FROM ${T("posts")} WHERE ID IN (${marcas(idsAdj.length)})`, ...idsAdj);
  const metas = await wp(`SELECT post_id AS id, meta_key AS k, meta_value AS v FROM ${T("postmeta")} WHERE post_id IN (${marcas(idsAdj.length)}) AND meta_key IN ('_wp_attached_file','_wp_attachment_image_alt','_wp_attachment_metadata')`, ...idsAdj);
  for (const f of filas) {
    const id = num(f["id"]);
    const m = (k: string) => metas.find((x) => num(x["id"]) === id && x["k"] === k);
    const md = m("_wp_attachment_metadata") ? metadatosAdjunto(str(m("_wp_attachment_metadata")!["v"])) : { ancho: null, alto: null, bytes: null };
    mapa.set(id, { id, tipoPost: str(f["tipoPost"]), tipoMime: str(f["mime"]), guid: str(f["guid"]), clave: m("_wp_attached_file") ? str(m("_wp_attached_file")!["v"]) : null, alt: str(m("_wp_attachment_image_alt")?.["v"]).trim(), ...md });
  }
  return mapa;
}

/** Artículos (publicados y borradores) con más de una fila de _thumbnail_id, de todo el corpus. */
export const leerPostsConVariosThumbnails = (wp: Consulta) => wp(
  `SELECT pm.post_id AS id FROM ${T("postmeta")} pm JOIN ${T("posts")} p ON p.ID = pm.post_id AND p.post_type='post' AND p.post_status IN ('publish','draft')
   WHERE pm.meta_key='_thumbnail_id' GROUP BY pm.post_id HAVING COUNT(*) > 1 ORDER BY pm.post_id`);

export const leerFilasThumbnail = (wp: Consulta, ids: number[]) =>
  wp(`SELECT meta_id AS metaId, post_id AS id, meta_value AS v FROM ${T("postmeta")} WHERE meta_key='_thumbnail_id' AND post_id IN (${marcas(ids.length)}) ORDER BY post_id, meta_id`, ...ids);

export const leerNombresDePosts = (wp: Consulta, ids: number[]) =>
  wp(`SELECT ID AS id, post_name AS nombre FROM ${T("posts")} WHERE ID IN (${marcas(ids.length)})`, ...ids);

/** Todos los posts publicados y borradores, con su post_name y estado. */
export const leerCorpus = (wp: Consulta) =>
  wp(`SELECT ID AS id, post_name AS nombre, post_status AS estado FROM ${T("posts")} WHERE post_type='post' AND post_status IN ('publish','draft') ORDER BY ID`);

// ---------------------------------------------------------------------------------------------------------------
// Lecturas de la base del CMS
// ---------------------------------------------------------------------------------------------------------------
/** ¿Son iguales según la intercalación del CMS? Siempre lo decide la base. */
export async function igualesEnBd(bd: Consulta, pares: Array<[string, string]>): Promise<boolean[]> {
  const res: boolean[] = [];
  for (let i = 0; i < pares.length; i += 250) {
    const lote = pares.slice(i, i + 250);
    const sql = lote.map((_, k) => `SELECT ${k} AS i, (? = ? COLLATE ${COLACION}) AS eq`).join(" UNION ALL ");
    const filas = await bd(sql, ...lote.flatMap(([a, b]) => [a, b]));
    for (const f of filas) res[i + num(f["i"])] = num(f["eq"]) === 1;
  }
  return res;
}

export const contarArticulosCms = (bd: Consulta) => bd("SELECT COUNT(*) AS n FROM articulos");
export const leerArticulosPorSlug = (bd: Consulta, slug: string) => bd(`SELECT id, slug, wpId FROM articulos WHERE slug = ? COLLATE ${COLACION}`, slug);
export const leerArticulosPorWpId = (bd: Consulta, wpId: number) => bd("SELECT id FROM articulos WHERE wpId = ?", wpId);
export const leerAutoresPorSlugOWpUserId = (bd: Consulta, slug: string, wpUserId: number) =>
  bd(`SELECT id, slug, wpUserId FROM autores WHERE slug = ? COLLATE ${COLACION} OR wpUserId = ?`, slug, wpUserId);
export const leerSeccionesCms = (bd: Consulta) => bd("SELECT slug FROM secciones");
export const leerCategoriasCms = (bd: Consulta) => bd("SELECT slug FROM categorias");

/** Agrupa por intercalación, en la base, los pares (id, slug) dados y cuenta los grupos con más de una fila. */
export async function agruparSlugsEnBd(bd: Consulta, valores: ReadonlyArray<readonly [number, string]>): Promise<Fila | undefined> {
  const sql = `SELECT COUNT(*) AS grupos, COALESCE(SUM(n), 0) AS filas FROM (SELECT COUNT(*) AS n FROM (VALUES ${valores.map(() => "ROW(?, ?)").join(",")}) AS t(i, s) GROUP BY s COLLATE ${COLACION} HAVING COUNT(*) > 1) x`;
  const [f] = await bd(sql, ...valores.flatMap(([i, s]) => [i, s]));
  return f;
}
