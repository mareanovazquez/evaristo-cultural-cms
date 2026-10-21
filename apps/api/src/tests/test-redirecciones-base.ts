// Comprueba las redirecciones de la tabla `redirecciones` (evaristo_cms, 3308, solo lectura) contra el sitio compilado.
// Para cada origen: o es la URL canónica (200) o redirige con 301 a la canónica, que responde 200.
// Levanta crearApp en 127.0.0.1 con puerto efímero.
//
// Requiere: npm run build:sitio.
// Uso: npm run test:redirecciones-base
import { existsSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { crearApp } from "../app.js";

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

if (!existsSync(fileURLToPath(new URL("../../../sitio/dist/server/entry.mjs", import.meta.url)))) fallar("falta compilar el sitio: corré npm run build:sitio");
const url = process.env["DATABASE_URL"] ? new URL(process.env["DATABASE_URL"]) : undefined;
if (!url) fallar("falta DATABASE_URL en el .env");
if (url.port !== "3308" || decodeURIComponent(url.pathname.slice(1)) !== "evaristo_cms") {
  fallar(`DATABASE_URL apunta a ${url.hostname}:${url.port}${url.pathname}; esta prueba solo corre contra evaristo_cms en el 3308`);
}

const dos = (n: number) => String(n).padStart(2, "0");
const canonicaArticulo = (slug: string, d: Date) => `/${d.getUTCFullYear()}/${dos(d.getUTCMonth() + 1)}/${dos(d.getUTCDate())}/${encodeURIComponent(slug)}/`;
const mismoPath = (a: string, b: string) => decodeURIComponent(a) === decodeURIComponent(b);

const prisma = obtenerClientePrisma();
let server: Server | undefined;
const problemas: string[] = [];
try {
  let filas;
  try {
    filas = await prisma.redireccion.findMany({
      select: {
        origen: true,
        tipo: true,
        codigo: true,
        destino: true,
        articulo: { select: { slug: true, estado: true, publicadoEn: true } },
        autor: { select: { slug: true, soloTexto: true } },
      },
      orderBy: { origen: "asc" },
    });
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (ruta: string) =>
    new Promise<{ estado: number; ubicacion: string | undefined }>((resolver, rechazar) => {
      const req = request({ host: "127.0.0.1", port: puerto, path: ruta }, (res) => {
        res.resume();
        res.on("end", () => resolver({ estado: res.statusCode ?? 0, ubicacion: res.headers.location }));
      });
      req.on("error", rechazar);
      req.end();
    });

  let canonicas = 0;
  let redirigidas = 0;
  const ahora = new Date();
  for (const f of filas) {
    const falla = (m: string) => problemas.push(`${f.tipo} ${f.origen}: ${m}`);
    // Destino esperado, calculado acá de forma independiente del manejador
    let esperado: string | undefined;
    if (f.tipo === "ARTICULO" || f.tipo === "SLUG_ANTERIOR") {
      if (f.articulo?.estado === "PUBLICADO" && f.articulo.publicadoEn && f.articulo.publicadoEn <= ahora) esperado = canonicaArticulo(f.articulo.slug, f.articulo.publicadoEn);
    } else if (f.tipo === "AUTOR") {
      if (f.autor && !f.autor.soloTexto) esperado = `/author/${encodeURIComponent(f.autor.slug)}/`;
    } else {
      esperado = f.destino ?? undefined;
    }
    if (!esperado) {
      const r = await pedir(f.origen);
      if (r.estado !== 404) falla(`sin destino visible: se esperaba 404 y dio ${r.estado}`);
      continue;
    }

    // Variantes del mismo pedido: tal cual, con %XX en mayúscula y sin la barra final
    const variantes = new Set([f.origen, f.origen.replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase()), f.origen.replace(/\/$/, "")]);
    for (const v of variantes) {
      const r = await pedir(v);
      if (mismoPath(v, esperado)) {
        if (r.estado !== 200) falla(`${v} es la canónica y dio ${r.estado}`);
      } else if (r.estado !== 301 && r.estado !== f.codigo) {
        falla(`${v} dio ${r.estado}, se esperaba ${f.codigo}`);
      } else if (r.ubicacion === undefined || !mismoPath(r.ubicacion, esperado)) {
        falla(`${v} redirige a ${String(r.ubicacion)}, se esperaba ${esperado}`);
      }
    }

    // El destino responde 200 y no encadena otra redirección
    if (esperado.startsWith("/")) {
      const fin = await pedir(esperado);
      if (fin.estado !== 200) falla(`el destino ${esperado} dio ${fin.estado}`);
    }
    if (mismoPath(f.origen, esperado)) canonicas++;
    else redirigidas++;
  }

  const porTipo = filas.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.tipo]: (acc[f.tipo] ?? 0) + 1 }), {});
  console.log(`Redirecciones en la base: ${filas.length} ${JSON.stringify(porTipo)}.`);
  console.log(`${canonicas} orígenes ya son la URL canónica (200, sin redirigir) y ${redirigidas} redirigen con 301 a un destino que responde 200.`);
  if (problemas.length) fallar(`${problemas.length} problemas:\n  - ${problemas.slice(0, 40).join("\n  - ")}`);
  console.log("\nOK: todas las redirecciones de la base llevan a una página que responde.");
} finally {
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
