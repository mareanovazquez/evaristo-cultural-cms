import { ErrorApi, pedirApi } from "./api";

/**
 * Elimina un borrador (solo el administrador). Pregunta antes; y si el borrador ya estuvo publicado, explica que su dirección en el sitio deja de
 * funcionar para siempre y pide una segunda confirmación. Devuelve true si se eliminó, false si la persona se arrepintió. Los errores salen como ErrorApi.
 */
export async function eliminarArticulo(id: number, titulo: string): Promise<boolean> {
  if (!window.confirm(`¿Eliminar el borrador «${titulo}»? No se puede deshacer. Las imágenes quedan en la biblioteca.`)) return false;
  try {
    await pedirApi(`/api/admin/articulos/${id}`, { metodo: "DELETE" });
    return true;
  } catch (e) {
    if (!(e instanceof ErrorApi) || e.codigo !== "estuvo_publicado") throw e;
    const direccion = typeof e.extra["direccion"] === "string" ? e.extra["direccion"] : "su dirección";
    const n = typeof e.extra["redirecciones"] === "number" ? e.extra["redirecciones"] : 0;
    const redirecciones = n > 0 ? ` También dejan de funcionar ${n === 1 ? "1 redirección" : `${n} redirecciones`} que llevaban a él.` : "";
    if (!window.confirm(`«${titulo}» ya estuvo publicado. Si lo eliminás, ${direccion} deja de funcionar para siempre: quien tenga ese enlace va a ver una página de error.${redirecciones} ¿Querés eliminarlo igual?`)) return false;
    await pedirApi(`/api/admin/articulos/${id}?perderDireccion=1`, { metodo: "DELETE" });
    return true;
  }
}
