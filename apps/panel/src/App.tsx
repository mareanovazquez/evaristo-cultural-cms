import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { Estructura } from "./Estructura";
import { Articulos } from "./paginas/Articulos";
import { EditarArticulo } from "./paginas/EditarArticulo";
import { Cuenta } from "./paginas/Cuenta";
import { Ingreso } from "./paginas/Ingreso";
import { NuevoArticulo } from "./paginas/NuevoArticulo";
import { Usuarios } from "./paginas/Usuarios";
import { tienePermiso, type Permiso } from "@evaristo/compartido/permisos";
import { useSesion } from "./sesion";

// Todo lo que está adentro necesita una sesión; si no la hay, se va a la pantalla de ingreso y se vuelve acá después.
function RutaProtegida() {
  const { usuario } = useSesion();
  const ubicacion = useLocation();
  if (usuario === undefined) return <p className="cargando" role="status">Cargando…</p>;
  if (usuario === null) return <Navigate to="/ingresar" replace state={{ desde: ubicacion.pathname + ubicacion.search }} />;
  // Con la contraseña provisoria que puso el administrador solo se puede estar en "Mi cuenta", eligiendo una propia.
  if (usuario.debeCambiarClave && ubicacion.pathname !== "/cuenta") return <Navigate to="/cuenta" replace />;
  return <Outlet />;
}

/** Pantallas que pide un permiso: quien no lo tiene vuelve a los artículos (la API lo vuelve a comprobar en cada pedido). */
function ConPermiso({ permiso }: { permiso: Permiso }) {
  const { usuario } = useSesion();
  if (!usuario || !tienePermiso(usuario.rol, permiso)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function NoEncontrada() {
  return (
    <section className="pantalla">
      <h1>No encontramos esa pantalla</h1>
      <p>
        <Link to="/">Volver a los artículos</Link>
      </p>
    </section>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/ingresar" element={<Ingreso />} />
      <Route element={<RutaProtegida />}>
        <Route element={<Estructura />}>
          <Route index element={<Articulos />} />
          <Route path="articulos/nuevo" element={<NuevoArticulo />} />
          <Route path="articulos/:id" element={<EditarArticulo />} />
          <Route path="cuenta" element={<Cuenta />} />
          <Route element={<ConPermiso permiso="usuarios.gestionar" />}>
            <Route path="usuarios" element={<Usuarios />} />
          </Route>
          <Route path="*" element={<NoEncontrada />} />
        </Route>
      </Route>
    </Routes>
  );
}
