import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router";
import { NOMBRE_DE_ROL, tienePermiso } from "@evaristo/compartido/permisos";
import { Icono, type NombreIcono } from "./iconos";
import { confirmarSalida } from "./salida";
import { useSesion } from "./sesion";

// Marco de todas las pantallas del panel: menú lateral (sidebar) y contenido. Decidido el 23/10/2026:
//  - Escritorio: el menú arranca desplegado y se puede plegar a solo íconos con el botón de abajo (se recuerda en este navegador).
//  - Celular: el menú arranca siempre cerrado; una barra de arriba con el botón de hamburguesa lo abre encima del contenido.
//    Se cierra con la X, con Esc, tocando afuera o al ir a otra pantalla.
// Plegado, cada ícono conserva su nombre para lectores de pantalla y como ayuda al pasar el mouse.

const CLAVE_PLEGADO = "panel-menu-plegado";
const leerPlegado = (): boolean => {
  try {
    return window.localStorage.getItem(CLAVE_PLEGADO) === "1";
  } catch {
    return false;
  }
};

function Enlace({ a, icono, fin, children }: { a: string; icono: NombreIcono; fin?: boolean; children: string }) {
  return (
    <NavLink to={a} end={fin} className="menu-enlace" title={children}>
      <Icono nombre={icono} />
      <span className="menu-texto">{children}</span>
    </NavLink>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="menu-grupo" role="group" aria-label={titulo}>
      <p className="menu-grupo-titulo" aria-hidden="true">
        {titulo}
      </p>
      {children}
    </div>
  );
}

export function Estructura() {
  const { usuario, salir } = useSesion();
  const ubicacion = useLocation();
  const [saliendo, setSaliendo] = useState(false);
  const [plegado, setPlegado] = useState(leerPlegado);
  const [abierto, setAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);

  // En celular, ir a otra pantalla cierra el menú.
  useEffect(() => setAbierto(false), [ubicacion.pathname]);

  // Con el menú abierto en celular: Esc lo cierra (y el foco vuelve al botón) y el foco entra al menú.
  useEffect(() => {
    if (!abierto) return;
    menu.current?.querySelector<HTMLElement>("a, button")?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAbierto(false);
      botonMenu.current?.focus();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  const alternarPlegado = () => {
    const nuevo = !plegado;
    setPlegado(nuevo);
    try {
      window.localStorage.setItem(CLAVE_PLEGADO, nuevo ? "1" : "0");
    } catch {
      /* sin almacenamiento: queda solo en esta sesión */
    }
  };

  const puede = (permiso: Parameters<typeof tienePermiso>[1]) => !!usuario && tienePermiso(usuario.rol, permiso);
  const nombreDelRol = usuario ? NOMBRE_DE_ROL[usuario.rol].toLowerCase() : "";

  return (
    <div className={`estructura${plegado ? " plegada" : ""}${abierto ? " menu-abierto" : ""}`}>
      <a className="salto-contenido" href="#contenido-panel">
        Saltar al contenido
      </a>

      <header className="barra-movil">
        <button type="button" ref={botonMenu} className="boton-menu" aria-label="Abrir el menú" aria-expanded={abierto} aria-controls="menu-lateral" onClick={() => setAbierto(true)}>
          <Icono nombre="menu" />
        </button>
        <Link to="/" className="barra-titulo">
          Panel de Evaristo Cultural
        </Link>
      </header>

      <div className="fondo-menu" aria-hidden="true" onClick={() => setAbierto(false)} />

      <aside className="menu-lateral" id="menu-lateral" ref={menu} aria-label="Menú del panel">
        <div className="menu-cabecera">
          <Link to="/" className="barra-titulo">
            <span className="menu-texto">Panel de Evaristo Cultural</span>
            <span className="menu-sigla" aria-hidden="true">
              EC
            </span>
          </Link>
          <button type="button" className="boton-menu menu-cerrar" aria-label="Cerrar el menú" onClick={() => { setAbierto(false); botonMenu.current?.focus(); }}>
            <Icono nombre="cerrar" />
          </button>
        </div>

        <nav className="menu-nav" aria-label="Secciones del panel">
          <Grupo titulo="Contenido">
            <Enlace a="/" icono="articulos" fin>
              Artículos
            </Enlace>
            {puede("autores.editar.ajenos") ? (
              <Enlace a="/autores" icono="autores">
                Autores
              </Enlace>
            ) : (
              <Enlace a="/autores/mia" icono="ficha">
                Mi ficha
              </Enlace>
            )}
            {puede("clasificacion.gestionar") && (
              <Enlace a="/clasificacion" icono="clasificacion">
                Secciones y categorías
              </Enlace>
            )}
          </Grupo>
          {puede("revision.usar") && (
            <Grupo titulo="Revisión">
              <Enlace a="/revision" icono="revision">
                Revisión
              </Enlace>
            </Grupo>
          )}
          {puede("usuarios.gestionar") && (
            <Grupo titulo="Administración">
              <Enlace a="/usuarios" icono="usuarios">
                Usuarios
              </Enlace>
            </Grupo>
          )}
          <Grupo titulo="Cuenta">
            <Enlace a="/cuenta" icono="cuenta">
              Mi cuenta
            </Enlace>
          </Grupo>
        </nav>

        <div className="menu-pie">
          <p className="barra-usuario">
            <span className="menu-texto">
              {usuario?.nombre}
              {usuario ? ` (${nombreDelRol})` : ""}
            </span>
          </p>
          <button
            type="button"
            className="menu-enlace menu-boton"
            title="Salir"
            disabled={saliendo}
            onClick={() => {
              if (!confirmarSalida()) return;
              setSaliendo(true);
              void salir();
            }}
          >
            <Icono nombre="salir" />
            <span className="menu-texto">{saliendo ? "Saliendo…" : "Salir"}</span>
          </button>
          <button type="button" className="menu-enlace menu-boton menu-plegar" aria-pressed={plegado} title={plegado ? "Desplegar el menú" : "Plegar el menú"} onClick={alternarPlegado}>
            <Icono nombre="plegar" clase="icono icono-plegar" />
            <span className="menu-texto">{plegado ? "Desplegar el menú" : "Plegar el menú"}</span>
          </button>
        </div>
      </aside>

      <main className="contenido" id="contenido-panel" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
