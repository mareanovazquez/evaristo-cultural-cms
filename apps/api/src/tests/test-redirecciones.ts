// Pruebas del manejador de redirecciones (src/redirecciones.ts) sin base de datos: un buscador falso y un "sitio" que responde 200.
// Levanta un servidor HTTP efímero en 127.0.0.1 con puerto asignado por el sistema y lo cierra al terminar.
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { cargarMapeo, destinoCategoriaWp } from "@evaristo/compartido/taxonomia";
import { cargarEtiquetasWp, originalDeMiniatura, rutaWordPress } from "@evaristo/compartido/rutas-wordpress";
import { armarFeed, baseDelSitio } from "../../../sitio/src/lib/feed.ts";
import { crearManejadorRedirecciones, destinoDe, type FilaRedireccion } from "../redirecciones.js";

let ok = 0;
const pruebas: Array<[string, () => Promise<void>]> = [];
const t = (name: string, fn: () => Promise<void>) => pruebas.push([name, fn]);

const pasado = new Date("2010-05-04T12:00:00Z");
const futuro = new Date(Date.now() + 10 * 24 * 3600 * 1000);
const art = (slug: string, estado = "PUBLICADO", publicadoEn: Date | null = pasado) => ({ slug, estado, publicadoEn });
const fila = (f: Partial<FilaRedireccion> & Pick<FilaRedireccion, "origen" | "tipo">): FilaRedireccion => ({ codigo: 301, destino: null, articulo: null, autor: null, ...f });

const filas: FilaRedireccion[] = [
  fila({ origen: "/2010/05/04/nombre-viejo/", tipo: "SLUG_ANTERIOR", articulo: art("nombre-nuevo") }),
  fila({ origen: "/2010/05/04/nombre-nuevo/", tipo: "ARTICULO", articulo: art("nombre-nuevo") }),
  fila({ origen: "/2010/05/03/otra-fecha/", tipo: "ARTICULO", articulo: art("otra-fecha") }),
  fila({ origen: "/2021/01/28/millie-jackson-%e2%80%8e-i-cry/", tipo: "ARTICULO", articulo: art("millie-jackson-i-cry") }),
  fila({ origen: "/2010/05/04/borrador/", tipo: "ARTICULO", articulo: art("borrador", "BORRADOR") }),
  fila({ origen: "/2010/05/04/programado/", tipo: "ARTICULO", articulo: art("programado", "PUBLICADO", futuro) }),
  fila({ origen: "/2010/05/04/sin-fecha/", tipo: "ARTICULO", articulo: art("sin-fecha", "PUBLICADO", null) }),
  fila({ origen: "/author/ana-perez-vieja/", tipo: "AUTOR", autor: { slug: "ana-perez", soloTexto: false } }),
  fila({ origen: "/author/redaccion/", tipo: "AUTOR", autor: { slug: "redaccion", soloTexto: true } }),
  fila({ origen: "/viejo/", tipo: "MANUAL", codigo: 302, destino: "/nuevo/" }),
  fila({ origen: "/externo/", tipo: "MANUAL", destino: "https://ejemplo.org/algo" }),
  fila({ origen: "/malo-1/", tipo: "MANUAL", destino: "//evil.com/" }),
  fila({ origen: "/malo-2/", tipo: "MANUAL", destino: "javascript:alert(1)" }),
  fila({ origen: "/malo-3/", tipo: "MANUAL", destino: "/\\evil.com" }),
  fila({ origen: "/malo-4/", tipo: "MANUAL", destino: null }),
];

// La base compara sin distinguir mayúsculas ni tildes: el falso devuelve candidatas parecidas, no solo las exactas.
const laxo = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
let consultas = 0;
let romper = false;
const buscar = async (candidatos: string[]) => {
  consultas++;
  if (romper) throw new Error("la base no responde");
  return filas.filter((f) => candidatos.some((c) => laxo(c) === laxo(f.origen)));
};

const app = express();
const mapeo = cargarMapeo();
app.use(crearManejadorRedirecciones(buscar, (ruta) => destinoCategoriaWp(ruta, mapeo)));
app.use((_req, res) => res.status(200).type("text/plain").send("sitio"));
const server = await new Promise<Server>((listo) => {
  const s = app.listen(0, "127.0.0.1", () => listo(s));
});
const puerto = (server.address() as AddressInfo).port;
const pedir = (ruta: string, metodo = "GET") =>
  new Promise<{ estado: number; ubicacion: string | undefined; cuerpo: string }>((resolver, rechazar) => {
    const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p: Buffer) => partes.push(p));
      res.on("end", () => resolver({ estado: res.statusCode ?? 0, ubicacion: res.headers.location, cuerpo: Buffer.concat(partes).toString() }));
    });
    req.on("error", rechazar);
    req.end();
  });
const aSitio = async (ruta: string) => {
  const r = await pedir(ruta);
  assert.equal(r.estado, 200, `${ruta} dio ${r.estado}`);
  assert.equal(r.cuerpo, "sitio", ruta);
};

t("slug anterior: 301 a la URL canónica del artículo", async () => {
  const r = await pedir("/2010/05/04/nombre-viejo/");
  assert.equal(r.estado, 301);
  assert.equal(r.ubicacion, "/2010/05/04/nombre-nuevo/");
});
t("URL vieja que ya es la canónica: no redirige, la atiende el sitio", async () => {
  await aSitio("/2010/05/04/nombre-nuevo/");
});
t("fecha distinta de la canónica: 301 a la canónica", async () => {
  const r = await pedir("/2010/05/03/otra-fecha/");
  assert.equal(r.estado, 301);
  assert.equal(r.ubicacion, "/2010/05/04/otra-fecha/");
});
t("sin barra final: un solo salto directo al destino", async () => {
  const r = await pedir("/2010/05/04/nombre-viejo");
  assert.equal(r.estado, 301);
  assert.equal(r.ubicacion, "/2010/05/04/nombre-nuevo/");
});
t("secuencias %XX en mayúscula y en minúscula encuentran la fila guardada", async () => {
  for (const ruta of ["/2021/01/28/millie-jackson-%e2%80%8e-i-cry/", "/2021/01/28/millie-jackson-%E2%80%8E-i-cry/", "/2021/01/28/millie-jackson-%E2%80%8E-i-cry"]) {
    const r = await pedir(ruta);
    assert.equal(r.estado, 301, ruta);
    assert.equal(r.ubicacion, "/2010/05/04/millie-jackson-i-cry/", ruta);
  }
});
t("la consulta (?a=b) se conserva", async () => {
  const r = await pedir("/2010/05/04/nombre-viejo/?utm=x&y=1");
  assert.equal(r.estado, 301);
  assert.equal(r.ubicacion, "/2010/05/04/nombre-nuevo/?utm=x&y=1");
});
t("autor: 301 a /author/<slug>/; autor de solo texto: sin redirección", async () => {
  const r = await pedir("/author/ana-perez-vieja/");
  assert.equal(r.estado, 301);
  assert.equal(r.ubicacion, "/author/ana-perez/");
  await aSitio("/author/redaccion/");
});
t("igualdad exacta: mayúsculas o tildes distintas no redirigen aunque la base las encuentre", async () => {
  for (const ruta of ["/Author/Ana-Perez-Vieja/", "/2010/05/04/NOMBRE-VIEJO/", "/author/ana-p%C3%A9rez-vieja/"]) await aSitio(ruta);
});
t("borrador, programado a futuro o sin fecha: no redirigen (el sitio dará 404)", async () => {
  for (const ruta of ["/2010/05/04/borrador/", "/2010/05/04/programado/", "/2010/05/04/sin-fecha/"]) await aSitio(ruta);
});
t("manual: respeta el código (302) y acepta rutas propias y http(s)", async () => {
  const a = await pedir("/viejo/");
  assert.equal(a.estado, 302);
  assert.equal(a.ubicacion, "/nuevo/");
  const b = await pedir("/externo/");
  assert.equal(b.estado, 301);
  assert.equal(b.ubicacion, "https://ejemplo.org/algo");
});
t("manual con destino peligroso o vacío (//host, javascript:, \\host): no redirige", async () => {
  for (const ruta of ["/malo-1/", "/malo-2/", "/malo-3/", "/malo-4/"]) await aSitio(ruta);
});
t("rutas sin fila, la portada y los métodos que no son GET/HEAD: pasan al sitio", async () => {
  await aSitio("/no-esta-en-la-tabla/");
  const antes = consultas;
  await aSitio("/");
  assert.equal(consultas, antes, "la portada no consulta la base");
  const post = await pedir("/2010/05/04/nombre-viejo/", "POST");
  assert.equal(post.estado, 200);
  assert.equal(post.cuerpo, "sitio");
  const head = await pedir("/2010/05/04/nombre-viejo/", "HEAD");
  assert.equal(head.estado, 301);
});
t("si la base falla, el pedido sigue al sitio", async () => {
  romper = true;
  try {
    await aSitio("/2010/05/04/nombre-viejo/");
  } finally {
    romper = false;
  }
});
t("categorías de WordPress: /category/<slug>/ va a la sección, la categoría, /novedades/ o la portada, sin consultar la base", async () => {
  const casos: Array<[string, string]> = [
    ["/category/resena/", "/seccion/resena/"],
    ["/category/seda/", "/seccion/asia/"],
    ["/category/resenas-seda/", "/seccion/asia/"],
    ["/category/resenas-historietas/", "/categoria/historieta/"],
    ["/category/tv-cine/", "/categoria/tv-y-cine/"],
    ["/category/series-tv/", "/categoria/tv-y-cine/"],
    ["/category/musica/", "/categoria/musica/"],
    ["/category/novedades/", "/novedades/"],
    ["/category/mexico/", "/"],
    ["/category/uncategorized/", "/"],
  ];
  const antes = consultas;
  for (const [ruta, destino] of casos) {
    const r = await pedir(ruta);
    assert.equal(r.estado, 301, ruta);
    assert.equal(r.ubicacion, destino, ruta);
  }
  assert.equal(consultas, antes, "las categorías no consultan la base");
});
t("categorías de WordPress: sin barra final, paginadas, con feed y con consulta", async () => {
  for (const ruta of ["/category/resena", "/category/resena/page/2/", "/category/resena/page/15", "/category/resena/feed/", "/category/resena/feed/atom/"]) {
    const r = await pedir(ruta);
    assert.equal(r.estado, 301, ruta);
    assert.equal(r.ubicacion, "/seccion/resena/", ruta);
  }
  assert.equal((await pedir("/category/resena/?paged=2")).ubicacion, "/seccion/resena/?paged=2");
  assert.equal((await pedir("/category/%72esena/")).ubicacion, "/seccion/resena/", "slug con %XX");
});
t("categorías de WordPress: lo que no es una categoría del mapeo sigue al sitio", async () => {
  for (const ruta of ["/category/", "/category/no-existe/", "/category/constructor/", "/category/__proto__/", "/category/resena/otra-cosa/", "/category/resena/page/x/", "/category/Resena/", "/category/%E0%A4%A/", "/categoria/resena/", "/seccion/resena/"]) await aSitio(ruta);
});
t("destinoDe: casos puros", async () => {
  assert.equal(destinoDe(fila({ origen: "/x/", tipo: "ARTICULO", articulo: art("a b") }), new Date("2011-01-01")), "/2010/05/04/a%20b/");
  assert.equal(destinoDe(fila({ origen: "/x/", tipo: "ARTICULO" })), undefined);
  assert.equal(destinoDe(fila({ origen: "/x/", tipo: "AUTOR" })), undefined);
});

// ---------- URLs de WordPress que no están en la tabla (Etapa 1, punto 5; 7/11/2026) ----------

const etiquetas = cargarEtiquetasWp();
const consultasWp: string[] = [];
const appWp = express();
appWp.use(
  crearManejadorRedirecciones(buscar, (ruta) => destinoCategoriaWp(ruta, mapeo), {
    rutaWp: (ruta, consulta) => rutaWordPress(ruta, consulta, mapeo, etiquetas),
    articuloPorWpId: async (wpId) => {
      consultasWp.push(`articulo ${wpId}`);
      return ({ 620: art("nota-620"), 621: art("borrador", "BORRADOR"), 622: art("futura", "PUBLICADO", futuro) } as Record<number, FilaRedireccion["articulo"]>)[wpId] ?? null;
    },
    autorPorWpUserId: async (id) => ({ 39: { slug: "osvaldo-gallone", soloTexto: false }, 2: { slug: "redaccion", soloTexto: true } } as Record<number, FilaRedireccion["autor"]>)[id] ?? null,
    // Como la base, compara sin mayúsculas ni tildes: el manejador tiene que elegir la exacta.
    imagenesPorNombre: async (nombre) =>
      [
        { clave: "tapa.jpg", nombreOriginal: "tapa.jpg" },
        { clave: "TAPA-wp123.jpg", nombreOriginal: "TAPA.jpg" },
        { clave: "cosecha-roja1.png", nombreOriginal: "cosecha-roja1.jpg" },
        { clave: "Perón.jpg", nombreOriginal: "Perón.jpg" },
      ].filter((i) => laxo(i.nombreOriginal) === laxo(nombre)),
  }),
);
appWp.use((_req, res) => res.status(200).type("text/plain").send("sitio"));
const serverWp = await new Promise<Server>((listo) => {
  const s = appWp.listen(0, "127.0.0.1", () => listo(s));
});
const puertoWp = (serverWp.address() as AddressInfo).port;
const pedirWp = (ruta: string) =>
  new Promise<{ estado: number; ubicacion: string | undefined; cuerpo: string }>((resolver, rechazar) => {
    const req = request({ host: "127.0.0.1", port: puertoWp, method: "GET", path: ruta }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p: Buffer) => partes.push(p));
      res.on("end", () => resolver({ estado: res.statusCode ?? 0, ubicacion: res.headers.location, cuerpo: Buffer.concat(partes).toString() }));
    });
    req.on("error", rechazar);
    req.end();
  });
const va = async (ruta: string, destino: string) => {
  const r = await pedirWp(ruta);
  assert.equal(r.estado, 301, `${ruta} dio ${r.estado}`);
  assert.equal(r.ubicacion, destino, ruta);
};
const sigue = async (ruta: string) => {
  const r = await pedirWp(ruta);
  assert.equal(r.estado, 200, `${ruta} dio ${r.estado} (${r.ubicacion ?? ""})`);
  assert.equal(r.cuerpo, "sitio", ruta);
};

t("wp: etiquetas al buscador con su nombre (con tildes, paginadas o en feed); una desconocida, con el slug", async () => {
  assert.ok(Object.keys(etiquetas.etiquetas).length > 5000);
  await va("/tag/narrativa-argentina/", "/buscar/?q=narrativa%20argentina");
  await va("/tag/japon/page/3/", `/buscar/?q=${encodeURIComponent("Japón")}`);
  await va("/tag/jazz/feed/", "/buscar/?q=Jazz");
  await va("/tag/harold-melvin-the-blue-notes", `/buscar/?q=${encodeURIComponent("Harold Melvin & the Blue Notes")}`);
  await va("/tag/no-existe-esta/", "/buscar/?q=no%20existe%20esta");
  await va("/?tag=japon", `/buscar/?q=${encodeURIComponent("Japón")}`);
});
t("wp: feeds: /feed/ lo atiende el sitio; sus variantes, los de comentarios y los de artículo y autor redirigen", async () => {
  await sigue("/feed/");
  for (const r of ["/feed/rss2/", "/feed/atom/", "/rss/", "/comments/feed/", "/?feed=rss2"]) await va(r, "/feed/");
  await va("/2010/05/04/nombre-nuevo/feed/", "/2010/05/04/nombre-nuevo/");
  await va("/2010/05/04/nombre-nuevo/amp/", "/2010/05/04/nombre-nuevo/");
  await va("/2010/05/04/nombre-nuevo/2/", "/2010/05/04/nombre-nuevo/");
  await va("/author/ana-perez/page/2/", "/author/ana-perez/");
  await va("/author/ana-perez/feed/", "/author/ana-perez/");
  // La categoría con feed sigue resolviéndose por el mapeo.
  await va("/category/resena/feed/", "/seccion/resena/");
});
t("wp: páginas fijas, archivos por fecha y paginación de la portada", async () => {
  await va("/home/", "/");
  await va("/rastros/", "/seccion/rastros/");
  await va("/historieta/", "/categoria/historieta/");
  await va("/literatura", "/categoria/literatura/");
  await va("/?page_id=69", "/seccion/rastros/");
  await va("/?page_id=23", "/");
  await sigue("/sample-page/");
  await sigue("/?page_id=2");
  for (const r of ["/2017/", "/2017/09/", "/2017/09/01/", "/2017/09/page/2/", "/page/4/"]) await va(r, "/ultimas/");
});
t("wp: ?p=ID al artículo (si se ve), ?author=ID al autor (si no es de solo texto), ?s= al buscador", async () => {
  await va("/?p=620", "/2010/05/04/nota-620/");
  await va("/?p=620&preview=true", "/2010/05/04/nota-620/");
  await sigue("/?p=621");
  await sigue("/?p=622");
  await sigue("/?p=999");
  await va("/?author=39", "/author/osvaldo-gallone/");
  await sigue("/?author=2");
  await va("/?s=borges%20ficciones", "/buscar/?q=borges%20ficciones");
  // Parámetros raros o de otra cosa: la portada.
  for (const r of ["/", "/?p=0", "/?p=abc", "/?p=-1", "/?s=", "/?utm_source=x", "/?pagina=2"]) await sigue(r);
});
t("wp: /wp-content/uploads/ a /media/<clave>: el nombre exacto, el renombrado, el BMP convertido y las miniaturas", async () => {
  await va("/wp-content/uploads/tapa.jpg", "/media/tapa.jpg");
  await va("/wp-content/uploads/TAPA.jpg", "/media/TAPA-wp123.jpg");
  await va("/wp-content/uploads/cosecha-roja1.jpg", "/media/cosecha-roja1.png");
  await va("/wp-content/uploads/tapa-300x200.jpg", "/media/tapa.jpg");
  await va(`/wp-content/uploads/${encodeURIComponent("Perón-1024x768.jpg")}`, `/media/${encodeURIComponent("Perón.jpg")}`);
  // Parecido pero no igual (la base no distingue): no se adivina; lo que no está, sigue (404 del sitio).
  for (const r of ["/wp-content/uploads/Tapa.jpg", "/wp-content/uploads/peron.jpg", "/wp-content/uploads/otra.pdf", "/wp-content/uploads/2010/05/tapa.jpg", "/wp-content/uploads/..", "/wp-content/uploads/%E0%A4%A"]) await sigue(r);
});
t("wp: rutas propias del sitio nuevo no se tocan", async () => {
  for (const r of ["/buscar/?q=x", "/ultimas/", "/novedades/", "/autores/", "/seccion/resena/", "/categoria/poesia/", "/author/ana-perez/", "/2010/05/04/nombre-nuevo/", "/media/tapa.jpg", "/feed/"]) {
    const res = await pedirWp(r);
    assert.ok(res.estado === 200 || (res.estado === 301 && res.ubicacion !== r), `${r}: ${res.estado} ${res.ubicacion ?? ""}`);
    if (!["/2010/05/04/nombre-nuevo/"].includes(r)) assert.equal(res.estado, 200, r);
  }
});
t("wp: originalDeMiniatura", async () => {
  assert.equal(originalDeMiniatura("foto-300x200.jpg"), "foto.jpg");
  assert.equal(originalDeMiniatura("foto-1x1.JPEG"), "foto.JPEG");
  assert.equal(originalDeMiniatura("foto.jpg"), undefined);
  assert.equal(originalDeMiniatura("300x200.jpg"), undefined);
});
t("feed: armarFeed escapa, usa direcciones completas y la base de SITIO_URL", async () => {
  const xml = armarFeed("https://evaristocultural.com.ar", [
    { titulo: `Tom & Jerry <"1">`, bajada: "Una bajada\u0001 con control", slug: "tom-y-jerry", publicadoEn: new Date("2026-11-01T10:00:00Z"), autores: ["Ana", "Luis O'Neill"] },
    { titulo: "Sin bajada", bajada: null, slug: "sin-bajada", publicadoEn: new Date("2026-10-01T10:00:00Z"), autores: [] },
  ]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.ok(xml.includes("<title>Tom &amp; Jerry &lt;&quot;1&quot;&gt;</title>"));
  assert.ok(xml.includes("<link>https://evaristocultural.com.ar/2026/11/01/tom-y-jerry/</link>"));
  assert.ok(xml.includes('<guid isPermaLink="true">https://evaristocultural.com.ar/2026/11/01/tom-y-jerry/</guid>'));
  assert.ok(xml.includes("<pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate>"));
  assert.ok(xml.includes("<lastBuildDate>Sun, 01 Nov 2026 10:00:00 GMT</lastBuildDate>"));
  assert.ok(xml.includes("<dc:creator>Luis O&apos;Neill</dc:creator>"));
  assert.ok(xml.includes("<description>Una bajada con control</description>"));
  assert.equal((xml.match(/<item>/g) ?? []).length, 2);
  assert.equal((xml.match(/<description>/g) ?? []).length, 2); // la del canal y la del primero
  assert.ok(xml.includes('<atom:link href="https://evaristocultural.com.ar/feed/" rel="self"'));
  assert.equal(baseDelSitio("http://127.0.0.1:3000", "https://evaristocultural.com.ar/"), "https://evaristocultural.com.ar");
  assert.equal(baseDelSitio("http://127.0.0.1:3000", undefined), "http://127.0.0.1:3000");
  assert.equal(baseDelSitio("http://127.0.0.1:3000", "javascript:alert(1)"), "http://127.0.0.1:3000");
  assert.ok(armarFeed("https://x.ar", []).includes("<channel>"));
});

let fallo: unknown;
try {
  for (const [name, fn] of pruebas) {
    await fn();
    ok++;
    console.log("ok", name);
  }
} catch (e) {
  fallo = e;
} finally {
  for (const s of [server, serverWp]) {
    s.closeAllConnections();
    s.close();
  }
}
if (fallo) {
  console.error("FALLÓ:", fallo);
  process.exit(1);
}
console.log(`\n${ok} pruebas de redirecciones ok`);
