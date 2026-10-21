// Paginación de los listados de notas (autor, sección).
export const NOTAS_POR_PAGINA = 12;

/** Número de página pedido: entero desde 1; cualquier otra cosa vale 1. */
export function paginaPedida(valor: string | null): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export const cantidadDePaginas = (total: number): number => Math.max(1, Math.ceil(total / NOTAS_POR_PAGINA));
