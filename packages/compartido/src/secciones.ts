export interface DatosSeccion {
  slug: string;
  nombre: string;
  interna: boolean;
}

// Secciones de la revista (formatos, históricas y Textos, el comodín de lo que no tiene formato; decisión 78), en el orden en que se muestran. Las internas no se eligen en el panel.
export const SECCIONES: readonly DatosSeccion[] = [
  { slug: "entrevista", nombre: "Entrevista", interna: false },
  { slug: "resena", nombre: "Reseña", interna: false },
  { slug: "ensayo", nombre: "Ensayo", interna: false },
  { slug: "cronica", nombre: "Crónica", interna: false },
  { slug: "critica", nombre: "Crítica", interna: false },
  { slug: "rastros", nombre: "Rastros", interna: false },
  { slug: "asia", nombre: "Asia", interna: false },
  { slug: "textos", nombre: "Textos", interna: false },
  { slug: "sin-asignar", nombre: "Sin asignar", interna: true },
];
