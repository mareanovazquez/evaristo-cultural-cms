import { Component, type ErrorInfo, type ReactNode } from "react";

// Si una pantalla falla al dibujarse, en vez de dejar la página en blanco se muestra un aviso en lenguaje común con la forma de seguir.
// Con `claveDeReinicio` (por ejemplo, la dirección de la pantalla) el aviso se va al ir a otra pantalla. No se muestra ningún detalle técnico.

interface Props {
  children: ReactNode;
  claveDeReinicio?: string;
}

export class ErrorBoundary extends Component<Props, { fallo: boolean }> {
  override state = { fallo: false };

  static getDerivedStateFromError(): { fallo: boolean } {
    return { fallo: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Queda en la consola del navegador para quien dé soporte; la persona no ve nada de esto.
    console.error("Falló una pantalla del panel:", error, info.componentStack);
  }

  override componentDidUpdate(anterior: Props): void {
    if (this.state.fallo && anterior.claveDeReinicio !== this.props.claveDeReinicio) this.setState({ fallo: false });
  }

  override render(): ReactNode {
    if (!this.state.fallo) return this.props.children;
    return (
      <section className="pantalla error-pantalla" role="alert">
        <h1>Algo salió mal en esta pantalla</h1>
        <p>Lo que ya guardaste está a salvo. Si estabas escribiendo, lo último que hiciste puede no haberse guardado.</p>
        <p className="acciones-fila">
          <button type="button" className="boton boton-primario" onClick={() => window.location.reload()}>
            Recargar la pantalla
          </button>
          <a className="boton boton-suave boton-enlace" href="/admin/">
            Volver a los artículos
          </a>
        </p>
        <p className="ayuda">Si vuelve a pasar, avisale a quien administra el sitio y contale qué estabas haciendo.</p>
      </section>
    );
  }
}
