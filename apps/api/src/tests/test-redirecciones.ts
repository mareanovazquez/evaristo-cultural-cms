// Pruebas del manejador de redirecciones (src/redirecciones.ts) sin base de datos: un buscador falso y un "sitio" que responde 200.
// Levanta un servidor HTTP efímero en 127.0.0.1 con puerto asignado por el sistema y lo cierra al terminar.
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { cargarMapeo, destinoCategoriaWp } from "@evaristo/compartido/taxonomia";
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
  server.closeAllConnections();
  server.close();
}
if (fallo) {
  console.error("FALLÓ:", fallo);
  process.exit(1);
}
console.log(`\n${ok} pruebas de redirecciones ok`);
