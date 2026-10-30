// Rutas del menú. Las de artículo, autor y sección viven en @evaristo/compartido/urls.
export { rutaSeccion as urlSeccion } from "@evaristo/compartido/urls";
export const URL_AUTORES = "/autores/";

// Cuántas secciones se ven siempre en el header de escritorio, además del enlace a «Novedades» (que va primero); el resto va en "Más".
// El orden de las secciones lo define el administrador desde el panel (decisión 78: Entrevista, Reseña, Ensayo y Crónica; luego Crítica, Rastros, Asia y Textos en «Más»).
export const SECCIONES_VISIBLES = 4;
