// Genera datos/redirecciones/etiquetas-wp.json: las etiquetas de WordPress (slug → nombre), para redirigir /tag/<slug>/ al buscador
// (decidido con Mariano el 7/11/2026). Solo lee WordPress (sesión READ ONLY). Uso, con la 3307 levantada:
//   npx tsx --env-file=../../.env scripts/migracion/generar-etiquetas-wp.ts [--wordpress=evaristo_lectura_nueva]
// No se vuelve a correr salvo que cambie la base de WordPress (la descarga del 31/10/2026 es la definitiva).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirSoloWordPress, BASES_WORDPRESS, T } from "./lib/leer-wordpress.ts";
import { decEntidades, decodificar } from "./lib/utilidades.ts";

const base = process.argv.find((a) => a.startsWith("--wordpress="))?.slice("--wordpress=".length) ?? "evaristo_lectura_nueva";
if (!BASES_WORDPRESS.includes(base)) throw new Error(`Base de WordPress no permitida: ${base}`);
const destino = fileURLToPath(new URL("../../datos/redirecciones/etiquetas-wp.json", import.meta.url));

const { wp, cerrar } = await abrirSoloWordPress(base);
const filas = await wp(
  `SELECT t.slug AS slug, t.name AS nombre FROM ${T("terms")} t JOIN ${T("term_taxonomy")} tt ON tt.term_id = t.term_id WHERE tt.taxonomy = 'post_tag' ORDER BY t.slug`,
);
await cerrar();

// El slug se guarda decodificado (WordPress guarda los no ASCII como %xx) y el nombre sin entidades HTML.
const etiquetas: Record<string, string> = {};
for (const f of filas) {
  const slug = decodificar(String(f["slug"])).normalize("NFC");
  // Sin el guion blando (U+00AD), que es invisible y no ayuda al buscador.
  const nombre = decEntidades(String(f["nombre"])).replace(/­/g, "").replace(/\s+/g, " ").trim();
  if (slug && nombre && !(slug in etiquetas)) etiquetas[slug] = nombre;
}
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, `${JSON.stringify({ fuente: `${base} (wp_terms, taxonomía post_tag)`, generado: new Date().toISOString().slice(0, 10), etiquetas }, null, 0)}\n`, "utf8");
console.log(`${Object.keys(etiquetas).length} etiquetas en ${destino}`);
