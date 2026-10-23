import { useState, type FormEvent } from "react";
import { NOMBRE_DE_ROL } from "@evaristo/compartido/permisos";
import { ErrorApi, pedirApi, type Usuario } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Mi cuenta: cambiar el nombre y la contraseña. Quien entró con la contraseña que le puso el administrador solo puede estar acá
// hasta elegir una propia (el resto del panel lo lleva de vuelta a esta pantalla).
export function Cuenta() {
  useTitulo("Mi cuenta");
  const { usuario, actualizarUsuario, sesionVencida } = useSesion();
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [claveActual, setClaveActual] = useState("");
  const [claveNueva, setClaveNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [okNombre, setOkNombre] = useState(false);
  const [errorClave, setErrorClave] = useState<string | null>(null);
  const [okClave, setOkClave] = useState(false);
  const [enviando, setEnviando] = useState<"nombre" | "clave" | null>(null);

  if (!usuario) return null;

  const mensajeDe = (e: unknown, porDefecto: string): string => {
    if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
    return e instanceof ErrorApi ? e.message : porDefecto;
  };

  async function guardarNombre(e: FormEvent) {
    e.preventDefault();
    setErrorNombre(null);
    setOkNombre(false);
    if (!nombre.trim()) {
      setErrorNombre("Escribí tu nombre.");
      return;
    }
    setEnviando("nombre");
    try {
      const r = await pedirApi<{ usuario: Usuario }>("/api/auth/yo", { metodo: "PATCH", cuerpo: { nombre } });
      actualizarUsuario(r.usuario);
      setNombre(r.usuario.nombre);
      setOkNombre(true);
    } catch (e_) {
      setErrorNombre(mensajeDe(e_, "No se pudo guardar el nombre. Probá de nuevo."));
    } finally {
      setEnviando(null);
    }
  }

  async function cambiarClave(e: FormEvent) {
    e.preventDefault();
    setErrorClave(null);
    setOkClave(false);
    if (!claveActual || !claveNueva) {
      setErrorClave("Escribí tu contraseña actual y la nueva.");
      return;
    }
    if (claveNueva !== repetida) {
      setErrorClave("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    setEnviando("clave");
    try {
      const r = await pedirApi<{ usuario: Usuario }>("/api/auth/clave", { metodo: "POST", cuerpo: { claveActual, claveNueva } });
      actualizarUsuario(r.usuario);
      setClaveActual("");
      setClaveNueva("");
      setRepetida("");
      setOkClave(true);
    } catch (e_) {
      setErrorClave(mensajeDe(e_, "No se pudo cambiar la contraseña. Probá de nuevo."));
    } finally {
      setEnviando(null);
    }
  }

  return (
    <section className="pantalla">
      <h1>Mi cuenta</h1>
      <p className="ayuda">
        {usuario.email} · {NOMBRE_DE_ROL[usuario.rol]}
      </p>

      {usuario.debeCambiarClave && (
        <p className="aviso aviso-alerta" role="alert">
          Estás usando una contraseña provisoria. Elegí una propia para seguir usando el panel.
        </p>
      )}

      <form className="grupo" onSubmit={(e) => void guardarNombre(e)} noValidate>
        <h2 className="grupo-titulo">Tu nombre</h2>
        <div className="campo">
          <label htmlFor="cuenta-nombre">Nombre</label>
          <input id="cuenta-nombre" type="text" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        {errorNombre && (
          <p className="aviso aviso-error" role="alert">
            {errorNombre}
          </p>
        )}
        {okNombre && (
          <p className="aviso aviso-ok" role="status">
            Guardamos tu nombre.
          </p>
        )}
        <button type="submit" className="boton boton-primario" disabled={enviando !== null}>
          {enviando === "nombre" ? "Guardando…" : "Guardar el nombre"}
        </button>
      </form>

      <form className="grupo" onSubmit={(e) => void cambiarClave(e)} noValidate>
        <h2 className="grupo-titulo">Cambiar la contraseña</h2>
        <p className="ayuda">Tiene que tener al menos 10 caracteres. Al cambiarla se cierra tu sesión en las demás computadoras.</p>
        <div className="campo">
          <label htmlFor="cuenta-clave-actual">Contraseña actual</label>
          <input id="cuenta-clave-actual" type="password" autoComplete="current-password" value={claveActual} onChange={(e) => setClaveActual(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="cuenta-clave-nueva">Contraseña nueva</label>
          <input id="cuenta-clave-nueva" type="password" autoComplete="new-password" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="cuenta-clave-repetida">Repetí la contraseña nueva</label>
          <input id="cuenta-clave-repetida" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        </div>
        {errorClave && (
          <p className="aviso aviso-error" role="alert">
            {errorClave}
          </p>
        )}
        {okClave && (
          <p className="aviso aviso-ok" role="status">
            Cambiamos tu contraseña.
          </p>
        )}
        <button type="submit" className="boton boton-primario" disabled={enviando !== null}>
          {enviando === "clave" ? "Cambiando…" : "Cambiar la contraseña"}
        </button>
      </form>
    </section>
  );
}
