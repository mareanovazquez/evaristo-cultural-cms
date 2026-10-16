// Comprobación A MANO (no forma parte de la suite): arma el Plan con la entrada del snapshot y con la lectura en vivo de
// WordPress y del CMS, y dice si son IGUALES para los 35. Solo lectura (lib/leer-wordpress.ts).
//
// Una sola diferencia es esperada y se neutraliza en ambos lados: el snapshot reemplaza por "[correo omitido]" las
// direcciones de correo que un autor escribió dentro de su bio, así que la bio en vivo pasa por la misma función antes de armar.
//
// Uso: npx tsx scripts/migracion/comparar-snapshot-vivo.ts   (desde packages/compartido)
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { armar } from "./lib/armar.ts";
import { entradaDesdeSnapshot } from "./lib/entrada-snapshot.ts";
import { entradaEnVivo } from "./lib/entrada-vivo.ts";
import { abrirConexiones } from "./lib/leer-wordpress.ts";
import { ocultarCorreos } from "./lib/utilidades.ts";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const { wp, bd, cerrar } = await abrirConexiones();
try {
  const vivo = await entradaEnVivo(wp, bd);
  vivo.usuarios = vivo.usuarios.map((u) => ({ ...u, bio: u.bio === null ? null : ocultarCorreos(u.bio) }));
  const snapshot = entradaDesdeSnapshot({ seccionesExistentes: vivo.seccionesExistentes, categoriasExistentes: vivo.categoriasExistentes });

  const a = JSON.parse(JSON.stringify(armar(snapshot)));
  const b = JSON.parse(JSON.stringify(armar(vivo)));
  const difs: string[] = [];
  const cmp = (x: any, y: any, ruta: string) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) cmp(x[k], y[k], `${ruta}.${k}`);
      return;
    }
    difs.push(`${ruta}\n    snapshot: ${JSON.stringify(x)?.slice(0, 200)}\n    en vivo:  ${JSON.stringify(y)?.slice(0, 200)}`);
  };
  cmp(a, b, "plan");
  console.log(`Artículos: snapshot ${a.articulos.length}, en vivo ${b.articulos.length}; redirecciones: ${a.redirecciones.length} / ${b.redirecciones.length}; autores: ${a.autores.length} / ${b.autores.length}`);
  if (difs.length) { console.log(`DIFERENCIAS (${difs.length}):`); for (const d of difs) console.log("-", d); process.exitCode = 1; }
  else console.log("IGUALES: el Plan armado desde el snapshot coincide con el armado desde la lectura en vivo.");
} finally {
  await cerrar();
}
