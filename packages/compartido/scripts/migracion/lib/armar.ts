// Armado de los registros de la migración: función PURA. Recibe los datos de WordPress ya leídos (en la forma del snapshot)
// y devuelve el Plan en memoria. No toca ninguna base ni el disco: la lectura y la medición de archivos son de otros módulos.
import { convertWpPost } from "../../../src/conversor/convert.ts";
import type { Warning } from "../../../src/conversor/types.ts";
import type { MapeoTaxonomias } from "../../../src/conversor/taxonomia.ts";
import { validateArticleBodyDetallado } from "../../../src/schema/validate.ts";
import type { AdjuntoSnapshot, MetaSnapshot, PostSnapshot, SnapshotWp, TerminoSnapshot, UsuarioSnapshot } from "./snapshot-tipos.ts";
import {
  adjuntoDeUrl, contarAltPendiente, contarInvisibles, decEntidades, decodificar, docDeTexto, quitarU200E, rutaUploads, slugFinal, textoPlanoDe,
} from "./utilidades.ts";

// Estados: solo estos se migran con regla. El 19300 es el único artículo privado que se acepta (decisión tomada).
export const ID_PRIVADO_ACEPTADO = 19300;

export interface MuestraFixture { id: number; slug: string; titulo: string; autor: string; imagen_destacada: string; contenido_crudo: string }
export interface CuentaSoloTexto { wpUserId: number; user_login: string; nombre: string }

/** Todo lo que armar() necesita, ya leído. */
export interface EntradaArmar {
  /** Los ids de la muestra, en el orden en que se arman. */
  ids: number[];
  /** Los artículos de la fixture (título y cuerpo tal cual); los ids que no están acá se arman desde `posts`. */
  fixture: MuestraFixture[];
  extras: Array<{ id: number; casos: string[] }>;
  posts: PostSnapshot[];
  meta: MetaSnapshot[];
  terminos: TerminoSnapshot[];
  usuarios: UsuarioSnapshot[];
  /** Detalle de los adjuntos que se usan como imagen de encabezado (y los demás que se quiera aportar). */
  adjuntos: AdjuntoSnapshot[];
  /** clave (_wp_attached_file) -> id del adjunto. */
  adjuntoPorClave: ReadonlyArray<readonly [string, number]>;
  opciones: SnapshotWp["opciones"];
  /** Cuentas que se migran como autor de solo texto. */
  cuentas: CuentaSoloTexto[];
  mapeo: MapeoTaxonomias;
  /** Slugs de las secciones que existen en el CMS. */
  seccionesExistentes: string[];
  /** Slugs de las categorías que ya existen en el CMS. */
  categoriasExistentes: string[];
}

export interface Problema { wpId: number | null; codigo: string; detalle?: unknown; bloqueante: boolean }

export interface AvisoMigracion { code: string; detalle?: unknown }

export interface ImagenEncabezado {
  wpId: number; clave: string | null; nombreOriginal: string | null; tipoMime: string; ancho: number | null; alto: number | null; bytes: number | null; hash: null;
}

export interface RedirecionPlan {
  origen: string; tipo: "ARTICULO" | "SLUG_ANTERIOR" | "AUTOR"; codigo: number; articuloWpId: number | null; autorWpUserId: number | null; destino: string | null;
}

export interface RegistroArticulo {
  wpId: number;
  slug: string;
  slugWp: string;
  estadoWp: string;
  estado: string;
  esExtra: string[] | null;
  antesDeLimpiar: { slug: string; titulo: string } | null;
  invisibles: { slug: Record<string, number>; titulo: Record<string, number>; cuerpo: Record<string, number> };
  oldSlugs: { validos: string[]; descartados: Array<{ valor: string; motivo: string | null }> };
  titulo: string;
  bajada: string | null;
  cuerpo: any;
  schemaVersion: number;
  textoPlano: string;
  publicadoEn: string | null;
  postDateLocal: string;
  postDateGmt: string;
  novedadHasta: string | null;
  seccion: string;
  categorias: string[];
  categoriaPrincipal: string | null;
  categoriasWp: string[];
  autores: Array<{ wpUserId: number; orden: number }>;
  imagenEncabezado: ImagenEncabezado | null;
  encabezadoAlt: string | null;
  encabezadoCredito: string | null;
  encabezadoPuntoFocalX: number;
  encabezadoPuntoFocalY: number;
  redesDescripcion: string | null;
  redesImagenUrl: string | null;
  redesImagenWpId: number | null;
  etiquetasWp: string[] | null;
  avisosMigracion: { cuerpo: Warning[]; titulo: string[]; validador: string[]; migracion: AvisoMigracion[] } | null;
  altPendientes: number;
  altPendientesCuerpo: number;
  visitasWp: number | null;
  bioDelCuerpo: string | null;
  thumbnailFilas: Array<{ metaId: number; valor: string }>;
  imagenDestacadaFixture: string;
  validacion: { errores: string[]; erroresBio: string[]; avisos: string[] };
  redirecciones: RedirecionPlan[];
}

export interface AutorPlan {
  wpUserId: number; slug: string; nombre: string; soloTexto: boolean; bio: unknown; articulosEnMuestra: number[];
}

export interface CategoriaACrear { slug: string; nombre: string | null; articulos: number[] }

/** Una imagen distinta que usa algún artículo (encabezado, cuerpo o redes), todavía sin los datos del adjunto. */
export interface ImagenReferenciada {
  clave: string; url: string; origen: string[]; articulos: number[]; adjuntoId: number | null; via: string | null;
}

export interface Plan {
  articulos: RegistroArticulo[];
  autores: AutorPlan[];
  redirecciones: RedirecionPlan[];
  categoriasACrear: CategoriaACrear[];
  /** Secciones que usan los artículos y no existen en el CMS. */
  seccionesFaltantes: string[];
  imagenesReferenciadas: ImagenReferenciada[];
  problemas: Problema[];
}

/** Estado del CMS según post_status: publish → PUBLICADO; draft y el privado 19300 → BORRADOR; cualquier otro → DESCONOCIDO. */
export function estadoCms(id: number, e: string): string {
  if (e === "publish") return "PUBLICADO";
  if (e === "draft") return "BORRADOR";
  if (e === "private" && id === ID_PRIVADO_ACEPTADO) return "BORRADOR";
  return `DESCONOCIDO(${e})`;
}
/**
 * post_date_gmt ("YYYY-MM-DD HH:MM:SS") como ISO en UTC, o null si no es una fecha válida (por ejemplo "0000-00-00 00:00:00",
 * que es lo que WordPress guarda en los borradores). Nunca se reemplaza por post_date, que es hora local.
 */
export function utcDe(gmt: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(gmt) || gmt.startsWith("0000")) return null;
  const iso = `${gmt.replace(" ", "T")}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Ruta vieja de WordPress según `permalink_structure`, con la fecha local del post. */
export function origenDe(permalink: string, fechaLocal: string, nombre: string): string {
  const [fecha] = fechaLocal.split(" ") as [string];
  const [a, m, d] = fecha.split("-") as [string, string, string];
  return permalink.replace(/%([a-z_]+)%/g, (_, k: string) => {
    if (k === "year") return a;
    if (k === "monthnum") return m;
    if (k === "day") return d;
    if (k === "postname") return nombre;
    throw new Error(`permalink_structure con una variable no soportada: %${k}%`);
  });
}

/**
 * La categoría principal (volanta), si existe, tiene que estar entre las categorías del artículo. Sin categoría principal es válido.
 * Devuelve null si es válido o el motivo si no.
 */
export function validarCategoriaPrincipal(articulo: { categorias: readonly string[]; categoriaPrincipal: string | null }): string | null {
  const { categoriaPrincipal, categorias } = articulo;
  if (categoriaPrincipal === null || categoriaPrincipal === undefined) return null;
  return categorias.includes(categoriaPrincipal) ? null : `la categoría principal "${categoriaPrincipal}" no está entre las categorías [${categorias.join(", ")}]`;
}

type ValorDestino = number | string | null | undefined;
/**
 * Una redirección apunta a exactamente un destino: un artículo (articuloId o articuloWpId), un autor (autorId o autorWpUserId)
 * o un destino manual (`destino`). Devuelve null si es válida o el motivo si no.
 */
export function validarDestinoUnico(r: { articuloId?: ValorDestino; articuloWpId?: ValorDestino; autorId?: ValorDestino; autorWpUserId?: ValorDestino; destino?: ValorDestino }): string | null {
  const presente = (v: ValorDestino) => v !== null && v !== undefined && v !== "";
  const destinos = [
    presente(r.articuloId) || presente(r.articuloWpId) ? "articulo" : null,
    presente(r.autorId) || presente(r.autorWpUserId) ? "autor" : null,
    presente(r.destino) ? "destino" : null,
  ].filter((x): x is string => x !== null);
  return destinos.length === 1 ? null : `la redirección tiene ${destinos.length} destinos (${destinos.join(", ") || "ninguno"}) y debe tener exactamente uno`;
}

/** Dependencias reemplazables, solo para los tests (por ejemplo, forzar una categoría principal inválida). */
export interface DependenciasArmar { convertir?: typeof convertWpPost }

export function armar(entrada: EntradaArmar, deps: DependenciasArmar = {}): Plan {
  const convertir = deps.convertir ?? convertWpPost;
  const { ids, fixture, mapeo } = entrada;
  const permalink = entrada.opciones.permalink_structure;
  const cuentaPorId = new Map(entrada.cuentas.map((c) => [c.wpUserId, c]));
  const postWp = new Map(entrada.posts.map((p) => [p.id, p]));
  const usuarioWp = new Map(entrada.usuarios.map((u) => [u.id, u]));
  const adjuntoPorClave = new Map(entrada.adjuntoPorClave);
  const adjuntoWp = new Map(entrada.adjuntos.map((a) => [a.id, a]));
  const motivosExtra = new Map(entrada.extras.map((e) => [e.id, e.casos]));
  const metaDe = (id: number, k: string) => entrada.meta.filter((f) => f.postId === id && f.k === k).map((f) => ({ metaId: f.metaId, valor: f.v }));

  // Los artículos: los de la fixture tal cual y los demás armados desde WordPress.
  const muestra: MuestraFixture[] = ids.map((id) => {
    const p = postWp.get(id);
    if (!p) throw new Error(`El artículo ${id} de la muestra no está en la base de WordPress`);
    if (p.tipo !== "post") throw new Error(`El ${id} no es un post (post_type=${p.tipo})`);
    return fixture.find((f) => f.id === id) ?? { id, slug: p.nombre, titulo: p.titulo, autor: usuarioWp.get(p.autor)?.nombre ?? "", imagen_destacada: "", contenido_crudo: p.contenido ?? "" };
  });

  const imagenesDeCuerpo = new Map<string, { url: string; articulos: Set<number> }>();
  const registros: RegistroArticulo[] = [];
  const autores = new Map<number, AutorPlan>();
  const problemas: Problema[] = [];

  for (const m of muestra) {
    const p = postWp.get(m.id)!;
    const usuario = usuarioWp.get(p.autor);
    const nombreAutor = usuario?.nombre ?? "";
    const cats = entrada.terminos.filter((f) => f.taxonomia === "category" && f.id === m.id).map((f) => ({ nombre: decEntidades(f.nombre), slug: f.slug })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    // Caracteres invisibles (medidos sobre lo crudo de WordPress) y limpieza de U+200E en título y slug
    const nombrePost = p.nombre;
    const slugDecodificado = decodificar(nombrePost);
    const tituloWp = m.titulo;
    const invisibles = { slug: contarInvisibles(slugDecodificado), titulo: contarInvisibles(tituloWp), cuerpo: contarInvisibles(m.contenido_crudo) };
    const avisosMigracion: AvisoMigracion[] = [];
    const dondeU200E = (["slug", "titulo"] as const).filter((k) => invisibles[k]["U+200E"]);
    if (dondeU200E.length) avisosMigracion.push({ code: "u200e_removido", detalle: { en: dondeU200E } });
    const estado = estadoCms(m.id, p.estado);
    if (p.estado === "private" && estado === "BORRADOR") avisosMigracion.push({ code: "origen_privado" });
    if (estado.startsWith("DESCONOCIDO")) {
      problemas.push({ wpId: m.id, codigo: "estado_desconocido", detalle: { postStatus: p.estado }, bloqueante: false });
      continue;
    }
    const esBorrador = estado === "BORRADOR";
    const slug = slugFinal(esBorrador, m.id, slugDecodificado).slug;
    const tituloEntrada = quitarU200E(tituloWp);

    const r = convertir({ titulo: tituloEntrada, contenido_crudo: m.contenido_crudo }, { autor: nombreAutor || null, taxonomia: { id: m.id, slugs: cats.map((c) => c.slug), mapeo } });
    const val = validateArticleBodyDetallado(r.doc as any, { modo: "migracion" });
    const erroresBio = r.bio ? validateArticleBodyDetallado({ type: "doc", content: r.bio } as any, { modo: "migracion" }).errores : [];

    // _wp_old_slug: se descartan los solo numéricos, los iguales al slug actual y los que terminan en __trashed
    const viejosCrudos = [...new Set(metaDe(m.id, "_wp_old_slug").map((x) => x.valor.trim()))].filter(Boolean);
    const motivoDescarte = (v: string) => /^\d+$/.test(v) ? "numerico" : v === nombrePost || decodificar(v) === slugDecodificado ? "igual_al_slug_actual" : v.endsWith("__trashed") ? "trashed" : null;
    const viejos = viejosCrudos.filter((v) => motivoDescarte(v) === null);
    const viejosDescartados = viejosCrudos.filter((v) => motivoDescarte(v) !== null).map((v) => ({ valor: v, motivo: motivoDescarte(v) }));
    // Un borrador o privado nunca tuvo URL pública: no genera redirecciones de artículo ni de slug anterior.
    const origen = origenDe(permalink, p.fecha, nombrePost);

    const redirecciones: RedirecionPlan[] = esBorrador || estado.startsWith("DESCONOCIDO") ? [] : [
      { origen, tipo: "ARTICULO", codigo: 301, articuloWpId: m.id, autorWpUserId: null, destino: null },
      ...viejos.map((v) => ({ origen: origenDe(permalink, p.fecha, v), tipo: "SLUG_ANTERIOR" as const, codigo: 301, articuloWpId: m.id, autorWpUserId: null, destino: null })),
    ];


    // Validaciones puras: si alguna falla se registra el problema y el artículo se excluye del plan
    const motivos: Array<{ codigo: string; motivo: string }> = [];
    const motivoPrincipal = validarCategoriaPrincipal({ categorias: r.categorias, categoriaPrincipal: r.categoriaPrincipal });
    if (motivoPrincipal) motivos.push({ codigo: "categoria_principal_invalida", motivo: motivoPrincipal });
    for (const red of redirecciones) {
      const motivoDestino = validarDestinoUnico(red);
      if (motivoDestino) motivos.push({ codigo: "destino_redireccion_invalido", motivo: `${red.origen}: ${motivoDestino}` });
    }
    if (motivos.length) {
      for (const x of motivos) problemas.push({ wpId: m.id, codigo: x.codigo, detalle: x.motivo, bloqueante: false });
      continue;
    }

    // Autor
    const wpUserId = p.autor;
    if (!autores.has(wpUserId)) {
      const soloTexto = cuentaPorId.has(wpUserId);
      const descripcion = usuario?.bio?.trim() ?? "";
      autores.set(wpUserId, {
        wpUserId, slug: usuario?.nicename ?? "", nombre: nombreAutor, soloTexto,
        bio: soloTexto ? null : docDeTexto(descripcion),
        articulosEnMuestra: [],
      });
    }
    autores.get(wpUserId)!.articulosEnMuestra.push(m.id);

    // Imagen de encabezado: si hay varias filas de _thumbnail_id, la de menor meta_id
    const filasThumb = metaDe(m.id, "_thumbnail_id").sort((a, b) => a.metaId - b.metaId);
    const adjEnc = filasThumb.length ? adjuntoWp.get(Number(filasThumb[0]!.valor)) : undefined;
    const credito = metaDe(m.id, "cb_image_credit")[0]?.valor.trim() ?? "";
    const imagenEncabezado: ImagenEncabezado | null = adjEnc && adjEnc.tipoPost === "attachment"
      ? { wpId: adjEnc.id, clave: adjEnc.clave, nombreOriginal: adjEnc.clave ? adjEnc.clave.split("/").pop()! : null, tipoMime: adjEnc.mime, ancho: adjEnc.ancho, alto: adjEnc.alto, bytes: adjEnc.bytes, hash: null }
      : null;

    // Datos para redes (solo si tienen contenido)
    const og = (k: string) => metaDe(m.id, k)[0]?.valor.trim() ?? "";
    const redesDescripcion = og("_webdados_fb_open_graph_specific_description") || null;
    const redesImagenUrl = og("_webdados_fb_open_graph_specific_image") || null;
    const redesAdjunto = redesImagenUrl ? adjuntoDeUrl(redesImagenUrl, adjuntoPorClave) : null;

    // Imágenes del cuerpo
    for (const im of r.assets.images) {
      const clave = rutaUploads(im.url) ?? im.url;
      const e = imagenesDeCuerpo.get(clave) ?? { url: im.url, articulos: new Set<number>() };
      e.articulos.add(m.id);
      imagenesDeCuerpo.set(clave, e);
    }

    const etiquetas = entrada.terminos.filter((f) => f.taxonomia === "post_tag" && f.id === m.id).map((f) => decEntidades(f.nombre));
    const visitas = metaDe(m.id, "cb_visit_counter")[0]?.valor;
    const altCuerpo = contarAltPendiente(r.doc);
    const encabezadoAlt = adjEnc && adjEnc.tipoPost === "attachment" ? adjEnc.alt ?? "" : "";
    registros.push({
      wpId: m.id,
      slug,
      slugWp: nombrePost,
      estadoWp: p.estado,
      estado,
      esExtra: motivosExtra.get(m.id) ?? null,
      antesDeLimpiar: dondeU200E.length ? { slug: slugDecodificado, titulo: tituloWp } : null,
      invisibles,
      oldSlugs: { validos: viejos, descartados: viejosDescartados },
      titulo: r.titulo, bajada: r.bajada || null,
      cuerpo: r.doc, schemaVersion: 1, textoPlano: textoPlanoDe(r.doc),
      publicadoEn: utcDe(p.fechaGmt),
      postDateLocal: p.fecha, postDateGmt: p.fechaGmt,
      novedadHasta: r.novedadHasta,
      seccion: r.seccion as string, categorias: r.categorias, categoriaPrincipal: r.categoriaPrincipal,
      categoriasWp: cats.map((c) => c.slug),
      autores: [{ wpUserId, orden: 0 }],
      imagenEncabezado, encabezadoAlt: encabezadoAlt || null, encabezadoCredito: credito || null,
      encabezadoPuntoFocalX: 0.5, encabezadoPuntoFocalY: 0.5,
      redesDescripcion, redesImagenUrl, redesImagenWpId: redesAdjunto?.id ?? null,
      etiquetasWp: etiquetas.length ? etiquetas : null,
      avisosMigracion: r.warnings.length || r.avisosTitulo.length || val.avisos.length || avisosMigracion.length ? { cuerpo: r.warnings, titulo: r.avisosTitulo, validador: val.avisos, migracion: avisosMigracion } : null,
      altPendientes: altCuerpo + (imagenEncabezado && !encabezadoAlt ? 1 : 0),
      altPendientesCuerpo: altCuerpo,
      visitasWp: visitas !== undefined && /^\d+$/.test(visitas) ? Number(visitas) : null,
      bioDelCuerpo: r.bio ? textoPlanoDe({ type: "doc", content: r.bio }) : null,
      thumbnailFilas: filasThumb, imagenDestacadaFixture: m.imagen_destacada || adjEnc?.guid || "",
      validacion: { errores: val.errores, erroresBio, avisos: val.avisos },
      redirecciones,
    });
  }

  // Redirecciones de autor: una por autor con página (el origen es único). Los autores de solo texto no tienen página.
  const listaAutores = [...autores.values()];
  const redireccionesAutor: RedirecionPlan[] = listaAutores.filter((a) => !a.soloTexto).map((a) => ({ origen: `/author/${a.slug}/`, tipo: "AUTOR", codigo: 301, articuloWpId: null, autorWpUserId: a.wpUserId, destino: null }));
  const redirecciones = [...registros.flatMap((r) => r.redirecciones), ...redireccionesAutor];

  // Secciones y categorías que los artículos usan y todavía no existen en el CMS
  const seccionesCms = new Set(entrada.seccionesExistentes);
  const categoriasCms = new Set(entrada.categoriasExistentes);
  const seccionesFaltantes = [...new Set(registros.map((r) => r.seccion))].filter((s) => !seccionesCms.has(s));
  const nombreDeCategoria = new Map(mapeo.categorias.map((c) => [c.slug, c.nombre]));
  const categoriasACrear: CategoriaACrear[] = [...new Set(registros.flatMap((r) => r.categorias))].filter((c) => !categoriasCms.has(c)).map((slug) => ({
    slug, nombre: nombreDeCategoria.get(slug) ?? null, articulos: registros.filter((r) => r.categorias.includes(slug)).map((r) => r.wpId),
  }));

  // Una categoría a crear sin nombre en el mapeo no se puede crear: problema bloqueante
  for (const c of categoriasACrear) if (c.nombre === null) problemas.push({ wpId: null, codigo: "categoria_sin_nombre_en_el_mapeo", detalle: { slug: c.slug, articulos: c.articulos }, bloqueante: true });

  // Imágenes distintas que usan los artículos (encabezado, redes y cuerpo), con el adjunto de WordPress que les corresponde
  const distintas = new Map<string, ImagenReferenciada>();
  const sumar = (clave: string, url: string, origen: string, articulo: number, adjunto: { id: number; via: string } | null) => {
    const e = distintas.get(clave) ?? { clave, origen: [], url, articulos: [], adjuntoId: adjunto?.id ?? null, via: adjunto?.via ?? null };
    if (!e.origen.includes(origen)) e.origen.push(origen);
    if (!e.articulos.includes(articulo)) e.articulos.push(articulo);
    distintas.set(clave, e);
  };
  for (const r of registros) {
    if (r.imagenEncabezado) sumar(`adjunto:${r.imagenEncabezado.wpId}`, r.imagenDestacadaFixture, "encabezado", r.wpId, { id: r.imagenEncabezado.wpId, via: "_thumbnail_id" });
    if (r.redesImagenUrl) sumar(r.redesImagenWpId ? `adjunto:${r.redesImagenWpId}` : `url:${r.redesImagenUrl}`, r.redesImagenUrl, "redes", r.wpId, r.redesImagenWpId ? { id: r.redesImagenWpId, via: "url" } : null);
  }
  for (const [, e] of imagenesDeCuerpo) {
    const adj = adjuntoDeUrl(e.url, adjuntoPorClave);
    for (const a of e.articulos) sumar(adj ? `adjunto:${adj.id}` : `url:${e.url}`, e.url, "cuerpo", a, adj);
  }

  return { articulos: registros, autores: listaAutores, redirecciones, categoriasACrear, seccionesFaltantes, imagenesReferenciadas: [...distintas.values()], problemas };
}
