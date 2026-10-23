import { useRef, type PointerEvent } from "react";
import { PROPORCION_ENCABEZADO } from "./api";

// Elegir el punto focal de la imagen de encabezado haciendo clic (o arrastrando) sobre la imagen entera.
// El sitio muestra el encabezado en un recuadro apaisado (PROPORCION_ENCABEZADO) y la parte marcada es la que no se corta.
// El archivo no se modifica: solo se guarda el punto (de 0 a 1 en cada eje). Los campos numéricos de la pantalla siguen siendo
// la alternativa para quien no usa el mouse o el dedo.

interface PuntoFocalProps {
  src: string;
  x: number;
  y: number;
  onCambio: (x: number, y: number) => void;
  /** Proporción del recuadro con el que el sitio muestra la imagen (por defecto, la del encabezado). */
  proporcion?: string;
  /** Explicación sobre cómo se muestra (por defecto, la del encabezado). */
  ayuda?: string;
}

const limitar = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
const redondear = (v: number): number => Math.round(v * 100) / 100;

export function PuntoFocal({ src, x, y, onCambio, proporcion = PROPORCION_ENCABEZADO, ayuda = "Hacé clic en la parte más importante de la imagen (o arrastrá la marca). En el sitio se muestra en un recuadro apaisado y esa parte no se corta." }: PuntoFocalProps) {
  const marco = useRef<HTMLDivElement>(null);
  const arrastrando = useRef(false);

  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const caja = marco.current?.getBoundingClientRect();
    if (!caja || caja.width === 0 || caja.height === 0) return;
    onCambio(redondear(limitar((e.clientX - caja.left) / caja.width)), redondear(limitar((e.clientY - caja.top) / caja.height)));
  };

  return (
    <div className="punto-focal">
      <p className="ayuda" id="punto-focal-ayuda">
        {ayuda}
      </p>
      <div
        ref={marco}
        className="punto-focal-marco"
        role="presentation"
        onPointerDown={(e) => {
          arrastrando.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          mover(e);
        }}
        onPointerMove={(e) => {
          if (arrastrando.current) mover(e);
        }}
        onPointerUp={() => {
          arrastrando.current = false;
        }}
        onPointerCancel={() => {
          arrastrando.current = false;
        }}
      >
        <img src={src} alt="" draggable={false} />
        <span className="punto-focal-marca" style={{ left: `${limitar(x) * 100}%`, top: `${limitar(y) * 100}%` }} aria-hidden="true" />
      </div>
      <p className="ayuda">Así se va a ver en el sitio:</p>
      <div className="punto-focal-previa" style={{ aspectRatio: proporcion }}>
        <img src={src} alt="" style={{ objectPosition: `${limitar(x) * 100}% ${limitar(y) * 100}%` }} />
      </div>
    </div>
  );
}
