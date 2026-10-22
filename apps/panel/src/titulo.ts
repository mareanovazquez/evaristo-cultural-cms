import { useEffect } from "react";

const BASE = "Panel de Evaristo Cultural";

/** Pone el título de la pestaña (lo primero que lee un lector de pantalla al cambiar de pantalla). */
export function useTitulo(texto: string): void {
  useEffect(() => {
    document.title = texto ? `${texto} · ${BASE}` : BASE;
  }, [texto]);
}
