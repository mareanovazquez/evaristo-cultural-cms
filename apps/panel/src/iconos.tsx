import type { ReactNode } from "react";

// Íconos del menú lateral: SVG propio, de trazo simple, que toma el color del texto. Son decorativos (el texto del enlace los nombra).

const TRAZOS = {
  articulos: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h6" /></>,
  autores: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.2c2.6.2 4.5 2 4.5 5.8" /></>,
  ficha: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6.5 16c.6-1.3 1.6-2 2.5-2s1.9.7 2.5 2M14 10h4M14 14h4" /></>,
  clasificacion: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2.5h8A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  revision: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="m9 13 2 2 4-4" /></>,
  usuarios: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><circle cx="12" cy="10" r="2" /><path d="M8.5 15.5c.8-1.4 2-2 3.5-2s2.7.6 3.5 2" /></>,
  cuenta: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
  salir: <><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" /><path d="M16 8l4 4-4 4M20 12H9" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  cerrar: <path d="M6 6l12 12M18 6 6 18" />,
  plegar: <path d="m13 7-5 5 5 5M19 7l-5 5 5 5" />,
  chevronArriba: <path d="m6 14 6-6 6 6" />,
} satisfies Record<string, ReactNode>;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, clase = "icono" }: { nombre: NombreIcono; clase?: string }) {
  return (
    <svg className={clase} viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {TRAZOS[nombre]}
    </svg>
  );
}
