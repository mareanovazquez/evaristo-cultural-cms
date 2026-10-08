import { defineMiddleware } from "astro:middleware";

// El adaptador de Node responde las páginas HTML como `text/html` a secas, sin charset.
// Acá lo completamos para todas las páginas, así las nuevas no tienen que declararlo.
export const onRequest = defineMiddleware(async (_context, next) => {
  const respuesta = await next();
  const tipo = respuesta.headers.get("Content-Type");
  if (!tipo?.toLowerCase().startsWith("text/html") || /charset=/i.test(tipo)) {
    return respuesta;
  }

  // Se arma una Response nueva (conserva el cuerpo en streaming, el estado y los demás encabezados).
  const encabezados = new Headers(respuesta.headers);
  encabezados.set("Content-Type", "text/html; charset=utf-8");
  return new Response(respuesta.body, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: encabezados,
  });
});
