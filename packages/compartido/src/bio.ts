import { isAllowedUrl, type JSONNode } from "./schema/validate.ts";

// Bio de un autor (decidido el 23/10/2026): párrafos con itálica y enlaces, sin negrita, listas ni títulos, hasta 500 caracteres.
// La usan la API (valida), el panel (contador) y el sitio dibuja el mismo documento con el renderizador del cuerpo.

export const BIO_MAX = 500;

/** Cantidad de caracteres de texto de la bio (lo que cuenta el contador del panel). */
export function largoDeBio(doc: JSONNode | null | undefined): number {
  const contar = (n: JSONNode): number => (n.type === "text" ? (n.text ?? "").length : (n.content ?? []).reduce((suma, h) => suma + contar(h), 0));
  return doc ? contar(doc) : 0;
}

/** ¿La bio tiene algo escrito? */
export const bioConTexto = (doc: JSONNode | null | undefined): boolean => {
  const hay = (n: JSONNode): boolean => (n.type === "text" ? (n.text ?? "").trim() !== "" : (n.content ?? []).some(hay));
  return doc ? hay(doc) : false;
};

/** Problemas de forma de una bio, en lenguaje común. No mira el largo (eso lo decide quien la guarda: una bio migrada puede pasarse). */
export function problemasDeFormaDeBio(doc: unknown): string[] {
  const problemas: string[] = [];
  if (typeof doc !== "object" || doc === null || (doc as JSONNode).type !== "doc" || !Array.isArray((doc as JSONNode).content)) return ["La bio no tiene el formato esperado."];
  for (const parrafo of (doc as JSONNode).content ?? []) {
    if (parrafo.type !== "paragraph") {
      problemas.push("La bio solo admite párrafos, sin listas ni títulos.");
      continue;
    }
    for (const nodo of parrafo.content ?? []) {
      if (nodo.type !== "text") {
        problemas.push("La bio solo admite texto, con itálica y enlaces.");
        continue;
      }
      for (const marca of nodo.marks ?? []) {
        if (marca.type === "link") {
          if (!isAllowedUrl(marca.attrs?.["href"])) problemas.push("Hay un enlace que no es válido. Solo se admiten direcciones que empiecen con http://, https:// o mailto:.");
        } else if (marca.type !== "italic") {
          problemas.push("La bio solo admite itálica y enlaces (sin negrita).");
        }
      }
    }
  }
  return [...new Set(problemas)];
}
