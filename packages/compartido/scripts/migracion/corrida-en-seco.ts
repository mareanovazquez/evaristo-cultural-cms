// Corrida en seco de la migración de la muestra (30 artículos de WordPress).
//
// SOLO LECTURA: lee la base de WordPress (127.0.0.1:3307, evaristo_lectura) y la del CMS (DATABASE_URL del .env,
// puerto 3308), arma en memoria los registros que se insertarían en el CMS y escribe un informe. No inserta ni
// modifica nada: las dos conexiones abren la sesión con SET SESSION TRANSACTION READ ONLY y todas las consultas
// pasan por `consultar()`, que rechaza todo lo que no sea un SELECT.
//
// Uso: npm run migracion:seco -w @evaristo/compartido
// Salidas (ignoradas por git): packages/compartido/out/corrida-en-seco-muestra.md y .json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { convertWpPost } from "../../src/conversor/convert.ts";
import { cargarMapeo } from "../../src/conversor/taxonomia.ts";
import type { DocNode } from "../../src/conversor/types.ts";
import { validateArticleBodyDetallado } from "../../src/schema/validate.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const aRuta = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SOLO_LECTURA = "SET SESSION TRANSACTION READ ONLY";
const COLACION = "utf8mb4_es_0900_ai_ci";
const PREFIJO = "wp_";
const T = (tabla: string) => `\`${PREFIJO}${tabla}\``;

// Cuentas de WordPress que no son personas: se migran como autor de solo texto (sin página, sin bio).
// Origen: testing-tiptap/conversor/scripts/consultar-autoria.ts (CUENTAS_INSTITUCIONALES y CUENTAS_PROBABLES,
// valores por defecto, rama integracion-conversor, commit ba37c92). Se comparan con display_name.
const CUENTAS_INSTITUCIONALES = new Set(["Evaristo Cultural", "EL FESTIVALON", "Encuentro Internacional de Cultura Japonesa"]);
const CUENTAS_PROBABLES = new Set<string>([]);

// ---------------------------------------------------------------------------------------------------------------
// Conexiones de solo lectura
// ---------------------------------------------------------------------------------------------------------------
type Fila = Record<string, unknown>;

const clienteWp = new PrismaClient({
  adapter: new PrismaMariaDb({ host: "127.0.0.1", port: 3307, user: "root", database: "evaristo_lectura", connectionLimit: 2, initSql: SOLO_LECTURA }),
});

function clienteCms(): PrismaClient {
  const texto = process.env["DATABASE_URL"];
  if (!texto) throw new Error("Falta DATABASE_URL en el entorno");
  const u = new URL(texto);
  if (u.hostname !== "127.0.0.1" || u.port !== "3308" || u.pathname !== "/evaristo_cms") {
    throw new Error("DATABASE_URL no apunta a 127.0.0.1:3308/evaristo_cms: la corrida en seco se niega a seguir");
  }
  return new PrismaClient({
    adapter: new PrismaMariaDb({
      host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: u.pathname.slice(1), connectionLimit: 2, initSql: SOLO_LECTURA,
    }),
  });
}
const cms = clienteCms();

/** Única puerta de entrada a las bases: solo SELECT, una sentencia. */
async function consultar(cliente: PrismaClient, sql: string, ...params: unknown[]): Promise<Fila[]> {
  if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) throw new Error(`Solo se permite un SELECT: ${sql.slice(0, 60)}`);
  return cliente.$queryRawUnsafe<Fila[]>(sql, ...params);
}
const wp = (sql: string, ...p: unknown[]) => consultar(clienteWp, sql, ...p);
const bd = (sql: string, ...p: unknown[]) => consultar(cms, sql, ...p);

const num = (v: unknown) => Number(v);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const marcas = (n: number) => Array.from({ length: n }, () => "?").join(",");

// ---------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------
const decodificar = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const claveJs = (s: string) => decodificar(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const decEntidades = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** ¿Son iguales según la intercalación del CMS? Siempre lo decide la base. */
async function igualesEnBd(pares: Array<[string, string]>): Promise<boolean[]> {
  const res: boolean[] = [];
  for (let i = 0; i < pares.length; i += 250) {
    const lote = pares.slice(i, i + 250);
    const sql = lote.map((_, k) => `SELECT ${k} AS i, (? = ? COLLATE ${COLACION}) AS eq`).join(" UNION ALL ");
    const filas = await bd(sql, ...lote.flatMap(([a, b]) => [a, b]));
    for (const f of filas) res[i + num(f["i"])] = num(f["eq"]) === 1;
  }
  return res;
}

function textoDe(n: DocNode, acc: string[] = []): string[] {
  if (n.text) acc.push(n.text);
  if (n.type === "footnote" && n.attrs?.["content"]) textoDe(n.attrs["content"] as DocNode, acc);
  for (const c of n.content ?? []) textoDe(c, acc);
  return acc;
}
const textoPlanoDe = (doc: DocNode) => (doc.content ?? []).map((b) => textoDe(b).join("")).filter(Boolean).join("\n");

function contarAltPendiente(n: DocNode): number {
  return (n.type === "imagen" && n.attrs?.["altPendiente"] === true ? 1 : 0) + (n.content ?? []).reduce((s, c) => s + contarAltPendiente(c), 0);
}

function docDeTexto(texto: string): DocNode | null {
  const parrafos = texto.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (!parrafos.length) return null;
  return { type: "doc", content: parrafos.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) };
}

/** Lee ancho, alto y tamaño que WordPress declara en _wp_attachment_metadata (PHP serializado). No son medidas verificadas. */
function metadatosAdjunto(serializado: string) {
  const ancho = serializado.match(/^a:\d+:\{s:5:"width";i:(\d+);s:6:"height";i:(\d+);/);
  const bytes = serializado.match(/s:4:"file";s:\d+:"[^"]*";s:8:"filesize";i:(\d+);/);
  return { ancho: ancho ? Number(ancho[1]) : null, alto: ancho ? Number(ancho[2]) : null, bytes: bytes ? Number(bytes[1]) : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------------------------------------------
interface Muestra { id: number; slug: string; titulo: string; autor: string; imagen_destacada: string; contenido_crudo: string }
const muestra: Muestra[] = JSON.parse(readFileSync(aRuta("../../src/conversor/tests/fixtures/muestra-wordpress.json"), "utf8"));
const ids = muestra.map((m) => m.id);
const mapeo = cargarMapeo();

const [{ ro }] = (await bd("SELECT @@session.transaction_read_only AS ro")) as [Fila];
const [{ ro: roWp }] = (await wp("SELECT @@session.transaction_read_only AS ro")) as [Fila];
if (num(ro) !== 1 || num(roWp) !== 1) throw new Error("Las sesiones no están en solo lectura: se aborta");

// La comparación de slugs depende de la intercalación del CMS: se comprueba que se comporte como se espera.
const [e1, e2, e3] = await igualesEnBd([["Mañana", "manana"], ["Café", "cafe"], ["CAFE", "cafe"]]);
if (e1 !== false || e2 !== true || e3 !== true) throw new Error(`La intercalación ${COLACION} no se comporta como se esperaba (ñ/n=${e1}, é/e=${e2}, A/a=${e3})`);

// ---------------------------------------------------------------------------------------------------------------
// Lecturas de WordPress
// ---------------------------------------------------------------------------------------------------------------
const marcaIds = marcas(ids.length);
const opciones = await wp(`SELECT option_name AS k, option_value AS v FROM ${T("options")} WHERE option_name IN ('permalink_structure','gmt_offset','timezone_string')`);
const opcion = (k: string) => str(opciones.find((o) => o["k"] === k)?.["v"]);
const permalink = opcion("permalink_structure");

const filasPosts = await wp(
  `SELECT ID AS id, post_type AS tipo, post_status AS estado, post_author AS autor, post_name AS nombre,
          DATE_FORMAT(post_date, '%Y-%m-%d %H:%i:%s') AS fecha, DATE_FORMAT(post_date_gmt, '%Y-%m-%d %H:%i:%s') AS fechaGmt
   FROM ${T("posts")} WHERE ID IN (${marcaIds})`, ...ids);
const postWp = new Map(filasPosts.map((f) => [num(f["id"]), f]));

const autoresIds = [...new Set(filasPosts.map((f) => num(f["autor"])))];
const filasUsuarios = await wp(`SELECT ID AS id, user_nicename AS nicename, display_name AS nombre FROM ${T("users")} WHERE ID IN (${marcas(autoresIds.length)})`, ...autoresIds);
const filasBio = await wp(`SELECT user_id AS id, meta_value AS bio FROM ${T("usermeta")} WHERE meta_key='description' AND user_id IN (${marcas(autoresIds.length)})`, ...autoresIds);
const usuarioWp = new Map(filasUsuarios.map((f) => [num(f["id"]), f]));
const bioWp = new Map(filasBio.map((f) => [num(f["id"]), str(f["bio"])]));

const filasMeta = await wp(
  `SELECT meta_id AS metaId, post_id AS postId, meta_key AS k, meta_value AS v FROM ${T("postmeta")}
   WHERE post_id IN (${marcaIds}) AND (meta_key IN ('cb_visit_counter','_wp_old_slug','cb_image_credit','_thumbnail_id') OR meta_key LIKE '\\_webdados\\_fb\\_open\\_graph\\_%')
   ORDER BY meta_id`, ...ids);
const metaDe = (id: number, k: string) => filasMeta.filter((f) => num(f["postId"]) === id && f["k"] === k).map((f) => ({ metaId: num(f["metaId"]), valor: str(f["v"]) }));

const terminos = async (taxonomia: string) => wp(
  `SELECT tr.object_id AS id, t.name AS nombre, t.slug AS slug FROM ${T("term_relationships")} tr
   JOIN ${T("term_taxonomy")} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = '${taxonomia}'
   JOIN ${T("terms")} t ON t.term_id = tt.term_id WHERE tr.object_id IN (${marcaIds})`, ...ids);
const filasEtiquetas = await terminos("post_tag");
const filasCategorias = await terminos("category");

// Adjuntos: clave (_wp_attached_file) -> id del adjunto, de toda la base.
const filasAdjuntos = await wp(`SELECT post_id AS id, meta_value AS clave FROM ${T("postmeta")} WHERE meta_key='_wp_attached_file'`);
const adjuntoPorClave = new Map(filasAdjuntos.map((f) => [str(f["clave"]), num(f["id"])]));

async function detalleAdjuntos(idsAdj: number[]) {
  const mapa = new Map<number, { id: number; tipoPost: string; tipoMime: string; guid: string; clave: string | null; alt: string; ancho: number | null; alto: number | null; bytes: number | null }>();
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

/** Ruta de uploads de una URL, o null si no es de la biblioteca de medios propia. */
function rutaUploads(url: string): string | null {
  const m = decodificar(url).match(/\/wp-content\/uploads\/(.+?)(?:[?#].*)?$/);
  return m ? m[1]! : null;
}
/** Id del adjunto que corresponde a una URL: exacta, o sin el sufijo de tamaño (-300x200) / -scaled / -eN. */
function adjuntoDeUrl(url: string): { id: number; via: "exacta" | "sin-sufijo" } | null {
  const ruta = rutaUploads(url);
  if (ruta === null) return null;
  const exacta = adjuntoPorClave.get(ruta);
  if (exacta !== undefined) return { id: exacta, via: "exacta" };
  const base = ruta.replace(/-(?:\d+x\d+|scaled|e\d+)(\.[A-Za-z0-9]+)$/, "$1");
  const alt = base !== ruta ? adjuntoPorClave.get(base) : undefined;
  return alt !== undefined ? { id: alt, via: "sin-sufijo" } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Conversión y armado de los registros
// ---------------------------------------------------------------------------------------------------------------
const estadoCms = (e: string) => (e === "publish" ? "PUBLICADO" : e === "draft" ? "BORRADOR" : e === "future" ? "PROGRAMADO" : `DESCONOCIDO(${e})`);
const utcDe = (gmt: string) => (gmt.startsWith("0000") ? null : `${gmt.replace(" ", "T")}.000Z`);

function origenDe(fechaLocal: string, nombre: string): string {
  const [fecha] = fechaLocal.split(" ") as [string];
  const [a, m, d] = fecha.split("-") as [string, string, string];
  const ruta = permalink.replace(/%([a-z_]+)%/g, (_, k: string) => {
    if (k === "year") return a;
    if (k === "monthnum") return m;
    if (k === "day") return d;
    if (k === "postname") return nombre;
    throw new Error(`permalink_structure con una variable no soportada: %${k}%`);
  });
  return ruta;
}

const imagenesDeCuerpo = new Map<string, { url: string; articulos: Set<number> }>();
const registros: any[] = [];
const autores = new Map<number, any>();
const detalleEnc = await detalleAdjuntos([...new Set(ids.flatMap((id) => metaDe(id, "_thumbnail_id").sort((a, b) => a.metaId - b.metaId).slice(0, 1).map((r) => Number(r.valor)).filter(Number.isInteger)))]);

for (const m of muestra) {
  const p = postWp.get(m.id);
  if (!p) throw new Error(`El artículo ${m.id} de la muestra no está en la base de WordPress`);
  const usuario = usuarioWp.get(num(p["autor"]));
  const nombreAutor = str(usuario?.["nombre"]);
  const cats = filasCategorias.filter((f) => num(f["id"]) === m.id).map((f) => ({ nombre: decEntidades(str(f["nombre"])), slug: str(f["slug"]) })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const r = convertWpPost(m, { autor: nombreAutor || null, taxonomia: { id: m.id, slugs: cats.map((c) => c.slug), mapeo } });
  const val = validateArticleBodyDetallado(r.doc as any, { modo: "migracion" });
  const erroresBio = r.bio ? validateArticleBodyDetallado({ type: "doc", content: r.bio } as any, { modo: "migracion" }).errores : [];

  // Autor
  const wpUserId = num(p["autor"]);
  if (!autores.has(wpUserId)) {
    const soloTexto = CUENTAS_INSTITUCIONALES.has(nombreAutor);
    const descripcion = bioWp.get(wpUserId)?.trim() ?? "";
    autores.set(wpUserId, {
      wpUserId, slug: str(usuario?.["nicename"]), nombre: nombreAutor, soloTexto,
      cuentaProbable: CUENTAS_PROBABLES.has(nombreAutor),
      bio: soloTexto ? null : docDeTexto(descripcion),
      articulosEnMuestra: [] as number[],
    });
  }
  autores.get(wpUserId).articulosEnMuestra.push(m.id);

  // Imagen de encabezado: si hay varias filas de _thumbnail_id, la de menor meta_id
  const filasThumb = metaDe(m.id, "_thumbnail_id").sort((a, b) => a.metaId - b.metaId);
  const adjEnc = filasThumb.length ? detalleEnc.get(Number(filasThumb[0]!.valor)) : undefined;
  const credito = metaDe(m.id, "cb_image_credit")[0]?.valor.trim() ?? "";
  const imagenEncabezado = adjEnc && adjEnc.tipoPost === "attachment"
    ? { wpId: adjEnc.id, clave: adjEnc.clave, nombreOriginal: adjEnc.clave ? adjEnc.clave.split("/").pop()! : null, tipoMime: adjEnc.tipoMime, ancho: adjEnc.ancho, alto: adjEnc.alto, bytes: adjEnc.bytes, hash: null }
    : null;

  // Datos para redes (solo si tienen contenido)
  const og = (k: string) => metaDe(m.id, k)[0]?.valor.trim() ?? "";
  const redesDescripcion = og("_webdados_fb_open_graph_specific_description") || null;
  const redesImagenUrl = og("_webdados_fb_open_graph_specific_image") || null;
  const redesAdjunto = redesImagenUrl ? adjuntoDeUrl(redesImagenUrl) : null;

  // Imágenes del cuerpo
  for (const im of r.assets.images) {
    const clave = rutaUploads(im.url) ?? im.url;
    const e = imagenesDeCuerpo.get(clave) ?? { url: im.url, articulos: new Set<number>() };
    e.articulos.add(m.id);
    imagenesDeCuerpo.set(clave, e);
  }

  const etiquetas = filasEtiquetas.filter((f) => num(f["id"]) === m.id).map((f) => decEntidades(str(f["nombre"])));
  const visitas = metaDe(m.id, "cb_visit_counter")[0]?.valor;
  const altCuerpo = contarAltPendiente(r.doc);
  const encabezadoAlt = adjEnc && adjEnc.tipoPost === "attachment" ? adjEnc.alt : "";
  const nombrePost = str(p["nombre"]);
  const viejos = [...new Set(metaDe(m.id, "_wp_old_slug").map((x) => x.valor.trim()))].filter((v) => v && !/^\d+$/.test(v) && v !== nombrePost);
  const origen = origenDe(str(p["fecha"]), nombrePost);

  const redirecciones = [
    { origen, tipo: "ARTICULO", codigo: 301, articuloWpId: m.id, autorWpUserId: null, destino: null },
    ...viejos.map((v) => ({ origen: origenDe(str(p["fecha"]), v), tipo: "SLUG_ANTERIOR", codigo: 301, articuloWpId: m.id, autorWpUserId: null, destino: null })),
  ];

  registros.push({
    wpId: m.id,
    slug: decodificar(nombrePost),
    slugWp: nombrePost,
    estado: estadoCms(str(p["estado"])),
    titulo: r.titulo, bajada: r.bajada || null,
    cuerpo: r.doc, schemaVersion: 1, textoPlano: textoPlanoDe(r.doc),
    publicadoEn: utcDe(str(p["fechaGmt"])),
    postDateLocal: str(p["fecha"]), postDateGmt: str(p["fechaGmt"]),
    novedadHasta: r.novedadHasta,
    seccion: r.seccion, categorias: r.categorias, categoriaPrincipal: r.categoriaPrincipal,
    categoriasWp: cats.map((c) => c.slug),
    autores: [{ wpUserId, orden: 0 }],
    imagenEncabezado, encabezadoAlt: encabezadoAlt || null, encabezadoCredito: credito || null,
    encabezadoPuntoFocalX: 0.5, encabezadoPuntoFocalY: 0.5,
    redesDescripcion, redesImagenUrl, redesImagenWpId: redesAdjunto?.id ?? null,
    etiquetasWp: etiquetas.length ? etiquetas : null,
    avisosMigracion: r.warnings.length || r.avisosTitulo.length || val.avisos.length ? { cuerpo: r.warnings, titulo: r.avisosTitulo, validador: val.avisos } : null,
    altPendientes: altCuerpo + (imagenEncabezado && !encabezadoAlt ? 1 : 0),
    altPendientesCuerpo: altCuerpo,
    visitasWp: visitas !== undefined && /^\d+$/.test(visitas) ? Number(visitas) : null,
    bioDelCuerpo: r.bio ? textoPlanoDe({ type: "doc", content: r.bio }) : null,
    thumbnailFilas: filasThumb, imagenDestacadaFixture: m.imagen_destacada,
    validacion: { errores: val.errores, erroresBio, avisos: val.avisos },
    redirecciones,
  });
}

// Redirecciones de autor: una por autor (el origen es único)
const redireccionesAutor = [...autores.values()].map((a) => ({ origen: `/author/${a.slug}/`, tipo: "AUTOR", codigo: 301, articuloWpId: null, autorWpUserId: a.wpUserId, destino: null }));
const redirecciones = [...registros.flatMap((r) => r.redirecciones), ...redireccionesAutor];

// ---------------------------------------------------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------------------------------------------------
const validaciones: Record<string, unknown> = {};

validaciones["principalEntreCategorias"] = registros.filter((r) => r.categoriaPrincipal !== null && !r.categorias.includes(r.categoriaPrincipal)).map((r) => r.wpId);
validaciones["redireccionesSinExactamenteUnDestino"] = redirecciones.filter((d) => [d.articuloWpId, d.autorWpUserId, d.destino].filter((x) => x !== null).length !== 1).map((d) => d.origen);

const origenes = new Map<string, number>();
for (const d of redirecciones) origenes.set(d.origen, (origenes.get(d.origen) ?? 0) + 1);
validaciones["origenesDuplicados"] = [...origenes].filter(([, n]) => n > 1).map(([o]) => o);
validaciones["origenesMasDe512"] = redirecciones.filter((d) => d.origen.length > 512).map((d) => d.origen);

// (a) choques de slug entre los 30 (la base decide)
const paresMuestra: Array<[string, string]> = [];
for (let i = 0; i < registros.length; i++) for (let j = i + 1; j < registros.length; j++) paresMuestra.push([registros[i].slug, registros[j].slug]);
const igMuestra = await igualesEnBd(paresMuestra);
validaciones["slugsChocanEntreLos30"] = paresMuestra.filter((_, i) => igMuestra[i]);
// (b) contra lo que ya hay en articulos
const [{ n: cantidadArticulosCms }] = (await bd("SELECT COUNT(*) AS n FROM articulos")) as [Fila];
const choquesCms: unknown[] = [];
const yaMigrados: number[] = [];
for (const r of registros) {
  const filas = await bd(`SELECT id, slug, wpId FROM articulos WHERE slug = ? COLLATE ${COLACION}`, r.slug);
  for (const f of filas) choquesCms.push({ wpId: r.wpId, slug: r.slug, existente: { id: num(f["id"]), slug: str(f["slug"]), wpId: f["wpId"] === null ? null : num(f["wpId"]) } });
  const porWp = await bd("SELECT id FROM articulos WHERE wpId = ?", r.wpId);
  if (porWp.length) yaMigrados.push(r.wpId);
}
validaciones["articulosEnCms"] = num(cantidadArticulosCms);
validaciones["slugsChocanContraCms"] = choquesCms;
validaciones["wpIdYaPresentesEnCms"] = yaMigrados;

// Slugs de autor: entre ellos y contra la tabla autores
const listaAutores = [...autores.values()];
const paresAutores: Array<[string, string]> = [];
for (let i = 0; i < listaAutores.length; i++) for (let j = i + 1; j < listaAutores.length; j++) paresAutores.push([listaAutores[i].slug, listaAutores[j].slug]);
const igAutores = await igualesEnBd(paresAutores);
validaciones["slugsDeAutorQueChocanEntreSi"] = paresAutores.filter((_, i) => igAutores[i]);
const autoresEnCms: unknown[] = [];
for (const a of listaAutores) {
  const filas = await bd(`SELECT id, slug, wpUserId FROM autores WHERE slug = ? COLLATE ${COLACION} OR wpUserId = ?`, a.slug, a.wpUserId);
  for (const f of filas) autoresEnCms.push({ wpUserId: a.wpUserId, slug: a.slug, existente: { id: num(f["id"]), slug: str(f["slug"]), wpUserId: f["wpUserId"] === null ? null : num(f["wpUserId"]) } });
}
validaciones["autoresYaPresentesEnCms"] = autoresEnCms;

// Secciones y categorías que el artículo usa: ¿existen en el CMS?
const seccionesCms = new Set((await bd("SELECT slug FROM secciones")).map((f) => str(f["slug"])));
const categoriasCms = new Set((await bd("SELECT slug FROM categorias")).map((f) => str(f["slug"])));
validaciones["seccionesQueNoExistenEnCms"] = [...new Set(registros.map((r) => r.seccion))].filter((s) => !seccionesCms.has(s));
validaciones["categoriasUsadasQueNoExistenEnCms"] = [...new Set(registros.flatMap((r) => r.categorias as string[]))].filter((c) => !categoriasCms.has(c));
validaciones["categoriasEnCms"] = categoriasCms.size;

validaciones["idempotencia"] = {
  articulosSinWpId: registros.filter((r) => !Number.isInteger(r.wpId)).map((r) => r.slug),
  autoresSinWpUserId: listaAutores.filter((a) => !Number.isInteger(a.wpUserId)).map((a) => a.slug),
  wpIdRepetidos: registros.map((r) => r.wpId).filter((v, i, a) => a.indexOf(v) !== i),
  wpUserIdRepetidos: [] as number[],
  clavesUnicasQueHacenFallarUnaSegundaCorrida: [
    "articulos.wpId, articulos.slug",
    "autores.wpUserId, autores.slug",
    "redirecciones.origen",
    "imagenes.clave, imagenes.wpId",
    "categorias.slug, secciones.slug (si el script los crea en vez de buscarlos)",
    "articulos_categorias y articulos_autores: clave primaria compuesta (articuloId, categoriaId / autorId)",
    "fichas_tecnicas.articuloId (clave primaria)",
  ],
  sinClaveUnica: "articulos_galeria no tiene ninguna clave única: una segunda corrida duplicaría las filas si no borra antes las del artículo",
};

// ---------------------------------------------------------------------------------------------------------------
// A. Artículos con más de una fila de _thumbnail_id (todo el corpus)
// ---------------------------------------------------------------------------------------------------------------
const multiples = await wp(
  `SELECT pm.post_id AS id FROM ${T("postmeta")} pm JOIN ${T("posts")} p ON p.ID = pm.post_id AND p.post_type='post' AND p.post_status IN ('publish','draft')
   WHERE pm.meta_key='_thumbnail_id' GROUP BY pm.post_id HAVING COUNT(*) > 1 ORDER BY pm.post_id`);
const idsMultiples = multiples.map((f) => num(f["id"]));
const filasMulti = await wp(`SELECT meta_id AS metaId, post_id AS id, meta_value AS v FROM ${T("postmeta")} WHERE meta_key='_thumbnail_id' AND post_id IN (${marcas(idsMultiples.length)}) ORDER BY post_id, meta_id`, ...idsMultiples);
const adjMulti = await detalleAdjuntos([...new Set(filasMulti.map((f) => Number(f["v"])).filter(Number.isInteger))]);
const nombresMulti = await wp(`SELECT ID AS id, post_name AS nombre FROM ${T("posts")} WHERE ID IN (${marcas(idsMultiples.length)})`, ...idsMultiples);
const revisionA = idsMultiples.map((id) => {
  const filas = filasMulti.filter((f) => num(f["id"]) === id).map((f) => {
    const valor = str(f["v"]);
    const a = adjMulti.get(Number(valor));
    return { metaId: num(f["metaId"]), valor, existe: !!a && a.tipoPost === "attachment", tipoPost: a?.tipoPost ?? null, clave: a?.clave ?? null, guid: a?.guid ?? null };
  });
  const elegida = filas[0]!;
  return {
    id, slug: str(nombresMulti.find((f) => num(f["id"]) === id)?.["nombre"]), enLaMuestra: ids.includes(id), filas, elegida: elegida.metaId,
    elegidaExiste: elegida.existe, mismoValor: new Set(filas.map((f) => f.valor)).size === 1, mismaClave: new Set(filas.map((f) => f.clave)).size === 1,
  };
});

// ---------------------------------------------------------------------------------------------------------------
// B. Colisiones de slug en todo el corpus (publicados + borradores)
// ---------------------------------------------------------------------------------------------------------------
const corpus = await wp(`SELECT ID AS id, post_name AS nombre, post_status AS estado FROM ${T("posts")} WHERE post_type='post' AND post_status IN ('publish','draft') ORDER BY ID`);
const conSlug = corpus.filter((f) => str(f["nombre"]) !== "");
const gruposJs = new Map<string, Array<{ id: number; slug: string }>>();
for (const f of conSlug) {
  const k = claveJs(str(f["nombre"]));
  const g = gruposJs.get(k) ?? [];
  g.push({ id: num(f["id"]), slug: decodificar(str(f["nombre"])) });
  gruposJs.set(k, g);
}
const candidatos = [...gruposJs.values()].filter((g) => g.length > 1);
const paresCorpus: Array<[{ id: number; slug: string }, { id: number; slug: string }]> = [];
for (const g of candidatos) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) paresCorpus.push([g[i]!, g[j]!]);
const igCorpus = await igualesEnBd(paresCorpus.map(([a, b]) => [a.slug, b.slug]));
const colisionesCorpus = paresCorpus.filter((_, i) => igCorpus[i]).map(([a, b]) => ({ a, b }));
const descartadosPorBd = paresCorpus.filter((_, i) => !igCorpus[i]).map(([a, b]) => ({ a, b }));
// Control cruzado: que la base agrupe todo el corpus por su cuenta (sin pasar por la normalización de JS)
let controlBd: { grupos: number; filas: number } | { error: string };
try {
  const valores = conSlug.map((f) => [num(f["id"]), decodificar(str(f["nombre"]))] as const);
  const sql = `SELECT COUNT(*) AS grupos, COALESCE(SUM(n), 0) AS filas FROM (SELECT COUNT(*) AS n FROM (VALUES ${valores.map(() => "ROW(?, ?)").join(",")}) AS t(i, s) GROUP BY s COLLATE ${COLACION} HAVING COUNT(*) > 1) x`;
  const [f] = await bd(sql, ...valores.flatMap(([i, s]) => [i, s]));
  controlBd = { grupos: num(f?.["grupos"]), filas: num(f?.["filas"]) };
} catch (e) {
  controlBd = { error: String((e as Error).message).slice(0, 200) };
}
const revisionB = {
  publicados: corpus.filter((f) => f["estado"] === "publish").length,
  borradores: corpus.filter((f) => f["estado"] === "draft").length,
  borradoresSinSlug: corpus.filter((f) => str(f["nombre"]) === "").length,
  conPorcentaje: conSlug.filter((f) => str(f["nombre"]).includes("%")).map((f) => ({ id: num(f["id"]), slug: str(f["nombre"]) })),
  gruposCandidatosJs: candidatos.length, paresCandidatos: paresCorpus.length,
  paresDescartadosPorLaBase: descartadosPorBd, colisionesReales: colisionesCorpus, controlDeLaBase: controlBd,
};

// ---------------------------------------------------------------------------------------------------------------
// C. Imágenes de los 30 artículos
// ---------------------------------------------------------------------------------------------------------------
const distintas = new Map<string, { origen: string[]; url: string; articulos: number[]; adjuntoId: number | null; via: string | null }>();
const sumar = (clave: string, url: string, origen: string, articulo: number, adjunto: { id: number; via: string } | null) => {
  const e = distintas.get(clave) ?? { origen: [], url, articulos: [], adjuntoId: adjunto?.id ?? null, via: adjunto?.via ?? null };
  if (!e.origen.includes(origen)) e.origen.push(origen);
  if (!e.articulos.includes(articulo)) e.articulos.push(articulo);
  distintas.set(clave, e);
};
for (const r of registros) {
  if (r.imagenEncabezado) sumar(`adjunto:${r.imagenEncabezado.wpId}`, r.imagenDestacadaFixture, "encabezado", r.wpId, { id: r.imagenEncabezado.wpId, via: "_thumbnail_id" });
  if (r.redesImagenUrl) sumar(r.redesImagenWpId ? `adjunto:${r.redesImagenWpId}` : `url:${r.redesImagenUrl}`, r.redesImagenUrl, "redes", r.wpId, r.redesImagenWpId ? { id: r.redesImagenWpId, via: "url" } : null);
}
for (const [, e] of imagenesDeCuerpo) {
  const adj = adjuntoDeUrl(e.url);
  for (const a of e.articulos) sumar(adj ? `adjunto:${adj.id}` : `url:${e.url}`, e.url, "cuerpo", a, adj);
}
const idsAdjImg = [...new Set([...distintas.values()].map((e) => e.adjuntoId).filter((x): x is number => x !== null))];
const detalleImg = await detalleAdjuntos(idsAdjImg);
const listaImg = [...distintas.entries()].map(([clave, e]) => {
  const d = e.adjuntoId !== null ? detalleImg.get(e.adjuntoId) : undefined;
  const propia = rutaUploads(e.url) !== null;
  return {
    clave, url: e.url, origen: e.origen, articulos: e.articulos, tipoDeUrl: propia ? "biblioteca de WordPress" : "externa o fuera de uploads",
    adjuntoWpId: e.adjuntoId, via: e.via, existeAdjunto: !!d && d.tipoPost === "attachment",
    claveCms: d?.clave ?? null, nombreOriginal: d?.clave ? d.clave.split("/").pop()! : null, tipoMime: d?.tipoMime || null,
    anchoDeclarado: d?.ancho ?? null, altoDeclarado: d?.alto ?? null, bytesDeclarados: d?.bytes ?? null,
  };
});
const revisionC = {
  distintas: listaImg.length,
  porOrigen: { encabezado: listaImg.filter((i) => i.origen.includes("encabezado")).length, cuerpo: listaImg.filter((i) => i.origen.includes("cuerpo")).length, redes: listaImg.filter((i) => i.origen.includes("redes")).length },
  identificablesConAdjunto: listaImg.filter((i) => i.existeAdjunto).length,
  viaExacta: listaImg.filter((i) => i.via === "exacta" || i.via === "_thumbnail_id" || i.via === "url").length,
  viaSinSufijo: listaImg.filter((i) => i.via === "sin-sufijo").length,
  sinAdjunto: listaImg.filter((i) => !i.existeAdjunto).map((i) => ({ url: i.url, tipoDeUrl: i.tipoDeUrl, articulos: i.articulos })),
  completables: {
    clave: listaImg.filter((i) => i.claveCms).length, nombreOriginal: listaImg.filter((i) => i.nombreOriginal).length, tipoMime: listaImg.filter((i) => i.tipoMime).length,
    wpId: listaImg.filter((i) => i.existeAdjunto).length, anchoAltoDeclarados: listaImg.filter((i) => i.anchoDeclarado !== null).length, bytesDeclarados: listaImg.filter((i) => i.bytesDeclarados !== null).length, hash: 0,
  },
  imagenes: listaImg,
};

// ---------------------------------------------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------------------------------------------
const cuenta = <T>(xs: T[], f: (x: T) => string) => { const o: Record<string, number> = {}; for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1; return o; };
const avisosPorTipo: Record<string, { articulos: number; total: number }> = {};
for (const r of registros) {
  for (const w of r.avisosMigracion?.cuerpo ?? []) { const a = (avisosPorTipo[`cuerpo:${w.code}`] ??= { articulos: 0, total: 0 }); a.articulos++; a.total += w.count; }
  for (const w of r.avisosMigracion?.titulo ?? []) { const c = String(w).split(":")[0]!; const a = (avisosPorTipo[`titulo:${c}`] ??= { articulos: 0, total: 0 }); a.articulos++; a.total++; }
}
const invalidos = registros.filter((r) => r.validacion.errores.length || r.validacion.erroresBio.length);
const resumen = {
  articulosConvertidos: registros.length,
  invalidos: invalidos.map((r) => ({ wpId: r.wpId, errores: [...r.validacion.errores, ...r.validacion.erroresBio].slice(0, 5) })),
  avisosPorTipo,
  secciones: cuenta(registros, (r) => r.seccion),
  categoriasPrincipales: cuenta(registros, (r) => r.categoriaPrincipal ?? "(ninguna)"),
  estados: cuenta(registros, (r) => r.estado),
  autores: listaAutores.length, autoresSoloTexto: listaAutores.filter((a) => a.soloTexto).map((a) => a.nombre),
  autoresSinBio: listaAutores.filter((a) => !a.soloTexto && !a.bio).length,
  redirecciones: { total: redirecciones.length, ...cuenta(redirecciones, (d) => d.tipo) },
  sinImagenDeEncabezado: registros.filter((r) => !r.imagenEncabezado).map((r) => r.wpId),
  conRedes: registros.filter((r) => r.redesDescripcion || r.redesImagenUrl).map((r) => r.wpId),
  conCredito: registros.filter((r) => r.encabezadoCredito).map((r) => r.wpId),
  publicadoEnDistintoDeFechaLocal: registros.filter((r) => r.publicadoEn !== null && r.publicadoEn !== `${r.postDateLocal.replace(" ", "T")}.000Z`).map((r) => r.wpId),
  slugsDistintosDeLaFixture: registros.filter((r, i) => r.slugWp !== muestra[i]!.slug).map((r) => r.wpId),
  gmtOffset: opcion("gmt_offset"), timezoneString: opcion("timezone_string"), permalinkStructure: permalink,
  choquesDeSlug: { entreLos30: (validaciones["slugsChocanEntreLos30"] as unknown[]).length, contraCms: choquesCms.length, corpusCompleto: colisionesCorpus.length },
  validacionesFallidas: Object.entries(validaciones).filter(([k, v]) => k !== "idempotencia" && k !== "articulosEnCms" && k !== "categoriasEnCms" && Array.isArray(v) && v.length > 0).map(([k]) => k),
};

// ---------------------------------------------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------------------------------------------
const salida = aRuta("../../out");
mkdirSync(salida, { recursive: true });
writeFileSync(`${salida}/corrida-en-seco-muestra.json`, JSON.stringify({ resumen, validaciones, articulos: registros, autores: listaAutores, redirecciones, revisionA, revisionB, revisionC }, null, 1));

const j = (v: unknown) => "`" + JSON.stringify(v) + "`";
const md: string[] = [];
md.push("# Corrida en seco de la migración de la muestra", "", "Solo lectura: no se escribió nada en ninguna base. Generado por `scripts/migracion/corrida-en-seco.ts`.", "");
md.push("## Resumen", "");
md.push(`- Artículos convertidos: ${resumen.articulosConvertidos}; inválidos (validador en modo migración): ${resumen.invalidos.length}${resumen.invalidos.length ? " " + j(resumen.invalidos) : ""}`);
md.push(`- Estados: ${j(resumen.estados)}`, `- Secciones: ${j(resumen.secciones)}`, `- Categoría principal: ${j(resumen.categoriasPrincipales)}`);
md.push(`- Avisos por tipo (artículos / ocurrencias): ${j(resumen.avisosPorTipo)}`);
md.push(`- Autores: ${resumen.autores}; de solo texto: ${j(resumen.autoresSoloTexto)}; personas sin bio en WordPress: ${resumen.autoresSinBio}`);
md.push(`- Redirecciones: ${j(resumen.redirecciones)} (permalink_structure ${j(permalink)}, gmt_offset ${j(resumen.gmtOffset)}, timezone_string ${j(resumen.timezoneString)})`);
md.push(`- Sin imagen de encabezado: ${j(resumen.sinImagenDeEncabezado)}; con datos para redes: ${j(resumen.conRedes)}; con crédito: ${j(resumen.conCredito)}`);
md.push(`- publicadoEn distinto de post_date local: ${j(resumen.publicadoEnDistintoDeFechaLocal)}; slug distinto del de la fixture: ${j(resumen.slugsDistintosDeLaFixture)}`);
md.push(`- Choques de slug: entre los 30 = ${resumen.choquesDeSlug.entreLos30}; contra articulos del CMS (${validaciones["articulosEnCms"]} filas) = ${resumen.choquesDeSlug.contraCms}; corpus completo = ${resumen.choquesDeSlug.corpusCompleto}`);
md.push(`- Validaciones con resultados: ${j(resumen.validacionesFallidas)}`, "");
md.push("## Validaciones", "");
for (const [k, v] of Object.entries(validaciones)) md.push(`- **${k}**: ${j(v)}`);
md.push("", "## A. Artículos con más de una fila de _thumbnail_id", "", `Total en el corpus: ${revisionA.length}; en la muestra: ${j(revisionA.filter((x) => x.enLaMuestra).map((x) => x.id))}`, "");
md.push("| id | slug | en la muestra | filas (meta_id → valor, existe) | elegida (menor meta_id) | misma clave de archivo |", "|---|---|---|---|---|---|");
for (const a of revisionA) md.push(`| ${a.id} | ${a.slug} | ${a.enLaMuestra ? "sí" : "no"} | ${a.filas.map((f) => `${f.metaId} → ${f.valor} (${f.existe ? "existe" : "NO existe"}${f.clave ? ", " + f.clave : ""})`).join("<br>")} | ${a.elegida}${a.elegidaExiste ? "" : " (NO existe)"} | ${a.mismaClave ? "sí" : "no"} |`);
md.push("", "## B. Colisiones de slug en el corpus completo", "", `- Publicados: ${revisionB.publicados}; borradores: ${revisionB.borradores} (sin slug: ${revisionB.borradoresSinSlug})`);
md.push(`- Slugs con %: ${j(revisionB.conPorcentaje)}`, `- Grupos candidatos (normalización de JS): ${revisionB.gruposCandidatosJs}; pares: ${revisionB.paresCandidatos}; pares que la base descarta: ${j(revisionB.paresDescartadosPorLaBase)}`);
md.push(`- Colisiones reales (confirmadas por la base): ${revisionB.colisionesReales.length} ${j(revisionB.colisionesReales)}`, `- Control: agrupación hecha por la base sobre todo el corpus: ${j(revisionB.controlDeLaBase)}`);
md.push("", "## C. Imágenes", "", `- Distintas: ${revisionC.distintas} (por origen: ${j(revisionC.porOrigen)}); identificables con un adjunto de WordPress: ${revisionC.identificablesConAdjunto} (exacta: ${revisionC.viaExacta}, sin sufijo de tamaño: ${revisionC.viaSinSufijo})`);
md.push(`- Se pueden completar sin los archivos: ${j(revisionC.completables)} (ancho, alto y bytes son los que WordPress declara en _wp_attachment_metadata; no están verificados contra el archivo; el hash no se puede calcular)`);
md.push(`- Sin adjunto: ${j(revisionC.sinAdjunto)}`);
md.push("", "## Artículos", "");
for (const r of registros) {
  const a = autores.get(r.autores[0].wpUserId);
  md.push(`### ${r.wpId} — ${r.titulo}`, "");
  md.push(`- slug \`${r.slug}\`${r.slug !== r.slugWp ? ` (en WordPress: \`${r.slugWp}\`)` : ""}; estado ${r.estado}; publicadoEn ${r.publicadoEn} (post_date local ${r.postDateLocal})`);
  md.push(`- bajada: ${r.bajada ? j(r.bajada) : "(vacía)"}; sección ${r.seccion}; categorías ${j(r.categorias)}; principal ${j(r.categoriaPrincipal)}; categorías WP ${j(r.categoriasWp)}`);
  md.push(`- autor: ${a.nombre} (wpUserId ${a.wpUserId}, slug ${a.slug}${a.soloTexto ? ", solo texto" : a.bio ? ", con bio" : ", sin bio"})${r.bioDelCuerpo ? "; bio dentro del cuerpo: " + j(r.bioDelCuerpo.slice(0, 120)) : ""}`);
  md.push(`- encabezado: ${r.imagenEncabezado ? j({ ...r.imagenEncabezado }) : "(sin imagen)"}; alt ${r.encabezadoAlt ? "ok" : "pendiente"}; crédito ${j(r.encabezadoCredito)}`);
  md.push(`- redes: ${j({ descripcion: r.redesDescripcion, imagen: r.redesImagenUrl, imagenWpId: r.redesImagenWpId })}; etiquetas ocultas: ${j(r.etiquetasWp)}; visitasWp ${r.visitasWp}; altPendientes ${r.altPendientes} (cuerpo ${r.altPendientesCuerpo})`);
  md.push(`- avisos: ${j(r.avisosMigracion)}; validación: ${j(r.validacion)}`);
  md.push(`- redirecciones: ${j(r.redirecciones.map((d: { tipo: string; origen: string }) => `${d.tipo} ${d.origen}`))}`, "");
}
writeFileSync(`${salida}/corrida-en-seco-muestra.md`, md.join("\n") + "\n");

console.log(`Corrida en seco: ${resumen.articulosConvertidos} artículos, ${resumen.invalidos.length} inválidos, ${redirecciones.length} redirecciones, ${listaAutores.length} autores.`);
console.log("Secciones:", JSON.stringify(resumen.secciones));
console.log("Avisos:", JSON.stringify(resumen.avisosPorTipo));
console.log("Choques de slug:", JSON.stringify(resumen.choquesDeSlug), "| validaciones con resultados:", JSON.stringify(resumen.validacionesFallidas));
console.log("Revisión A:", revisionA.length, "artículos con varias _thumbnail_id (", revisionA.filter((x) => x.enLaMuestra).length, "en la muestra ) | B:", revisionB.colisionesReales.length, "colisiones | C:", revisionC.distintas, "imágenes distintas,", revisionC.identificablesConAdjunto, "con adjunto");
console.log(`Informe: ${salida}/corrida-en-seco-muestra.md`);

await clienteWp.$disconnect();
await cms.$disconnect();
