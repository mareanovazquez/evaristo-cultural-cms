import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ErrorApi, pedirApi } from "../api";
import { useTitulo } from "../titulo";

// Elegir una contraseña nueva desde el enlace del correo (/admin/restablecer#<código>, 11/11/2026). El código viene después del «#»:
// se guarda y se saca de la barra de direcciones, así no queda en el historial. Al abrir se pregunta si el enlace sigue sirviendo,
// para avisar antes de que la persona escriba nada.
const FORMA_CODIGO = /^[A-Za-z0-9_-]{43}$/;

type Estado = "verificando" | "valido" | "invalido" | "listo";

export function Restablecer() {
  useTitulo("Elegir una contraseña nueva");
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const [token] = useState(() => ubicacion.hash.replace(/^#/, ""));
  const [estado, setEstado] = useState<Estado>(() => (FORMA_CODIGO.test(token) ? "verificando" : "invalido"));
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Solo al abrir la pantalla: saca el código de la barra de direcciones.
  useEffect(() => {
    if (ubicacion.hash) void navegar(ubicacion.pathname, { replace: true });
  }, []);

  useEffect(() => {
    if (estado !== "verificando") return;
    let vigente = true;
    pedirApi("/api/auth/restablecer/verificar", { metodo: "POST", cuerpo: { token } })
      .then(() => vigente && setEstado("valido"))
      .catch((e: unknown) => {
        if (!vigente) return;
        // Si no se pudo preguntar (sin conexión), se deja escribir igual: al guardar se vuelve a comprobar.
        setEstado(e instanceof ErrorApi && e.codigo === "enlace_invalido" ? "invalido" : "valido");
      });
    return () => {
      vigente = false;
    };
  }, [estado, token]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clave || !repetida) {
      setError("Escribí la contraseña nueva dos veces.");
      return;
    }
    if (clave !== repetida) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      await pedirApi("/api/auth/restablecer", { metodo: "POST", cuerpo: { token, clave } });
      setClave("");
      setRepetida("");
      setEstado("listo");
    } catch (e_) {
      if (e_ instanceof ErrorApi && e_.codigo === "enlace_invalido") setEstado("invalido");
      else setError(e_ instanceof ErrorApi ? e_.message : "No se pudo cambiar la contraseña. Probá de nuevo en un momento.");
    } finally {
      setEnviando(false);
    }
  }

  if (estado === "verificando") {
    return (
      <main className="ingreso">
        <p className="cargando" role="status">
          Revisando el enlace…
        </p>
      </main>
    );
  }

  if (estado === "invalido") {
    return (
      <main className="ingreso">
        <div className="ingreso-caja">
          <h1>El enlace no sirve</h1>
          <p className="aviso aviso-alerta" role="alert">
            Puede que haya vencido (vale una hora), que ya se haya usado o que esté incompleto.
          </p>
          <p className="ingreso-pie">
            <Link to="/recuperar">Pedir un enlace nuevo</Link>
          </p>
        </div>
      </main>
    );
  }

  if (estado === "listo") {
    return (
      <main className="ingreso">
        <div className="ingreso-caja">
          <h1>Listo</h1>
          <p className="aviso aviso-ok" role="status">
            Tu contraseña cambió. Si tenías el panel abierto en otra computadora, ahí vas a tener que ingresar de nuevo.
          </p>
          <Link to="/ingresar" className="boton boton-primario boton-enlace">
            Ingresar
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="ingreso">
      <form className="ingreso-caja" onSubmit={(e) => void guardar(e)} noValidate>
        <h1>Elegí una contraseña nueva</h1>
        <p className="ayuda">Tiene que tener al menos 10 caracteres.</p>
        <div className="campo">
          <label htmlFor="restablecer-clave">Contraseña nueva</label>
          <input id="restablecer-clave" type="password" autoComplete="new-password" autoFocus value={clave} onChange={(e) => setClave(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="restablecer-repetida">Repetí la contraseña nueva</label>
          <input id="restablecer-repetida" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        </div>
        {error && (
          <p className="aviso aviso-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="boton boton-primario" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar la contraseña"}
        </button>
      </form>
    </main>
  );
}
