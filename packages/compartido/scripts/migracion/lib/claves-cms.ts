// Claves de imagen en el CMS (decisión 81, 4/11/2026). Pura: sin disco ni base.
//
// `imagenes.clave` es única con la colación utf8mb4_es_0900_ai_ci (no distingue mayúsculas ni tildes) y además es el nombre del archivo en una
// carpeta plana, que en Windows o macOS tampoco distingue mayúsculas. WordPress (Linux) tiene 45 pares de adjuntos que el CMS no distingue
// (`Tapa-libro.jpg` / `tapa-libro.jpg`, `Perón.jpg` / `peron.jpg`). En cada grupo, uno conserva su clave y los demás se importan con el sufijo
// `-wp<id del adjunto>` antes de la extensión (`Tapa-libro-wp270.jpg`). El nombre de WordPress se conserva en `imagenes.nombreOriginal`.

export interface AdjuntoConClave { id: number; clave: string }

/** La clave como la compara `imagenes.clave` (colación utf8mb4_es_0900_ai_ci): sin mayúsculas y sin acentos, pero la ñ sigue siendo distinta de la n. */
export function claveComparable(s: string): string {
  const d = s.normalize("NFD");
  let salida = "";
  for (let i = 0; i < d.length; i++) {
    const c = d[i]!;
    if (/\p{M}/u.test(c) && !(c === "̃" && /[nN]/.test(d[i - 1] ?? ""))) continue;
    salida += c;
  }
  return salida.normalize("NFC").toLowerCase();
}

/** `Tapa-libro.jpg` + 270 -> `Tapa-libro-wp270.jpg`; sin extensión, el sufijo va al final. Respeta la carpeta si la clave tiene una. */
export function claveConSufijo(clave: string, id: number): string {
  const barra = clave.lastIndexOf("/");
  const dir = clave.slice(0, barra + 1), nombre = clave.slice(barra + 1);
  const punto = nombre.lastIndexOf(".");
  return punto > 0 ? `${dir}${nombre.slice(0, punto)}-wp${id}${nombre.slice(punto)}` : `${dir}${nombre}-wp${id}`;
}

export interface ResultadoClavesCms {
  /** Solo los adjuntos renombrados: id -> clave en el CMS. Los demás conservan la de WordPress (en NFC). */
  renombradas: Map<number, string>;
  /** Grupos que el CMS no distingue, con quién conserva la clave. */
  grupos: Array<{ conserva: number; renombrados: number[]; claves: string[] }>;
  /** Una clave nueva que vuelve a chocar con otra: no se adivina otra. */
  errores: string[];
}

/**
 * Asigna la clave del CMS. En cada grupo de claves que el CMS no distingue conserva la suya el adjunto que elige `conserva` (por defecto, el de
 * id más bajo); `conserva` recibe los ids del grupo y devuelve uno de ellos.
 */
export function asignarClavesCms(adjuntos: readonly AdjuntoConClave[], conserva: (ids: number[]) => number = (ids) => Math.min(...ids)): ResultadoClavesCms {
  const r: ResultadoClavesCms = { renombradas: new Map(), grupos: [], errores: [] };
  const porComparable = new Map<string, AdjuntoConClave[]>();
  for (const a of adjuntos) { const k = claveComparable(a.clave); porComparable.set(k, [...(porComparable.get(k) ?? []), a]); }
  for (const g of porComparable.values()) {
    if (g.length < 2) continue;
    const ids = g.map((a) => a.id).sort((x, y) => x - y);
    const queda = conserva(ids);
    if (!ids.includes(queda)) { r.errores.push(`el grupo ${ids.join(", ")} no incluye al adjunto ${queda} que conservaría la clave`); continue; }
    const renombrados = ids.filter((id) => id !== queda);
    for (const a of g) if (a.id !== queda) r.renombradas.set(a.id, claveConSufijo(a.clave.normalize("NFC"), a.id));
    r.grupos.push({ conserva: queda, renombrados, claves: g.map((a) => a.clave) });
  }
  // Las claves nuevas no pueden chocar con ninguna otra (ni entre sí)
  const usadas = new Map<string, number>();
  for (const a of adjuntos) if (!r.renombradas.has(a.id)) usadas.set(claveComparable(a.clave), a.id);
  for (const [id, nueva] of r.renombradas) {
    const k = claveComparable(nueva), otro = usadas.get(k);
    if (otro !== undefined) r.errores.push(`la clave nueva «${nueva}» del adjunto ${id} choca con la del adjunto ${otro}`);
    else usadas.set(k, id);
  }
  return r;
}
