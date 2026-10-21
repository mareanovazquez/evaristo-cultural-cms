import { SECCIONES } from "@evaristo/compartido/secciones";

// Rutas del menú. Las de artículo, autor y sección viven en @evaristo/compartido/urls.
export { rutaSeccion as urlSeccion } from "@evaristo/compartido/urls";
export const URL_AUTORES = "/autores/";

// Secciones del menú: las que no son internas, en el orden de la revista.
export const SECCIONES_MENU = SECCIONES.filter((s) => !s.interna);
// Cuántas se ven siempre en el header de escritorio; el resto va en "Más".
export const SECCIONES_VISIBLES = 6;
