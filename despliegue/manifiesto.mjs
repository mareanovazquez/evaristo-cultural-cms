// Manifiesto SHA-256 de una carpeta, en el formato de `sha256sum` («hash  ruta/relativa», con barras /), para comprobar que una carpeta
// llegó entera y sin cambios a otra máquina (la de los originales, al subirla al servidor).
//
// En la Lenovo:   node despliegue/manifiesto.mjs "<carpeta>" "<archivo de salida>"
//                 (en PowerShell, con el segundo argumento y no con «>», que guarda en UTF-16 y sha256sum no lo lee)
// En el servidor: cd /srv/evaristo/datos/originales && sha256sum --check --quiet /ruta/a/originales.sha256
//                 (sin salida y código 0: todo igual; si algo falta o cambió, lo nombra)
//
// Sin dependencias. Los nombres van tal cual (UTF-8), así también se comprueba que las tildes llegaron bien. Ordenado por ruta.
// Sin archivo de salida, escribe en la salida estándar (para Linux o Git Bash).
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const [carpeta, salida] = process.argv.slice(2);
if (!carpeta) {
  console.error('Uso: node despliegue/manifiesto.mjs "<carpeta>" ["<archivo de salida>"]');
  process.exit(2);
}

function* recorrer(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) yield* recorrer(ruta);
    else if (e.isFile()) yield ruta;
  }
}

const hashDe = (ruta) =>
  new Promise((resolver, rechazar) => {
    const h = createHash("sha256");
    createReadStream(ruta).on("data", (d) => h.update(d)).on("end", () => resolver(h.digest("hex"))).on("error", rechazar);
  });

const archivos = [...recorrer(carpeta)].map((r) => ({ ruta: r, rel: relative(carpeta, r).split(sep).join("/") }));
archivos.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
const lineas = [];
for (const a of archivos) {
  if (/[\n\\]/.test(a.rel)) {
    console.error(`No se puede poner en el manifiesto (salto de línea o barra invertida en el nombre): ${a.rel}`);
    process.exit(1);
  }
  lineas.push(`${await hashDe(a.ruta)}  ${a.rel}\n`);
}
if (salida) writeFileSync(salida, lineas.join(""), "utf8");
else process.stdout.write(lineas.join(""));
console.error(`${archivos.length} archivos en el manifiesto${salida ? `: ${salida}` : ""}.`);
