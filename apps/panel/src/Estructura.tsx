import { useState } from "react";
import { NavLink, Link, Outlet } from "react-router";
import { NOMBRE_DE_ROL, tienePermiso } from "@evaristo/compartido/permisos";
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
        <div className="barra-izquierda">
          <Link to="/" className="barra-titulo">
            Panel de Evaristo Cultural
          </Link>
          <nav className="barra-menu" aria-label="Secciones del panel">
            <NavLink to="/" end>
              Artículos
            </NavLink>
            {usuario && (tienePermiso(usuario.rol, "autores.editar.ajenos") ? <NavLink to="/autores">Autores</NavLink> : <NavLink to="/autores/mia">Mi ficha</NavLink>)}
            {usuario && tienePermiso(usuario.rol, "usuarios.gestionar") && <NavLink to="/usuarios">Usuarios</NavLink>}
            <NavLink to="/cuenta">Mi cuenta</NavLink>
          </nav>
        </div>
        <div className="barra-usuario">
          <span>
            {usuario?.nombre}
            {usuario ? ` (${NOMBRE_DE_ROL[usuario.rol].toLowerCase()})` : ""}
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
