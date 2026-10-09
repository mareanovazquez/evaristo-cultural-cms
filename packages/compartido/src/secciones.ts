export interface DatosSeccion {
  slug: string;
  nombre: string;
  interna: boolean;
}

// Secciones de la revista, en el orden en que se muestran. Las internas no se eligen en el panel.
export const SECCIONES: readonly DatosSeccion[] = [
  { slug: "entrevista", nombre: "Entrevista", interna: false },
  { slug: "resena", nombre: "Reseña", interna: false },
  { slug: "ensayo", nombre: "Ensayo", interna: false },
  { slug: "cronica", nombre: "Crónica", interna: false },
  { slug: "critica", nombre: "Crítica", interna: false },
  { slug: "rastros", nombre: "Rastros", interna: false },
  { slug: "asia", nombre: "Asia", interna: false },
  { slug: "poesia", nombre: "Poesía", interna: false },
  { slug: "teatro", nombre: "Teatro", interna: false },
  { slug: "musica", nombre: "Música", interna: false },
  { slug: "historieta", nombre: "Historieta", interna: false },
  { slug: "tv-y-cine", nombre: "TV & Cine", interna: false },
  { slug: "fantastico", nombre: "Fantástico", interna: false },
  { slug: "arte", nombre: "Arte", interna: false },
  { slug: "infantojuvenil", nombre: "Infantojuvenil", interna: false },
  { slug: "libro-ilustrado", nombre: "Libro Ilustrado", interna: false },
  { slug: "literatura", nombre: "Literatura", interna: false },
  { slug: "sin-asignar", nombre: "Sin asignar", interna: true },
];
