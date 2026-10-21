// Las páginas /prueba-layout/* son temporales y solo se sirven en desarrollo (astro dev) o con PRUEBA_LAYOUT=1.
export function pruebaLayoutHabilitada(): boolean {
  return import.meta.env.DEV || process.env["PRUEBA_LAYOUT"] === "1";
}
