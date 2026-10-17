// Recorre el grafo de imports relativos de un archivo (para los tests que comprueban qué módulos alcanza un programa).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function grafo(entrada: string) {
  const archivos = new Set<string>(), externos = new Set<string>(), generados = new Set<string>();
  const pendientes = [entrada];
  while (pendientes.length) {
    const f = pendientes.pop()!;
    if (archivos.has(f)) continue;
    archivos.add(f);
    const texto = readFileSync(f, "utf8");
    for (const m of texto.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)|(?:^|\n)\s*import\s+"([^"]+)"/g)) {
      const dest = m[1] ?? m[2] ?? m[3]!;
      if (!dest.startsWith(".")) { externos.add(dest); continue; }
      const ruta = resolve(dirname(f), dest);
      if (ruta.includes(`${join("src", "generated")}`)) { generados.add(ruta); continue; }
      if (existsSync(ruta)) pendientes.push(ruta);
      else throw new Error(`${f} importa ${dest}, que no existe`);
    }
  }
  return { archivos, externos, generados };
}
