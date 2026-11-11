import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { ErrorApi, pedirApi } from "../api";
import { useTitulo } from "../titulo";

// «¿Olvidaste tu contraseña?» (11/11/2026): se escribe el email y la API manda un enlace para elegir una nueva. La respuesta es
// siempre la misma, tenga cuenta o no ese email (no se revela quién tiene usuario).
export function Recuperar() {
  useTitulo("Recuperar la contraseña");
  const ubicacion = useLocation();
  const [email, setEmail] = useState((ubicacion.state as { email?: string } | null)?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Escribí el email con el que ingresás al panel.");
      return;
    }
    setEnviando(true);
    try {
      await pedirApi("/api/auth/recuperar", { metodo: "POST", cuerpo: { email: email.trim() } });
      setEnviado(true);
    } catch (e_) {
      setError(e_ instanceof ErrorApi ? e_.message : "No se pudo enviar el pedido. Probá de nuevo en un momento.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <main className="ingreso">
        <div className="ingreso-caja">
          <h1>Revisá tu correo</h1>
          <p className="aviso aviso-ok" role="status">
            Si {email.trim()} tiene una cuenta en el panel, te mandamos un enlace para elegir una contraseña nueva. Vale una hora.
          </p>
          <p className="ayuda">Si no llega en unos minutos, revisá la carpeta de spam o volvé a pedirlo.</p>
          <p className="ingreso-pie">
            <Link to="/ingresar">Volver a ingresar</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="ingreso">
      <form className="ingreso-caja" onSubmit={(e) => void enviar(e)} noValidate>
        <h1>¿Olvidaste tu contraseña?</h1>
        <p className="ayuda">Escribí el email con el que ingresás y te mandamos un enlace para elegir una nueva.</p>
        <div className="campo">
          <label htmlFor="recuperar-email">Email</label>
          <input id="recuperar-email" name="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && (
          <p className="aviso aviso-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="boton boton-primario" disabled={enviando}>
          {enviando ? "Enviando…" : "Mandarme el enlace"}
        </button>
        <p className="ingreso-pie">
          <Link to="/ingresar">Volver a ingresar</Link>
        </p>
      </form>
    </main>
  );
}
