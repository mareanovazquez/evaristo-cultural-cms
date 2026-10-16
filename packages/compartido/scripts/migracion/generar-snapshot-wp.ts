// Genera datos/migracion/snapshot-wp-muestra.json: los datos de WordPress que necesita el armado de los 35 artículos de la
// muestra (los 30 de la fixture más los 5 de datos/migracion/muestra-extra.json), para poder probar sin base.
//
// SOLO LECTURA: usa lib/leer-wordpress.ts (sesiones en READ ONLY y consultar(), que solo admite SELECT). No guarda datos
// personales: de los usuarios solo toma id, login, nicename, nombre público y la bio pública (con las direcciones de
// correo que escribió el autor dentro de la bio reemplazadas por "[correo omitido]"); nunca email de cuenta, contraseña,
// url, clave de activación ni fechas de registro. La salida es determinista: claves y listas en orden estable, sin
// fechas de generación.
//
// Uso: npm run snapshot:wp -w @evaristo/compartido
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { convertWpContent } from "../../src/conversor/convert.ts";
import { abrirConexiones, detalleAdjuntos, leerAdjuntosPorClave, leerBios, leerCuentas, leerMeta, leerOpciones, leerPosts, leerTerminos, leerUsuarios } from "./lib/leer-wordpress.ts";
import type { AdjuntoSnapshot, SnapshotWp } from "./lib/snapshot-tipos.ts";
import { adjuntoDeUrl, num, ocultarCorreos, str } from "./lib/utilidades.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
const aRuta = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SALIDA = aRuta("../../datos/migracion/snapshot-wp-muestra.json");

const fixture: Array<{ id: number; contenido_crudo: string }> = JSON.parse(readFileSync(aRuta("../../src/conversor/tests/fixtures/muestra-wordpress.json"), "utf8"));
const extras: Array<{ id: number }> = JSON.parse(readFileSync(aRuta("../../datos/migracion/muestra-extra.json"), "utf8")).articulos;
const cuentas: Array<{ wpUserId: number }> = JSON.parse(readFileSync(aRuta("../../datos/migracion/cuentas.json"), "utf8")).cuentas;
const idsFixture = new Set(fixture.map((m) => m.id));
const ids = [...fixture.map((m) => m.id), ...extras.map((e) => e.id)];
if (new Set(ids).size !== 35) throw new Error(`Se esperaban 35 artículos distintos y hay ${new Set(ids).size}`);

const { wp, cerrar } = await abrirConexiones();
try {
  const porId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;

  const opciones = await leerOpciones(wp);
  const opcion = (k: string) => str(opciones.find((o) => o["k"] === k)?.["v"]);

  const filasPosts = await leerPosts(wp, ids);
  const posts = filasPosts.map((f) => {
    const id = num(f["id"]);
    return {
      id, tipo: str(f["tipo"]), estado: str(f["estado"]), autor: num(f["autor"]), nombre: str(f["nombre"]), titulo: str(f["titulo"]),
      fecha: str(f["fecha"]), fechaGmt: str(f["fechaGmt"]),
      ...(idsFixture.has(id) ? {} : { contenido: str(f["contenido"]) }),
    };
  }).sort(porId);
  if (posts.length !== 35) throw new Error(`WordPress devolvió ${posts.length} posts de los 35 pedidos`);

  const filasMeta = await leerMeta(wp, ids);
  const meta = filasMeta.map((f) => ({ metaId: num(f["metaId"]), postId: num(f["postId"]), k: str(f["k"]), v: str(f["v"]) })).sort((a, b) => a.metaId - b.metaId);

  const terminos = [
    ...(await leerTerminos(wp, "category", ids)).map((f) => ({ taxonomia: "category" as const, id: num(f["id"]), nombre: str(f["nombre"]), slug: str(f["slug"]) })),
    ...(await leerTerminos(wp, "post_tag", ids)).map((f) => ({ taxonomia: "post_tag" as const, id: num(f["id"]), nombre: str(f["nombre"]), slug: str(f["slug"]) })),
  ].sort((a, b) => a.id - b.id || a.taxonomia.localeCompare(b.taxonomia) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) || (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));

  // Usuarios: autores de los 35 posts. id + nicename + nombre salen de leerUsuarios; el login de leerCuentas (sin email).
  const idsAutores = [...new Set(posts.map((p) => p.autor))].sort((a, b) => a - b);
  const usuariosFilas = await leerUsuarios(wp, idsAutores);
  const loginsFilas = await leerCuentas(wp, idsAutores);
  const biosFilas = await leerBios(wp, idsAutores);
  const usuarios = idsAutores.map((id) => {
    const u = usuariosFilas.find((f) => num(f["id"]) === id);
    const l = loginsFilas.find((f) => num(f["id"]) === id);
    if (!u || !l) throw new Error(`El usuario ${id} no está en wp_users`);
    const bio = biosFilas.find((f) => num(f["id"]) === id);
    return { id, login: str(l["login"]), nicename: str(u["nicename"]), nombre: str(u["nombre"]), bio: bio ? ocultarCorreos(str(bio["bio"])) : null };
  });

  const cuentasSnap = (await leerCuentas(wp, cuentas.map((c) => c.wpUserId))).map((f) => ({ id: num(f["id"]), login: str(f["login"]), nombre: str(f["nombre"]) })).sort(porId);

  // Adjuntos referenciados: encabezado (_thumbnail_id), imágenes del cuerpo y imagen de Facebook.
  const mapaClaves = new Map((await leerAdjuntosPorClave(wp)).map((f) => [str(f["clave"]), num(f["id"])] as const));
  const idsAdj = new Set<number>();
  for (const m of meta) if (m.k === "_thumbnail_id" && /^\d+$/.test(m.v)) idsAdj.add(Number(m.v));
  for (const m of meta) if (m.k === "_webdados_fb_open_graph_specific_image" && m.v.trim()) { const a = adjuntoDeUrl(m.v.trim(), mapaClaves); if (a) idsAdj.add(a.id); }
  for (const p of posts) {
    const contenido = idsFixture.has(p.id) ? fixture.find((f) => f.id === p.id)!.contenido_crudo : p.contenido!;
    for (const im of convertWpContent(contenido).assets.images) { const a = adjuntoDeUrl(im.url, mapaClaves); if (a) idsAdj.add(a.id); }
  }
  const detalle = await detalleAdjuntos(wp, [...idsAdj].sort((a, b) => a - b));
  const adjuntos: AdjuntoSnapshot[] = [...detalle.values()].map((d) => ({
    id: d.id, tipoPost: d.tipoPost, mime: d.tipoMime, guid: d.guid, clave: d.clave, alt: d.alt || null, ancho: d.ancho, alto: d.alto, bytes: d.bytes,
  })).sort(porId);

  const snapshot: SnapshotWp = {
    version: 1,
    opciones: { gmt_offset: opcion("gmt_offset"), permalink_structure: opcion("permalink_structure"), timezone_string: opcion("timezone_string") },
    posts, meta, terminos, usuarios, adjuntos, cuentas: cuentasSnap,
  };
  // UTF-8 sin BOM, sangría de 2 y LF
  writeFileSync(SALIDA, JSON.stringify(snapshot, null, 2) + "\n", { encoding: "utf8" });
  console.log(`Snapshot: ${posts.length} posts, ${meta.length} meta, ${terminos.length} términos, ${usuarios.length} usuarios, ${adjuntos.length} adjuntos, ${cuentasSnap.length} cuentas -> ${SALIDA}`);
} finally {
  await cerrar();
}
