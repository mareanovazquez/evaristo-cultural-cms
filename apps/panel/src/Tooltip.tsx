import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";

// Tooltip: un texto corto que aparece al pasar el mouse (con una pequeña demora) o al llegar con el teclado (enseguida), y se va con Esc,
// al sacar el mouse o al salir del elemento. Pensado para los botones de solo ícono.
//  - Envuelve UN elemento, que recibe `aria-describedby` mientras el tooltip se ve. El nombre accesible del botón va aparte (`aria-label`).
//  - Va con posición fija: no lo recorta una tabla con desplazamiento ni un menú. Se coloca arriba del elemento (abajo si no hay lugar) y se
//    mantiene dentro de la pantalla.
//  - Funciona también con un botón deshabilitado: los eventos los recibe el envoltorio (el botón deshabilitado no deja pasar el mouse, ver `.boton-icono:disabled`).
//  - En pantallas táctiles aparece al tocar (el elemento recibe el foco) y se va al salir.

const DEMORA_MS = 300;
const SEPARACION = 6;
const MARGEN = 8;

export const tiemposTooltip = { demora: DEMORA_MS };

export function Tooltip({ texto, children }: { texto: string; children: ReactElement<{ "aria-describedby"?: string }> }) {
  const id = useId();
  const envoltorio = useRef<HTMLSpanElement>(null);
  const burbuja = useRef<HTMLSpanElement>(null);
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [visible, setVisible] = useState(false);
  const [estilo, setEstilo] = useState<CSSProperties>({ visibility: "hidden" });

  const mostrar = (conDemora: boolean) => {
    clearTimeout(reloj.current);
    if (conDemora) reloj.current = setTimeout(() => setVisible(true), tiemposTooltip.demora);
    else setVisible(true);
  };
  const ocultar = () => {
    clearTimeout(reloj.current);
    setVisible(false);
    setEstilo({ visibility: "hidden" });
  };
  useEffect(() => () => clearTimeout(reloj.current), []);

  // Coloca la burbuja una vez que se sabe cuánto mide.
  useLayoutEffect(() => {
    if (!visible || !envoltorio.current || !burbuja.current) return;
    const r = envoltorio.current.getBoundingClientRect();
    const b = burbuja.current.getBoundingClientRect();
    const arriba = r.top - b.height - SEPARACION;
    const top = arriba >= MARGEN ? arriba : r.bottom + SEPARACION;
    const left = Math.min(Math.max(r.left + r.width / 2 - b.width / 2, MARGEN), Math.max(MARGEN, window.innerWidth - b.width - MARGEN));
    setEstilo({ top, left, visibility: "visible" });
  }, [visible, texto]);

  // Esc lo cierra; al desplazar la pantalla o cambiar su tamaño también (quedaría mal ubicado).
  useEffect(() => {
    if (!visible) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") ocultar();
    };
    window.addEventListener("keydown", alTeclear);
    window.addEventListener("resize", ocultar);
    window.addEventListener("scroll", ocultar, true);
    return () => {
      window.removeEventListener("keydown", alTeclear);
      window.removeEventListener("resize", ocultar);
      window.removeEventListener("scroll", ocultar, true);
    };
  }, [visible]);

  return (
    <span ref={envoltorio} className="tooltip-envoltorio" onMouseEnter={() => mostrar(true)} onMouseLeave={ocultar} onFocus={() => mostrar(false)} onBlur={ocultar}>
      {cloneElement(children, visible ? { "aria-describedby": id } : {})}
      {visible && (
        <span ref={burbuja} id={id} role="tooltip" className="tooltip" style={estilo}>
          {texto}
        </span>
      )}
    </span>
  );
}
