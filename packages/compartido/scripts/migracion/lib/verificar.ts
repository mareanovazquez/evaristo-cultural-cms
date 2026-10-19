// Verificación POSTERIOR a la escritura: compara lo que hay en una base contra el plan de los artículos pedidos. SOLO LEE.
// La función central recibe por parámetro las conexiones de solo lectura (`bd`: el CMS; `wp`: WordPress, solo para armar el plan) y el destino que
// valida; no abre conexiones, no conoce ningún destino y no importa escribir.ts, correr-escritura.ts ni flujo-escribir.ts. Todo pasa por consultar()
// (un único SELECT por vez). Quien la llama decide la base: el script verificar-escritura.ts, siempre evaristo_cms; los tests con base, evaristo_cms_test.
// Nunca devuelve ni imprime correos, textos de bio ni claves: solo nombres de comprobaciones, ids y cantidades.
import { validateArticleBodyDetallado } from "../../../src/schema/validate.ts";
import { leerDestinoServidor } from "./conexiones.ts";
import type { DestinoUrl } from "./destinos.ts";
import { nodosImagen, srcDeClave } from "./enlaces-imagenes.ts";
import type { Consulta } from "./leer-wordpress.ts";
import type { Plan } from "./armar.ts";
import { simular } from "./simular.ts";
import { marcas, num, str } from "./utilidades.ts";

export interface OpcionesVerificacion {
  /** El CMS, de solo lectura (sesión READ ONLY). */
  bd: Consulta;
  /** WordPress, de solo lectura: solo para armar el plan esperado. Obligatoria si no se pasa `plan`. */
  wp?: Consulta;
  /** La base que se verifica (host, puerto y base); se comprueba contra lo que dice el servidor. */
  destino: DestinoUrl;
  /** wpId de los artículos a verificar (de la muestra). */
  ids: readonly number[];
  /** No comparar los conteos globales de la base: solo lo relacionado con los artículos pedidos. */
  soloEstos: boolean;
  originales: string;
  /** El plan esperado ya armado (los tests con base lo arman del snapshot, sin WordPress ni originales). Si falta, se arma con simular(). */
  plan?: Plan;
}

export interface Comprobacion { articulo: number | null; nombre: string; ok: boolean; detalle: string }

export interface ResultadoVerificacion {
  base: string;
  conteos: Record<string, number>;
  presentes: number[];
  ausentes: number[];
  comprobaciones: Comprobacion[];
  diferencias: number;
}

type Fila = Record<string, any>;
const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const aJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const estable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x instanceof Date ? x.getTime() : x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const hojas = (v: unknown, acc: string[] = []): string[] => { if (typeof v === "string") acc.push(v); else if (Array.isArray(v)) v.forEach((x) => hojas(x, acc)); else if (v && typeof v === "object") Object.values(v).forEach((x) => hojas(x, acc)); return acc; };
const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string | number | Date).toISOString());

export async function verificarEscritura(o: OpcionesVerificacion): Promise<ResultadoVerificacion> {
  const { bd, wp } = o;
  const comprobaciones: Comprobacion[] = [];
  const chk = (articulo: number | null, nombre: string, ok: boolean, detalle = "") => { comprobaciones.push({ articulo, nombre, ok, detalle }); };
  const uno = async (sql: string, ...p: unknown[]): Promise<Fila | undefined> => ((await bd(sql, ...p)) as Fila[])[0];
  const cuenta = async (sql: string, ...p: unknown[]): Promise<number> => num((await uno(sql, ...p))?.["n"]);

  // la base es la que se pidió
  const servidorCms = await leerDestinoServidor(bd);
  if (servidorCms.base !== o.destino.base || servidorCms.puerto !== o.destino.puerto) throw new Error(`La conexión no es a ${o.destino.host}:${o.destino.puerto}/${o.destino.base} (el servidor dice ${servidorCms.puerto}/${servidorCms.base || "NULL"}): se aborta`);
  let plan = o.plan;
  if (!plan) {
    if (!wp) throw new Error("verificarEscritura: sin plan hace falta la conexión de WordPress");
    const servidorWordPress = await leerDestinoServidor(wp);

  // el plan esperado: simulación de solo lectura (las colisiones se miran contra la propia base verificada)
    const { preparado } = await simular(
      { alcance: { tipo: "ids", ids: [...o.ids] }, modo: "simular", esperarArticulos: null, esperarSobrescribir: null, abortarAlPrimerError: false, sobrescribir: false, originales: o.originales },
      { wp, bd, destino: o.destino, servidorCms, servidorWordPress },
      { destinoPermitido: o.destino },
    );
    plan = preparado.plan;
  }

  // conteos de todas las tablas
  const tablas = ((await bd("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME")) as Fila[]).map((f) => str(f["t"]));
  const conteos: Record<string, number> = {};
  for (const t of tablas) {
    if (!/^[A-Za-z0-9_]+$/.test(t)) throw new Error(`nombre de tabla inesperado: ${t}`);
    conteos[t] = await cuenta(`SELECT COUNT(*) AS n FROM \`${t}\``);
  }

  const presentes: number[] = [], ausentes: number[] = [];
  const filaDe = new Map<number, Fila>();
  for (const id of o.ids) {
    const f = await uno("SELECT a.*, s.slug AS seccionSlug, cp.slug AS categoriaPrincipalSlug FROM articulos a JOIN secciones s ON s.id = a.seccionId LEFT JOIN categorias cp ON cp.id = a.categoriaPrincipalId WHERE a.wpId = ?", id);
    if (f) { presentes.push(id); filaDe.set(id, f); } else { ausentes.push(id); chk(id, "el artículo está en la base", false, "no está"); }
  }

  const autorIdDe = new Map<number, number>();
  for (const a of plan.autores) { const f = await uno("SELECT id FROM autores WHERE wpUserId = ?", a.wpUserId); if (f) autorIdDe.set(a.wpUserId, num(f["id"])); }

  // ---------------------------------------------------------------------------------------------------------
  // por artículo
  // ---------------------------------------------------------------------------------------------------------
  for (const id of presentes) {
    const art = filaDe.get(id)!;
    const artId = num(art["id"]);
    const pa = plan.articulos.find((x) => x.wpId === id);
    if (!pa) { chk(id, "el artículo está en el plan", false, "el plan lo excluye (inválido): no se puede comparar"); continue; }
    const c = (nombre: string, ok: boolean, detalle = "") => chk(id, nombre, ok, detalle);

    // (a) relaciones del artículo
    const cats = (await bd("SELECT c.slug FROM articulos_categorias ac JOIN categorias c ON c.id = ac.categoriaId WHERE ac.articuloId = ? ORDER BY c.slug", artId)) as Fila[];
    c("(a) categorías del artículo", estable(cats.map((x) => str(x["slug"]))) === estable([...pa.categorias].sort()), `${cats.length} en la base, ${pa.categorias.length} en el plan`);
    const autoresDb = (await bd("SELECT au.wpUserId, aa.orden FROM articulos_autores aa JOIN autores au ON au.id = aa.autorId WHERE aa.articuloId = ? ORDER BY aa.orden, au.wpUserId", artId)) as Fila[];
    c("(d) autores y orden", estable(autoresDb.map((x) => [num(x["wpUserId"]), num(x["orden"])])) === estable([...pa.autores].sort((x, y) => x.orden - y.orden || x.wpUserId - y.wpUserId).map((x) => [x.wpUserId, x.orden])), `${autoresDb.length} en la base, ${pa.autores.length} en el plan`);
    c("(a) galería del artículo (0)", (await cuenta("SELECT COUNT(*) AS n FROM articulos_galeria WHERE articuloId = ?", artId)) === 0);
    c("(a) ficha técnica del artículo (0)", (await cuenta("SELECT COUNT(*) AS n FROM fichas_tecnicas WHERE articuloId = ?", artId)) === 0);

    // (b) la fila
    c("(b) slug", str(art["slug"]) === pa.slug, `${str(art["slug"])} vs ${pa.slug}`);
    c("(b) estado", str(art["estado"]) === pa.estado, `${str(art["estado"])} vs ${pa.estado}`);
    c("(b) sección", str(art["seccionSlug"]) === pa.seccion, `${str(art["seccionSlug"])} vs ${pa.seccion}`);
    c("(b) categoría principal dentro de sus categorías", pa.categoriaPrincipal === null ? art["categoriaPrincipalId"] === null : cats.some((x) => str(x["slug"]) === str(art["categoriaPrincipalSlug"])) && str(art["categoriaPrincipalSlug"]) === pa.categoriaPrincipal, `${str(art["categoriaPrincipalSlug"]) || "(ninguna)"} vs ${pa.categoriaPrincipal ?? "(ninguna)"}`);
    c("(b) título", str(art["titulo"]) === pa.titulo);
    c("(b) publicadoEn", iso(art["publicadoEn"]) === pa.publicadoEn, `${iso(art["publicadoEn"])} vs ${pa.publicadoEn}`);
    c("(b) visitasWp", (art["visitasWp"] === null ? null : num(art["visitasWp"])) === pa.visitasWp, `${str(art["visitasWp"])} vs ${str(pa.visitasWp)}`);
    c("(b) avisosMigracion", estable(aJson(art["avisosMigracion"]) ?? null) === estable(pa.avisosMigracion ?? null));
    c("(b) altPendientes", num(art["altPendientes"]) === pa.altPendientes, `${num(art["altPendientes"])} vs ${pa.altPendientes}`);

    // (c) el cuerpo
    let cuerpo: any = null;
    try { cuerpo = aJson(art["cuerpo"]); c("(c) el cuerpo es JSON válido", cuerpo !== null && typeof cuerpo === "object"); } catch { c("(c) el cuerpo es JSON válido", false); }
    c("(c) schemaVersion", num(art["schemaVersion"]) === pa.schemaVersion, `${num(art["schemaVersion"])} vs ${pa.schemaVersion}`);
    if (cuerpo && typeof cuerpo === "object") {
      const { errores } = validateArticleBodyDetallado(cuerpo as never, { modo: "migracion" });
      c("(c) validado con validate.ts en modo migración", errores.length === 0, `${errores.length} errores`);
    }
    c("(c) texto plano igual al del plan", str(art["textoPlano"]) === pa.textoPlano, `${str(art["textoPlano"]).length} vs ${pa.textoPlano.length} caracteres`);

    // (f) imágenes del cuerpo
    const nodos = cuerpo && typeof cuerpo === "object" ? nodosImagen(cuerpo) : [];
    const esperadas = nodosImagen(pa.cuerpo).filter((n) => typeof n.attrs?.["imagenWpId"] === "number").length;
    c("(f) cantidad de imágenes del cuerpo (con fila)", nodos.filter((n) => typeof n.attrs?.["imagenId"] === "number").length === esperadas, `${nodos.length} nodos, ${esperadas} esperados con fila${nodos.length === 0 ? " (el cuerpo no tiene imágenes)" : ""}`);
    let malos = 0;
    for (const n of nodos) {
      const imagenId = n.attrs?.["imagenId"];
      if (imagenId === undefined) continue;   // una imagen sin original: queda como el plan la dejó
      const f = typeof imagenId === "number" ? await uno("SELECT clave FROM imagenes WHERE id = ?", imagenId) : undefined;
      if (!f || n.attrs?.["src"] !== srcDeClave(str(f["clave"])) || "imagenWpId" in (n.attrs ?? {})) malos++;
    }
    c("(f) cada nodo imagen: imagenId existe y src /media/<clave> coherente", malos === 0, `${malos} con problemas`);

    // (g) imagen de encabezado
    const pi = plan.imagenes.find((x) => x.wpId === pa.encabezadoAdjuntoWpId);
    if (art["imagenEncabezadoId"] === null) c("(g) imagen de encabezado", pi === undefined, pi === undefined ? "el artículo no tiene encabezado con fila (sin original o sin encabezado)" : "debería tener encabezado y no lo tiene");
    else {
      const im = await uno("SELECT * FROM imagenes WHERE id = ?", art["imagenEncabezadoId"]);
      c("(g) encabezado: fila de imagenes igual a la del plan", !!im && !!pi && num(im["wpId"]) === pi.wpId && str(im["clave"]) === pi.clave && str(im["nombreOriginal"]) === pi.nombreOriginal && str(im["tipoMime"]) === pi.tipoMime && num(im["ancho"]) === pi.ancho && num(im["alto"]) === pi.alto && num(im["bytes"]) === pi.bytes && str(im["hash"]) === pi.hash, im ? `${str(im["clave"])} ${str(im["tipoMime"])} ${num(im["ancho"])}x${num(im["alto"])} ${num(im["bytes"])} bytes` : "no existe");
    }
    c("(g) encabezado: alt, crédito y punto focal", art["encabezadoAlt"] === pa.encabezadoAlt && art["encabezadoCredito"] === pa.encabezadoCredito && num(art["encabezadoPuntoFocalX"]) === pa.encabezadoPuntoFocalX && num(art["encabezadoPuntoFocalY"]) === pa.encabezadoPuntoFocalY);

    // (e) redirecciones del artículo
    for (const r of plan.redirecciones.filter((x) => x.articuloWpId === id)) await comprobarRedireccion(id, r, { articuloId: artId });
  }

  // redirecciones de autor, autores e imágenes del plan (sin artículo: se comprueban una vez)
  async function comprobarRedireccion(articulo: number | null, r: { origen: string; tipo: string; autorWpUserId: number | null }, esperado: { articuloId?: number; autorId?: number }) {
    const f = await uno("SELECT tipo, codigo, articuloId, autorId, destino FROM redirecciones WHERE origen = ?", r.origen);
    if (!f) { chk(articulo, `(e) redirección ${r.origen}`, false, "no existe"); return; }
    const destinos = [f["articuloId"], f["autorId"], f["destino"]].filter((x) => x !== null && x !== undefined);
    const existe = f["articuloId"] !== null ? (await cuenta("SELECT COUNT(*) AS n FROM articulos WHERE id = ?", f["articuloId"])) === 1
      : f["autorId"] !== null ? (await cuenta("SELECT COUNT(*) AS n FROM autores WHERE id = ?", f["autorId"])) === 1 : str(f["destino"]).length > 0;
    const apunta = (f["articuloId"] === null ? undefined : num(f["articuloId"])) === esperado.articuloId && (f["autorId"] === null ? undefined : num(f["autorId"])) === esperado.autorId;
    chk(articulo, `(e) redirección ${r.origen}`, str(f["tipo"]) === r.tipo && num(f["codigo"]) === 301 && destinos.length === 1 && existe && apunta, `tipo ${str(f["tipo"])}, código ${num(f["codigo"])}, destinos ${destinos.length}, destino existe ${existe}, apunta a lo esperado ${apunta}`);
  }
  for (const r of plan.redirecciones.filter((x) => x.tipo === "AUTOR")) {
    const autorId = r.autorWpUserId === null ? undefined : autorIdDe.get(r.autorWpUserId);
    if (autorId === undefined) chk(null, `(e) redirección ${r.origen}`, false, "el autor no está en la base");
    else await comprobarRedireccion(null, r, { autorId });
  }
  for (const a of plan.autores) {
    const f = await uno("SELECT slug, nombre, soloTexto, bio FROM autores WHERE wpUserId = ?", a.wpUserId);
    chk(null, `(d) autor ${a.wpUserId}: slug, nombre y soloTexto`, !!f && str(f["slug"]) === a.slug && str(f["nombre"]) === a.nombre && Boolean(f["soloTexto"]) === a.soloTexto);
    chk(null, `(h) autor ${a.wpUserId}: la bio guardada es la del plan (no se muestra)`, !!f && estable(aJson(f["bio"]) ?? null) === estable(a.bio ?? null));
  }
  for (const i of plan.imagenes) {
    const f = await uno("SELECT * FROM imagenes WHERE wpId = ?", i.wpId);
    chk(null, `(g) imagen ${i.wpId}: fila igual a la del plan`, !!f && str(f["clave"]) === i.clave && str(f["nombreOriginal"]) === i.nombreOriginal && str(f["tipoMime"]) === i.tipoMime && num(f["ancho"]) === i.ancho && num(f["alto"]) === i.alto && num(f["bytes"]) === i.bytes && str(f["hash"]) === i.hash);
  }

  // (h) ni correos ni texto de bio fuera de autores.bio
  if (presentes.length) {
    const ph = marcas(presentes.length);
    const arts = await bd(`SELECT * FROM articulos WHERE wpId IN (${ph})`, ...presentes);
    const aut = await bd("SELECT slug, nombre, soloTexto FROM autores");
    const imgs = await bd("SELECT * FROM imagenes");
    const cats = await bd("SELECT * FROM categorias");
    const reds = await bd("SELECT * FROM redirecciones");
    const enJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
    const texto = enJson([arts, aut, imgs, cats, reds]);
    // los correos que están en el propio contenido del artículo (el cuerpo que escribió su autor) son legítimos: lo que no puede haber es un correo que el plan no tenga,
    // ni ninguno en las demás tablas. En las bios de los autores del plan solo pueden estar los correos que el plan trae (hoy, el wpUserId 39).
    const correosDe = (s: string) => new Set(s.match(new RegExp(CORREO.source, "g")) ?? []);
    const delPlan = correosDe(enJson(plan.articulos.filter((x) => presentes.includes(x.wpId)).map((x) => [x.titulo, x.bajada, x.cuerpo, x.textoPlano, x.redesDescripcion, x.avisosMigracion, x.etiquetasWp, x.encabezadoAlt, x.encabezadoCredito])));
    const enArticulos = correosDe(enJson(arts));
    const deMas = [...enArticulos].filter((x) => !delPlan.has(x)).length;
    const enOtras = correosDe(enJson([aut, imgs, cats, reds])).size;
    const idsAutores = plan.autores.map((a) => a.wpUserId);
    const biosDb = idsAutores.length ? await bd(`SELECT bio FROM autores WHERE wpUserId IN (${marcas(idsAutores.length)})`, ...idsAutores) : [];
    const correosDeBiosDelPlan = correosDe(enJson(plan.autores.map((a) => a.bio ?? null)));
    const enBios = correosDe(enJson(biosDb));
    const biosDeMas = [...enBios].filter((x) => !correosDeBiosDelPlan.has(x)).length;
    chk(null, "(h) sin correos fuera de autores.bio y del contenido del propio artículo", deMas === 0 && enOtras === 0 && biosDeMas === 0, `${deMas} correos de más en artículos, ${enOtras} en otras tablas, ${biosDeMas} de más en bios (${enArticulos.size} en el contenido de los artículos, todos del plan)`);
    const fragmentos = plan.autores.flatMap((a) => hojas(a.bio)).map((s) => s.trim()).filter((s) => s.length >= 15).map((s) => JSON.stringify(s).slice(1, -1));
    chk(null, "(h) sin texto de bio fuera de autores.bio", fragmentos.every((s) => !texto.includes(s)));
  }

  // (a)/(i) conteos globales
  if (!o.soloEstos) {
    const esperado: Record<string, number> = {
      articulos: o.ids.length, categorias: new Set(plan.articulos.flatMap((a) => a.categorias)).size, autores: plan.autores.length, imagenes: plan.imagenes.length, redirecciones: plan.redirecciones.length,
      articulos_categorias: plan.articulos.reduce((n, a) => n + a.categorias.length, 0), articulos_autores: plan.articulos.reduce((n, a) => n + a.autores.length, 0),
      articulos_galeria: 0, fichas_tecnicas: 0, usuarios: 0, pruebaconexion: 0,
    };
    for (const [t, n] of Object.entries(esperado)) chk(null, `(a) conteo ${t}`, conteos[t] === n, `esperado ${n}, hay ${conteos[t]}`);
    chk(null, "(i) secciones no cambiaron", conteos["secciones"] === 18, `hay ${conteos["secciones"]}`);
    if ("_prisma_migrations" in conteos) chk(null, "(i) _prisma_migrations no cambió", conteos["_prisma_migrations"] === 3, `hay ${conteos["_prisma_migrations"]}`);
    const otras = tablas.filter((t) => !(t in esperado) && !["secciones", "_prisma_migrations"].includes(t));
    chk(null, "(i) ninguna tabla desconocida con filas", otras.every((t) => conteos[t] === 0), `tablas no listadas: ${JSON.stringify(otras)}`);
  }

  return { base: o.destino.base, conteos, presentes, ausentes, comprobaciones, diferencias: comprobaciones.filter((x) => !x.ok).length };
}

/** El código de salida del script: 0 si no hay diferencias (un artículo pedido que no está cuenta como diferencia) y 1 si las hay. */
export const codigoDeSalida = (r: ResultadoVerificacion): number => (r.diferencias > 0 ? 1 : 0);

/** El resultado como líneas de texto: con pocos artículos, todas las comprobaciones; con muchos, una línea por artículo y el detalle de las diferencias. */
export function formatearVerificacion(r: ResultadoVerificacion, ids: readonly number[]): string[] {
  const l: string[] = [];
  l.push(`Base: ${r.base} | artículos pedidos: ${ids.length} (en la base: ${r.presentes.length}, ausentes: ${r.ausentes.length})`);
  l.push(`Conteos: ${JSON.stringify(r.conteos)}`);
  if (r.ausentes.length) l.push(`No están en la base: ${r.ausentes.join(", ")}`);
  l.push("");
  const marca = (c: Comprobacion) => `${c.ok ? "OK        " : "DIFERENCIA"} ${c.articulo === null ? "" : `[${c.articulo}] `}${c.nombre}${c.detalle ? ` — ${c.detalle}` : ""}`;
  if (ids.length <= 3) for (const c of r.comprobaciones) l.push(marca(c));
  else {
    for (const id of ids) {
      const cs = r.comprobaciones.filter((c) => c.articulo === id);
      const mal = cs.filter((c) => !c.ok).length;
      l.push(`${mal ? "DIFERENCIA" : "OK        "} [${id}] ${cs.length} comprobaciones${mal ? `, ${mal} con diferencias` : ""}`);
    }
    const generales = r.comprobaciones.filter((c) => c.articulo === null);
    l.push(`${generales.some((c) => !c.ok) ? "DIFERENCIA" : "OK        "} generales (autores, imágenes, redirecciones de autor, bios y conteos): ${generales.length} comprobaciones`);
    l.push("");
    for (const c of r.comprobaciones.filter((x) => !x.ok)) l.push(marca(c));
  }
  l.push("");
  l.push(`${r.comprobaciones.length} comprobaciones, ${r.diferencias} diferencias. Nada se escribió (solo SELECT, sesión READ ONLY).`);
  return l;
}
