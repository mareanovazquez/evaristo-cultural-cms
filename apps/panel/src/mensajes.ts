// Pasa los avisos técnicos de la API (validador del texto, formularios) a lenguaje común para mostrarlos a la editora.
// Los mensajes que la API ya escribe en lenguaje común (títulos, secciones, categorías, conflictos) pasan tal cual.

const REGLAS: Array<[RegExp, string]> = [
  [/^Imagen sin texto alternativo/, "Hay una imagen sin texto alternativo. Hacé clic en la imagen y completalo, o marcala como decorativa."],
  [/^Una imagen nueva no puede quedar con el texto alternativo pendiente/, "Hay una imagen nueva sin texto alternativo. Hacé clic en la imagen y completalo, o marcala como decorativa."],
  [/^Imagen con ruta relativa/, "Hay una imagen con una dirección que no sirve. Quitala y elegila de nuevo desde la biblioteca."],
  [/^imagenId|^altPendiente/, "Hay una imagen del texto mal vinculada a la biblioteca. Quitala y volvé a insertarla."],
  [/^Nota al pie vacía/, "Hay una nota al pie vacía. Escribí su texto o borrala."],
  [/^Enlace con protocolo/, "Hay un enlace que no es válido. Solo se admiten direcciones que empiecen con http://, https:// o mailto:."],
  [/^Video con/, "Hay un video que no es de YouTube ni de Vimeo, o cuyo enlace no es válido."],
  [/^Celda de tabla/, "La tabla tiene celdas combinadas o con contenido que no se admite. Usá una tabla simple."],
  [/^Nivel de título/, "Solo se admiten títulos de nivel 2, 3 y 4."],
  [/^Marca de formato no permitida/, "Hay un formato de texto que no se admite. Solo se permiten negrita, cursiva y enlaces."],
  [/vacío en /, "Hay un bloque vacío en el texto (por ejemplo una lista, una cita o un título sin contenido). Completalo o borralo."],
  // Lo que queda del validador del texto (nodos, estructura): se muestra una sola vez, sin rutas técnicas.
  [/^(Nodo|Texto vacío|Video|<)|content\[|doc\./, "Hay algo en el texto que no tiene el formato esperado. Probá deshacer lo último que agregaste o pegaste."],
  // Mensajes por defecto de zod (en inglés) que escaparon a la validación en español de la API.
  [/^(Invalid|Too small|Too big|Unrecognized|Required|Expected)/i, "Hay un dato del formulario con un valor que no se acepta. Revisá los campos."],
];

export function lenguajeComun(problema: string): string {
  for (const [patron, texto] of REGLAS) if (patron.test(problema)) return texto;
  return problema;
}

/** Los problemas de una respuesta 422 en lenguaje común, sin repetidos. */
export function problemasEnLenguajeComun(problemas: string[]): string[] {
  return [...new Set(problemas.map(lenguajeComun))];
}
