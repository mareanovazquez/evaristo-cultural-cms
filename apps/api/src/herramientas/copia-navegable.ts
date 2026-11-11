// Copia navegable sin conexión del sitio público (pedido del 11/11/2026): una carpeta que se abre con cualquier navegador, sin servidor,
// sin base y sin internet, para que la editorial tenga todo lo publicado con el diseño del sitio nuevo.
//
// Levanta crearApp en un puerto efímero de 127.0.0.1 (como test:humo) contra la real en SOLO LECTURA (el sitio no escribe en la base),
// recorre el sitio desde la portada y desde la lista de artículos publicados, y guarda cada página como HTML con los enlaces reescritos a
// rutas relativas, para que funcione abriéndola desde el disco (file://).
//   - Las imágenes van en una sola versión de hasta ANCHO px (sin srcset), para que la copia pese menos.
//   - Las tipografías de Google Fonts se bajan y quedan adentro (licencia OFL). Si no hay internet, quedan enlazadas en línea.
//   - El buscador, el feed y el panel no van: los enlaces al buscador se sacan y los demás quedan como texto.
//   - Los nombres de archivo quedan en ASCII (sin tildes ni espacios), así la carpeta se comprime y se mueve sin que se rompan.
//   - Los enlaces a URLs viejas de WordPress (dentro de los artículos) se resuelven con las redirecciones del sitio.
//
// Requiere: npm run build:sitio, la base real en el 3308 y la carpeta de los originales.
// Uso: npm run copia:navegable -w @evaristo/api -- --originales="<carpeta>" --salida="<carpeta nueva>" [--variantes="<caché>"]
//   --variantes   caché de las imágenes achicadas (se puede borrar al terminar). Por defecto, una carpeta en el temporal del sistema.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { rutaArticulo } from "@evaristo/compartido/urls";
import { crearApp } from "../app.js";

/** Ancho de las imágenes de la copia (uno de ANCHOS_VARIANTES). */
const ANCHO = 1200;
/** Pedidos en paralelo al sitio. */
const PARALELOS = 8;
/** Dominios del sitio: un enlace absoluto a ellos se trata como interno (los artículos viejos los tienen). */
const DOMINIOS = new Set(["evaristocultural.com.ar", "www.evaristocultural.com.ar"]);
/** Lo que no va en la copia: necesita el servidor o no es para el público. */
const EXCLUIDAS = /^\/(buscar|feed|admin|api|prueba-layout)(\/|$)/;
/** Agente para pedir el CSS de Google Fonts (con uno de navegador actual devuelve woff2). */
const AGENTE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

const argumento = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const dirMedia = argumento("originales") ?? process.env["MEDIA_DIR"];
if (!dirMedia || !existsSync(dirMedia) || !statSync(dirMedia).isDirectory()) fallar('falta la carpeta de originales: --originales="<carpeta>"');
const salida = argumento("salida");
if (!salida) fallar('falta la carpeta de salida: --salida="<carpeta nueva>"');
if (existsSync(salida) && readdirSync(salida).length > 0) fallar(`la carpeta de salida tiene que no existir o estar vacía: ${salida}`);
const dirVariantes = argumento("variantes") ?? join(tmpdir(), "evaristo-variantes-copia");
if (!existsSync(fileURLToPath(new URL("../../../sitio/dist/server/entry.mjs", import.meta.url)))) fallar("falta compilar el sitio: corré npm run build:sitio");
const url = process.env["DATABASE_URL"] ? new URL(process.env["DATABASE_URL"]) : undefined;
if (!url) fallar("falta DATABASE_URL en el .env");
if (url.port !== "3308" || decodeURIComponent(url.pathname.slice(1)) !== "evaristo_cms") {
  fallar(`DATABASE_URL apunta a ${url.hostname}:${url.port}${url.pathname}; la copia se hace desde evaristo_cms en el 3308`);
}

// Las carpetas se crean recién después de comprobar la conexión (si no, una corrida fallida deja la salida ocupada).
const dirSitio = join(salida, "sitio");

// ---------------------------------------------------------------- nombres de archivo

const corto = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

/** Un segmento de ruta en ASCII seguro; si hubo que cambiarlo, lleva un hash del original para que no choque con otro. */
function seguro(s: string): string {
  const limpio = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return limpio === s && limpio !== "" ? limpio : `${limpio || "x"}-${corto(s)}`;
}

/** Igual que seguro(), pero conserva la extensión al final. */
function seguroConExtension(nombre: string): string {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(nombre)!;
  const base = m[1] ?? "";
  const ext = m[2] ?? "";
  const limpio = seguro(base);
  return limpio === base ? nombre : `${limpio}${ext.toLowerCase()}`;
}

const decodificar = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function archivoDePagina(ruta: string): string {
  const u = new URL(ruta, "http://x");
  const segmentos = u.pathname.split("/").filter(Boolean).map((s) => seguro(decodificar(s)));
  const pagina = u.searchParams.get("pagina");
  let nombre = pagina && pagina !== "1" ? `pagina-${seguro(pagina)}` : "index";
  if ([...u.searchParams.keys()].some((k) => k !== "pagina")) nombre += `-${corto(u.search)}`;
  return [...segmentos, `${nombre}.html`].join("/");
}

function archivoDeRecurso(ruta: string): string {
  const u = new URL(ruta, "http://x");
  const segmentos = u.pathname.split("/").filter(Boolean).map(decodificar);
  if (segmentos[0] === "media") return `media/${seguroConExtension(segmentos.slice(1).join("/"))}`;
  const ultimo = segmentos.pop() ?? "recurso";
  return [...segmentos.map(seguro), seguroConExtension(ultimo)].join("/");
}

// Windows no distingue mayúsculas: dos rutas distintas no pueden ir a parar al mismo archivo.
const duenoDeArchivo = new Map<string, string>();
function reservar(archivo: string, ruta: string): string {
  const k = archivo.toLowerCase();
  const dueno = duenoDeArchivo.get(k);
  if (dueno === undefined || dueno === ruta) {
    duenoDeArchivo.set(k, ruta);
    return archivo;
  }
  const otro = archivo.replace(/(\.[A-Za-z0-9]{1,5})$/, `-${corto(ruta)}$1`);
  return reservar(otro, ruta);
}

function escribir(archivo: string, contenido: string | Uint8Array): void {
  const destino = join(dirSitio, ...archivo.split("/"));
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido);
}

/** Ruta relativa de un archivo de la copia a otro (las dos relativas a sitio/). */
function relativo(desde: string, hacia: string): string {
  return posix.relative(posix.dirname(desde), hacia) || posix.basename(hacia);
}

// ---------------------------------------------------------------- servidor y recorrido

const prisma = obtenerClientePrisma();
let servidor: Server | undefined;

type Resultado =
  | { tipo: "pagina"; archivo: string }
  | { tipo: "recurso"; archivo: string }
  | { tipo: "externa"; url: string }
  | { tipo: "excluida" }
  | { tipo: "inexistente" };

const cache = new Map<string, Promise<Resultado>>();
const rutaDeArchivo = new Map<string, string>();
const paginasPorReescribir = new Set<string>();
const cssPorReescribir = new Set<string>();
const pendientes: Promise<unknown>[] = [];
const avisos: string[] = [];
let bytes = 0;

function limitador(n: number) {
  let activos = 0;
  const espera: (() => void)[] = [];
  return async <T>(tarea: () => Promise<T>): Promise<T> => {
    if (activos >= n) await new Promise<void>((r) => espera.push(r));
    activos++;
    try {
      return await tarea();
    } finally {
      activos--;
      espera.shift()?.();
    }
  };
}
const limite = limitador(PARALELOS);

try {
  const ahora = new Date();
  let publicados: { slug: string; publicadoEn: Date }[];
  try {
    const filas = await prisma.articulo.findMany({
      where: { estado: "PUBLICADO", publicadoEn: { lte: ahora } },
      select: { slug: true, publicadoEn: true },
    });
    publicados = filas.filter((f): f is { slug: string; publicadoEn: Date } => f.publicadoEn !== null);
  } catch (e) {
    fallar(`no hay conexión con evaristo_cms en el 3308 (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
  console.log(`Artículos publicados en la base: ${publicados.length}`);
  mkdirSync(dirSitio, { recursive: true });
  mkdirSync(dirVariantes, { recursive: true });

  servidor = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, { dirMedia, dirSubidas: undefined, dirVariantes, proxy: false }).listen(0, "127.0.0.1", () => listo(s));
  });
  const ORIGEN = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  /** Un enlace como ruta interna (path + consulta) y su fragmento; null si es externo o especial. */
  function interna(valor: string, rutaActual: string): { ruta: string; fragmento: string } | null {
    const v = valor.trim();
    if (v === "" || v.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(v)) return null;
    let u: URL;
    try {
      u = new URL(v, ORIGEN + rutaActual);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.origin !== ORIGEN && !DOMINIOS.has(u.hostname.toLowerCase())) return null;
    const fragmento = u.hash;
    if (u.pathname.startsWith("/media/")) return { ruta: u.pathname, fragmento };
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/.test(k)) u.searchParams.delete(k);
    if (u.searchParams.get("pagina") === "1") u.searchParams.delete("pagina");
    return { ruta: u.pathname + u.search, fragmento };
  }

  /** Busca los enlaces de una página sin armar el DOM (para seguir recorriendo). */
  function descubrir(html: string, rutaActual: string): void {
    for (const m of html.matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)) {
      const destino = interna(m[1]!.replace(/&amp;/g, "&"), rutaActual);
      if (destino && !EXCLUIDAS.test(destino.ruta)) pendientes.push(resolver(destino.ruta));
    }
  }

  type Pedido = Resultado | { tipo: "redirige"; destino: string };

  async function pedir(ruta: string): Promise<Pedido> {
    if (EXCLUIDAS.test(ruta)) return { tipo: "excluida" };
    const esMedia = ruta.startsWith("/media/");
    const pedido = esMedia && !/\.gif$/i.test(ruta) ? `${ruta}?w=${ANCHO}` : ruta;
    const r = await fetch(ORIGEN + pedido, { redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get("location");
      await r.body?.cancel();
      if (!location) return { tipo: "inexistente" };
      const destino = interna(location, ruta);
      if (!destino) return { tipo: "externa", url: new URL(location, ORIGEN + ruta).href };
      return { tipo: "redirige", destino: destino.ruta };
    }
    if (r.status !== 200) {
      await r.body?.cancel();
      if (r.status !== 404) avisos.push(`${ruta}: estado ${r.status}`);
      return { tipo: "inexistente" };
    }
    const tipo = (r.headers.get("content-type") ?? "").toLowerCase();
    const cuerpo = new Uint8Array(await r.arrayBuffer());
    bytes += cuerpo.byteLength;
    if (tipo.startsWith("text/html")) {
      const archivo = reservar(archivoDePagina(ruta), ruta);
      escribir(archivo, cuerpo);
      rutaDeArchivo.set(archivo, ruta);
      paginasPorReescribir.add(archivo);
      descubrir(Buffer.from(cuerpo).toString("utf8"), ruta);
      return { tipo: "pagina", archivo };
    }
    const archivo = reservar(archivoDeRecurso(ruta), ruta);
    escribir(archivo, cuerpo);
    if (tipo.startsWith("text/css")) {
      rutaDeArchivo.set(archivo, ruta);
      cssPorReescribir.add(archivo);
    }
    return { tipo: "recurso", archivo };
  }

  function resolver(ruta: string, cadena: readonly string[] = []): Promise<Resultado> {
    const enCache = cache.get(ruta);
    if (enCache) return enCache;
    const promesa = (async (): Promise<Resultado> => {
      try {
        const r = await limite(() => pedir(ruta));
        if (r.tipo !== "redirige") return r;
        if (cadena.includes(r.destino) || cadena.length > 5) {
          avisos.push(`${ruta}: redirección en círculo`);
          return { tipo: "inexistente" };
        }
        return await resolver(r.destino, [...cadena, ruta]);
      } catch (e) {
        avisos.push(`${ruta}: ${e instanceof Error ? e.message : String(e)}`);
        return { tipo: "inexistente" };
      }
    })();
    cache.set(ruta, promesa);
    return promesa;
  }

  async function drenar(): Promise<void> {
    while (pendientes.length > 0) await Promise.all(pendientes.splice(0));
  }

  // ---- tipografías

  let fuentes: Promise<string | undefined> | undefined;
  function bajarFuentes(hrefGoogle: string): Promise<string | undefined> {
    fuentes ??= (async () => {
      try {
        const r = await fetch(hrefGoogle, { headers: { "user-agent": AGENTE } });
        if (!r.ok) throw new Error(`estado ${r.status}`);
        let css = await r.text();
        const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]!))];
        for (const u of urls) {
          const f = await fetch(u);
          if (!f.ok) throw new Error(`estado ${f.status} en ${u}`);
          const nombre = `fuentes/${corto(u)}${posix.extname(new URL(u).pathname) || ".woff2"}`;
          const datos = new Uint8Array(await f.arrayBuffer());
          bytes += datos.byteLength;
          escribir(nombre, datos);
          css = css.split(u).join(relativo("fuentes/fuentes.css", nombre));
        }
        escribir("fuentes/fuentes.css", css);
        console.log(`Tipografías: ${urls.length} archivos`);
        return "fuentes/fuentes.css";
      } catch (e) {
        avisos.push(`tipografías: no se pudieron bajar (${e instanceof Error ? e.message : String(e)}); quedan en línea`);
        return undefined;
      }
    })();
    return fuentes;
  }

  // ---- reescritura

  /** El valor nuevo de un atributo, o null si el enlace va a algo que no está en la copia (buscador, feed, panel). */
  async function reescribirValor(valor: string, archivo: string, ruta: string, esEnlace: boolean): Promise<string | null> {
    const v = valor.trim();
    if (v.startsWith("//")) return `https:${v}`;
    const destino = interna(v, ruta);
    if (!destino) return valor;
    const r = await resolver(destino.ruta);
    switch (r.tipo) {
      case "pagina":
      case "recurso":
        return relativo(archivo, r.archivo) + destino.fragmento;
      case "externa":
        return r.url;
      case "excluida":
        return null;
      case "inexistente":
        return esEnlace ? relativo(archivo, "404.html") : valor;
    }
  }

  async function reescribirCssTexto(css: string, archivo: string, ruta: string): Promise<string> {
    const partes = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
    let salidaCss = css;
    for (const m of partes) {
      const nuevo = await reescribirValor(m[2]!, archivo, ruta, false);
      if (nuevo !== null && nuevo !== m[2]) salidaCss = salidaCss.split(m[0]).join(`url("${nuevo}")`);
    }
    return salidaCss;
  }

  // La reescritura va con expresiones sobre el HTML y no con un DOM: con jsdom, 3.800 páginas agotan la memoria. Alcanza porque el HTML
  // lo genera el propio sitio (atributos siempre entre comillas dobles); los <script>, <style> y comentarios se separan antes.
  const desescapar = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  /** Reemplaza cada coincidencia con el resultado (asíncrono) de f, en orden. */
  async function reemplazar(texto: string, re: RegExp, f: (m: RegExpExecArray) => Promise<string>): Promise<string> {
    let resultado = "";
    let desde = 0;
    for (const m of texto.matchAll(re)) {
      resultado += texto.slice(desde, m.index) + (await f(m as RegExpExecArray));
      desde = m.index + m[0].length;
    }
    return resultado + texto.slice(desde);
  }

  async function reescribirEtiqueta(etiqueta: string, archivo: string, ruta: string): Promise<string> {
    const nombre = /^<([a-zA-Z][\w-]*)/.exec(etiqueta)![1]!.toLowerCase();
    if (nombre === "use") return etiqueta;
    // Una sola versión de cada imagen.
    const sinSrcset = etiqueta.replace(/\s(?:srcset|sizes)="[^"]*"/g, "");
    return reemplazar(sinSrcset, /(\s)(href|src|poster|style)="([^"]*)"/g, async (m) => {
      const espacio = m[1]!;
      const atributo = m[2]!;
      const valor = desescapar(m[3]!);
      if (atributo === "style") {
        return valor.includes("url(") ? `${espacio}style="${escapar(await reescribirCssTexto(valor, archivo, ruta))}"` : m[0];
      }
      const nuevo = await reescribirValor(valor, archivo, ruta, nombre === "a" && atributo === "href");
      // Algo que no está en la copia: sin el atributo, un <a> queda como texto.
      if (nuevo === null) return "";
      return nuevo === valor ? m[0] : `${espacio}${atributo}="${escapar(nuevo)}"`;
    });
  }

  async function reescribirPagina(archivo: string): Promise<void> {
    const ruta = rutaDeArchivo.get(archivo)!;
    let html = readFileSync(join(dirSitio, ...archivo.split("/")), "utf8");

    html = html.replace(/<link\b[^>]*\brel="(?:preconnect|alternate)"[^>]*>\s*/g, "");
    // El buscador necesita el servidor: el ícono del header y el «Buscar» del menú del celular se sacan.
    html = html.replace(/<a class="buscar"[\s\S]*?<\/a>\s*/g, "").replace(/<a href="\/buscar\/">Buscar<\/a>/g, "");
    html = html.replace(/<source\b[^>]*\bsrcset="[^"]*"[^>]*>/g, "");

    const partes = html.split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->)/);
    for (let i = 0; i < partes.length; i++) {
      const parte = partes[i]!;
      if (i % 2 === 1) {
        if (parte.startsWith("<style") && parte.includes("url(")) partes[i] = await reescribirCssTexto(parte, archivo, ruta);
        continue;
      }
      partes[i] = await reemplazar(parte, /<[a-zA-Z][\w-]*\b[^>]*>/g, (m) => reescribirEtiqueta(m[0], archivo, ruta));
    }
    html = partes.join("");

    // Tipografías locales (después de lo anterior, que deja tal cual los enlaces externos).
    const fuente = /<link\b[^>]*\bhref="(https:\/\/fonts\.googleapis\.com\/[^"]*)"[^>]*>/.exec(html);
    if (fuente) {
      const local = await bajarFuentes(desescapar(fuente[1]!));
      if (local) html = html.replace(fuente[1]!, escapar(relativo(archivo, local)));
    }
    escribir(archivo, html);
  }

  // ---- recorrido

  const semillas = ["/", "/autores/", "/ultimas/", "/novedades/", ...publicados.map(rutaArticulo)];
  const t0 = Date.now();
  for (const s of semillas) pendientes.push(resolver(s));
  await drenar();
  console.log(`Recorrido: ${paginasPorReescribir.size} páginas en ${Math.round((Date.now() - t0) / 1000)} s`);

  // Página de «no encontrado», para los enlaces internos a algo que no existe.
  const r404 = await fetch(`${ORIGEN}/copia-navegable-pagina-inexistente/`);
  if (r404.status !== 404 || !(r404.headers.get("content-type") ?? "").startsWith("text/html")) fallar(`la página 404 dio ${r404.status}`);
  escribir("404.html", await r404.text());
  rutaDeArchivo.set("404.html", "/");
  paginasPorReescribir.add("404.html");

  const reescribirLimitado = limitador(4);
  const hechas = new Set<string>();
  while (paginasPorReescribir.size > 0 || cssPorReescribir.size > 0) {
    const lote = [...paginasPorReescribir];
    paginasPorReescribir.clear();
    let cuenta = 0;
    await Promise.all(
      lote.map((a) =>
        reescribirLimitado(async () => {
          if (hechas.has(a)) return;
          hechas.add(a);
          await reescribirPagina(a);
          if (++cuenta % 500 === 0) console.log(`  reescritas ${cuenta} de ${lote.length}`);
        }),
      ),
    );
    for (const a of [...cssPorReescribir]) {
      cssPorReescribir.delete(a);
      const destino = join(dirSitio, ...a.split("/"));
      escribir(a, await reescribirCssTexto(readFileSync(destino, "utf8"), a, rutaDeArchivo.get(a)!));
    }
    await drenar();
  }

  // ---- verificación

  const faltan: string[] = [];
  for (const a of publicados) {
    const r = await resolver(rutaArticulo(a));
    if (r.tipo !== "pagina" || !existsSync(join(dirSitio, ...r.archivo.split("/")))) faltan.push(rutaArticulo(a));
  }
  const resultados = await Promise.all([...cache.values()]);
  const recursos = resultados.filter((r) => r.tipo === "recurso").length;
  const inexistentes = [...cache.keys()].filter((_, i) => resultados[i]!.tipo === "inexistente");

  // ---- entrada y LEEME

  writeFileSync(
    join(salida, "Abrir Evaristo Cultural.html"),
    '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=sitio/index.html">\n<title>Evaristo Cultural</title>\n</head>\n<body>\n<p><a href="sitio/index.html">Abrir Evaristo Cultural</a></p>\n</body>\n</html>\n',
  );
  const fecha = ahora.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  writeFileSync(
    join(salida, "LEEME.txt"),
    [
      "EVARISTO CULTURAL — COPIA NAVEGABLE SIN CONEXIÓN",
      "================================================",
      "",
      `Generada el ${fecha} desde la base del sitio nuevo. Tiene los ${publicados.length} artículos publicados (de 2006 a 2026),`,
      "con sus imágenes, autores, secciones y categorías, tal como se ven en el sitio nuevo.",
      "",
      "CÓMO ABRIRLA",
      "",
      "  1. Si te llegó comprimida (.zip), primero descomprimila: clic derecho > «Extraer todo».",
      "     Desde adentro del .zip no funciona.",
      "  2. Abrí «Abrir Evaristo Cultural.html» con doble clic. Se abre en el navegador,",
      "     sin internet y sin instalar nada.",
      "",
      "  En Google Drive no se puede navegar: hay que descargarla a la computadora.",
      "",
      "QUÉ NO FUNCIONA EN LA COPIA",
      "",
      "  - El buscador (necesita un servidor): para encontrar una nota, usá las secciones,",
      "    las categorías, los autores o «Ver todo» en la portada.",
      "  - Los videos de YouTube y Vimeo, y los enlaces a otros sitios, necesitan internet.",
      "  - Las imágenes están en una versión de hasta 1200 píxeles de ancho, suficiente para",
      "    leer y mirar. Los originales en máxima calidad están en la copia de WordPress",
      "    (uploads-completo.tar).",
      "",
      "Es una copia de consulta: no se puede editar ni publicar desde acá.",
      "",
    ].join("\r\n"),
  );

  console.log("");
  console.log(`Páginas: ${hechas.size} · recursos: ${recursos} · ${(bytes / 1024 ** 3).toFixed(2)} GB descargados`);
  console.log(`Artículos publicados en la copia: ${publicados.length - faltan.length} de ${publicados.length}`);
  if (faltan.length) console.log(`FALTAN:\n  ${faltan.slice(0, 50).join("\n  ")}`);
  console.log(`Enlaces internos a algo que no existe: ${inexistentes.length}`);
  for (const r of inexistentes.slice(0, 30)) console.log(`  ${r}`);
  if (avisos.length) console.log(`Avisos (${avisos.length}):\n  ${avisos.slice(0, 50).join("\n  ")}`);
  console.log(`Copia en ${salida}`);
  if (faltan.length) process.exitCode = 1;
} finally {
  await new Promise<void>((listo) => {
    if (!servidor) return listo();
    servidor.close(() => listo());
    servidor.closeAllConnections();
  });
  await prisma.$disconnect();
}
