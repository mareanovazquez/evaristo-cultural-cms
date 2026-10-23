import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ErrorApi, pedirApi, type Usuario } from "./api";

// Quién está usando el panel. Se consulta una vez al abrir y se actualiza al ingresar, salir o cuando la sesión vence.

interface ContextoSesion {
  /** undefined mientras se consulta; null si no hay sesión. */
  usuario: Usuario | null | undefined;
  ingresar: (email: string, clave: string) => Promise<void>;
  salir: () => Promise<void>;
  /** Para cuando cualquier pedido recibe un 401. */
  sesionVencida: () => void;
  /** true si la sesión terminó mientras se usaba el panel (para avisarlo en la pantalla de ingreso). */
  sesionTerminada: boolean;
  /** Reemplaza los datos del usuario (por ejemplo, tras cambiar el nombre o la contraseña en "Mi cuenta"). */
  actualizarUsuario: (usuario: Usuario) => void;
}

const Contexto = createContext<ContextoSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null | undefined>(undefined);
  const [sesionTerminada, setSesionTerminada] = useState(false);

  useEffect(() => {
    const control = new AbortController();
    pedirApi<{ usuario: Usuario }>("/api/auth/yo", { signal: control.signal })
      .then((r) => setUsuario(r.usuario))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 401 es lo esperado cuando no hay sesión; cualquier otro error también deja la pantalla de ingreso.
        if (!(error instanceof ErrorApi)) console.error(error);
        setUsuario(null);
      });
    return () => control.abort();
  }, []);

  const ingresar = useCallback(async (email: string, clave: string) => {
    const r = await pedirApi<{ usuario: Usuario }>("/api/auth/ingresar", { metodo: "POST", cuerpo: { email, clave } });
    setSesionTerminada(false);
    setUsuario(r.usuario);
  }, []);

  const salir = useCallback(async () => {
    try {
      await pedirApi("/api/auth/salir", { metodo: "POST", cuerpo: {} });
    } finally {
      setSesionTerminada(false);
      setUsuario(null);
    }
  }, []);

  const sesionVencida = useCallback(() => {
    setSesionTerminada(true);
    setUsuario(null);
  }, []);

  const actualizarUsuario = useCallback((nuevo: Usuario) => setUsuario(nuevo), []);

  const valor = useMemo(() => ({ usuario, ingresar, salir, sesionVencida, sesionTerminada, actualizarUsuario }), [usuario, ingresar, salir, sesionVencida, sesionTerminada, actualizarUsuario]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ContextoSesion {
  const c = useContext(Contexto);
  if (!c) throw new Error("useSesion se usa dentro de ProveedorSesion");
  return c;
}
