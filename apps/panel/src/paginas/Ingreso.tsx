import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ErrorApi } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

export function Ingreso() {
  useTitulo("Ingresar");
  const { usuario, ingresar, sesionTerminada } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const desde = (ubicacion.state as { desde?: string } | null)?.desde ?? "/";
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Si ya hay sesión, no tiene sentido ver esta pantalla.
  if (usuario) return <Navigate to={desde} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !clave) {
      setError("Escribí tu email y tu contraseña.");
      return;
    }
    setEnviando(true);
    try {
      await ingresar(email, clave);
      void navegar(desde, { replace: true });
    } catch (e_) {
      setError(e_ instanceof ErrorApi ? e_.message : "No se pudo ingresar. Probá de nuevo en un momento.");
      setClave("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="ingreso">
      <form className="ingreso-caja" onSubmit={(e) => void enviar(e)} noValidate>
        <h1>Ingresar al panel</h1>
        <p className="ayuda">Panel de Evaristo Cultural</p>
        {sesionTerminada && !error && (
          <p className="aviso aviso-alerta" role="status">
            Tu sesión terminó. Ingresá de nuevo para seguir: vas a volver a la pantalla en la que estabas.
          </p>
        )}
        <div className="campo">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="clave">Contraseña</label>
          <input id="clave" name="clave" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </div>
        {error && (
          <p className="aviso aviso-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="boton boton-primario" disabled={enviando}>
          {enviando ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
