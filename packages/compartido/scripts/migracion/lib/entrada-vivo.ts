// Arma la entrada de armar() leyendo en vivo de WordPress y del CMS (solo lectura, vía lib/leer-wordpress.ts).
// Es la contraparte de lib/entrada-snapshot.ts: las dos producen la misma forma de entrada.
import { cargarDatosVersionados } from "./entrada-snapshot.ts";
import type { EntradaArmar } from "./armar.ts";
import {
  detalleAdjuntos, leerAdjuntosPorClave, leerBios, leerCategoriasCms, leerMeta, leerOpciones, leerPosts, leerSeccionesCms, leerTerminos, leerUsuarios,
} from "./leer-wordpress.ts";
import type { Consulta } from "./leer-wordpress.ts";
import type { AdjuntoSnapshot, TerminoSnapshot } from "./snapshot-tipos.ts";
import { num, str } from "./utilidades.ts";

/** Con `soloIds` lee de WordPress únicamente esos artículos de la muestra (un subconjunto no arrastra los demás). */
export async function entradaEnVivo(wp: Consulta, bd: Consulta, soloIds?: readonly number[]): Promise<EntradaArmar> {
  const datos = cargarDatosVersionados();
  const ids = soloIds ? datos.ids.filter((id) => soloIds.includes(id)) : datos.ids;

  const opciones = await leerOpciones(wp);
  const opcion = (k: string) => str(opciones.find((o) => o["k"] === k)?.["v"]);

  const posts = (await leerPosts(wp, ids)).map((f) => ({
    id: num(f["id"]), tipo: str(f["tipo"]), estado: str(f["estado"]), autor: num(f["autor"]), nombre: str(f["nombre"]), titulo: str(f["titulo"]),
    fecha: str(f["fecha"]), fechaGmt: str(f["fechaGmt"]), contenido: str(f["contenido"]),
  }));

  const idsAutores = [...new Set(posts.map((p) => p.autor))];
  const filasUsuarios = await leerUsuarios(wp, idsAutores);
  const filasBio = await leerBios(wp, idsAutores);
  const usuarios = filasUsuarios.map((f) => {
    const bio = filasBio.find((b) => num(b["id"]) === num(f["id"]));
    return { id: num(f["id"]), login: "", nicename: str(f["nicename"]), nombre: str(f["nombre"]), bio: bio ? str(bio["bio"]) : null };
  });

  const meta = (await leerMeta(wp, ids)).map((f) => ({ metaId: num(f["metaId"]), postId: num(f["postId"]), k: str(f["k"]), v: str(f["v"]) }));

  const terminos: TerminoSnapshot[] = [
    ...(await leerTerminos(wp, "category", ids)).map((f) => ({ taxonomia: "category" as const, id: num(f["id"]), nombre: str(f["nombre"]), slug: str(f["slug"]) })),
    ...(await leerTerminos(wp, "post_tag", ids)).map((f) => ({ taxonomia: "post_tag" as const, id: num(f["id"]), nombre: str(f["nombre"]), slug: str(f["slug"]) })),
  ];

  // Detalle de los adjuntos de encabezado (la menor meta_id de _thumbnail_id de cada post)
  const idsThumb = new Set<number>();
  for (const id of ids) {
    const primera = meta.filter((m) => m.postId === id && m.k === "_thumbnail_id").sort((a, b) => a.metaId - b.metaId)[0];
    if (primera && Number.isInteger(Number(primera.v))) idsThumb.add(Number(primera.v));
  }
  const detalle = await detalleAdjuntos(wp, [...idsThumb]);
  const adjuntos: AdjuntoSnapshot[] = [...detalle.values()].map((d) => ({
    id: d.id, tipoPost: d.tipoPost, mime: d.tipoMime, guid: d.guid, clave: d.clave, alt: d.alt || null, ancho: d.ancho, alto: d.alto, bytes: d.bytes,
  }));

  const adjuntoPorClave = (await leerAdjuntosPorClave(wp)).map((f) => [str(f["clave"]), num(f["id"])] as const);

  return {
    ids, fixture: datos.fixture, extras: datos.extras, posts, meta, terminos, usuarios, adjuntos, adjuntoPorClave,
    opciones: { gmt_offset: opcion("gmt_offset"), permalink_structure: opcion("permalink_structure"), timezone_string: opcion("timezone_string") },
    cuentas: datos.cuentas, mapeo: datos.mapeo,
    seccionesExistentes: (await leerSeccionesCms(bd)).map((f) => str(f["slug"])),
    categoriasExistentes: (await leerCategoriasCms(bd)).map((f) => str(f["slug"])),
  };
}
