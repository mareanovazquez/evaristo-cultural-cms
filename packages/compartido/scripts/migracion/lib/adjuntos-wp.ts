// Lectura de los adjuntos de WordPress en la 3307 (127.0.0.1, sesión READ ONLY, solo SELECT). La usan `verificar-descarga` y `extraer-originales`.
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../../src/generated/prisma/client.js";
import { consultar, metadatosAdjunto, SOLO_LECTURA, type Consulta, type Fila } from "./leer-wordpress.ts";
import { num, str } from "./utilidades.ts";
import { derivadasDeMetadatos, tamanosDeMetadatos, type AdjuntoWp } from "./verificar-descarga.ts";

/** Abre la base de WordPress de la 3307 en solo lectura; aborta si la sesión no quedó READ ONLY. */
export async function abrirWordPress(base: string): Promise<{ wp: Consulta; cerrar: () => Promise<void> }> {
  const cliente = new PrismaClient({ adapter: new PrismaMariaDb({ host: "127.0.0.1", port: 3307, user: "root", database: base, connectionLimit: 2, initSql: SOLO_LECTURA }) });
  const wp: Consulta = (sql, ...p) => consultar(cliente, sql, ...p);
  const [{ ro }] = (await wp("SELECT @@session.transaction_read_only AS ro")) as [Fila];
  if (num(ro) !== 1) { await cliente.$disconnect(); throw new Error("La sesión no está en solo lectura: se aborta"); }
  return { wp, cerrar: () => cliente.$disconnect() };
}

/** Los adjuntos de WordPress con su `_wp_attached_file`, el tamaño, el ancho y el alto declarados y las derivadas que declaran. */
export async function leerAdjuntos(wp: Consulta, prefijo: string): Promise<AdjuntoWp[]> {
  const filas: Fila[] = await wp(`SELECT post_id AS id, meta_key AS k, meta_value AS v FROM \`${prefijo}postmeta\` WHERE meta_key IN ('_wp_attached_file','_wp_attachment_metadata')`);
  const claves = new Map<number, string>(), metas = new Map<number, string>();
  for (const f of filas) (str(f["k"]) === "_wp_attached_file" ? claves : metas).set(num(f["id"]), str(f["v"]));
  const adjuntos: AdjuntoWp[] = [];
  for (const [id, clave] of claves) {
    if (!clave.trim()) continue;
    const meta = metas.get(id);
    const m = meta ? metadatosAdjunto(meta) : null;
    adjuntos.push({ id, clave, bytesDeclarados: m ? m.bytes : null, ancho: m ? m.ancho : null, alto: m ? m.alto : null, tamanos: meta ? tamanosDeMetadatos(meta, clave) : [], derivadas: meta ? derivadasDeMetadatos(meta, clave) : [] });
  }
  return adjuntos.sort((a, b) => a.id - b.id);
}
