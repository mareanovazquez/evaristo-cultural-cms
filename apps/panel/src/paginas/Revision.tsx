import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ErrorApi, pedirApi, type ResumenRevision } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Tablero de la revisión de lo que dejó la migración desde WordPress: cuánto hay por completar o por mirar, con enlaces a la lista de cada cosa.

const A_LA_LISTA = (filtro: string) => `/revision/articulos?filtro=${encodeURIComponent(filtro)}`;

export function Revision() {
  useTitulo("Revisión de la migración");
  const { sesionVencida } = useSesion();
  const [resumen, setResumen] = useState<ResumenRevision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const control = new AbortController();
    pedirApi<ResumenRevision>("/api/admin/revision/resumen", { signal: control.signal })
      .then(setResumen)
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ErrorApi && e.estado === 401) {
          sesionVencida();
          return;
        }
        setError(e instanceof ErrorApi ? e.message : "No se pudo cargar el resumen.");
      });
    return () => control.abort();
  }, [sesionVencida]);

  return (
    <section>
      <div className="listado-encabezado">
        <h1>Revisión de la migración</h1>
        <Link to="/revision/articulos" className="boton boton-suave boton-enlace">
          Ver todos los artículos
        </Link>
      </div>
      <p className="ayuda">Lo que quedó por mirar después de pasar los artículos desde WordPress. Cada aviso que revisás sale de la lista de pendientes (se puede deshacer).</p>

      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}
      {!resumen && !error && (
        <p className="cargando" role="status">
          Cargando…
        </p>
      )}

      {resumen && (
        <>
          <h2 className="grupo-titulo">Para completar</h2>
          <ul className="tablero">
            <Tarjeta cantidad={resumen.altPendientes} titulo="Artículos con imágenes sin texto alternativo" filtro="alt" />
            <Tarjeta cantidad={resumen.sinAsignar} titulo="Artículos sin sección (en «Sin asignar»)" filtro="sin-asignar" />
            <Tarjeta cantidad={resumen.sinAutor} titulo="Artículos sin autor" filtro="sin-autor" />
            <Tarjeta cantidad={resumen.borradoresMigrados} titulo="Borradores que vienen de WordPress" filtro="borrador-migrado" />
          </ul>

          <h2 className="grupo-titulo">Avisos de la migración</h2>
          {resumen.avisos.length === 0 ? (
            <p className="vacio">No hay avisos.</p>
          ) : (
            <div className="tabla-envoltorio">
              <table className="tabla">
                <caption className="solo-lectores">Avisos de la migración</caption>
                <thead>
                  <tr>
                    <th scope="col">Aviso</th>
                    <th scope="col">Por revisar</th>
                    <th scope="col">Ya revisados</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.avisos.map((a) => (
                    <tr key={a.codigo}>
                      <td className="celda-titulo">
                        <span className="titulo-articulo">{a.etiqueta}</span>
                        <span className="ayuda">{a.codigo}</span>
                      </td>
                      <td>{a.pendientes > 0 ? <Link to={A_LA_LISTA(`aviso:${a.codigo}`)}>{a.pendientes}</Link> : "0"}</td>
                      <td>{a.revisados > 0 ? <Link to={A_LA_LISTA(`revisado:${a.codigo}`)}>{a.revisados}</Link> : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="grupo-titulo">Artículos por sección</h2>
          <div className="tabla-envoltorio">
            <table className="tabla">
              <caption className="solo-lectores">Artículos por sección</caption>
              <thead>
                <tr>
                  <th scope="col">Sección</th>
                  <th scope="col">Artículos</th>
                </tr>
              </thead>
              <tbody>
                {resumen.secciones.map((s) => (
                  <tr key={s.id}>
                    <td>{s.nombre}</td>
                    <td>{s.articulos > 0 ? <Link to={A_LA_LISTA(`seccion:${s.id}`)}>{s.articulos}</Link> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Tarjeta({ cantidad, titulo, filtro }: { cantidad: number; titulo: string; filtro: string }) {
  return (
    <li className="tablero-tarjeta">
      <span className="tablero-numero">{cantidad}</span>
      {cantidad > 0 ? <Link to={A_LA_LISTA(filtro)}>{titulo}</Link> : <span>{titulo}</span>}
    </li>
  );
}
