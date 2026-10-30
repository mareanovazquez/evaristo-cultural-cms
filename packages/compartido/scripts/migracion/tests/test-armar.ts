// Pruebas puras de scripts/migracion/lib/armar.ts con la entrada del snapshot de WordPress (sin base ni disco, salvo la
// lectura de los JSON de datos).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertWpPost } from "../../../src/conversor/convert.ts";
import { armar, validarCategoriaPrincipal, validarDestinoUnico } from "../lib/armar.ts";
import type { EntradaArmar } from "../lib/armar.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
import { nodosImagen, srcDeClave } from "../lib/enlaces-imagenes.ts";
import type { Medicion } from "../lib/enlaces-imagenes.ts";
import { MARCADOR_CORREO_OMITIDO } from "../lib/snapshot-tipos.ts";
import type { MetaSnapshot, PostSnapshot, TerminoSnapshot, UsuarioSnapshot } from "../lib/snapshot-tipos.ts";

let ok = 0;
const t = (name: string, fn: () => void) => { fn(); ok++; console.log("ok", name); };
const cuenta = <T>(xs: T[], f: (x: T) => string) => { const o: Record<string, number> = {}; for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1; return o; };

const plan = armar(entradaDesdeSnapshot());
const articulo = (id: number) => plan.articulos.find((a) => a.wpId === id)!;

t("T01: los 35 desde el snapshot: estados, slugs, secciones y categorías a crear", () => {
  assert.equal(plan.articulos.length, 35);
  assert.deepEqual(cuenta(plan.articulos, (a) => a.estado), { PUBLICADO: 34, BORRADOR: 1 });
  assert.equal(articulo(22546).estado, "BORRADOR");
  assert.equal(articulo(22546).slug, "borrador-22546");
  assert.ok(plan.articulos.every((a) => a.slug !== ""), "ningún slug vacío");
  assert.ok(plan.articulos.every((a) => typeof a.seccion === "string" && a.seccion !== ""), "todos con sección");
  assert.deepEqual(cuenta(plan.articulos, (a) => a.seccion), {
    asia: 17, textos: 7, ensayo: 4, rastros: 3, "sin-asignar": 2, entrevista: 1, resena: 1,
  });
  assert.deepEqual(plan.seccionesFaltantes, []);
  assert.equal(plan.categoriasACrear.length, 7);
  assert.deepEqual(plan.categoriasACrear.map((c) => c.slug).sort(), ["fantastico", "historieta", "literatura", "musica", "poesia", "teatro", "tv-y-cine"]);
  assert.ok(plan.categoriasACrear.every((c) => c.nombre !== null));
});

// Baseline de la salida de 7eda10c: vive en out/ (ignorado por git), así que este test se saltea si no está.
const BASELINE = fileURLToPath(new URL("../../../out/baseline-armar/corrida-en-seco-ampliada.json", import.meta.url));
if (!existsSync(BASELINE)) {
  console.log("SALTEADO: no hay baseline (out/baseline-armar/corrida-en-seco-ampliada.json); T02 no se ejecutó");
} else {
  t("T02: el Plan desde el snapshot coincide con el baseline (salvo las redirecciones de autores de solo texto)", () => {
    const base = JSON.parse(readFileSync(BASELINE, "utf8"));  // salida de 7eda10c
    assert.equal(base.articulos.length, plan.articulos.length);
    for (const b of base.articulos) {
      const a = articulo(b.wpId);
      assert.ok(a, `falta el ${b.wpId}`);
      // seccion, categorias y categoriaPrincipal no se comparan: cambiaron por la decisión 78 (el baseline es anterior)
      for (const k of ["slug", "estado", "autores", "redirecciones", "publicadoEn"] as const) {
        assert.deepEqual(a[k], b[k], `${b.wpId}.${k}`);
      }
      for (const k of ["cuerpo", "titulo", "validador", "migracion"] as const) {
        assert.deepEqual(a.avisosMigracion?.[k] ?? [], b.avisosMigracion?.[k] ?? [], `${b.wpId}.avisos.${k}`);
      }
    }
    // única diferencia decidida: las cuentas de solo texto ya no tienen redirección /author/<slug>/ (el baseline las tiene)
    const soloTexto = new Set(base.autores.filter((x: { soloTexto: boolean }) => x.soloTexto).map((x: { wpUserId: number }) => x.wpUserId));
    assert.deepEqual(plan.redirecciones, base.redirecciones.filter((r: { tipo: string; autorWpUserId: number | null }) => !(r.tipo === "AUTOR" && soloTexto.has(r.autorWpUserId as number))));
    assert.deepEqual(plan.autores.map((x) => x.wpUserId), base.autores.map((x: { wpUserId: number }) => x.wpUserId));

    // Con las mediciones del baseline (la corrida real sobre los originales) el cuerpo solo cambia en imagenWpId y src de los nodos imagen.
    const mediciones = new Map<string, Medicion>(base.revisionD.imagenes.map((x: { clave: string; medicion: Medicion }) => [x.clave.normalize("NFC"), x.medicion]));
    const medido = armar({ ...entradaDesdeSnapshot(), mediciones });
    const sinEnlace = (doc: unknown) => JSON.parse(JSON.stringify(doc, (k, v) => (k === "imagenWpId" || (k === "src" && typeof v === "string") ? undefined : v)));
    let nodosEnlazados = 0;
    for (const b of base.articulos) {
      const a = medido.articulos.find((x) => x.wpId === b.wpId)!;
      assert.deepEqual(sinEnlace(a.cuerpo), sinEnlace(b.cuerpo), `${b.wpId}.cuerpo (salvo imagenWpId y src)`);
      assert.equal(a.textoPlano, b.textoPlano, `${b.wpId}.textoPlano`);
      const antes = nodosImagen(b.cuerpo), despues = nodosImagen(a.cuerpo);
      assert.equal(antes.length, despues.length);
      despues.forEach((n, i) => {
        // todas las imágenes del cuerpo de la muestra tienen original: cada una recibe su adjunto y su /media/<clave>
        assert.equal(typeof n.attrs!["imagenWpId"], "number", `${b.wpId} imagen ${i}`);
        const clave = [...mediciones.keys()].find((c) => srcDeClave(c) === n.attrs!["src"]);
        assert.ok(clave, `${b.wpId}: ${String(n.attrs!["src"])} es la clave de una imagen medida`);
        assert.equal(n.attrs!["alt"], antes[i]!.attrs!["alt"]);
        nodosEnlazados++;
      });
      // encabezado: mismo adjunto y misma clave; lo medido reemplaza lo que declaraba WordPress, salvo en los dos sin original
      if (b.wpId === 2462 || b.wpId === 22546) {
        assert.equal(a.imagenEncabezado, null);
        assert.equal(a.encabezadoAlt, null);
        assert.equal(a.encabezadoCredito, null);
        assert.ok(a.avisosMigracion!.migracion.some((x) => x.code === "original_faltante"));
      } else {
        assert.equal(a.imagenEncabezado?.wpId, b.imagenEncabezado?.wpId);
        assert.equal(a.imagenEncabezado?.clave, b.imagenEncabezado?.clave);
        assert.equal(a.encabezadoAlt, b.encabezadoAlt);
        assert.equal(a.encabezadoCredito, b.encabezadoCredito);
        assert.deepEqual(a.avisosMigracion?.migracion ?? [], b.avisosMigracion?.migracion ?? []);
      }
    }
    assert.equal(nodosEnlazados, 172);
    assert.equal(medido.imagenes.length, 200);
    assert.deepEqual(medido.imagenesSinFila.map((x) => [x.adjuntoWpId, x.codigo]), [[2464, "original_faltante"], [22547, "original_faltante"]]);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Entradas sintéticas
// ---------------------------------------------------------------------------------------------------------------
const base = entradaDesdeSnapshot();
const post = (o: Partial<PostSnapshot> & { id: number }): PostSnapshot => ({
  tipo: "post", estado: "publish", autor: 9001, nombre: `post-${o.id}`, titulo: `Título ${o.id}`, fecha: "2020-01-02 03:04:05", fechaGmt: "2020-01-02 03:04:05", contenido: "<p>Hola</p>", ...o,
});
const usuario = (id: number, extra: Partial<UsuarioSnapshot> = {}): UsuarioSnapshot => ({ id, login: `u${id}`, nicename: `autor-${id}`, nombre: `Autor ${id}`, bio: null, ...extra });
const sintetica = (posts: PostSnapshot[], extra: Partial<EntradaArmar> = {}): EntradaArmar => ({
  ...base, ids: posts.map((p) => p.id), fixture: [], extras: [], posts, meta: [], terminos: [], usuarios: [usuario(9001)], adjuntos: [], adjuntoPorClave: [], ...extra,
});
const meta = (metaId: number, postId: number, k: string, v: string): MetaSnapshot => ({ metaId, postId, k, v });
const tipos = (a: { redirecciones: Array<{ tipo: string }> }) => a.redirecciones.map((r) => r.tipo);

t("T03: borrador-<wpId> en el 22546 y en un borrador sintético; sin redirección de artículo ni de slug anterior", () => {
  const b = articulo(22546);
  assert.equal(b.slug, "borrador-22546");
  assert.deepEqual(b.redirecciones, []);
  assert.equal(b.publicadoEn, null, "post_date_gmt es 0000-00-00: publicadoEn null, no se cae en post_date");
  assert.equal(b.postDateLocal, "2023-06-29 23:38:10");
  // la redirección de su autor (421, que tiene página) sí existe
  const autor = plan.autores.find((a) => a.wpUserId === 421)!;
  assert.equal(autor.soloTexto, false);
  assert.ok(plan.redirecciones.some((r) => r.tipo === "AUTOR" && r.autorWpUserId === 421 && r.origen === `/author/${autor.slug}/`));
  // sintético: un draft CON post_name también lleva borrador-<id>
  const p = armar(sintetica([post({ id: 555, estado: "draft", nombre: "un-nombre-real", fechaGmt: "2022-03-04 05:06:07" })]));
  assert.equal(p.articulos[0]!.slug, "borrador-555");
  assert.equal(p.articulos[0]!.estado, "BORRADOR");
  assert.deepEqual(p.articulos[0]!.redirecciones, []);
  assert.equal(p.articulos[0]!.publicadoEn, "2022-03-04T05:06:07.000Z", "el borrador conserva post_date_gmt si es válida");
  assert.equal(p.articulos[0]!.avisosMigracion?.migracion.some((x) => x.code === "origen_privado") ?? false, false);
});

t("T04: privado sintético 19300 -> BORRADOR, borrador-19300, aviso origen_privado y publicadoEn según la regla", () => {
  const priv = (fechaGmt: string) => armar(sintetica([post({ id: 19300, estado: "private", nombre: "19300", titulo: "", contenido: "Texto corto.", fecha: "2021-05-06 04:08:09", fechaGmt })])).articulos[0]!;
  const valido = priv("2021-05-06 07:08:09");
  assert.equal(valido.estado, "BORRADOR");
  assert.equal(valido.slug, "borrador-19300");
  assert.deepEqual(valido.redirecciones, []);
  assert.ok(valido.avisosMigracion?.migracion.some((x) => x.code === "origen_privado"));
  assert.equal(valido.publicadoEn, "2021-05-06T07:08:09.000Z");
  assert.equal(priv("0000-00-00 00:00:00").publicadoEn, null, "fecha inválida: null, nunca post_date");
  // otros estados: no se inventa una regla; el artículo se excluye con un problema
  for (const [id, estado] of [[777, "private"], [778, "pending"], [779, "trash"], [780, "future"]] as const) {
    const p = armar(sintetica([post({ id, estado }), post({ id: 1000 + id })]));
    assert.deepEqual(p.articulos.map((a) => a.wpId), [1000 + id], `${estado} queda afuera`);
    assert.deepEqual(p.problemas, [{ wpId: id, codigo: "estado_desconocido", detalle: { postStatus: estado }, bloqueante: false }]);
  }
});

t("T06: _wp_old_slug: 12526 sí; 15244 (__trashed), numérico e igual al actual no", () => {
  assert.deepEqual(tipos(articulo(12526)), ["ARTICULO", "SLUG_ANTERIOR"]);
  assert.equal(articulo(12526).redirecciones.find((r) => r.tipo === "SLUG_ANTERIOR")!.origen, "/2017/06/19/culpables/");
  assert.deepEqual(tipos(articulo(15244)), ["ARTICULO"]);
  assert.deepEqual(articulo(15244).oldSlugs.descartados.map((d) => d.motivo), ["trashed"]);
  const m = [meta(1, 5, "_wp_old_slug", "123"), meta(2, 5, "_wp_old_slug", "post-5"), meta(3, 5, "_wp_old_slug", "viejo__trashed"), meta(4, 5, "_wp_old_slug", "slug-viejo")];
  const a = armar(sintetica([post({ id: 5 })], { meta: m })).articulos[0]!;
  assert.deepEqual(a.oldSlugs.validos, ["slug-viejo"]);
  assert.deepEqual(a.oldSlugs.descartados.map((d) => d.motivo), ["numerico", "igual_al_slug_actual", "trashed"]);
  assert.deepEqual(a.redirecciones.map((r) => r.origen), ["/2020/01/02/post-5/", "/2020/01/02/slug-viejo/"]);
});

t("T08: validarCategoriaPrincipal: válida, ausente e inválida; y armar excluye al artículo inválido", () => {
  assert.equal(validarCategoriaPrincipal({ categorias: ["ensayo", "resena"], categoriaPrincipal: "ensayo" }), null);
  assert.equal(validarCategoriaPrincipal({ categorias: [], categoriaPrincipal: null }), null);
  assert.equal(validarCategoriaPrincipal({ categorias: ["ensayo"], categoriaPrincipal: null }), null);
  assert.match(validarCategoriaPrincipal({ categorias: ["ensayo"], categoriaPrincipal: "poesia" })!, /poesia/);
  assert.match(validarCategoriaPrincipal({ categorias: [], categoriaPrincipal: "poesia" })!, /poesia/);
  const invalido: typeof convertWpPost = (p, o) => ({ ...convertWpPost(p, o), categorias: ["ensayo"], categoriaPrincipal: "poesia" });
  const p = armar(sintetica([post({ id: 31 }), post({ id: 32 })]), { convertir: (x, o) => (x.titulo.endsWith("31") ? invalido(x, o) : convertWpPost(x, o)) });
  assert.deepEqual(p.articulos.map((a) => a.wpId), [32]);
  assert.equal(p.problemas.length, 1);
  assert.equal(p.problemas[0]!.wpId, 31);
  assert.equal(p.problemas[0]!.codigo, "categoria_principal_invalida");
});

t("T09: validarDestinoUnico: uno solo es válido; ninguno y dos o más no; armar no produce redirecciones inválidas", () => {
  assert.equal(validarDestinoUnico({ articuloWpId: 1, autorWpUserId: null, destino: null }), null);
  assert.equal(validarDestinoUnico({ articuloId: 1 }), null);
  assert.equal(validarDestinoUnico({ articuloWpId: null, autorWpUserId: 3, destino: null }), null);
  assert.equal(validarDestinoUnico({ autorId: 3 }), null);
  assert.equal(validarDestinoUnico({ destino: "/otra/" }), null);
  assert.match(validarDestinoUnico({ articuloWpId: null, autorWpUserId: null, destino: null })!, /0 destinos/);
  assert.match(validarDestinoUnico({})!, /ninguno/);
  assert.match(validarDestinoUnico({ articuloWpId: 1, autorWpUserId: 2, destino: null })!, /2 destinos/);
  assert.match(validarDestinoUnico({ articuloId: 1, autorId: 2, destino: "/x/" })!, /3 destinos/);
  assert.match(validarDestinoUnico({ destino: "" })!, /0 destinos/);
  assert.ok(plan.redirecciones.every((r) => validarDestinoUnico(r) === null));
  assert.deepEqual(plan.problemas, []);
  assert.equal(plan.redirecciones.length, 58);
});

t("T11: las 7 cuentas de solo texto no tienen bio ni redirección de autor; los demás autores sí", () => {
  const cuentas = base.cuentas;
  assert.equal(cuentas.length, 7);
  const posts = cuentas.map((c, i) => post({ id: 100 + i, autor: c.wpUserId }));
  const p = armar(sintetica(posts, { usuarios: cuentas.map((c) => usuario(c.wpUserId, { nicename: `cuenta-${c.wpUserId}`, bio: "Una bio que no debe migrarse." })) }));
  assert.equal(p.autores.length, 7);
  assert.ok(p.autores.every((a) => a.soloTexto && a.bio === null));
  assert.deepEqual(p.redirecciones.filter((r) => r.tipo === "AUTOR"), []);
  // en la muestra: los soloTexto son 203 y 245; los demás tienen su /author/<nicename>/
  assert.deepEqual(plan.autores.filter((a) => a.soloTexto).map((a) => a.wpUserId), [203, 245]);
  const conPagina = plan.autores.filter((a) => !a.soloTexto);
  assert.equal(conPagina.length, 23);
  for (const a of conPagina) assert.ok(plan.redirecciones.some((r) => r.tipo === "AUTOR" && r.autorWpUserId === a.wpUserId && r.origen === `/author/${a.slug}/`), a.slug);
  assert.equal(plan.redirecciones.filter((r) => r.tipo === "AUTOR").length, 23);
  assert.ok(!plan.redirecciones.some((r) => r.origen === "/author/revistaseda/" || r.origen === "/author/evaristo-cultural/"));
  assert.ok(conPagina.some((a) => a.bio !== null), "las personas con bio la conservan");
});

t("T12: categorías a crear: las 7 con su nombre del mapeo; las existentes no se repiten; sin nombre es bloqueante", () => {
  assert.deepEqual(plan.categoriasACrear.map((c) => [c.slug, c.nombre]).sort(), [
    ["fantastico", "Fantástico"], ["historieta", "Historieta"], ["literatura", "Literatura"], ["musica", "Música"],
    ["poesia", "Poesía"], ["teatro", "Teatro"], ["tv-y-cine", "TV & Cine"],
  ]);
  assert.deepEqual(plan.problemas.filter((x) => x.bloqueante), []);
  const algunas = armar(entradaDesdeSnapshot({ categoriasExistentes: ["musica", "teatro", "tv-y-cine"] }));
  assert.deepEqual(algunas.categoriasACrear.map((c) => c.slug).sort(), ["fantastico", "historieta", "literatura", "poesia"]);
  const todas = armar(entradaDesdeSnapshot({ categoriasExistentes: plan.categoriasACrear.map((c) => c.slug) }));
  assert.deepEqual(todas.categoriasACrear, []);
  // una categoría que el mapeo no nombra
  const mapeo = { ...base.mapeo, taxonomiasWp: { ...base.mapeo.taxonomiasWp, "tema-nuevo": { nombre: "Tema nuevo", accion: "categoria" as const, categorias: ["categoria-fantasma"], destino: "/" } } };
  const terminos: TerminoSnapshot[] = [{ taxonomia: "category", id: 41, nombre: "Tema nuevo", slug: "tema-nuevo" }];
  const sin = armar(sintetica([post({ id: 41 })], { mapeo, terminos }));
  assert.deepEqual(sin.categoriasACrear, [{ slug: "categoria-fantasma", nombre: null, articulos: [41] }]);
  assert.deepEqual(sin.problemas, [{ wpId: null, codigo: "categoria_sin_nombre_en_el_mapeo", detalle: { slug: "categoria-fantasma", articulos: [41] }, bloqueante: true }]);
});

t("T12b: Novedades de WordPress: sale con la novedad vencida (su fecha de publicación) y la sección que le toca; sin la marca, null", () => {
  // en el snapshot el id del término es el del post
  const terminos: TerminoSnapshot[] = [
    { taxonomia: "category", id: 51, nombre: "Novedades", slug: "novedades" },
    { taxonomia: "category", id: 52, nombre: "Novedades", slug: "novedades" },
    { taxonomia: "category", id: 52, nombre: "Reseñas", slug: "resena" },
    { taxonomia: "category", id: 53, nombre: "Poesia", slug: "poesia" },
  ];
  const p = armar(sintetica([post({ id: 51 }), post({ id: 52 }), post({ id: 53 })], { terminos }));
  const de = (id: number) => p.articulos.find((a) => a.wpId === id)!;
  assert.deepEqual([de(51).seccion, de(51).novedadHasta], ["textos", de(51).publicadoEn]); // solo Novedades: Textos
  assert.deepEqual([de(52).seccion, de(52).novedadHasta], ["resena", de(52).publicadoEn]); // con formato: lo conserva
  assert.ok(de(51).novedadHasta !== null && new Date(de(51).novedadHasta!) < new Date("2026-10-30T00:00:00Z"), "vencida");
  assert.deepEqual([de(53).seccion, de(53).categorias, de(53).novedadHasta], ["textos", ["poesia"], null]); // sin la marca
  assert.equal(p.articulos.filter((a) => a.novedadHasta === null).length, 1);
});

t("T05 (armado): 19899 -> millie-jackson-i-cry (guiones colapsados), título sin U+200E y aviso u200e_removido", () => {
  const a = articulo(19899);
  assert.equal(a.slug, "millie-jackson-i-cry");
  assert.ok(!a.titulo.includes("\u200E"));
  assert.deepEqual(a.avisosMigracion?.migracion.find((x) => x.code === "u200e_removido"), { code: "u200e_removido", detalle: { en: ["slug", "titulo"] } });
  // un doble guion legítimo, sin U+200E, no se toca
  assert.equal(armar(sintetica([post({ id: 6, nombre: "a--b" })])).articulos[0]!.slug, "a--b");
});

t("T07: 2462 y 22546 de punta a punta: sin encabezado, aviso original_faltante y columnas null", () => {
  const sinOriginal: Medicion = { estado: "original faltante", archivo: null, diferenciaDeNombre: null, bytes: null, sha256: null, mime: null, ancho: null, alto: null };
  const medicionesDe = (e: EntradaArmar, faltantes: string[]) => new Map<string, Medicion>(e.adjuntos.filter((a) => a.clave).map((a) => [a.clave!, faltantes.includes(a.clave!)
    ? sinOriginal
    : { estado: "medida", archivo: a.clave!, diferenciaDeNombre: null, bytes: 1234, sha256: "c".repeat(64), mime: "image/jpeg", ancho: a.ancho ?? 10, alto: a.alto ?? 10 }] as const));
  const entrada = entradaDesdeSnapshot();
  const p = armar({ ...entrada, mediciones: medicionesDe(entrada, ["escanear0006.jpg", "mankell.jpg"]) });
  assert.equal(p.articulos.length, 35);
  const faltantes: Array<[number, number, string]> = [[2462, 2464, "escanear0006.jpg"], [22546, 22547, "mankell.jpg"]];
  for (const [id, adjuntoWpId, clave] of faltantes) {
    const a = p.articulos.find((x) => x.wpId === id)!;
    assert.equal(a.imagenEncabezado, null, `${id} migra sin encabezado`);
    assert.equal(a.encabezadoAlt, null);
    assert.equal(a.encabezadoCredito, null);
    assert.equal(a.encabezadoAdjuntoWpId, adjuntoWpId);
    assert.equal(a.altPendientes, a.altPendientesCuerpo, "el encabezado ausente no suma alt pendiente");
    const av = a.avisosMigracion!.migracion.find((x) => x.code === "original_faltante")!;
    assert.deepEqual(av.detalle, { contexto: "encabezado", adjuntoWpId, clave, anchoDeclaradoPorWp: id === 2462 ? 1950 : 1000, altoDeclaradoPorWp: id === 2462 ? 1257 : 800, alt: null, credito: null });
    assert.ok(!p.imagenes.some((i) => i.wpId === adjuntoWpId), "sin fila de imagen");
  }
  assert.deepEqual(p.imagenesSinFila.map((x) => x.adjuntoWpId), [2464, 22547]);
  assert.equal(p.imagenes.length, 200);
  assert.ok(p.imagenes.every((i) => i.hash.length === 64 && i.bytes > 0 && i.ancho > 0 && i.alto > 0));
  // el resto conserva su encabezado, con lo medido
  assert.equal(p.articulos.find((x) => x.wpId === 22590)!.imagenEncabezado, null, "22590 no tiene _thumbnail_id");
  assert.equal(p.articulos.filter((x) => x.imagenEncabezado === null).length, 3);
  const con = p.articulos.find((x) => x.wpId === 19660)!.imagenEncabezado!;
  assert.equal(con.hash, "c".repeat(64));
  assert.equal(con.bytes, 1234);
  // alt y crédito del encabezado ausente viajan dentro del aviso (adjunto con alt y artículo con crédito, sintético)
  const adj = { id: 9700, tipoPost: "attachment", mime: "image/jpeg", guid: "http://x/wp-content/uploads/falta.jpg", clave: "falta.jpg", alt: "Un texto alternativo", ancho: 400, alto: 300, bytes: null };
  const s = armar(sintetica([post({ id: 800 })], {
    meta: [meta(1, 800, "_thumbnail_id", "9700"), meta(2, 800, "cb_image_credit", "Foto: Alguien")], adjuntos: [adj], adjuntoPorClave: [["falta.jpg", 9700]],
    mediciones: new Map<string, Medicion>([["falta.jpg", sinOriginal]]),
  })).articulos[0]!;
  assert.deepEqual([s.imagenEncabezado, s.encabezadoAlt, s.encabezadoCredito], [null, null, null]);
  assert.deepEqual(s.avisosMigracion!.migracion[0], { code: "original_faltante", detalle: { contexto: "encabezado", adjuntoWpId: 9700, clave: "falta.jpg", anchoDeclaradoPorWp: 400, altoDeclaradoPorWp: 300, alt: "Un texto alternativo", credito: "Foto: Alguien" } });
  // existe pero no se pudo medir: mismo tratamiento, con otro código
  const sm = armar(sintetica([post({ id: 801 })], {
    meta: [meta(1, 801, "_thumbnail_id", "9700")], adjuntos: [adj], adjuntoPorClave: [["falta.jpg", 9700]],
    mediciones: new Map<string, Medicion>([["falta.jpg", { estado: "ilegible", archivo: "falta.jpg", diferenciaDeNombre: null, bytes: 5, sha256: "d".repeat(64), mime: "image/webp", ancho: null, alto: null, motivo: "formato no soportado: image/webp" }]]),
  })).articulos[0]!;
  assert.equal(sm.imagenEncabezado, null);
  assert.equal(sm.avisosMigracion!.migracion[0]!.code, "imagen_sin_medir");
  assert.equal((sm.avisosMigracion!.migracion[0]!.detalle as { motivo: string }).motivo, "formato no soportado: image/webp");
});

const aviso = (a: { avisosMigracion: { migracion: Array<{ code: string; detalle?: unknown }> } | null }, code: string) => a.avisosMigracion?.migracion.filter((x) => x.code === code) ?? [];

t("T18: fecha_borrador: el 22546 (2023-06-29), un borrador con fecha válida no, un privado con ceros sí", () => {
  assert.deepEqual(aviso(articulo(22546), "fecha_borrador"), [{ code: "fecha_borrador", detalle: { postDate: "2023-06-29 23:38:10" } }]);
  assert.ok(articulo(22546).publicadoEn === null);
  assert.deepEqual(plan.articulos.filter((a) => aviso(a, "fecha_borrador").length).map((a) => a.wpId), [22546]);
  const conFecha = armar(sintetica([post({ id: 555, estado: "draft", fechaGmt: "2022-03-04 05:06:07" })])).articulos[0]!;
  assert.deepEqual(aviso(conFecha, "fecha_borrador"), []);
  const privado = armar(sintetica([post({ id: 19300, estado: "private", nombre: "19300", fecha: "2021-05-06 04:08:09", fechaGmt: "0000-00-00 00:00:00" })])).articulos[0]!;
  assert.deepEqual(aviso(privado, "fecha_borrador"), [{ code: "fecha_borrador", detalle: { postDate: "2021-05-06 04:08:09" } }]);
  assert.equal(privado.publicadoEn, null);
  assert.equal(aviso(privado, "origen_privado").length, 1, "conserva el aviso origen_privado");
  // un publicado nunca lleva este aviso
  assert.deepEqual(aviso(armar(sintetica([post({ id: 556 })])).articulos[0]!, "fecha_borrador"), []);
});

t("T19: bio_con_correo: con correo, con marcador, sin correo y autor de solo texto; el correo nunca viaja", () => {
  const CORREO = "alguien@ejemplo.com";
  const porBio = (bio: string | null, autor = 9001) => armar(sintetica([post({ id: 70, autor }), post({ id: 71, autor })], { usuarios: [usuario(autor, { bio })] }));
  const conCorreo = porBio(`Escribe desde siempre. Contacto: ${CORREO}`);
  assert.deepEqual(conCorreo.articulos.map((a) => aviso(a, "bio_con_correo")), [
    [{ code: "bio_con_correo", detalle: { wpUserId: 9001, nombre: "Autor 9001" } }],
    [{ code: "bio_con_correo", detalle: { wpUserId: 9001, nombre: "Autor 9001" } }],
  ]);
  assert.ok(!JSON.stringify(conCorreo.articulos.map((a) => a.avisosMigracion)).includes(CORREO), "el aviso no contiene el correo");
  assert.equal(conCorreo.autores[0]!.bioConCorreo, true);
  assert.ok(!JSON.stringify(conCorreo.autores.map((a) => ({ ...a, bio: null }))).includes(CORREO));
  // el marcador que deja el snapshot cuenta igual
  assert.equal(aviso(porBio(`Escribe. ${MARCADOR_CORREO_OMITIDO}`).articulos[0]!, "bio_con_correo").length, 1);
  assert.equal(MARCADOR_CORREO_OMITIDO, "[correo omitido]");
  // sin correo, sin bio
  assert.equal(aviso(porBio("Escribe desde siempre.").articulos[0]!, "bio_con_correo").length, 0);
  assert.equal(aviso(porBio(null).articulos[0]!, "bio_con_correo").length, 0);
  // autor de solo texto: no hay bio que migrar, no hay aviso
  const cuenta7 = base.cuentas[0]!.wpUserId;
  const soloTexto = porBio(`Contacto: ${CORREO}`, cuenta7);
  assert.equal(soloTexto.autores[0]!.soloTexto, true);
  assert.deepEqual(soloTexto.articulos.map((a) => aviso(a, "bio_con_correo").length), [0, 0]);
  // en la muestra: solo el usuario 39 (bio redactada en el snapshot)
  const usuarios = new Set(plan.articulos.filter((a) => aviso(a, "bio_con_correo").length).map((a) => a.autores[0]!.wpUserId));
  assert.deepEqual([...usuarios], [39]);
  assert.ok(!JSON.stringify(plan.articulos.map((a) => a.avisosMigracion)).match(/@/));
});

// ---------------------------------------------------------------------------------------------------------------
// Texto plano: el plan de los 35 trae todas las palabras visibles del cuerpo (recorrido propio del test, que no usa textoPlanoDe)
// ---------------------------------------------------------------------------------------------------------------
const palabras = (s: string) => (s.match(/\S+/g) ?? []).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
/** Palabras visibles del cuerpo: cada unidad de texto se cuenta aparte (hardBreak y notas cortan la unidad), más epígrafes y autor y fuente de cita. */
function palabrasDelCuerpo(doc: unknown): number {
  let total = 0;
  const camina = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (n.type === "paragraph" || n.type === "heading") {
      let trozo = "";
      const vuelca = () => { total += palabras(trozo); trozo = ""; };
      const dentro = (h: any): void => {
        if (typeof h.text === "string") trozo += h.text;
        else if (h.type === "hardBreak") vuelca();
        else if (h.type === "footnote") { vuelca(); camina(h.attrs?.content); }
        else (h.content ?? []).forEach(dentro);
      };
      (n.content ?? []).forEach(dentro);
      vuelca();
      return;
    }
    if (n.type === "imagen") { total += palabras(String(n.attrs?.epigrafe ?? "")); return; }
    (n.content ?? []).forEach(camina);
    if (n.type === "cita") total += palabras(String(n.attrs?.autor ?? "")) + palabras(String(n.attrs?.fuente ?? ""));
  };
  camina(doc);
  return total;
}
t("textoPlano: en los 35 del snapshot, las palabras del texto plano son las del cuerpo (epígrafes incluidos), sin pegar ni perder ninguna", () => {
  for (const a of plan.articulos) {
    assert.equal(palabras(a.textoPlano), palabrasDelCuerpo(a.cuerpo), `${a.wpId}: palabras del textoPlano`);
    assert.ok(!/\n\n|^\s|\s$|  /.test(a.textoPlano), `${a.wpId}: sin líneas vacías, espacios dobles ni bordes con espacio`);
    assert.ok(a.textoPlano.length > 0, `${a.wpId}: texto plano no vacío`);
  }
});
t("textoPlano: testigos 5296 (tablas), 720 (saltos de línea) y 4265 (epígrafes): antes 367, 80 y 5974 palabras; ahora las del cuerpo", () => {
  assert.equal(palabras(articulo(5296).textoPlano), 475);
  assert.equal(palabras(articulo(720).textoPlano), 83);
  assert.equal(palabras(articulo(4265).textoPlano), 6232);
  assert.equal(palabrasDelCuerpo(articulo(4265).cuerpo), 6232);
});

console.log(`${ok} pruebas de armar ok`);
