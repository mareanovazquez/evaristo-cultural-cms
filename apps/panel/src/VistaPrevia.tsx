import { useEffect, useMemo, useState } from "react";
import { htmlVistaPrevia, type DatosVistaPrevia } from "./vista-previa";

// Las hojas de estilo del sitio, como texto, para que la vista previa se vea igual que la página pública sin copiar el CSS.
// Se piden recién al abrir la vista previa (el panel no las necesita para nada más).
async function cargarHojas(): Promise<string> {
  const [tokens, base, articulo, sitio] = await Promise.all([
    import("../../sitio/src/styles/tokens.css?raw"),
    import("../../sitio/src/styles/base.css?raw"),
    import("../../sitio/src/styles/articulo.css?raw"),
    import("../../sitio/src/styles/sitio.css?raw"),
  ]);
  return [tokens, base, articulo, sitio].map((m) => m.default).join("\n");
}

/** De dónde salen las hojas (las pruebas lo reemplazan: fuera de Vite no existe el sufijo ?raw). */
export const fuente = { cargar: cargarHojas };

let hojasEnMemoria: Promise<string> | undefined;

export function VistaPrevia({ datos }: { datos: DatosVistaPrevia }) {
  const [hojas, setHojas] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    hojasEnMemoria ??= fuente.cargar();
    let vigente = true;
    hojasEnMemoria.then(
      (h) => vigente && setHojas(h),
      () => {
        hojasEnMemoria = undefined;
        if (vigente) setError(true);
      },
    );
    return () => {
      vigente = false;
    };
  }, []);

  const documento = useMemo(() => (hojas === null ? null : htmlVistaPrevia(datos, hojas)), [datos, hojas]);

  if (error) {
    return (
      <p className="aviso aviso-error" role="alert">
        No se pudo preparar la vista previa. Probá de nuevo.
      </p>
    );
  }
  if (documento === null) {
    return (
      <p className="cargando" role="status">
        Preparando la vista previa…
      </p>
    );
  }
  return (
    <>
      <p className="ayuda">Así se va a ver el artículo en el sitio, con lo que tenés escrito ahora (guardado o no).</p>
      {/* Sin scripts: la vista previa solo muestra. Los enlaces se abren en otra pestaña. */}
      <iframe className="vista-previa" title="Vista previa del artículo" srcDoc={documento} sandbox="allow-popups allow-popups-to-escape-sandbox" />
    </>
  );
}
