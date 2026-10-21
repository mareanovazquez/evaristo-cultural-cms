// Texto plano del cuerpo de un artículo, para el buscador. Función pura: la usan la migración y la API del panel.
// (Antes vivía en scripts/migracion/lib/utilidades.ts, que sigue exportándola.)
import type { DocNode } from "./conversor/types.ts";

/**
 * Texto plano del cuerpo, para el buscador: función pura del documento (el mismo cuerpo da siempre el mismo texto). Una línea por unidad de texto, unidas con "\n".
 *  - Dentro de un párrafo o título los nodos de texto adyacentes se unen SIN separador, tengan o no marcas ("pa" + negrita "la" + "bra" = "palabra").
 *  - Se separan con "\n": párrafos, títulos, ítems de lista, los párrafos de ítems, celdas, filas y citas, los saltos de línea (hardBreak) y cada epígrafe.
 *  - El contenido de una nota al pie se mete con espacios en el lugar de la nota, sin partir la línea del párrafo que la lleva.
 *  - Incluye el texto de los nodos y, de los atributos, solo lo que el lector ve como texto del artículo: el epígrafe de la imagen (attrs.epigrafe, justo
 *    después de la imagen) y el autor y la fuente de la cita (attrs.autor y attrs.fuente, después de sus párrafos).
 *  - No incluye el alt de la imagen (describe la imagen para accesibilidad, no es texto del artículo), ni href de enlaces, ni datos del video, ni niveles ni variantes.
 *  - Cada línea sale sin espacios al principio ni al final y con los espacios internos colapsados; las líneas vacías se descartan (nunca hay "\n\n").
 */
export function textoPlanoDe(doc: DocNode): string {
  const lineas: string[] = [];
  let actual = "";
  const cerrar = () => { const l = actual.replace(/\s+/g, " ").trim(); if (l) lineas.push(l); actual = ""; };
  const linea = (s: unknown) => { cerrar(); if (typeof s === "string") actual = s; cerrar(); };
  const enLinea = (n: DocNode) => {
    if (n.type === "hardBreak") cerrar();
    else if (n.type === "footnote") {
      const c = n.attrs?.["content"] as DocNode | undefined;
      actual += ` ${c ? textoPlanoDe(c).replace(/\n/g, " ") : ""} `;
    } else if (typeof n.text === "string") actual += n.text;
    else for (const h of n.content ?? []) enLinea(h);
  };
  const bloque = (n: DocNode) => {
    switch (n.type) {
      case "paragraph": case "heading": cerrar(); for (const h of n.content ?? []) enLinea(h); cerrar(); break;
      case "imagen": linea(n.attrs?.["epigrafe"]); break;
      case "cita": cerrar(); for (const h of n.content ?? []) bloque(h); linea(n.attrs?.["autor"]); linea(n.attrs?.["fuente"]); break;
      case "video": case "hardBreak": cerrar(); break;
      default:
        if (typeof n.text === "string") { actual += n.text; cerrar(); }
        else for (const h of n.content ?? []) bloque(h);
    }
  };
  bloque(doc);
  cerrar();
  return lineas.join("\n");
}
