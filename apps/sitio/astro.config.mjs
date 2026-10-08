import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Salida SSR en modo middleware: Express (apps/api) monta el handler de Astro.
// El puerto 4321 es solo para `astro dev` (npm run dev:sitio).
export default defineConfig({
  output: "server",
  adapter: node({ mode: "middleware" }),
  server: { host: "127.0.0.1", port: 4321 },
});
