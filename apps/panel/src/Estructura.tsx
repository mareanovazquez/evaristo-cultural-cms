import { useState } from "react";
import { Link, Outlet } from "react-router";
import { confirmarSalida } from "./salida";
import { useSesion } from "./sesion";

// Marco de todas las pantallas del panel: barra superior con quién ingresó y el botón para salir.
export function Estructura() {
  const { usuario, salir } = useSesion();
  const [saliendo, setSaliendo] = useState(false);

  return (
    <>
      <a className="salto-contenido" href="#contenido-panel">
        Saltar al contenido
      </a>
      <header className="barra">
        <Link to="/" className="barra-titulo">
          Panel de Evaristo Cultural
        </Link>
        <div className="barra-usuario">
          <span>
            {usuario?.nombre}
            {usuario?.rol === "ADMINISTRADOR" ? " (administración)" : ""}
          </span>
          <button
            type="button"
            className="boton boton-suave"
            disabled={saliendo}
            onClick={() => {
              if (!confirmarSalida()) return;
              setSaliendo(true);
              void salir();
            }}
          >
            {saliendo ? "Saliendo…" : "Salir"}
          </button>
        </div>
      </header>
      <main className="contenido" id="contenido-panel" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}
