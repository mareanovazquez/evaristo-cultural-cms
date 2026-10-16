// Pruebas puras de scripts/migracion/lib/armar.ts con la entrada del snapshot de WordPress (sin base ni disco, salvo la
// lectura de los JSON de datos).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertWpPost } from "../../../src/conversor/convert.ts";
import { armar, validarCategoriaPrincipal, validarDestinoUnico } from "../lib/armar.ts";
import type { EntradaArmar } from "../lib/armar.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
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
    asia: 17, ensayo: 4, rastros: 3, literatura: 3, musica: 2, "sin-asignar": 2, entrevista: 1, resena: 1, poesia: 1, teatro: 1,
  });
  assert.deepEqual(plan.seccionesFaltantes, []);
  assert.equal(plan.categoriasACrear.length, 8);
  assert.deepEqual(plan.categoriasACrear.map((c) => c.slug).sort(), ["ensayo", "entrevista", "fantastico", "historieta", "literatura", "poesia", "resena", "tv-y-cine"]);
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
      for (const k of ["slug", "estado", "seccion", "categorias", "categoriaPrincipal", "autores", "redirecciones", "publicadoEn"] as const) {
        assert.deepEqual(a[k], b[k], `${b.wpId}.${k}`);
      }
      assert.deepEqual(a.avisosMigracion?.cuerpo ?? null, b.avisosMigracion?.cuerpo ?? null, `${b.wpId}.avisos.cuerpo`);
      assert.deepEqual(a.avisosMigracion?.titulo ?? null, b.avisosMigracion?.titulo ?? null, `${b.wpId}.avisos.titulo`);
    }
    // única diferencia decidida: las cuentas de solo texto ya no tienen redirección /author/<slug>/ (el baseline las tiene)
    const soloTexto = new Set(base.autores.filter((x: { soloTexto: boolean }) => x.soloTexto).map((x: { wpUserId: number }) => x.wpUserId));
    assert.deepEqual(plan.redirecciones, base.redirecciones.filter((r: { tipo: string; autorWpUserId: number | null }) => !(r.tipo === "AUTOR" && soloTexto.has(r.autorWpUserId as number))));
    assert.deepEqual(plan.autores.map((x) => x.wpUserId), base.autores.map((x: { wpUserId: number }) => x.wpUserId));
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

t("T12: categorías a crear: las 8 con su nombre del mapeo; las existentes no se repiten; sin nombre es bloqueante", () => {
  assert.deepEqual(plan.categoriasACrear.map((c) => [c.slug, c.nombre]).sort(), [
    ["ensayo", "Ensayo"], ["entrevista", "Entrevista"], ["fantastico", "Fantástico"], ["historieta", "Historieta"],
    ["literatura", "Literatura"], ["poesia", "Poesía"], ["resena", "Reseña"], ["tv-y-cine", "TV & Cine"],
  ]);
  assert.deepEqual(plan.problemas.filter((x) => x.bloqueante), []);
  const algunas = armar(entradaDesdeSnapshot({ categoriasExistentes: ["entrevista", "resena", "tv-y-cine"] }));
  assert.deepEqual(algunas.categoriasACrear.map((c) => c.slug).sort(), ["ensayo", "fantastico", "historieta", "literatura", "poesia"]);
  const todas = armar(entradaDesdeSnapshot({ categoriasExistentes: plan.categoriasACrear.map((c) => c.slug) }));
  assert.deepEqual(todas.categoriasACrear, []);
  // una categoría que el mapeo no nombra
  const mapeo = { ...base.mapeo, taxonomiasWp: { ...base.mapeo.taxonomiasWp, "tema-nuevo": { nombre: "Tema nuevo", accion: "categoria" as const, categorias: ["categoria-fantasma"] } } };
  const terminos: TerminoSnapshot[] = [{ taxonomia: "category", id: 41, nombre: "Tema nuevo", slug: "tema-nuevo" }];
  const sin = armar(sintetica([post({ id: 41 })], { mapeo, terminos }));
  assert.deepEqual(sin.categoriasACrear, [{ slug: "categoria-fantasma", nombre: null, articulos: [41] }]);
  assert.deepEqual(sin.problemas, [{ wpId: null, codigo: "categoria_sin_nombre_en_el_mapeo", detalle: { slug: "categoria-fantasma", articulos: [41] }, bloqueante: true }]);
});

console.log(`${ok} pruebas de armar ok`);
