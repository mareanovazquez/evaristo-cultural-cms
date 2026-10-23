import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { ProveedorSesion } from "./sesion";
import "./estilos.css";

const contenedor = document.getElementById("root");
if (!contenedor) throw new Error("No se encontró el elemento #root");

// El panel se sirve bajo /admin/ (Express en producción, Vite en desarrollo).
createRoot(contenedor).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename="/admin">
        <ProveedorSesion>
          <App />
        </ProveedorSesion>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
