import { useEffect, useState } from "react";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "ok"; filas: number }
  | { tipo: "error" };

export function App() {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  useEffect(() => {
    const control = new AbortController();
    fetch("/api/salud", { signal: control.signal })
      .then((respuesta) => respuesta.json() as Promise<{ estado?: string; filas?: number }>)
      .then((datos) => {
        if (datos.estado === "ok" && typeof datos.filas === "number") {
          setEstado({ tipo: "ok", filas: datos.filas });
        } else {
          setEstado({ tipo: "error" });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEstado({ tipo: "error" });
      });
    return () => control.abort();
  }, []);

  return (
    <main className="pantalla">
      <h1>Panel de Evaristo Cultural</h1>
      <p>Prueba de conexión con la API</p>
      <p className={`resultado resultado-${estado.tipo}`} role="status">
        {estado.tipo === "cargando" && "Consultando…"}
        {estado.tipo === "ok" && `La API responde correctamente (filas: ${estado.filas})`}
        {estado.tipo === "error" && "No se pudo conectar con la API"}
      </p>
      <p className="nota">Texto de control: “Año nuevo”, canción, niño, ¿qué tal? — «cultura».</p>
    </main>
  );
}
