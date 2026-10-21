import { SECCIONES } from "@evaristo/compartido/secciones";

// Rutas públicas provisorias: todavía no hay páginas de sección, de autores ni buscador.
// El esquema definitivo de URL del artículo y de sección se decide antes del paso 4.
export const urlSeccion = (slug: string): string => `/seccion/${slug}/`;
export const URL_AUTORES = "/autores/";

// Secciones del menú: las que no son internas, en el orden de la revista.
export const SECCIONES_MENU = SECCIONES.filter((s) => !s.interna);
// Cuántas se ven siempre en el header de escritorio; el resto va en "Más".
export const SECCIONES_VISIBLES = 6;
