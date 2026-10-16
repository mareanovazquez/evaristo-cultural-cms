// Forma del snapshot de WordPress de la muestra (datos/migracion/snapshot-wp-muestra.json). Solo tipos: lo escribe
// scripts/migracion/generar-snapshot-wp.ts y lo lee lib/entrada-snapshot.ts. No contiene datos personales de usuarios
// (nada de email, contraseña, url, clave de activación ni fechas de registro).

export interface PostSnapshot {
  id: number;
  tipo: string;
  /** post_status */
  estado: string;
  /** post_author */
  autor: number;
  /** post_name crudo (con percent-encoding, tal cual está en WordPress) */
  nombre: string;
  /** post_title */
  titulo: string;
  /** post_date (hora local de WordPress), "YYYY-MM-DD HH:MM:SS" */
  fecha: string;
  /** post_date_gmt, "YYYY-MM-DD HH:MM:SS" ("0000-00-00 00:00:00" si no tiene) */
  fechaGmt: string;
  /** post_content: solo en los artículos que NO están en la fixture de la muestra */
  contenido?: string;
}

export interface MetaSnapshot { metaId: number; postId: number; k: string; v: string }
export interface TerminoSnapshot { taxonomia: "category" | "post_tag"; id: number; nombre: string; slug: string }
export interface UsuarioSnapshot { id: number; login: string; nicename: string; nombre: string; bio: string | null }

export interface AdjuntoSnapshot {
  id: number;
  /** post_type del adjunto ("attachment") */
  tipoPost: string;
  /** post_mime_type */
  mime: string;
  guid: string;
  /** _wp_attached_file */
  clave: string | null;
  /** _wp_attachment_image_alt */
  alt: string | null;
  /** Ancho, alto y tamaño que WordPress declara en _wp_attachment_metadata (no son medidas verificadas). */
  ancho: number | null;
  alto: number | null;
  bytes: number | null;
}

export interface CuentaSnapshot { id: number; login: string; nombre: string }

export interface SnapshotWp {
  version: 1;
  opciones: { gmt_offset: string; permalink_structure: string; timezone_string: string };
  posts: PostSnapshot[];
  meta: MetaSnapshot[];
  terminos: TerminoSnapshot[];
  usuarios: UsuarioSnapshot[];
  adjuntos: AdjuntoSnapshot[];
  cuentas: CuentaSnapshot[];
}
