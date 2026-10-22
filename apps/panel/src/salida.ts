import { useEffect } from "react";

// Aviso antes de salir de una pantalla con cambios sin guardar.
//  - Cerrar o recargar la pestaña: el aviso propio del navegador (beforeunload).
//  - Los enlaces del panel y el botón Salir: una pregunta antes de irse. (BrowserRouter no permite frenar el botón Atrás del navegador:
//    ahí el respaldo es el autoguardado.)

const MENSAJE = "Hay cambios sin guardar. Si salís ahora se pueden perder. ¿Querés salir igual?";

const estado = { haySinGuardar: false };

/** Pregunta si se puede salir. Verdadero si no hay nada sin guardar o si la persona confirma. */
export function confirmarSalida(): boolean {
  return !estado.haySinGuardar || window.confirm(MENSAJE);
}

export function useAvisarAlSalir(hayCambios: boolean): void {
  useEffect(() => {
    estado.haySinGuardar = hayCambios;
    if (!hayCambios) return;

    const antesDeCerrar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // En la fase de captura, para llegar antes que el enrutador y poder frenar el cambio de pantalla.
    const alHacerClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const enlace = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!enlace || enlace.getAttribute("target") === "_blank" || enlace.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(MENSAJE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", antesDeCerrar);
    document.addEventListener("click", alHacerClic, true);
    return () => {
      estado.haySinGuardar = false;
      window.removeEventListener("beforeunload", antesDeCerrar);
      document.removeEventListener("click", alHacerClic, true);
    };
  }, [hayCambios]);
}
