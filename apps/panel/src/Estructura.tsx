import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as TecladoReact, type ReactNode } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router";
import { NOMBRE_DE_ROL, tienePermiso } from "@evaristo/compartido/permisos";
import { Icono, type NombreIcono } from "./iconos";
import { confirmarSalida } from "./salida";
import { useSesion } from "./sesion";

// Marco de todas las pantallas del panel: menú lateral (sidebar) y contenido. Decidido el 23/10/2026:
//  - Escritorio: el menú arranca desplegado y se puede plegar a solo íconos con el botón (solo ícono) de la cabecera; se recuerda en este navegador.
//  - Celular: el menú arranca siempre cerrado; una barra de arriba con el botón de hamburguesa lo abre encima del contenido.
//    Se cierra con la X, con Esc, tocando afuera o al ir a otra pantalla.
//  - Footer: la persona que ingresó, con un popover que reúne «Mi cuenta» y «Salir» (y lo que se sume después).
// Plegado, cada ícono conserva su nombre para lectores de pantalla y como ayuda al pasar el mouse.

const CLAVE_PLEGADO = "panel-menu-plegado";
const leerPlegado = (): boolean => {
  try {
    return window.localStorage.getItem(CLAVE_PLEGADO) === "1";
  } catch {
    return false;
  }
};
/** ¿Es una pantalla de escritorio (donde el menú se pliega a íconos)? Sin matchMedia (pruebas) se toma como escritorio. */
const esEscritorio = (): boolean => (typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 900px)").matches : true);

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

const iniciales = (nombre: string): string =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** El usuario del footer y su popover (Mi cuenta, Salir). Se abre hacia arriba; con el menú plegado, hacia la derecha. */
function MenuUsuario({ nombre, rol, plegado }: { nombre: string; rol: string; plegado: boolean }) {
  const { salir } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [estilo, setEstilo] = useState<CSSProperties>({});
  const disparador = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  // El popover es `fixed`: así no lo recorta el desplazamiento del menú. Se ubica según el botón del usuario.
  useLayoutEffect(() => {
    if (!abierto || !disparador.current) return;
    const r = disparador.current.getBoundingClientRect();
    if (plegado && esEscritorio()) setEstilo({ left: r.right + 8, bottom: window.innerHeight - r.bottom });
    else setEstilo({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6 });
  }, [abierto, plegado]);

  // Cierra con Esc (devolviendo el foco al botón), con un clic afuera, al cambiar el tamaño de la ventana y al plegar o desplegar el menú.
  useEffect(() => {
    if (!abierto) return;
    popover.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAbierto(false);
      disparador.current?.focus();
    };
    const alTocar = (e: MouseEvent) => {
      const objetivo = e.target as Node;
      if (!popover.current?.contains(objetivo) && !disparador.current?.contains(objetivo)) setAbierto(false);
    };
    const cerrar = () => setAbierto(false);
    window.addEventListener("keydown", alTeclear, true);
    document.addEventListener("mousedown", alTocar);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("keydown", alTeclear, true);
      document.removeEventListener("mousedown", alTocar);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);
  useEffect(() => setAbierto(false), [plegado]);

  // Flechas, Inicio y Fin recorren los ítems del popover.
  const alTeclearEnMenu = (e: TecladoReact<HTMLDivElement>) => {
    const items = [...(popover.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const ir = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") ir(i + 1);
    else if (e.key === "ArrowUp") ir(i - 1);
    else if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(items.length - 1);
  };

  return (
    <div className="menu-usuario">
      <button
        type="button"
        ref={disparador}
        className="menu-usuario-boton"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls="menu-usuario-popover"
        title={plegado ? nombre : undefined}
        onClick={() => setAbierto((v) => !v)}
      >
        <span className="menu-avatar" aria-hidden="true">
          {iniciales(nombre)}
        </span>
        <span className="menu-texto menu-usuario-datos">
          <span className="barra-usuario">{nombre}</span>
          <span className="menu-usuario-rol">{rol}</span>
        </span>
        <Icono nombre="chevronArriba" clase="icono icono-chico menu-usuario-chevron" />
      </button>
      {abierto && (
        <div ref={popover} id="menu-usuario-popover" className="popover-menu" role="menu" aria-label="Tu cuenta" style={estilo} onKeyDown={alTeclearEnMenu}>
          <Link to="/cuenta" role="menuitem" className="popover-item" onClick={() => setAbierto(false)}>
            <Icono nombre="cuenta" />
            Mi cuenta
          </Link>
          <button
            type="button"
            role="menuitem"
            className="popover-item"
            disabled={saliendo}
            onClick={() => {
              if (!confirmarSalida()) return;
              setSaliendo(true);
              void salir();
            }}
          >
            <Icono nombre="salir" />
            {saliendo ? "Saliendo…" : "Salir"}
          </button>
        </div>
      )}
    </div>
  );
}

export function Estructura() {
  const { usuario } = useSesion();
  const ubicacion = useLocation();
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
          <Link to="/" className="barra-titulo menu-marca">
            <span className="menu-texto">Panel de Evaristo Cultural</span>
          </Link>
          <button type="button" className="boton-menu menu-plegar" aria-label={plegado ? "Desplegar el menú" : "Plegar el menú"} aria-pressed={plegado} title={plegado ? "Desplegar el menú" : "Plegar el menú"} onClick={alternarPlegado}>
            <Icono nombre="plegar" clase="icono icono-plegar" />
          </button>
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
        </nav>

        <div className="menu-pie">{usuario && <MenuUsuario nombre={usuario.nombre} rol={nombreDelRol} plegado={plegado} />}</div>
      </aside>

      <main className="contenido" id="contenido-panel" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
