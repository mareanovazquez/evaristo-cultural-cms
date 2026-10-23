import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DESCRIPCION_DE_ROL, NOMBRE_DE_ROL, ROLES, type Rol } from "@evaristo/compartido/permisos";
import { ErrorApi, pedirApi, type UsuarioAdmin } from "../api";
import { useSesion } from "../sesion";
import { useTitulo } from "../titulo";

// Usuarios del panel (solo administrador). Las acciones están en una ficha por persona, debajo de la lista.
//  - "Revocar el acceso" no borra nada: corta sus sesiones y conserva su ficha de autor y sus artículos.
//  - La contraseña inicial (y la de un restablecimiento) la escribe el administrador y se la pasa a la persona, que la cambia al ingresar.

const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

/** Una contraseña provisoria legible (sin letras que se confunden), por ejemplo «kd7m-p3qx-w9ta». */
export function claveProvisoria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const texto = Array.from(bytes, (b) => letras[b % letras.length]).join("");
  return `${texto.slice(0, 4)}-${texto.slice(4, 8)}-${texto.slice(8)}`;
}

type Ficha = { modo: "crear" } | { modo: "vincular"; autorId: number } | null;
type AutorLibre = { id: number; nombre: string; slug: string };

export function Usuarios() {
  useTitulo("Usuarios");
  const { usuario: yo, sesionVencida } = useSesion();
  const [lista, setLista] = useState<UsuarioAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [elegido, setElegido] = useState<number | null>(null);
  // Contraseña recién escrita: se muestra una sola vez para que el administrador se la pase a la persona.
  const [entregar, setEntregar] = useState<{ nombre: string; email: string; clave: string } | null>(null);

  const falla = useCallback(
    (e: unknown, porDefecto: string): string => {
      if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
      return e instanceof ErrorApi ? e.message : porDefecto;
    },
    [sesionVencida],
  );

  const cargar = useCallback(async () => {
    try {
      const r = await pedirApi<{ usuarios: UsuarioAdmin[] }>("/api/admin/usuarios");
      setLista(r.usuarios);
      setError(null);
    } catch (e) {
      setError(falla(e, "No se pudo cargar la lista de usuarios."));
    }
  }, [falla]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const reemplazar = (u: UsuarioAdmin) => setLista((l) => l?.map((x) => (x.id === u.id ? u : x)) ?? l);
  const seleccionado = lista?.find((u) => u.id === elegido) ?? null;

  return (
    <div>
      <div className="listado-encabezado">
        <h1>Usuarios</h1>
        <button type="button" className="boton boton-primario" onClick={() => setNuevo((v) => !v)} aria-expanded={nuevo}>
          {nuevo ? "Cerrar" : "Nuevo usuario"}
        </button>
      </div>

      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}

      {entregar && (
        <div className="aviso aviso-alerta" role="status">
          <p>
            Pasale esta contraseña provisoria a <strong>{entregar.nombre}</strong> ({entregar.email}). No la vas a poder ver de nuevo, y cuando ingrese tiene que elegir una propia:
          </p>
          <p>
            <code className="clave-provisoria">{entregar.clave}</code>
          </p>
          <button type="button" className="boton boton-suave" onClick={() => setEntregar(null)}>
            Ya se la pasé
          </button>
        </div>
      )}

      {nuevo && (
        <FormularioAlta
          falla={falla}
          alCrear={(u, clave) => {
            setNuevo(false);
            setEntregar({ nombre: u.nombre, email: u.email, clave });
            setElegido(null);
            void cargar();
          }}
        />
      )}

      {lista === null && !error ? (
        <p className="cargando" role="status">
          Cargando…
        </p>
      ) : (
        lista && (
          <div className="tabla-envoltorio">
            <table className="tabla">
              <caption className="solo-lectores">Usuarios del panel</caption>
              <thead>
                <tr>
                  <th scope="col">Persona</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Acceso</th>
                  <th scope="col">Ficha de autor</th>
                  <th scope="col">Artículos</th>
                  <th scope="col">Último ingreso</th>
                  <th scope="col">
                    <span className="solo-lectores">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.map((u) => (
                  <tr key={u.id}>
                    <td className="celda-titulo">
                      <span className="titulo-articulo">
                        {u.nombre}
                        {u.id === yo?.id ? " (vos)" : ""}
                      </span>
                      <span className="ayuda">{u.email}</span>
                    </td>
                    <td>{NOMBRE_DE_ROL[u.rol]}</td>
                    <td>
                      {u.activo ? <span className="estado estado-publicado">Con acceso</span> : <span className="estado estado-borrador">Sin acceso</span>}
                      {u.debeCambiarClave && u.activo && <span className="etiqueta etiqueta-alerta"> Contraseña provisoria</span>}
                    </td>
                    <td>{u.autor ? u.autor.nombre : <span className="ayuda">Sin ficha</span>}</td>
                    <td>{u.articulos}</td>
                    <td>{u.ultimoAccesoEn ? fecha.format(new Date(u.ultimoAccesoEn)) : <span className="ayuda">Nunca</span>}</td>
                    <td>
                      <button type="button" className="boton boton-suave" aria-expanded={elegido === u.id} onClick={() => setElegido(elegido === u.id ? null : u.id)}>
                        {elegido === u.id ? "Cerrar" : "Administrar"}
                        <span className="solo-lectores"> a {u.nombre}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {seleccionado && (
        <FichaUsuario
          key={seleccionado.id}
          usuario={seleccionado}
          esUnoMismo={seleccionado.id === yo?.id}
          falla={falla}
          alCambiar={reemplazar}
          alEntregarClave={(clave) => setEntregar({ nombre: seleccionado.nombre, email: seleccionado.email, clave })}
          alRecargar={cargar}
        />
      )}
    </div>
  );
}

type Falla = (e: unknown, porDefecto: string) => string;

/** Elegir la ficha de autor de la persona: crearla con su nombre o enlazar una existente que no sea de nadie. */
function ElegirFicha({ obligatoria, valor, alCambiar, falla }: { obligatoria: boolean; valor: Ficha; alCambiar: (f: Ficha) => void; falla: Falla }) {
  const [busqueda, setBusqueda] = useState("");
  const [libres, setLibres] = useState<AutorLibre[]>([]);
  const [error, setError] = useState<string | null>(null);
  const modo = valor?.modo ?? "ninguna";

  useEffect(() => {
    if (modo !== "vincular") return;
    const control = new AbortController();
    const t = setTimeout(() => {
      pedirApi<{ autores: AutorLibre[] }>(`/api/admin/usuarios/autores-disponibles?q=${encodeURIComponent(busqueda.trim())}`, { signal: control.signal })
        .then((r) => {
          setLibres(r.autores);
          setError(null);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(falla(e, "No se pudo buscar entre los autores."));
        });
    }, 250);
    return () => {
      clearTimeout(t);
      control.abort();
    };
  }, [modo, busqueda, falla]);

  return (
    <fieldset className="subgrupo">
      <legend>Ficha de autor{obligatoria ? "" : " (opcional)"}</legend>
      <p className="ayuda">{obligatoria ? "Un redactor firma sus artículos con su propia ficha." : "Con una ficha puede firmar sus artículos."}</p>
      {!obligatoria && (
        <label className="casilla">
          <input type="radio" name="ficha" checked={modo === "ninguna"} onChange={() => alCambiar(null)} />
          Sin ficha
        </label>
      )}
      <label className="casilla">
        <input type="radio" name="ficha" checked={modo === "crear"} onChange={() => alCambiar({ modo: "crear" })} />
        Crear una ficha con su nombre
      </label>
      <label className="casilla">
        <input type="radio" name="ficha" checked={modo === "vincular"} onChange={() => alCambiar({ modo: "vincular", autorId: 0 })} />
        Usar una ficha que ya existe
      </label>
      {valor?.modo === "vincular" && (
        <div className="campo">
          <label htmlFor="ficha-busqueda">Buscar autor</label>
          <input id="ficha-busqueda" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <label htmlFor="ficha-autor" className="solo-lectores">
            Autor
          </label>
          <select id="ficha-autor" value={valor.autorId || ""} onChange={(e) => alCambiar({ modo: "vincular", autorId: Number(e.target.value) })}>
            <option value="">Elegí un autor</option>
            {libres.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </select>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </fieldset>
  );
}

function FormularioAlta({ falla, alCrear }: { falla: Falla; alCrear: (u: UsuarioAdmin, clave: string) => void }) {
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<Rol>("REDACTOR");
  const [clave, setClave] = useState("");
  const [ficha, setFicha] = useState<Ficha>({ modo: "crear" });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiarRol = (nuevo: Rol) => {
    setRol(nuevo);
    // Un redactor necesita ficha; para los demás es opcional (se arranca sin).
    if (nuevo === "REDACTOR" && !ficha) setFicha({ modo: "crear" });
  };

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !nombre.trim() || !clave) {
      setError("Completá el email, el nombre y la contraseña provisoria.");
      return;
    }
    if (ficha?.modo === "vincular" && !ficha.autorId) {
      setError("Elegí la ficha de autor de la lista, o creá una nueva.");
      return;
    }
    setEnviando(true);
    try {
      const r = await pedirApi<{ usuario: UsuarioAdmin }>("/api/admin/usuarios", { metodo: "POST", cuerpo: { email, nombre, rol, clave, ...(ficha ? { ficha } : {}) } });
      alCrear(r.usuario, clave);
    } catch (e_) {
      setError(falla(e_, "No se pudo crear el usuario. Probá de nuevo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="grupo" onSubmit={(e) => void enviar(e)} noValidate aria-label="Nuevo usuario">
      <h2 className="grupo-titulo">Nuevo usuario</h2>
      <div className="par-campos">
        <div className="campo">
          <label htmlFor="alta-nombre">Nombre</label>
          <input id="alta-nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="alta-email">Email</label>
          <input id="alta-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="alta-rol">Rol</label>
        <select id="alta-rol" value={rol} onChange={(e) => cambiarRol(e.target.value as Rol)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {NOMBRE_DE_ROL[r]}
            </option>
          ))}
        </select>
        <p className="ayuda">{DESCRIPCION_DE_ROL[rol]}</p>
      </div>
      <div className="campo">
        <label htmlFor="alta-clave">Contraseña provisoria</label>
        <div className="fila-clave">
          <input id="alta-clave" type="text" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} />
          <button type="button" className="boton boton-suave" onClick={() => setClave(claveProvisoria())}>
            Generar
          </button>
        </div>
        <p className="ayuda">Al menos 10 caracteres. La persona la cambia la primera vez que ingresa.</p>
      </div>
      <ElegirFicha obligatoria={rol === "REDACTOR"} valor={ficha} alCambiar={setFicha} falla={falla} />
      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="boton boton-primario" disabled={enviando}>
        {enviando ? "Creando…" : "Crear usuario"}
      </button>
    </form>
  );
}

function FichaUsuario({
  usuario,
  esUnoMismo,
  falla,
  alCambiar,
  alEntregarClave,
  alRecargar,
}: {
  usuario: UsuarioAdmin;
  esUnoMismo: boolean;
  falla: Falla;
  alCambiar: (u: UsuarioAdmin) => void;
  alEntregarClave: (clave: string) => void;
  alRecargar: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState(usuario.nombre);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [fichaNueva, setFichaNueva] = useState<Ficha>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** Hace un pedido de esta ficha y muestra el resultado. */
  async function hacer(ruta: string, metodo: string, cuerpo: unknown, exito: string, alTerminar?: (r: Record<string, unknown>) => void) {
    setError(null);
    setOk(null);
    setOcupado(true);
    try {
      const r = await pedirApi<{ usuario?: UsuarioAdmin } & Record<string, unknown>>(ruta, { metodo, cuerpo });
      if (r.usuario) alCambiar(r.usuario);
      setOk(exito);
      alTerminar?.(r);
    } catch (e) {
      setError(falla(e, "No se pudo completar la acción. Probá de nuevo."));
      await alRecargar();
    } finally {
      setOcupado(false);
    }
  }

  const base = `/api/admin/usuarios/${usuario.id}`;
  const cambioDatos = nombre.trim() !== usuario.nombre || rol !== usuario.rol;

  return (
    <section className="grupo ficha-usuario" aria-label={`Administrar a ${usuario.nombre}`}>
      <h2 className="grupo-titulo">{usuario.nombre}</h2>
      <p className="ayuda">{usuario.email}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void hacer(base, "PATCH", { nombre, rol }, "Guardamos los cambios.");
        }}
        noValidate
      >
        <div className="par-campos">
          <div className="campo">
            <label htmlFor="adm-nombre">Nombre</label>
            <input id="adm-nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="adm-rol">Rol</label>
            <select id="adm-rol" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {NOMBRE_DE_ROL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="ayuda">{DESCRIPCION_DE_ROL[rol]}</p>
        <button type="submit" className="boton boton-primario" disabled={ocupado || !cambioDatos}>
          Guardar nombre y rol
        </button>
      </form>

      <hr />

      {!usuario.autor && (
        <>
          <ElegirFicha obligatoria={false} valor={fichaNueva} alCambiar={setFichaNueva} falla={falla} />
          <button
            type="button"
            className="boton boton-suave"
            disabled={ocupado || !fichaNueva || (fichaNueva.modo === "vincular" && !fichaNueva.autorId)}
            onClick={() => void hacer(`${base}/ficha`, "POST", fichaNueva, "Le dimos su ficha de autor.", () => setFichaNueva(null))}
          >
            Darle la ficha de autor
          </button>
          <hr />
        </>
      )}

      <div className="acciones-fila">
        {usuario.activo ? (
          <button
            type="button"
            className="boton boton-peligro"
            disabled={ocupado}
            onClick={() => {
              if (window.confirm(`¿Revocar el acceso de ${usuario.nombre}? No va a poder ingresar y se cierran sus sesiones. Sus artículos y su ficha de autor quedan como están, y se le puede volver a dar acceso.`)) void hacer(`${base}/desactivar`, "POST", {}, "Revocamos su acceso.");
            }}
          >
            Revocar el acceso
          </button>
        ) : (
          <button type="button" className="boton boton-primario" disabled={ocupado} onClick={() => void hacer(`${base}/activar`, "POST", {}, "Le devolvimos el acceso.")}>
            Volver a dar acceso
          </button>
        )}
        <button
          type="button"
          className="boton boton-suave"
          disabled={ocupado}
          onClick={() => void hacer(`${base}/cerrar-sesiones`, "POST", {}, esUnoMismo ? "Cerramos tus sesiones en las demás computadoras." : "Cerramos todas sus sesiones.")}
        >
          Cerrar todas sus sesiones
        </button>
      </div>

      {!esUnoMismo && <RestablecerClave ocupado={ocupado} alEnviar={(clave) => hacer(`${base}/clave`, "POST", { clave }, "Cambiamos su contraseña.", () => alEntregarClave(clave))} />}
      {esUnoMismo && <p className="ayuda">Tu propia contraseña se cambia en «Mi cuenta».</p>}

      {error && (
        <p className="aviso aviso-error" role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className="aviso aviso-ok" role="status">
          {ok}
        </p>
      )}
    </section>
  );
}

function RestablecerClave({ ocupado, alEnviar }: { ocupado: boolean; alEnviar: (clave: string) => Promise<void> }) {
  const [clave, setClave] = useState("");
  return (
    <form
      className="campo"
      onSubmit={(e) => {
        e.preventDefault();
        if (clave && window.confirm("¿Restablecer la contraseña? Se cierran sus sesiones y tiene que elegir una propia al ingresar.")) void alEnviar(clave).then(() => setClave(""));
      }}
      noValidate
    >
      <label htmlFor="adm-clave">Restablecer la contraseña</label>
      <div className="fila-clave">
        <input id="adm-clave" type="text" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} />
        <button type="button" className="boton boton-suave" onClick={() => setClave(claveProvisoria())}>
          Generar
        </button>
        <button type="submit" className="boton boton-suave" disabled={ocupado || !clave}>
          Restablecer
        </button>
      </div>
    </form>
  );
}
