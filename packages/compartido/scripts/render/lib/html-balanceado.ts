// Comprobador simple de etiquetas balanceadas para el HTML que produce el renderizador.
// Respeta los elementos vacíos (br, img, use...). Devuelve la lista de problemas; vacía si todo cierra bien.
const VACIOS = new Set(["br", "img", "use", "hr", "input", "meta", "link", "source", "wbr", "col", "path", "polyline"]);
const ETIQUETA = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

export function problemasDeEtiquetas(html: string): string[] {
  const problemas: string[] = [];
  const pila: string[] = [];
  for (const m of html.matchAll(ETIQUETA)) {
    const cierra = m[1] === "/";
    const nombre = (m[2] ?? "").toLowerCase();
    const autocierre = (m[3] ?? "").trimEnd().endsWith("/");
    if (VACIOS.has(nombre) || autocierre) {
      if (cierra) problemas.push(`cierre de elemento vacío </${nombre}>`);
      continue;
    }
    if (!cierra) {
      pila.push(nombre);
    } else if (pila[pila.length - 1] === nombre) {
      pila.pop();
    } else {
      problemas.push(`</${nombre}> no corresponde con <${pila[pila.length - 1] ?? "nada"}> abierta`);
      const i = pila.lastIndexOf(nombre);
      if (i >= 0) pila.length = i;
    }
  }
  for (const abierta of pila) problemas.push(`<${abierta}> sin cerrar`);
  // Un "<" o ">" suelto fuera de las etiquetas indica texto sin escapar.
  if (/[<>]/.test(html.replace(ETIQUETA, ""))) problemas.push("hay un < o > sin escapar fuera de las etiquetas");
  return problemas;
}
