// Roles y permisos del panel (decidido el 22/10/2026). Un solo lugar compartido entre la API y el panel: cada permiso tiene nombre
// y se resuelve según el rol. Sumar un rol más adelante es cambiar esta tabla, no revisar todo el código.
// Con tres roles fijos no hace falta nada configurable (sin pantalla para crear roles).

export const ROLES = ["REDACTOR", "EDITOR", "ADMINISTRADOR"] as const;
export type Rol = (typeof ROLES)[number];

export const NOMBRE_DE_ROL: Record<Rol, string> = { REDACTOR: "Redactor", EDITOR: "Editor", ADMINISTRADOR: "Administrador" };

export const DESCRIPCION_DE_ROL: Record<Rol, string> = {
  REDACTOR: "Escribe y publica sus propios artículos, firmados con su ficha de autor.",
  EDITOR: "Edita y publica todos los artículos, y administra autores y la revisión de la migración.",
  ADMINISTRADOR: "Todo lo anterior, más usuarios, secciones y categorías.",
};

export const PERMISOS = [
  // Artículos: crear es de todos; ver, editar y publicar son de los propios (Redactor) o de todos.
  "articulos.crear",
  "articulos.gestionar.ajenos",
  "articulos.reasignar",
  // Biblioteca de imágenes: ver, usar y subir es de todos.
  "imagenes.borrar",
  // Autores
  "autores.elegir.cualquiera",
  "autores.crear",
  "autores.editar.ajenos",
  "autores.eliminar",
  // Secciones y categorías
  "clasificacion.gestionar",
  // Usuarios
  "usuarios.gestionar",
  // Herramientas de revisión de la migración
  "revision.usar",
] as const;
export type Permiso = (typeof PERMISOS)[number];

const DE_TODOS: Permiso[] = ["articulos.crear"];
const DE_EDITOR: Permiso[] = ["articulos.gestionar.ajenos", "articulos.reasignar", "imagenes.borrar", "autores.elegir.cualquiera", "autores.crear", "autores.editar.ajenos", "revision.usar"];
const DE_ADMINISTRADOR: Permiso[] = ["autores.eliminar", "clasificacion.gestionar", "usuarios.gestionar"];

const TABLA: Record<Rol, ReadonlySet<Permiso>> = {
  REDACTOR: new Set(DE_TODOS),
  EDITOR: new Set([...DE_TODOS, ...DE_EDITOR]),
  ADMINISTRADOR: new Set([...DE_TODOS, ...DE_EDITOR, ...DE_ADMINISTRADOR]),
};

export const esRol = (valor: unknown): valor is Rol => typeof valor === "string" && (ROLES as readonly string[]).includes(valor);

export const tienePermiso = (rol: Rol, permiso: Permiso): boolean => TABLA[rol].has(permiso);

/** Los permisos de un rol, para mandárselos al panel. */
export const permisosDe = (rol: Rol): Permiso[] => PERMISOS.filter((p) => TABLA[rol].has(p));
