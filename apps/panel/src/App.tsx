import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { Estructura } from "./Estructura";
import { Articulos } from "./paginas/Articulos";
import { Ingreso } from "./paginas/Ingreso";
import { useSesion } from "./sesion";

// Todo lo que está adentro necesita una sesión; si no la hay, se va a la pantalla de ingreso y se vuelve acá después.
function RutaProtegida() {
  const { usuario } = useSesion();
  const ubicacion = useLocation();
  if (usuario === undefined) return <p className="cargando" role="status">Cargando…</p>;
  if (usuario === null) return <Navigate to="/ingresar" replace state={{ desde: ubicacion.pathname + ubicacion.search }} />;
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
          <Route path="*" element={<NoEncontrada />} />
        </Route>
      </Route>
    </Routes>
  );
}
