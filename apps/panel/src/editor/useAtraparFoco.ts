import { useEffect } from 'react'

// Manejo del foco de las ventanas (nota al pie, imagen, video, biblioteca), para quien usa el teclado o un lector de pantalla:
//  - al abrirse, el foco pasa a la ventana (si todavía no está adentro);
//  - Tab y Mayús+Tab dan la vuelta dentro de la ventana de arriba, sin salir a la página de atrás;
//  - al cerrarse, el foco vuelve a lo que lo tenía antes.
// Si hay dos ventanas apiladas (el selector de imágenes sobre el diálogo de imagen), actúa sobre la última del documento.

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

const ventanaDeArriba = (): HTMLElement | null => {
  const ventanas = document.querySelectorAll<HTMLElement>('.modal-overlay')
  return ventanas.length > 0 ? ventanas[ventanas.length - 1]! : null
}

const enfocables = (ventana: HTMLElement): HTMLElement[] => Array.from(ventana.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true')

export function useAtraparFoco(activo: boolean): void {
  useEffect(() => {
    if (!activo) return
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Foco inicial: el primer elemento útil (no el botón de cerrar), una vez que la ventana ya está en el documento.
    // Se reintenta unos instantes: el comando focus() de TipTap devuelve el foco al editor un momento después (usa requestAnimationFrame)
    // y, como la ventana tapa toda la página, nadie más pudo haberlo movido a propósito.
    const llevarFoco = () => {
      const ventana = ventanaDeArriba()
      if (!ventana || ventana.contains(document.activeElement)) return
      const lista = enfocables(ventana)
      ;(lista.find((el) => !el.classList.contains('btn-close')) ?? lista[0])?.focus()
    }
    const intentos = [0, 50, 150, 300].map((ms) => setTimeout(llevarFoco, ms))

    const alApretar = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const ventana = ventanaDeArriba()
      if (!ventana) return
      const lista = enfocables(ventana)
      if (lista.length === 0) return
      const primero = lista[0]!
      const ultimo = lista[lista.length - 1]!
      const actual = document.activeElement
      if (!ventana.contains(actual)) {
        e.preventDefault()
        primero.focus()
      } else if (e.shiftKey && actual === primero) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && actual === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alApretar)

    return () => {
      intentos.forEach(clearTimeout)
      document.removeEventListener('keydown', alApretar)
      // Al cerrarse, el foco vuelve a donde estaba (si ese elemento sigue en la página).
      if (anterior && document.contains(anterior)) anterior.focus()
    }
  }, [activo])
}
