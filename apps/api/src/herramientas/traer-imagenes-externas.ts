// Baja las imágenes del cuerpo que apuntan a otros sitios y las guarda como imágenes del CMS (decisión 90). La lista de qué se baja y de
// dónde está fija en imagenes-externas.ts.
//
// Uso:
//   npm run imagenes:externas -w @evaristo/api -- --base-real --carpeta="<originales>"              (ensayo: baja y muestra, no guarda nada)
//   npm run imagenes:externas -w @evaristo/api -- --base-real --carpeta="<originales>" --escribir   (guarda; pide tipear el nombre de la base)
//   --base-dev    contra evaristo_cms_dev
//   --base-real   contra evaristo_cms. Con --escribir exige ESCRITURA_REAL_HABILITADA = true (ceremonia de la decisión 50) y una terminal
//                 interactiva. Antes: respaldo con mysqldump --result-file.
//   --carpeta     la carpeta de los originales que va a servir MEDIA_DIR; los archivos quedan ahí, con una clave nombre-<hash>.<ext>.
import { existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { ESCRITURA_REAL_HABILITADA, guardaDestino } from "@evaristo/compartido/destinos";
import { elegirBase } from "../entorno.js";
import { traerImagenesExternas } from "./imagenes-externas.js";

function salir(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

const base = elegirBase();
if (!base) salir("indicá la base: --base-dev (desarrollo) o --base-real (la real)");
const carpeta = process.argv.find((a) => a.startsWith("--carpeta="))?.slice("--carpeta=".length);
if (!carpeta || !existsSync(carpeta) || !statSync(carpeta).isDirectory()) salir('indicá la carpeta de los originales: --carpeta="<carpeta>" (tiene que existir)');
const escribir = process.argv.includes("--escribir");

if (base === "real") {
  try {
    guardaDestino(process.env["DATABASE_URL"]);
  } catch (e) {
    salir(e instanceof Error ? e.message : String(e));
  }
  if (escribir) {
    if (!ESCRITURA_REAL_HABILITADA) salir("la escritura en la base real está cerrada (ESCRITURA_REAL_HABILITADA = false). Ver la decisión 50.");
    if (!process.stdin.isTTY) salir("para escribir en la base real hace falta una terminal interactiva");
  }
}

console.log(`${escribir ? "ESCRITURA" : "Ensayo (no se guarda nada)"} en ${base === "real" ? "evaristo_cms (REAL)" : "evaristo_cms_dev"}; carpeta: ${carpeta}`);
const prisma = obtenerClientePrisma();
try {
  // Primero siempre el ensayo: si algo no se puede bajar, no se escribe nada.
  const ensayo = await traerImagenesExternas({ prisma, carpeta, escribir: false });
  console.log(`Artículos con imágenes externas: ${ensayo.articulos}; nodos: ${ensayo.nodos}; sin fuente revisada: ${ensayo.sinFuente.length}; no se pudieron bajar: ${ensayo.fallidas.length}`);
  for (const s of ensayo.sinFuente) console.log(`  sin fuente (no se toca): artículo ${s.articuloId} ${s.src.slice(0, 100)}`);
  if (!escribir) {
    console.log("Ensayo terminado. Para guardar, repetir con --escribir.");
  } else if (ensayo.nodos === 0) {
    console.log("No hay nada para hacer.");
  } else {
    if (ensayo.fallidas.length > 0) salir("alguna imagen no se pudo bajar; no se escribió nada");
    if (base === "real") {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const tipeado = await rl.question("Para escribir en 127.0.0.1:3308 tipeá el nombre de la base (evaristo_cms): ");
      rl.close();
      if (tipeado.trim() !== "evaristo_cms") salir("no coincide; no se escribió nada");
    }
    const r = await traerImagenesExternas({ prisma, carpeta, escribir: true, log: () => undefined });
    console.log(`Listo: ${r.imagenesCreadas} imágenes nuevas, ${r.imagenesReusadas} reusadas, ${r.articulosCambiados} artículos actualizados${r.saltados.length ? `, ${r.saltados.length} salteados (${r.saltados.map((s) => `${s.articuloId}: ${s.motivo}`).join("; ")})` : ""}.`);
    if (r.fallidas.length || r.saltados.length) process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
