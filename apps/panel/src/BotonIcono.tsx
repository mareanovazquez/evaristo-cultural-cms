import type { MouseEventHandler } from "react";
import { Icono, type NombreIcono } from "./iconos";
import { Tooltip } from "./Tooltip";

// Botón de solo ícono con su tooltip. `etiqueta` es el nombre del botón para lectores de pantalla (conviene que diga sobre qué actúa,
// por ejemplo «Editar Cine»); el tooltip muestra `ayuda` si se da (por ejemplo, por qué está deshabilitado) y si no, `texto`.

interface Props {
  icono: NombreIcono;
  /** Nombre accesible del botón. */
  etiqueta: string;
  /** Lo que dice el tooltip. Por defecto, `etiqueta`. */
  texto?: string;
  /** Si el botón está deshabilitado, por qué (reemplaza al texto del tooltip). */
  motivo?: string | undefined;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  peligro?: boolean;
  /** Para los que abren o cierran un panel. */
  expandido?: boolean;
}

export function BotonIcono({ icono, etiqueta, texto, motivo, onClick, disabled, peligro, expandido }: Props) {
  return (
    <Tooltip texto={disabled && motivo ? motivo : (texto ?? etiqueta)}>
      <button type="button" className={`boton-icono${peligro ? " boton-icono-peligro" : ""}`} aria-label={etiqueta} aria-expanded={expandido} disabled={disabled} onClick={onClick}>
        <Icono nombre={icono} clase="icono icono-boton" />
      </button>
    </Tooltip>
  );
}
