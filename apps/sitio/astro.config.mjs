import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Salida SSR en modo middleware: Express (apps/api) monta el handler de Astro.
// El puerto 4321 es solo para `astro dev` (npm run dev:sitio).
//
// Política de contenido (CSP, paso 8 de la fase 4): Astro calcula los hashes de sus scripts y estilos propios y los manda en la cabecera
// Content-Security-Policy de cada página (en modo servidor la manda como cabecera, no como etiqueta <meta>). Acá se agrega lo que el sitio usa de afuera:
//  - Google Fonts (hoja de estilos y tipografías), y los videos de YouTube (sin cookies) y de Vimeo, que el renderizador del cuerpo incrusta.
//  - Estilos en línea ('unsafe-inline'): las fotos usan style="object-position: …" (punto focal) y Astro no permite configurar style-src-attr aparte.
// Las demás cabeceras (nosniff, referrer, y la política de lo que Astro no sirve, como /media) las agrega Express (apps/api/src/seguridad.ts).
export default defineConfig({
  output: "server",
  adapter: node({ mode: "middleware" }),
  server: { host: "127.0.0.1", port: 4321 },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self' https://fonts.gstatic.com",
        "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ],
      // 'unsafe-inline' en estilos por los atributos style (Astro no deja configurar style-src-attr aparte); los scripts quedan estrictos, solo con hash.
      styleDirective: { resources: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"] },
    },
  },
});
