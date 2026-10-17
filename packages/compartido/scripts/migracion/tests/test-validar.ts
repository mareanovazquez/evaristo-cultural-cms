// Pruebas de scripts/migracion/lib/validar.ts con un consultar simulado (sin base). La intercalación de MySQL se imita con una función
// de prueba: é = e, mayúsculas = minúsculas y ñ distinta de n. En la corrida real quien decide es MySQL 8.4.
import assert from "node:assert/strict";
import { convertWpPost } from "../../../src/conversor/convert.ts";
import { armar } from "../lib/armar.ts";
import type { EntradaArmar } from "../lib/armar.ts";
import { entradaDesdeSnapshot } from "../lib/entrada-snapshot.ts";
import type { Consulta, Fila } from "../lib/leer-wordpress.ts";
import { COLACION } from "../lib/leer-wordpress.ts";
import type { PostSnapshot, UsuarioSnapshot } from "../lib/snapshot-tipos.ts";
import {
  bloqueantesDelPlan, gruposIgualesEnBd, largoEnCaracteres, largosDeSchema, leerIntercalaciones, leerLargosSchema, validarArticulos, validarColisiones,
  validarCuentas, validarDestino, validarIntercalaciones, validarPlan,
} from "../lib/validar.ts";

let ok = 0;
const t = (name: string, fn: () => void | Promise<void>) => { const r = fn(); if (r) throw new Error("usar ta() para tests asíncronos"); ok++; console.log("ok", name); };
const ta = async (name: string, fn: () => Promise<void>) => { await fn(); ok++; console.log("ok", name); };

// ---------------------------------------------------------------------------------------------------------------
// Consultar simulado: registra todo el SQL y responde como lo haría la base, con la intercalación imitada en JS
// ---------------------------------------------------------------------------------------------------------------
const clave = (s: string) => s.normalize("NFC").toLowerCase().replace(/ñ/g, "\u0001").normalize("NFD").replace(/\p{M}/gu, "");
interface Existente { id: number; slug: string; wpId: number | null }
function baseSimulada(opciones: { existentes?: Existente[]; colacion?: Record<string, string | null> } = {}) {
  const sql: string[] = [];
  const colacion = { "articulos.slug": COLACION, "redirecciones.origen": COLACION, "imagenes.clave": COLACION, ...opciones.colacion };
  const bd: Consulta = async (texto, ...p): Promise<Fila[]> => {
    sql.push(texto);
    if (/DENSE_RANK/.test(texto)) {
      const claves = new Map<string, number>();
      return Array.from({ length: p.length / 2 }, (_, k) => {
        const c = clave(String(p[2 * k + 1]));
        if (!claves.has(c)) claves.set(c, claves.size + 1);
        return { i: p[2 * k] as number, g: claves.get(c)! };
      });
    }
    if (/FROM articulos WHERE slug/.test(texto)) return (opciones.existentes ?? []).filter((e) => clave(e.slug) === clave(String(p[0]))).map((e) => ({ ...e }));
    if (/FROM autores/.test(texto)) return [];
    if (/information_schema\.COLUMNS/.test(texto)) {
      return Object.entries(colacion).filter(([, c]) => c !== null).map(([k, c]) => ({ tabla: k.split(".")[0], columna: k.split(".")[1], colacion: c }));
    }
    throw new Error(`consulta inesperada: ${texto.slice(0, 60)}`);
  };
  return { bd, sql };
}

// ---------------------------------------------------------------------------------------------------------------
// Entradas sintéticas
// ---------------------------------------------------------------------------------------------------------------
const base = entradaDesdeSnapshot();
const post = (o: Partial<PostSnapshot> & { id: number }): PostSnapshot => ({
  tipo: "post", estado: "publish", autor: 9001, nombre: `post-${o.id}`, titulo: `Título ${o.id}`, fecha: "2020-01-02 03:04:05", fechaGmt: "2020-01-02 03:04:05", contenido: "<p>Hola</p>", ...o,
});
const usuario = (id: number): UsuarioSnapshot => ({ id, login: `u${id}`, nicename: `autor-${id}`, nombre: `Autor ${id}`, bio: null });
const sintetica = (posts: PostSnapshot[], extra: Partial<EntradaArmar> = {}): EntradaArmar => ({
  ...base, ids: posts.map((p) => p.id), fixture: [], extras: [], posts, meta: [], terminos: [], usuarios: [usuario(9001)], adjuntos: [], adjuntoPorClave: [], ...extra,
});
const largos = leerLargosSchema();
const codigos = (ps: Array<{ wpId: number | null; codigo: string }>) => ps.map((p) => `${p.wpId}:${p.codigo}`).sort();

t("T17: los largos salen de schema.prisma y se cuentan en caracteres", () => {
  assert.equal(largos.get("Articulo.slug"), 255);
  assert.equal(largos.get("Articulo.titulo"), 512);
  assert.equal(largos.get("Redireccion.origen"), 512);
  assert.equal(largos.get("Imagen.clave"), 512);
  assert.deepEqual([...largosDeSchema("model A {\n  id Int @id\n  x  String? @db.VarChar(7)\n}\nmodel B {\n  x String @db.VarChar(9) @unique\n}\n")], [["A.x", 7], ["B.x", 9]]);
  assert.equal("😀".length, 2);
  assert.equal(largoEnCaracteres("😀"), 1);
  assert.equal(largoEnCaracteres("a".repeat(255) + "ñ"), 256);
  assert.throws(() => validarArticulos(armar(sintetica([post({ id: 1 })])), new Map()), /no declara/);
});

t("T17: longitudes, slug o título vacío, publicado sin fecha y cuerpo inválido excluyen solo al artículo", () => {
  const cuerpoInvalido: typeof convertWpPost = (x, o) => (x.titulo.endsWith("107") ? { ...convertWpPost(x, o), doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "cosa-rara" }] }] } as never } : convertWpPost(x, o));
  const posts = [
    post({ id: 100, nombre: "a".repeat(255) }),                         // justo en el máximo
    post({ id: 101, nombre: "a".repeat(256) }),                         // uno de más
    post({ id: 102, nombre: "😀".repeat(255) }),                        // 255 caracteres (510 unidades UTF-16): entra
    post({ id: 103, nombre: "😀".repeat(256) }),                        // 256 caracteres: no entra
    post({ id: 104, titulo: "T".repeat(512) }),                         // justo
    post({ id: 105, titulo: "T".repeat(513) }),                         // uno de más
    post({ id: 106, nombre: "" }),                                      // publicado sin slug
    post({ id: 107 }),                                                  // cuerpo inválido (con el conversor de prueba)
    post({ id: 108, fechaGmt: "0000-00-00 00:00:00" }),                 // publicado sin fecha
    post({ id: 109, titulo: "" }),                                      // título vacío
    post({ id: 110 }),                                                  // sin problemas
    post({ id: 111, estado: "draft", nombre: "", fechaGmt: "0000-00-00 00:00:00" }),  // borrador sin slug ni fecha: es válido (borrador-111)
  ];
  const plan = armar(sintetica(posts), { convertir: cuerpoInvalido });
  const p = validarArticulos(plan, largos);
  assert.deepEqual(codigos(p), [
    "101:slug_demasiado_largo", "103:slug_demasiado_largo", "105:titulo_demasiado_largo", "106:slug_vacio", "107:cuerpo_invalido", "108:publicado_sin_fecha", "109:titulo_vacio",
  ].sort());
  assert.deepEqual(p.find((x) => x.wpId === 101)!.detalle, { largo: 256, maximo: 255 });
  assert.ok(p.every((x) => x.bloqueante === false));
  // armar() deja afuera a los excluidos y el plan queda coherente
  const excluidos = new Set(p.map((x) => x.wpId as number));
  const recortado = armar(sintetica(posts, { excluidos }), { convertir: cuerpoInvalido });
  assert.deepEqual(recortado.articulos.map((a) => a.wpId), [100, 102, 104, 110, 111]);
  assert.equal(recortado.redirecciones.filter((r) => r.tipo === "ARTICULO").length, 4, "el borrador no tiene redirección");
  assert.ok(recortado.redirecciones.every((r) => r.articuloWpId === null || recortado.articulos.some((a) => a.wpId === r.articuloWpId)));
  assert.deepEqual(recortado.autores[0]!.articulosEnMuestra, [100, 102, 104, 110, 111]);
});

await ta("T17: colisiones de slug las decide la base: é=e, A=a, ñ≠n; el que colisiona se excluye y los demás siguen", async () => {
  const { bd, sql } = baseSimulada();
  const plan = armar(sintetica([
    post({ id: 200, nombre: "Café" }), post({ id: 201, nombre: "cafe" }),            // iguales para la base: se excluyen los dos
    post({ id: 202, nombre: "Mañana" }), post({ id: 203, nombre: "manana" }),        // la ñ no es la n: siguen los dos
    post({ id: 204, nombre: "UNICO" }), post({ id: 205, nombre: "unico-otro" }),
  ]));
  const r = await validarColisiones(plan, bd);
  assert.deepEqual(codigos(r.problemas), ["200:slug_duplicado_en_el_plan", "201:slug_duplicado_en_el_plan"]);
  assert.deepEqual(r.problemas.find((x) => x.wpId === 200)!.detalle, { slug: "Café", conWpId: [201] });
  assert.ok(sql.every((s) => /^\s*SELECT\b/i.test(s)), "solo SELECT");
  assert.ok(sql.some((s) => s.includes(`COLLATE ${COLACION}`)), "compara con la intercalación del CMS");
  // el plan armado sin los excluidos conserva a los demás
  const sinChocar = armar(sintetica([post({ id: 200, nombre: "Café" }), post({ id: 201, nombre: "cafe" }), post({ id: 204 })], { excluidos: new Set(r.problemas.map((x) => x.wpId as number)) }));
  assert.deepEqual(sinChocar.articulos.map((a) => a.wpId), [204]);
});

await ta("T17: contra las filas existentes (menos la propia por wpId) y borrador-<id> contra un slug real", async () => {
  const existentes: Existente[] = [
    { id: 1, slug: "Ocupado", wpId: null },        // fila manual con el mismo slug
    { id: 2, slug: "otro-articulo", wpId: 999 },   // de otro artículo de WordPress
    { id: 3, slug: "yo-mismo", wpId: 303 },        // la propia fila: no cuenta
    { id: 4, slug: "borrador-304", wpId: 777 },    // un slug real que ocupa el slug del borrador
  ];
  const { bd } = baseSimulada({ existentes });
  const plan = armar(sintetica([
    post({ id: 300, nombre: "ocupado" }), post({ id: 301, nombre: "otro-articulo" }), post({ id: 302, nombre: "libre" }),
    post({ id: 303, nombre: "yo-mismo" }), post({ id: 304, estado: "draft", nombre: "", fechaGmt: "0000-00-00 00:00:00" }),
  ]));
  const r = await validarColisiones(plan, bd);
  assert.deepEqual(codigos(r.problemas), ["300:slug_choca_con_articulo_existente", "301:slug_choca_con_articulo_existente", "304:borrador_choca_con_slug_real"]);
  assert.deepEqual(r.problemas.find((x) => x.wpId === 301)!.detalle, { slug: "otro-articulo", existentes: [{ id: 2, slug: "otro-articulo", wpId: 999 }] });
  // dentro del plan: un publicado llamado borrador-305 y el borrador 305 -> se excluye el borrador
  const choque = await validarColisiones(armar(sintetica([post({ id: 310, nombre: "borrador-305" }), post({ id: 305, estado: "draft", nombre: "", fechaGmt: "0000-00-00 00:00:00" })])), baseSimulada().bd);
  assert.deepEqual(codigos(choque.problemas), ["305:borrador_choca_con_slug_real"]);
  assert.deepEqual(await gruposIgualesEnBd(baseSimulada().bd, ["solo uno"]), [], "con un solo valor no hay nada que agrupar ni consultar");
});

await ta("T17: bloqueantes: intercalación incorrecta (con la real de cada columna), cuentas, sección faltante, categoría sin nombre y destino", async () => {
  const { bd } = baseSimulada({ colacion: { "articulos.slug": "utf8mb4_0900_ai_ci", "imagenes.clave": null } });
  const columnas = await leerIntercalaciones(bd);
  assert.deepEqual(columnas.map((c) => [`${c.tabla}.${c.columna}`, c.real, c.ok]), [
    ["articulos.slug", "utf8mb4_0900_ai_ci", false], ["redirecciones.origen", COLACION, true], ["imagenes.clave", null, false],
  ]);
  assert.deepEqual(validarIntercalaciones(columnas).map((p) => [p.codigo, p.bloqueante, (p.detalle as { columna: string }).columna]), [
    ["intercalacion_incorrecta", true, "articulos.slug"], ["intercalacion_incorrecta", true, "imagenes.clave"],
  ]);
  // cuentas
  const cuentas = base.cuentas.slice(0, 2);
  const filas = cuentas.map((c) => ({ id: c.wpUserId, login: c.user_login, nombre: c.nombre }));
  assert.equal(validarCuentas(cuentas, filas), null);
  assert.equal(validarCuentas(cuentas, [filas[0]!, { ...filas[1]!, nombre: "Otro nombre" }])!.codigo, "cuentas_no_coinciden");
  assert.equal(validarCuentas(cuentas, [filas[0]!])!.bloqueante, true);
  // destino
  const permitido = { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" };
  assert.equal(validarDestino(permitido, permitido), null);
  for (const mal of [{ ...permitido, puerto: 3307 }, { ...permitido, base: "evaristo_cms_test" }, { ...permitido, host: "localhost" }]) assert.equal(validarDestino(mal, permitido)!.codigo, "destino_no_permitido");
  // sección faltante y categoría sin nombre
  const plan = armar(sintetica([post({ id: 400 })]), {});
  assert.deepEqual(bloqueantesDelPlan({ ...plan, seccionesFaltantes: ["ensayo"] }).map((p) => p.codigo), ["seccion_faltante"]);
  const mapeo = { ...base.mapeo, taxonomiasWp: { ...base.mapeo.taxonomiasWp, "tema-nuevo": { nombre: "Tema nuevo", accion: "categoria" as const, categorias: ["categoria-fantasma"] } } };
  const sinNombre = armar(sintetica([post({ id: 41 })], { mapeo, terminos: [{ taxonomia: "category", id: 41, nombre: "Tema nuevo", slug: "tema-nuevo" }] }));
  assert.deepEqual(bloqueantesDelPlan(sinNombre).map((p) => p.codigo), ["categoria_sin_nombre_en_el_mapeo"]);
});

await ta("T17: validarPlan junta todo; con la intercalación mal no consulta colisiones", async () => {
  const cuentas = base.cuentas;
  const filasCuentasWp = cuentas.map((c) => ({ id: c.wpUserId, login: c.user_login, nombre: c.nombre }));
  const destino = { host: "127.0.0.1", puerto: 3308, base: "evaristo_cms" };
  const plan = armar(sintetica([post({ id: 500, nombre: "Café" }), post({ id: 501, nombre: "cafe" }), post({ id: 502, nombre: "b".repeat(300) }), post({ id: 503 })]));
  const bien = baseSimulada();
  const r = await validarPlan({ plan, bd: bien.bd, largos, cuentas, filasCuentasWp, destino, destinoPermitido: destino });
  assert.deepEqual(r.bloqueantes, []);
  assert.deepEqual(codigos(r.deArticulo), ["500:slug_duplicado_en_el_plan", "501:slug_duplicado_en_el_plan", "502:slug_demasiado_largo"]);
  assert.deepEqual([...r.excluidos].sort(), [500, 501, 502]);
  const mal = baseSimulada({ colacion: { "articulos.slug": "utf8mb4_bin" } });
  const r2 = await validarPlan({ plan, bd: mal.bd, largos, cuentas, filasCuentasWp, destino: { ...destino, puerto: 3307 }, destinoPermitido: destino });
  assert.deepEqual(r2.bloqueantes.map((p) => p.codigo), ["destino_no_permitido", "intercalacion_incorrecta"]);
  assert.ok(!mal.sql.some((s) => /DENSE_RANK|FROM articulos/.test(s)), "no consultó colisiones con la intercalación equivocada");
  assert.deepEqual(codigos(r2.deArticulo), ["502:slug_demasiado_largo"]);
});

console.log(`${ok} pruebas de validar ok`);
