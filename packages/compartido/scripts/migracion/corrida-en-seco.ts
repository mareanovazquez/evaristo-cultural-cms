// Corrida en seco de la migración de la muestra ampliada (35 artículos de WordPress: los 30 de la fixture más los 5 de
// datos/migracion/muestra-extra.json), con la medición de las imágenes originales en disco.
//
// SOLO LECTURA: lee la base de WordPress (127.0.0.1:3307, evaristo_lectura) y la del CMS (DATABASE_URL del .env,
// puerto 3308), arma en memoria los registros que se insertarían en el CMS y escribe un informe. No inserta ni
// modifica nada: las dos conexiones abren la sesión con SET SESSION TRANSACTION READ ONLY y todas las consultas
// pasan por `consultar()`, que rechaza todo lo que no sea un SELECT.
//
// Las carpetas de imágenes también son de solo lectura: solo se listan y se leen.
//
// Uso: npm run migracion:seco -w @evaristo/compartido
// Salidas (ignoradas por git): packages/compartido/out/corrida-en-seco-ampliada.md y .json
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  INVISIBLES, aNFC, claveJs, cuentaDe, decodificar, limpiarSlug, num, rutaUploads, str,
} from "./lib/utilidades.ts";
import { armar } from "./lib/armar.ts";
import { crearMedidor, dimensiones, tipoPorContenido } from "./lib/imagenes.ts";
import { cargarDatosVersionados } from "./lib/entrada-snapshot.ts";
import { entradaEnVivo } from "./lib/entrada-vivo.ts";
import {
  COLACION, abrirConexiones, agruparSlugsEnBd, contarArticulosCms, detalleAdjuntos, igualesEnBd, leerArticulosPorSlug, leerArticulosPorWpId,
  leerAutoresPorSlugOWpUserId, leerCorpus, leerCuentas, leerFilasThumbnail, leerNombresDePosts, leerPostsConVariosThumbnails,
} from "./lib/leer-wordpress.ts";
import type { Fila } from "./lib/leer-wordpress.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const aRuta = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Carpetas de imágenes (solo lectura). Los originales se llaman como figuran en _wp_attached_file.
const CARPETA_ORIGINALES = aRuta("../../../../../CMS-EVARISTO(ASSETS)/uploads-muestra/originales");
const CARPETA_DERIVADAS = aRuta("../../../../../CMS-EVARISTO(ASSETS)/uploads-muestra/derivadas");
const LISTA_IMAGENES = aRuta("../../out/imagenes-muestra-ampliada.txt");

// ---------------------------------------------------------------------------------------------------------------
// Conexiones de solo lectura (lib/leer-wordpress.ts)
// ---------------------------------------------------------------------------------------------------------------
const { wp, bd, cerrar } = await abrirConexiones();

// ---------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Entrada y lectura en vivo
// ---------------------------------------------------------------------------------------------------------------
const { fixture, extras, cuentas, ids } = cargarDatosVersionados();
const idsFixture = fixture.map((m) => m.id);

// La comparación de slugs depende de la intercalación del CMS: se comprueba que se comporte como se espera.
const [e1, e2, e3] = await igualesEnBd(bd, [["Mañana", "manana"], ["Café", "cafe"], ["CAFE", "cafe"]]);
if (e1 !== false || e2 !== true || e3 !== true) throw new Error(`La intercalación ${COLACION} no se comporta como se esperaba (ñ/n=${e1}, é/e=${e2}, A/a=${e3})`);

// Lo que armar() necesita, leído en vivo de WordPress y del CMS (lib/entrada-vivo.ts)
const entrada = await entradaEnVivo(wp, bd);
const permalink = entrada.opciones.permalink_structure;

// Cuentas institucionales: cada una debe existir en wp_users con el mismo id, user_login y display_name del JSON.
const filasCuentas = await leerCuentas(wp, cuentas.map((c) => c.wpUserId));
const cuentasVerificadas = cuentas.map((c) => {
  const f = filasCuentas.find((x) => num(x["id"]) === c.wpUserId);
  return { ...c, existeEnWp: !!f, loginEnWp: f ? str(f["login"]) : null, nombreEnWp: f ? str(f["nombre"]) : null, coincide: !!f && str(f["login"]) === c.user_login && str(f["nombre"]) === c.nombre };
});
const cuentasQueNoCoinciden = cuentasVerificadas.filter((c) => !c.coincide);
if (cuentasQueNoCoinciden.length) throw new Error(`Las cuentas de datos/migracion/cuentas.json no coinciden con WordPress: ${JSON.stringify(cuentasQueNoCoinciden)}`);

// ---------------------------------------------------------------------------------------------------------------
// Armado de los registros (función pura, lib/armar.ts)
// ---------------------------------------------------------------------------------------------------------------
const plan = armar(entrada);
const registros = plan.articulos;
const autores = new Map(plan.autores.map((a) => [a.wpUserId, a]));
const redirecciones = plan.redirecciones;

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

// (a) choques de slug entre los 35 (la base decide)
const paresMuestra: Array<[string, string]> = [];
for (let i = 0; i < registros.length; i++) for (let j = i + 1; j < registros.length; j++) paresMuestra.push([registros[i].slug, registros[j].slug]);
const igMuestra = await igualesEnBd(bd, paresMuestra);
validaciones["slugsChocanEntreLos35"] = paresMuestra.filter((_, i) => igMuestra[i]);
// (b) contra lo que ya hay en articulos
const [{ n: cantidadArticulosCms }] = (await contarArticulosCms(bd)) as [Fila];
const choquesCms: unknown[] = [];
const yaMigrados: number[] = [];
for (const r of registros) {
  const filas = await leerArticulosPorSlug(bd, r.slug);
  for (const f of filas) choquesCms.push({ wpId: r.wpId, slug: r.slug, existente: { id: num(f["id"]), slug: str(f["slug"]), wpId: f["wpId"] === null ? null : num(f["wpId"]) } });
  const porWp = await leerArticulosPorWpId(bd, r.wpId);
  if (porWp.length) yaMigrados.push(r.wpId);
}
validaciones["articulosEnCms"] = num(cantidadArticulosCms);
validaciones["slugsChocanContraCms"] = choquesCms;
validaciones["wpIdYaPresentesEnCms"] = yaMigrados;

// Slugs de autor: entre ellos y contra la tabla autores
const listaAutores = [...autores.values()];
const paresAutores: Array<[string, string]> = [];
for (let i = 0; i < listaAutores.length; i++) for (let j = i + 1; j < listaAutores.length; j++) paresAutores.push([listaAutores[i].slug, listaAutores[j].slug]);
const igAutores = await igualesEnBd(bd, paresAutores);
validaciones["slugsDeAutorQueChocanEntreSi"] = paresAutores.filter((_, i) => igAutores[i]);
const autoresEnCms: unknown[] = [];
for (const a of listaAutores) {
  const filas = await leerAutoresPorSlugOWpUserId(bd, a.slug, a.wpUserId);
  for (const f of filas) autoresEnCms.push({ wpUserId: a.wpUserId, slug: a.slug, existente: { id: num(f["id"]), slug: str(f["slug"]), wpUserId: f["wpUserId"] === null ? null : num(f["wpUserId"]) } });
}
validaciones["autoresYaPresentesEnCms"] = autoresEnCms;

// Secciones y categorías que el artículo usa: ¿existen en el CMS? (lo calcula armar())
validaciones["seccionesQueNoExistenEnCms"] = plan.seccionesFaltantes;
const categoriasACrear = plan.categoriasACrear;
validaciones["categoriasUsadasQueNoExistenEnCms"] = categoriasACrear.map((c) => c.slug);
validaciones["categoriasEnCms"] = new Set(entrada.categoriasExistentes).size;
validaciones["categoriasACrearSinNombreEnElMapeo"] = categoriasACrear.filter((c) => c.nombre === null).map((c) => c.slug);

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
const multiples = await leerPostsConVariosThumbnails(wp);
const idsMultiples = multiples.map((f) => num(f["id"]));
const filasMulti = await leerFilasThumbnail(wp, idsMultiples);
const adjMulti = await detalleAdjuntos(wp, [...new Set(filasMulti.map((f) => Number(f["v"])).filter(Number.isInteger))]);
const nombresMulti = await leerNombresDePosts(wp, idsMultiples);
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
const corpus = await leerCorpus(wp);
const conSlug = corpus.filter((f) => str(f["nombre"]) !== "");
const gruposJs = new Map<string, Array<{ id: number; slug: string }>>();
for (const f of conSlug) {
  const k = claveJs(limpiarSlug(decodificar(str(f["nombre"]))).slug);
  const g = gruposJs.get(k) ?? [];
  g.push({ id: num(f["id"]), slug: limpiarSlug(decodificar(str(f["nombre"]))).slug });
  gruposJs.set(k, g);
}
const candidatos = [...gruposJs.values()].filter((g) => g.length > 1);
const paresCorpus: Array<[{ id: number; slug: string }, { id: number; slug: string }]> = [];
for (const g of candidatos) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) paresCorpus.push([g[i]!, g[j]!]);
const igCorpus = await igualesEnBd(bd, paresCorpus.map(([a, b]) => [a.slug, b.slug]));
const colisionesCorpus = paresCorpus.filter((_, i) => igCorpus[i]).map(([a, b]) => ({ a, b }));
const descartadosPorBd = paresCorpus.filter((_, i) => !igCorpus[i]).map(([a, b]) => ({ a, b }));
// Control cruzado: que la base agrupe todo el corpus por su cuenta (sin pasar por la normalización de JS)
let controlBd: { grupos: number; filas: number } | { error: string };
try {
  const valores = conSlug.map((f) => [num(f["id"]), limpiarSlug(decodificar(str(f["nombre"]))).slug] as const);
  const f = await agruparSlugsEnBd(bd, valores);
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
const distintas = new Map(plan.imagenesReferenciadas.map((e) => [e.clave, e] as const));
const idsAdjImg = [...new Set([...distintas.values()].map((e) => e.adjuntoId).filter((x): x is number => x !== null))];
const detalleImg = await detalleAdjuntos(wp, idsAdjImg);
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
// D. Medición de los archivos originales (solo lectura de disco)
// ---------------------------------------------------------------------------------------------------------------
const cacheDir = new Map<string, string[]>();
const listar = (d: string) => { if (!cacheDir.has(d)) cacheDir.set(d, readdirSync(d)); return cacheDir.get(d)!; };

const lineasLista = readFileSync(LISTA_IMAGENES, "utf8").split(/\r?\n/).filter(Boolean);
const clavesCalculadas = listaImg.filter((i) => i.existeAdjunto && i.claveCms).map((i) => i.claveCms!);
const contraLista = {
  lineasEnLista: lineasLista.length,
  calculadas: clavesCalculadas.length,
  enListaYNoCalculadas: lineasLista.filter((l) => !clavesCalculadas.includes(l)),
  calculadasYNoEnLista: clavesCalculadas.filter((c) => !lineasLista.includes(c)),
};

// La medición (lib/imagenes.ts) es la misma que usa la migración: el nombre se compara exacto (NFC, sensible a mayúsculas).
const medir = crearMedidor(CARPETA_ORIGINALES);

const medidas = listaImg.filter((i) => i.existeAdjunto && i.claveCms).map((i) => {
  const m = medir(i.claveCms!);
  return {
    adjuntoWpId: i.adjuntoWpId, clave: i.claveCms!, articulos: i.articulos, origen: i.origen, medicion: m,
    wp: { ancho: i.anchoDeclarado, alto: i.altoDeclarado, bytes: i.bytesDeclarados, mime: i.tipoMime },
    coincide: m.estado === "medida" ? {
      ancho: i.anchoDeclarado === null ? null : i.anchoDeclarado === m.ancho,
      alto: i.altoDeclarado === null ? null : i.altoDeclarado === m.alto,
      bytes: i.bytesDeclarados === null ? null : i.bytesDeclarados === m.bytes,
      mime: i.tipoMime ? i.tipoMime === m.mime : null,
    } : null,
  };
});
const conArchivo = medidas.filter((x) => x.medicion.estado !== "original faltante");
const faltantes = medidas.filter((x) => x.medicion.estado === "original faltante");
const ilegibles = medidas.filter((x) => x.medicion.estado === "ilegible");
const completas = medidas.filter((x) => x.medicion.estado === "medida");

// Derivadas: solo informativas, nunca se usan como originales
const archivosDerivadas = (() => { try { return readdirSync(CARPETA_DERIVADAS); } catch { return [] as string[]; } })();
const derivadas = archivosDerivadas.map((nombre) => {
  const b = readFileSync(join(CARPETA_DERIVADAS, nombre));
  const mime = tipoPorContenido(b);
  const d = dimensiones(b, mime);
  const original = faltantes.find((f) => {
    const base = basename(f.clave).replace(/\.[^.]+$/, "");
    return nombre.startsWith(`${base}-`) && /-\d+x\d+\.[^.]+$/.test(nombre);
  });
  const wpAncho = original?.wp.ancho ?? null, wpAlto = original?.wp.alto ?? null;
  const esperado = d && wpAncho && wpAlto ? Math.round((d.ancho * wpAlto) / wpAncho) : null;
  return {
    archivo: nombre, bytes: b.length, mime, ancho: d?.ancho ?? null, alto: d?.alto ?? null,
    originalFaltante: original?.clave ?? null, dimensionesDeclaradasDelOriginal: { ancho: wpAncho, alto: wpAlto },
    proporcion: d && wpAncho && wpAlto && esperado !== null
      ? { medida: +(d.ancho / d.alto).toFixed(4), declarada: +(wpAncho / wpAlto).toFixed(4), altoEsperado: esperado, diferenciaEnPixeles: d.alto - esperado, coincide: Math.abs(d.alto - esperado) <= 1 }
      : null,
  };
});

// Duplicados de contenido: mismo hash en adjuntos distintos
const porHash = new Map<string, typeof completas>();
for (const x of conArchivo) { if (!x.medicion.sha256) continue; const g = porHash.get(x.medicion.sha256) ?? []; g.push(x); porHash.set(x.medicion.sha256, g); }
const duplicadas = [...porHash].filter(([, g]) => new Set(g.map((x) => x.adjuntoWpId)).size > 1)
  .map(([sha256, g]) => ({ sha256, adjuntos: g.map((x) => ({ adjuntoWpId: x.adjuntoWpId, clave: x.clave, articulos: x.articulos })) }));

// Diferencias contra lo que declara WordPress (solo donde WordPress declara algo)
const campo = (k: "ancho" | "alto" | "bytes" | "mime") => {
  const declara = completas.filter((x) => x.coincide![k] !== null);
  return { declara: declara.length, coinciden: declara.filter((x) => x.coincide![k] === true).length, difieren: declara.filter((x) => x.coincide![k] === false).length, sinDeclarar: completas.length - declara.length };
};
const diferenciasContraWp = completas.filter((x) => Object.values(x.coincide!).some((v) => v === false)).map((x) => ({
  adjuntoWpId: x.adjuntoWpId, clave: x.clave, articulos: x.articulos,
  medido: { ancho: x.medicion.ancho, alto: x.medicion.alto, bytes: x.medicion.bytes, mime: x.medicion.mime }, wp: x.wp,
  campos: Object.entries(x.coincide!).filter(([, v]) => v === false).map(([k]) => k),
}));
const archivosEnLaCarpeta = (() => { try { return listar(CARPETA_ORIGINALES); } catch { return [] as string[]; } })();
const usadosEnDisco = new Set(conArchivo.map((x) => aNFC(x.medicion.archivo!)));
const revisionD = {
  carpetaOriginales: CARPETA_ORIGINALES, archivosEnLaCarpeta: archivosEnLaCarpeta.length,
  contraLaListaDeRutas: contraLista,
  conArchivo: conArchivo.length, medidasCompletas: completas.length,
  ilegibles: ilegibles.map((x) => ({ adjuntoWpId: x.adjuntoWpId, clave: x.clave, motivo: x.medicion.motivo })),
  originalesFaltantes: faltantes.map((x) => ({
    adjuntoWpId: x.adjuntoWpId, clave: x.clave, estado: x.medicion.estado,
    usos: x.articulos.map((a) => ({ articulo: a, roles: x.origen })),
    dimensionesDeclaradasPorWordPress: { ancho: x.wp.ancho, alto: x.wp.alto, bytes: x.wp.bytes },
  })),
  derivadas,
  duplicadasDeContenido: duplicadas,
  contraWordPress: { ancho: campo("ancho"), alto: campo("alto"), bytes: campo("bytes"), mime: campo("mime"), imagenesConAlgunaDiferencia: diferenciasContraWp.length, diferencias: diferenciasContraWp },
  diferenciasDeNombre: conArchivo.filter((x) => x.medicion.diferenciaDeNombre).map((x) => ({ clave: x.clave, enDisco: x.medicion.archivo, tipo: x.medicion.diferenciaDeNombre })),
  archivosEnDiscoSinUso: archivosEnLaCarpeta.filter((n) => !usadosEnDisco.has(aNFC(n))),
  mimes: cuentaDe(completas.map((x) => x.medicion.mime ?? "(desconocido)")),
  totalBytes: conArchivo.reduce((t, x) => t + (x.medicion.bytes ?? 0), 0),
  imagenes: medidas,
};
revisionC.completables.hash = completas.length;

// ---------------------------------------------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------------------------------------------
const cuenta = <T>(xs: T[], f: (x: T) => string) => { const o: Record<string, number> = {}; for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1; return o; };
const avisosPorTipo: Record<string, { articulos: number; total: number }> = {};
for (const r of registros) {
  for (const w of r.avisosMigracion?.cuerpo ?? []) { const a = (avisosPorTipo[`cuerpo:${w.code}`] ??= { articulos: 0, total: 0 }); a.articulos++; a.total += w.count; }
  for (const w of r.avisosMigracion?.titulo ?? []) { const c = String(w).split(":")[0]!; const a = (avisosPorTipo[`titulo:${c}`] ??= { articulos: 0, total: 0 }); a.articulos++; a.total++; }
}
for (const r of registros) {
  for (const w of r.avisosMigracion?.migracion ?? []) { const a = (avisosPorTipo[`migracion:${w.code}`] ??= { articulos: 0, total: 0 }); a.articulos++; a.total++; }
}
const invalidos = registros.filter((r) => r.validacion.errores.length || r.validacion.erroresBio.length);
const invisiblesHallados = INVISIBLES.map(([nombre]) => ({
  caracter: nombre,
  en: (["slug", "titulo", "cuerpo"] as const).map((donde) => ({ donde, articulos: registros.filter((r) => r.invisibles[donde][nombre]).map((r) => ({ wpId: r.wpId, veces: r.invisibles[donde][nombre] })) })).filter((x) => x.articulos.length),
}));
const slugAnterior = redirecciones.filter((d) => d.tipo === "SLUG_ANTERIOR");
const resumen = {
  articulosConvertidos: registros.length,
  fixture: idsFixture.length, extra: extras.length,
  invalidos: invalidos.map((r) => ({ wpId: r.wpId, errores: [...r.validacion.errores, ...r.validacion.erroresBio].slice(0, 5) })),
  avisosPorTipo,
  secciones: cuenta(registros, (r) => r.seccion),
  categoriasPrincipales: cuenta(registros, (r) => r.categoriaPrincipal ?? "(ninguna)"),
  estados: cuenta(registros, (r) => r.estado),
  estadosDesconocidos: registros.filter((r) => r.estado.startsWith("DESCONOCIDO")).map((r) => ({ wpId: r.wpId, postStatus: r.estadoWp })),
  slugsGenerados: registros.filter((r) => r.estado === "BORRADOR").map((r) => ({ wpId: r.wpId, postStatus: r.estadoWp, slugEnWordPress: r.slugWp, slug: r.slug })),
  slugsLimpiados: registros.filter((r) => r.antesDeLimpiar).map((r) => ({ wpId: r.wpId, slugAntes: r.antesDeLimpiar!.slug, slugDespues: r.slug, tituloAntes: r.antesDeLimpiar!.titulo, tituloDespues: r.titulo })),
  invisiblesHallados,
  categoriasACrear,
  autores: listaAutores.length, autoresSoloTexto: listaAutores.filter((a) => a.soloTexto).map((a) => ({ wpUserId: a.wpUserId, nombre: a.nombre })),
  cuentasVerificadas,
  autoresSinBio: listaAutores.filter((a) => !a.soloTexto && !a.bio).length,
  redirecciones: { total: redirecciones.length, ...cuenta(redirecciones, (d) => d.tipo) },
  slugAnterior: {
    generadas: slugAnterior.map((d) => ({ wpId: d.articuloWpId, origen: d.origen })),
    descartadas: registros.filter((r) => r.oldSlugs.descartados.length).map((r) => ({ wpId: r.wpId, descartados: r.oldSlugs.descartados })),
  },
  sinRedireccionDeArticulo: registros.filter((r) => !r.redirecciones.some((d: { tipo: string }) => d.tipo === "ARTICULO")).map((r) => ({ wpId: r.wpId, estado: r.estado })),
  sinImagenDeEncabezado: registros.filter((r) => !r.imagenEncabezado).map((r) => r.wpId),
  conRedes: registros.filter((r) => r.redesDescripcion || r.redesImagenUrl).map((r) => r.wpId),
  conCredito: registros.filter((r) => r.encabezadoCredito).map((r) => r.wpId),
  publicadoEnDistintoDeFechaLocal: registros.filter((r) => r.publicadoEn !== null && r.publicadoEn !== `${r.postDateLocal.replace(" ", "T")}.000Z`).map((r) => r.wpId),
  slugsDistintosDeWordPress: registros.filter((r) => r.slug !== decodificar(r.slugWp)).map((r) => r.wpId),
  gmtOffset: entrada.opciones.gmt_offset, timezoneString: entrada.opciones.timezone_string, permalinkStructure: permalink,
  choquesDeSlug: { entreLos35: (validaciones["slugsChocanEntreLos35"] as unknown[]).length, contraCms: choquesCms.length, corpusCompleto: colisionesCorpus.length },
  imagenes: {
    distintas: revisionC.distintas, porOrigen: revisionC.porOrigen, conArchivo: revisionD.conArchivo, medidasCompletas: revisionD.medidasCompletas,
    ilegibles: revisionD.ilegibles.length, originalesFaltantes: revisionD.originalesFaltantes.map((f) => f.clave), duplicadas: revisionD.duplicadasDeContenido.length,
    contraWordPress: { ancho: revisionD.contraWordPress.ancho, alto: revisionD.contraWordPress.alto, bytes: revisionD.contraWordPress.bytes, mime: revisionD.contraWordPress.mime, conAlgunaDiferencia: revisionD.contraWordPress.imagenesConAlgunaDiferencia },
    diferenciasDeNombre: revisionD.diferenciasDeNombre.length, mimes: revisionD.mimes, totalBytes: revisionD.totalBytes,
    listaDeRutasCoincide: contraLista.enListaYNoCalculadas.length === 0 && contraLista.calculadasYNoEnLista.length === 0,
  },
  validacionesFallidas: Object.entries(validaciones).filter(([k, v]) => k !== "idempotencia" && k !== "articulosEnCms" && k !== "categoriasEnCms" && Array.isArray(v) && v.length > 0).map(([k]) => k),
};

// ---------------------------------------------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------------------------------------------
const salida = aRuta("../../out");
mkdirSync(salida, { recursive: true });
writeFileSync(`${salida}/corrida-en-seco-ampliada.json`, JSON.stringify({ resumen, validaciones, articulos: registros, autores: listaAutores, redirecciones, revisionA, revisionB, revisionC, revisionD }, null, 1));

const j = (v: unknown) => "`" + JSON.stringify(v) + "`";
const md: string[] = [];
md.push("# Corrida en seco de la migración de la muestra ampliada (35 artículos)", "", "Solo lectura: no se escribió nada en ninguna base ni en las carpetas de imágenes. Generado por `scripts/migracion/corrida-en-seco.ts`.", "");
md.push("## Resumen", "");
md.push(`- Artículos convertidos: ${resumen.articulosConvertidos} (${resumen.fixture} de la fixture + ${resumen.extra} extra); inválidos (validador en modo migración): ${resumen.invalidos.length}${resumen.invalidos.length ? " " + j(resumen.invalidos) : ""}`);
md.push(`- Estados: ${j(resumen.estados)}; desconocidos: ${j(resumen.estadosDesconocidos)}`, `- Slugs generados (borradores): ${j(resumen.slugsGenerados)}`);
md.push(`- Slugs y títulos limpiados de U+200E: ${j(resumen.slugsLimpiados)}`);
md.push(`- Otros caracteres invisibles (solo informados, sin tocar): ${j(resumen.invisiblesHallados)}`);
md.push(`- Secciones: ${j(resumen.secciones)}`, `- Categoría principal: ${j(resumen.categoriasPrincipales)}`);
md.push(`- Avisos por tipo (artículos / ocurrencias): ${j(resumen.avisosPorTipo)}`);
md.push(`- Categorías a crear (no existen en la tabla categorias del CMS; no se crean en esta tarea): ${j(resumen.categoriasACrear)}`);
md.push(`- Autores: ${resumen.autores}; de solo texto: ${j(resumen.autoresSoloTexto)}; personas sin bio en WordPress: ${resumen.autoresSinBio}`);
md.push(`- Cuentas de datos/migracion/cuentas.json verificadas contra wp_users (id, user_login y display_name): ${j(resumen.cuentasVerificadas)}`);
md.push(`- Redirecciones: ${j(resumen.redirecciones)} (permalink_structure ${j(permalink)}, gmt_offset ${j(resumen.gmtOffset)}, timezone_string ${j(resumen.timezoneString)})`);
md.push(`- SLUG_ANTERIOR generadas: ${j(resumen.slugAnterior.generadas)}; _wp_old_slug descartados: ${j(resumen.slugAnterior.descartadas)}`);
md.push(`- Artículos sin redirección de artículo (borradores: nunca tuvieron URL pública): ${j(resumen.sinRedireccionDeArticulo)}`);
md.push(`- Sin imagen de encabezado: ${j(resumen.sinImagenDeEncabezado)}; con datos para redes: ${j(resumen.conRedes)}; con crédito: ${j(resumen.conCredito)}`);
md.push(`- publicadoEn distinto de post_date local: ${j(resumen.publicadoEnDistintoDeFechaLocal)}; slug distinto del post_name decodificado de WordPress: ${j(resumen.slugsDistintosDeWordPress)}`);
md.push(`- Choques de slug: entre los 35 = ${resumen.choquesDeSlug.entreLos35}; contra articulos del CMS (${validaciones["articulosEnCms"]} filas) = ${resumen.choquesDeSlug.contraCms}; corpus completo = ${resumen.choquesDeSlug.corpusCompleto}`);
md.push(`- Imágenes: ${j(resumen.imagenes)}`);
md.push(`- Validaciones con resultados: ${j(resumen.validacionesFallidas)}`, "");
md.push("## Validaciones", "");
for (const [k, v] of Object.entries(validaciones)) md.push(`- **${k}**: ${j(v)}`);
md.push("", "## A. Artículos con más de una fila de _thumbnail_id", "", `Total en el corpus: ${revisionA.length}; en la muestra: ${j(revisionA.filter((x) => x.enLaMuestra).map((x) => x.id))}`, "");
md.push("| id | slug | en la muestra | filas (meta_id → valor, existe) | elegida (menor meta_id) | misma clave de archivo |", "|---|---|---|---|---|---|");
for (const a of revisionA) md.push(`| ${a.id} | ${a.slug} | ${a.enLaMuestra ? "sí" : "no"} | ${a.filas.map((f) => `${f.metaId} → ${f.valor} (${f.existe ? "existe" : "NO existe"}${f.clave ? ", " + f.clave : ""})`).join("<br>")} | ${a.elegida}${a.elegidaExiste ? "" : " (NO existe)"} | ${a.mismaClave ? "sí" : "no"} |`);
md.push("", "## B. Colisiones de slug en el corpus completo", "", `- Publicados: ${revisionB.publicados}; borradores: ${revisionB.borradores} (sin slug: ${revisionB.borradoresSinSlug}); en la comparación los slugs van sin U+200E`);
md.push(`- Slugs con %: ${j(revisionB.conPorcentaje)}`, `- Grupos candidatos (normalización de JS): ${revisionB.gruposCandidatosJs}; pares: ${revisionB.paresCandidatos}; pares que la base descarta: ${j(revisionB.paresDescartadosPorLaBase)}`);
md.push(`- Colisiones reales (confirmadas por la base): ${revisionB.colisionesReales.length} ${j(revisionB.colisionesReales)}`, `- Control: agrupación hecha por la base sobre todo el corpus: ${j(revisionB.controlDeLaBase)}`);
md.push("", "## C. Imágenes de los 35 artículos", "", `- Distintas: ${revisionC.distintas} (por origen: ${j(revisionC.porOrigen)}); identificables con un adjunto de WordPress: ${revisionC.identificablesConAdjunto} (exacta: ${revisionC.viaExacta}, sin sufijo de tamaño: ${revisionC.viaSinSufijo})`);
md.push(`- Completables: ${j(revisionC.completables)} (el hash viene de la medición de la sección D)`);
md.push(`- Sin adjunto: ${j(revisionC.sinAdjunto)}`);
md.push(`- Contra out/imagenes-muestra-ampliada.txt: ${j({ ...contraLista, enListaYNoCalculadas: contraLista.enListaYNoCalculadas, calculadasYNoEnLista: contraLista.calculadasYNoEnLista })}`);
md.push("", "## D. Medición de los originales en disco", "");
md.push(`- Carpeta: ${revisionD.archivosEnLaCarpeta} archivos; con archivo: ${revisionD.conArchivo}; medidas completas (bytes, hash, MIME por contenido, ancho y alto): ${revisionD.medidasCompletas}; ilegibles: ${j(revisionD.ilegibles)}; bytes totales: ${revisionD.totalBytes}`);
md.push(`- MIME por contenido: ${j(revisionD.mimes)}`);
md.push(`- **Originales faltantes** (sin hash, bytes ni dimensiones): ${j(revisionD.originalesFaltantes)}`);
md.push(`- Derivadas (solo informativas): ${j(revisionD.derivadas)}`);
md.push(`- Duplicadas de contenido (mismo SHA-256 en adjuntos distintos): ${revisionD.duplicadasDeContenido.length} ${j(revisionD.duplicadasDeContenido)}`);
md.push(`- Contra lo que declara WordPress: ancho ${j(revisionD.contraWordPress.ancho)}; alto ${j(revisionD.contraWordPress.alto)}; bytes ${j(revisionD.contraWordPress.bytes)}; MIME ${j(revisionD.contraWordPress.mime)}; imágenes con alguna diferencia: ${revisionD.contraWordPress.imagenesConAlgunaDiferencia}`);
for (const d of revisionD.contraWordPress.diferencias) md.push(`  - ${d.adjuntoWpId} ${d.clave} (artículos ${d.articulos.join(", ")}): difieren ${d.campos.join(", ")}; medido ${j(d.medido)}; WordPress ${j(d.wp)}`);
md.push(`- Nombre en disco distinto de _wp_attached_file (mayúsculas o normalización Unicode): ${revisionD.diferenciasDeNombre.length} ${j(revisionD.diferenciasDeNombre)}`);
md.push(`- Archivos en la carpeta que ningún adjunto usa: ${j(revisionD.archivosEnDiscoSinUso)}`);
md.push("", "| adjunto | clave | MIME | ancho×alto | bytes | SHA-256 | WP ancho×alto | WP bytes | artículos |", "|---|---|---|---|---|---|---|---|---|");
for (const x of revisionD.imagenes) md.push(`| ${x.adjuntoWpId} | ${x.clave} | ${x.medicion.mime ?? "—"} | ${x.medicion.ancho !== null ? `${x.medicion.ancho}×${x.medicion.alto}` : x.medicion.estado} | ${x.medicion.bytes ?? "—"} | ${x.medicion.sha256 ? x.medicion.sha256.slice(0, 16) + "…" : "—"} | ${x.wp.ancho ?? "?"}×${x.wp.alto ?? "?"} | ${x.wp.bytes ?? "?"} | ${x.articulos.join(", ")} |`);
md.push("", "## Artículos", "");
for (const r of registros) {
  const a = autores.get(r.autores[0]!.wpUserId)!;
  const imgs = medidas.filter((x) => x.articulos.includes(r.wpId));
  md.push(`### ${r.wpId} — ${r.titulo}`, "");
  md.push(`- slug \`${r.slug}\`${r.slug !== decodificar(r.slugWp) || r.slugWp === "" ? ` (en WordPress: \`${r.slugWp}\`, post_status ${r.estadoWp})` : ""}; estado ${r.estado}; publicadoEn ${r.publicadoEn} (post_date local ${r.postDateLocal})${r.esExtra ? `; muestra extra: ${r.esExtra.join(", ")}` : ""}`);
  if (r.antesDeLimpiar) md.push(`- U+200E removido: slug \`${r.antesDeLimpiar.slug}\` → \`${r.slug}\`; título ${j(r.antesDeLimpiar.titulo)} → ${j(r.titulo)}`);
  md.push(`- bajada: ${r.bajada ? j(r.bajada) : "(vacía)"}; sección ${r.seccion}; categorías ${j(r.categorias)}; principal ${j(r.categoriaPrincipal)}; categorías WP ${j(r.categoriasWp)}`);
  md.push(`- autor: ${a.nombre} (wpUserId ${a.wpUserId}, slug ${a.slug}${a.soloTexto ? ", solo texto" : a.bio ? ", con bio" : ", sin bio"})${r.bioDelCuerpo ? "; bio dentro del cuerpo: " + j(r.bioDelCuerpo.slice(0, 120)) : ""}`);
  md.push(`- encabezado: ${r.imagenEncabezado ? j({ ...r.imagenEncabezado }) : "(sin imagen)"}; alt ${r.encabezadoAlt ? "ok" : "pendiente"}; crédito ${j(r.encabezadoCredito)}`);
  md.push(`- imágenes: ${imgs.length} (con archivo ${imgs.filter((x) => x.medicion.estado !== "original faltante").length}; faltantes ${j(imgs.filter((x) => x.medicion.estado === "original faltante").map((x) => ({ clave: x.clave, usos: x.origen, ancho: x.wp.ancho, alto: x.wp.alto })))})`);
  md.push(`- redes: ${j({ descripcion: r.redesDescripcion, imagen: r.redesImagenUrl, imagenWpId: r.redesImagenWpId })}; etiquetas ocultas: ${j(r.etiquetasWp)}; visitasWp ${r.visitasWp}; altPendientes ${r.altPendientes} (cuerpo ${r.altPendientesCuerpo})`);
  md.push(`- invisibles: ${j(r.invisibles)}; _wp_old_slug: ${j(r.oldSlugs)}`);
  md.push(`- avisos: ${j(r.avisosMigracion)}; validación: ${j(r.validacion)}`);
  md.push(`- redirecciones: ${j(r.redirecciones.map((d: { tipo: string; origen: string }) => `${d.tipo} ${d.origen}`))}`, "");
}
writeFileSync(`${salida}/corrida-en-seco-ampliada.md`, md.join("\n") + "\n");

console.log(`Corrida en seco: ${resumen.articulosConvertidos} artículos, ${resumen.invalidos.length} inválidos, ${redirecciones.length} redirecciones, ${listaAutores.length} autores.`);
console.log("Estados:", JSON.stringify(resumen.estados), "| borradores:", JSON.stringify(resumen.slugsGenerados.map((s) => `${s.wpId}->${s.slug}`)));
console.log("Secciones:", JSON.stringify(resumen.secciones));
console.log("Avisos:", JSON.stringify(resumen.avisosPorTipo));
console.log("Redirecciones:", JSON.stringify(resumen.redirecciones), "| SLUG_ANTERIOR:", JSON.stringify(resumen.slugAnterior.generadas.map((x) => x.wpId)), "descartadas:", JSON.stringify(resumen.slugAnterior.descartadas.map((x) => x.wpId)));
console.log("Categorías a crear:", JSON.stringify(resumen.categoriasACrear.map((c) => c.slug)));
console.log("Cuentas verificadas:", resumen.cuentasVerificadas.filter((c) => c.coincide).length, "de", resumen.cuentasVerificadas.length);
console.log("Choques de slug:", JSON.stringify(resumen.choquesDeSlug), "| validaciones con resultados:", JSON.stringify(resumen.validacionesFallidas));
console.log("Imágenes:", JSON.stringify(resumen.imagenes));
console.log("Revisión A:", revisionA.length, "artículos con varias _thumbnail_id (", revisionA.filter((x) => x.enLaMuestra).length, "en la muestra ) | B:", revisionB.colisionesReales.length, "colisiones");
console.log(`Informe: ${salida}/corrida-en-seco-ampliada.md`);

await cerrar();
