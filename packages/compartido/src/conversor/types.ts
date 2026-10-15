/**
 * Tipos del conversor. Los nodos siguen el documento JSON de TipTap/ProseMirror
 * que usa el editor del CMS (ver especificacion-stack.md, sección 6).
 */

import type { TaxonomiaResuelta } from './taxonomia.ts'

export type Mark = { type: 'bold' | 'italic' | 'link'; attrs?: { href: string } }

export interface DocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  marks?: Mark[]
  text?: string
}

/** Un tipo de aviso, con cuántas veces ocurrió en el artículo y unos ejemplos. */
export interface Warning {
  code: string
  count: number
  ejemplos: string[]
}

export interface ImageAsset {
  /** URL que quedó en el nodo de imagen (el original si la imagen enlazaba a él). */
  url: string
  /** URL del <img> tal como estaba, si difiere de `url`. */
  miniatura?: string
}

export interface ConvertResult {
  doc: DocNode
  /** Párrafos de bio que se sacaron del cuerpo (solo si estaban tras un <hr>). */
  bio: DocNode[] | null
  warnings: Warning[]
  assets: {
    images: ImageAsset[]
    /** Enlaces a otros artículos del mismo sitio, para reescribir luego. */
    internalLinks: string[]
  }
  /** Contadores de lo que se convirtió o se descartó. */
  stats: Record<string, number>
}

/** Resultado de convertir un artículo completo: el cuerpo (sin cambios) más el título normalizado. */
export interface ConvertPostResult extends ConvertResult {
  /** Título normalizado ("" si el artículo no tiene título). */
  titulo: string
  /** Bajada normalizada ("" si no hay). */
  bajada: string
  /** Avisos del título (mismos códigos que la planilla de revisión); no son avisos del cuerpo. */
  avisosTitulo: string[]
  /** Sección nueva (slug; "sin-asignar" si no hay candidata); null si no se pasó `taxonomia`. */
  seccion: string | null
  /** Categorías nuevas (slugs), sin repetir la sección. */
  categorias: string[]
  /** Categoría principal (volanta): una de `categorias`, o null si no tiene; null también si no se pasó `taxonomia`. */
  categoriaPrincipal: string | null
  /** Detalle de la resolución (candidatas, descartes, sin mapear); null si no se pasó `taxonomia`. */
  taxonomia: TaxonomiaResuelta | null
  /** Hasta cuándo el artículo cuenta como novedad (ISO); los migrados arrancan en null. */
  novedadHasta: string | null
}

export interface ConvertOptions {
  /** Dominios propios del sitio viejo, para detectar enlaces internos. */
  siteHosts?: string[]
}
