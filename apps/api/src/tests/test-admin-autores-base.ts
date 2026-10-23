// Prueba de los autores del panel (src/admin/autores.ts) con la base de verdad, SOLO contra evaristo_cms_dev.
// Crea usuarios, fichas y artículos temporales y los borra al terminar. Comprueba: permisos por rol, listado con búsqueda y filtros,
// validaciones (bio, redes, dirección, foto), cambio de dirección con redirección, conflicto de versión, eliminar y unir sin perder
// artículos ni repetir autores (incluidos los cambios sin publicar).
//
// Uso: npm run test:admin-autores
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { crearApp } from "../app.js";
import { hashearClave } from "../auth/clave.js";
import { NOMBRE_COOKIE } from "../auth/rutas.js";
import { elegirBase } from "../entorno.js";

function fallar(mensaje: string): never {
  console.error(`FALLÓ: ${mensaje}`);
  process.exit(1);
}

try {
  if (elegirBase(["--base-dev"]) !== "dev") fallar("no se pudo elegir la base de desarrollo");
} catch (e) {
  fallar(e instanceof Error ? e.message : String(e));
}
const url = new URL(process.env["DATABASE_URL"]!);
if (url.port !== "3308" || decodeURIComponent(url.pathname.slice(1)) !== "evaristo_cms_dev") fallar("esta prueba solo corre contra evaristo_cms_dev en el 3308");

type J = Record<string, any>;
const prisma = obtenerClientePrisma();
const sufijo = Date.now().toString(36);
const prefijo = `Autest ${sufijo}`;
const slugBase = `autest-${sufijo}`;
const dominio = `${sufijo}.ejemplo.org`;
const CLAVE = "clave-de-prueba-larga-1";
let server: Server | undefined;

const T = (text: string, marks?: J[]): J => ({ type: "text", text, ...(marks ? { marks } : {}) });
const P = (...content: J[]): J => ({ type: "paragraph", content });
const doc = (...content: J[]): J => ({ type: "doc", content });

try {
  await prisma.autor.count({ where: { usuarioId: null } }).catch(() => fallar("falta la migración de roles en evaristo_cms_dev (db:deploy)"));
  const mk = (email: string, rol: "ADMINISTRADOR" | "EDITOR" | "REDACTOR") => hashearClave(CLAVE).then((passwordHash) => prisma.usuario.create({ data: { email: `${email}@${dominio}`, nombre: `${prefijo} ${email}`, rol, passwordHash }, select: { id: true } }));
  const admin = await mk("admin", "ADMINISTRADOR");
  const editor = await mk("editor", "EDITOR");
  const redactor = await mk("redactor", "REDACTOR");
  const fichaRedactor = await prisma.autor.create({ data: { nombre: `${prefijo} Redactora`, slug: `${slugBase}-redactora`, usuarioId: redactor.id }, select: { id: true } });

  server = await new Promise<Server>((listo) => {
    const s = crearApp(prisma, {}).listen(0, "127.0.0.1", () => listo(s));
  });
  const puerto = (server.address() as AddressInfo).port;
  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, cookie?: string) =>
    new Promise<{ estado: number; json: J; texto: string; cookie: string | undefined }>((resolver, rechazar) => {
      const datos = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
      const req = request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(datos)) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let json: J = {};
          try {
            json = JSON.parse(texto) as J;
          } catch {
            /* no es JSON */
          }
          const set = res.headers["set-cookie"];
          resolver({ estado: res.statusCode ?? 0, json, texto, cookie: Array.isArray(set) ? set[0] : set });
        });
      });
      req.on("error", rechazar);
      if (datos) req.write(datos);
      req.end();
    });
  const como = async (email: string) => {
    const r = await pedir("POST", "/api/auth/ingresar", { email: `${email}@${dominio}`, clave: CLAVE });
    assert.equal(r.estado, 200, r.texto);
    const cookie = `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(r.cookie ?? "")?.[1] ?? ""}`;
    return (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, `/api/admin${ruta}`, cuerpo, cookie);
  };
  const ana = await como("admin");
  const edi = await como("editor");
  const red = await como("redactor");

  // ---------- A. Permisos ----------
  for (const [m, r] of [["GET", "/autores"], ["GET", "/autores/mia"], ["GET", "/autores/1"], ["POST", "/autores"], ["PUT", "/autores/1"], ["DELETE", "/autores/1"], ["POST", "/autores/1/unir"]] as const) {
    assert.equal((await pedir(m, `/api/admin${r}`, m === "GET" || m === "DELETE" ? undefined : {})).estado, 401, `${m} ${r} sin sesión`);
  }
  assert.equal((await red("GET", "/autores")).estado, 403, "el redactor no ve el listado");
  assert.equal((await red("POST", "/autores", { nombre: "X" })).estado, 403, "ni crea autores");
  assert.equal((await red("DELETE", `/autores/${fichaRedactor.id}`)).estado, 403);
  assert.equal((await red("POST", `/autores/${fichaRedactor.id}/unir`, { destinoId: 1 })).estado, 403);
  assert.equal((await edi("DELETE", `/autores/${fichaRedactor.id}`)).estado, 403, "el editor no elimina");
  assert.equal((await edi("POST", `/autores/${fichaRedactor.id}/unir`, { destinoId: 1 })).estado, 403, "ni une");
  const mia = await red("GET", "/autores/mia");
  assert.equal(mia.json["id"], fichaRedactor.id);
  assert.equal((await edi("GET", "/autores/mia")).estado, 404, "quien no tiene ficha no tiene «mi ficha»");

  // ---------- B. Crear, listar y buscar ----------
  assert.equal((await edi("POST", "/autores", { nombre: "  " })).estado, 422);
  assert.equal((await edi("POST", "/autores", { nombre: "X", slug: "Con Mayúsculas" })).estado, 422, "dirección con formato inválido");
  assert.equal((await edi("POST", "/autores", { nombre: "X", otro: 1 })).estado, 422);
  const creado = await edi("POST", "/autores", { nombre: `${prefijo} Álvaro Núñez` });
  assert.equal(creado.estado, 201, creado.texto);
  const alvaroId = creado.json["id"] as number;
  const alvaro = await prisma.autor.findUniqueOrThrow({ where: { id: alvaroId }, select: { slug: true } });
  assert.match(alvaro.slug, /^autest-[a-z0-9]+-alvaro-nunez$/, "la dirección sale del nombre, sin tildes");
  assert.equal((await edi("POST", "/autores", { nombre: "Otro", slug: alvaro.slug })).estado, 422, "la dirección tiene que ser única");
  const repetido = await edi("POST", "/autores", { nombre: `${prefijo} Álvaro Núñez` });
  assert.equal(repetido.estado, 201, "el mismo nombre genera otra dirección");
  const alvaro2Id = repetido.json["id"] as number;

  const lista = await edi("GET", `/autores?q=${encodeURIComponent(prefijo)}`);
  assert.equal(lista.estado, 200);
  assert.ok(lista.json["total"] === 3);
  const fila = (lista.json["autores"] as J[]).find((a) => a["id"] === alvaroId)!;
  assert.deepEqual({ conBio: fila["conBio"], conFoto: fila["conFoto"], articulos: fila["articulos"], soloTexto: fila["soloTexto"] }, { conBio: false, conFoto: false, articulos: 0, soloTexto: false });
  assert.ok(!lista.texto.includes("passwordHash"));
  assert.ok(((await edi("GET", `/autores?q=${encodeURIComponent(prefijo)}&filtro=sin-bio`)).json["autores"] as J[]).some((a) => a["id"] === alvaroId));
  assert.ok(((await edi("GET", `/autores?q=${encodeURIComponent(prefijo)}&filtro=con-usuario`)).json["autores"] as J[]).every((a) => a["usuario"] !== null));
  assert.equal((await edi("GET", "/autores?filtro=inventado")).estado, 400);

  // ---------- C. Guardar: validaciones ----------
  const lee = async (api: typeof edi, id: number) => (await api("GET", `/autores/${id}`)).json as J;
  const datosDe = (a: J, extra: J = {}): J => ({
    nombre: a["nombre"],
    bio: a["bio"],
    instagram: a["instagram"],
    x: a["x"],
    facebook: a["facebook"],
    sitioWeb: a["sitioWeb"],
    fotoId: a["fotoId"],
    fotoAlt: a["fotoAlt"],
    fotoPuntoFocalX: a["fotoPuntoFocalX"],
    fotoPuntoFocalY: a["fotoPuntoFocalY"],
    ...extra,
  });
  const guardar = (api: typeof edi, id: number, ficha: J, extra: J = {}, version?: string) => api("PUT", `/autores/${id}`, { version: version ?? ficha["autor"]["version"], datos: datosDe(ficha["autor"], extra) });
  const falla = (r: { estado: number; json: J }, texto: RegExp, mensaje: string) => {
    assert.equal(r.estado, 422, `${mensaje}: ${JSON.stringify(r.json)}`);
    assert.match(((r.json["problemas"] ?? []) as string[]).join(" | "), texto, mensaje);
  };
  let ficha = await lee(edi, alvaroId);
  assert.equal(ficha["puedeEditarTodo"], true);
  assert.equal(ficha["bioMax"], 500);
  falla(await guardar(edi, alvaroId, ficha, { nombre: "" }), /Escribí el nombre/, "nombre vacío");
  falla(await guardar(edi, alvaroId, ficha, { bio: doc({ type: "bulletList", content: [] }) }), /solo admite párrafos/, "lista en la bio");
  falla(await guardar(edi, alvaroId, ficha, { bio: doc(P(T("negrita", [{ type: "bold" }]))) }), /sin negrita/, "negrita en la bio");
  falla(await guardar(edi, alvaroId, ficha, { bio: doc(P(T("enlace", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))) }), /enlace que no es válido/, "enlace peligroso en la bio");
  falla(await guardar(edi, alvaroId, ficha, { bio: doc(P(T("a".repeat(501)))) }), /501 caracteres y el máximo es 500/, "bio de 501");
  falla(await guardar(edi, alvaroId, ficha, { instagram: "@usuario" }), /Instagram: pegá la dirección completa/, "red sin dirección completa");
  falla(await guardar(edi, alvaroId, ficha, { facebook: "ftp://facebook.com/x" }), /Facebook/, "red con otro protocolo");
  falla(await guardar(edi, alvaroId, ficha, { sitioWeb: "https://sinpunto" }), /El sitio web/, "sitio sin dominio");
  falla(await guardar(edi, alvaroId, ficha, { fotoId: 999_999_999 }), /foto elegida no está en la biblioteca/, "foto inexistente");
  falla(await guardar(edi, alvaroId, ficha, { fotoPuntoFocalX: 2 }), /entre 0 y 100/, "punto focal fuera de rango");
  falla(await guardar(edi, alvaroId, ficha, { slug: "Mal Formato" }), /dirección solo puede tener/, "dirección con formato inválido");
  assert.equal((await edi("PUT", `/autores/${alvaroId}`, { version: ficha["autor"]["version"], datos: { ...datosDe(ficha["autor"]), campoDeMas: 1 } })).estado, 422, "no acepta campos de más");

  // Guardar bien: bio justo de 500, redes, foto, sin cambiar la dirección
  const imagen = await prisma.imagen.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } });
  const bio500 = doc(P(T("a".repeat(250), [{ type: "italic" }])), P(T("b".repeat(249), [{ type: "link", attrs: { href: "https://ejemplo.org/libro" } }]), T("c")));
  const ok1 = await guardar(edi, alvaroId, ficha, { nombre: `${prefijo} Álvaro Núñez Peña`, bio: bio500, instagram: " https://instagram.com/alvaro ", x: "https://x.com/alvaro", sitioWeb: "https://alvaro.example.org", fotoId: imagen.id, fotoAlt: "  Retrato de Álvaro  ", fotoPuntoFocalX: 0.3, fotoPuntoFocalY: 0.7 });
  assert.equal(ok1.estado, 200, ok1.texto);
  const g = ok1.json["autor"] as J;
  assert.equal(g["nombre"], `${prefijo} Álvaro Núñez Peña`);
  assert.equal(g["instagram"], "https://instagram.com/alvaro", "se recortan los espacios");
  assert.equal(g["facebook"], null);
  assert.equal(g["fotoAlt"], "Retrato de Álvaro");
  assert.equal(g["foto"]["id"], imagen.id);
  assert.equal(g["slug"], alvaro.slug, "la dirección no cambió sin pedirlo");
  assert.notEqual(g["version"], ficha["autor"]["version"], "la versión avanza");
  // Vaciar: la bio sin texto queda en null y sin foto no queda texto alternativo
  const ok2 = await guardar(edi, alvaroId, { autor: g }, { bio: doc(P()), fotoId: null, fotoAlt: "huérfano" });
  assert.equal(ok2.estado, 200, ok2.texto);
  assert.equal(ok2.json["autor"]["bio"], null);
  assert.equal(ok2.json["autor"]["fotoAlt"], null);
  assert.equal(ok2.json["autor"]["foto"], null);
  // Conflicto: la misma versión vieja ya no sirve
  const viejo = await guardar(edi, alvaroId, { autor: g }, {}, g["version"]);
  assert.equal(viejo.estado, 409);
  assert.equal(viejo.json["estado"], "conflicto");

  // Una bio migrada que se pasa de 500 se puede guardar mientras no se toque; si se toca, tiene que cumplir
  const larga = doc(P(T("x".repeat(900))));
  const migrada = await prisma.autor.create({ data: { nombre: `${prefijo} Migrada`, slug: `${slugBase}-migrada`, bio: larga, instagram: "usuario_viejo" }, select: { id: true } });
  ficha = await lee(edi, migrada.id);
  const sinTocar = await guardar(edi, migrada.id, ficha, { nombre: `${prefijo} Migrada Y` });
  assert.equal(sinTocar.estado, 200, "cambiar solo el nombre no obliga a acortar la bio ni a corregir una red vieja: " + sinTocar.texto);
  assert.equal(sinTocar.json["autor"]["instagram"], "usuario_viejo");
  falla(await guardar(edi, migrada.id, { autor: sinTocar.json["autor"] }, { bio: doc(P(T("x".repeat(900) + "!"))) }), /el máximo es 500/, "al tocarla tiene que cumplir");
  falla(await guardar(edi, migrada.id, { autor: sinTocar.json["autor"] }, { instagram: "otro_usuario" }), /Instagram/, "al cambiar la red tiene que ser una dirección");
  const acortada = await guardar(edi, migrada.id, { autor: sinTocar.json["autor"] }, { bio: doc(P(T("Corta."))) });
  assert.equal(acortada.estado, 200);

  // ---------- D. Cambio de dirección y redirección ----------
  ficha = await lee(edi, alvaroId);
  const slugViejo = ficha["autor"]["slug"] as string;
  const slugNuevo = `${slugBase}-nuevo`;
  falla(await guardar(edi, alvaroId, ficha, { slug: `${slugBase}-redactora` }), /Ya hay un autor con esa dirección/, "dirección de otro autor");
  const cambio = await guardar(edi, alvaroId, ficha, { slug: slugNuevo });
  assert.equal(cambio.estado, 200, cambio.texto);
  const redir = await prisma.redireccion.findUnique({ where: { origen: `/author/${slugViejo}/` }, select: { tipo: true, autorId: true, codigo: true } });
  assert.deepEqual(redir, { tipo: "AUTOR", autorId: alvaroId, codigo: 301 }, "la dirección vieja redirige");
  // Otro autor no puede tomar la dirección vieja (la ocupa una redirección)
  falla(await guardar(edi, alvaro2Id, await lee(edi, alvaro2Id), { slug: slugViejo }), /Ya hay un autor con esa dirección/, "dirección vieja ocupada por una redirección");
  // Y volver a la vieja la libera
  const vuelta = await guardar(edi, alvaroId, await lee(edi, alvaroId), { slug: slugViejo });
  assert.equal(vuelta.estado, 200);
  assert.equal(await prisma.redireccion.count({ where: { origen: `/author/${slugViejo}/` } }), 0, "la redirección de la dirección que volvió a usarse se borra");
  assert.ok(await prisma.redireccion.findUnique({ where: { origen: `/author/${slugNuevo}/` } }), "y la que quedó atrás redirige");
  // El sitio la sirve
  const sitio = await fetch(`http://127.0.0.1:${puerto}/author/${slugNuevo}/`, { redirect: "manual" });
  assert.ok([301, 503].includes(sitio.status), `el sitio redirige o no está compilado (${sitio.status})`);
  if (sitio.status === 301) assert.equal(new URL(sitio.headers.get("location")!, "http://x").pathname, `/author/${slugViejo}/`);

  // ---------- E. El redactor edita solo su ficha ----------
  assert.equal((await red("GET", `/autores/${alvaroId}`)).estado, 404, "la ficha de otro no se ve");
  assert.equal((await red("PUT", `/autores/${alvaroId}`, { version: "x", datos: {} })).estado, 404, "ni se edita");
  const propia = await lee(red, fichaRedactor.id);
  assert.equal(propia["puedeEditarTodo"], false);
  const suya = await guardar(red, fichaRedactor.id, propia, { nombre: `${prefijo} Redactora Pérez`, bio: doc(P(T("Escribo."))) });
  assert.equal(suya.estado, 200, suya.texto);
  falla(await guardar(red, fichaRedactor.id, { autor: suya.json["autor"] }, { slug: `${slugBase}-otra` }), /los cambia un editor/, "no cambia su dirección");
  falla(await guardar(red, fichaRedactor.id, { autor: suya.json["autor"] }, { soloTexto: true }), /los cambia un editor/, "no se vuelve «solo texto»");
  assert.equal((await edi("PUT", `/autores/${fichaRedactor.id}`, { version: suya.json["autor"]["version"], datos: datosDe(suya.json["autor"], { slug: `${slugBase}-redactora-b`, soloTexto: false }) })).estado, 200, "el editor sí");

  // ---------- F. Eliminar ----------
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { interna: false }, select: { id: true } });
  const articulo = async (titulo: string, autores: number[]) =>
    prisma.articulo.create({
      data: { slug: `${slugBase}-${titulo}`, titulo: `${prefijo} ${titulo}`, cuerpo: { type: "doc", content: [] }, textoPlano: "", estado: "BORRADOR", seccionId: seccion.id, autores: { create: autores.map((autorId, orden) => ({ autorId, orden })) } },
      select: { id: true, autores: { select: { autorId: true } } },
    });
  const libre = await prisma.autor.create({ data: { nombre: `${prefijo} Libre`, slug: `${slugBase}-libre` }, select: { id: true } });
  const conNota = await prisma.autor.create({ data: { nombre: `${prefijo} Con nota`, slug: `${slugBase}-con-nota` }, select: { id: true } });
  const aNota = await articulo("nota-unica", [conNota.id]);
  const con = await ana("DELETE", `/autores/${conNota.id}`);
  assert.equal(con.estado, 409);
  assert.match(con.json["mensaje"], /1 artículo: no se puede eliminar/);
  assert.equal((await ana("DELETE", `/autores/${fichaRedactor.id}`)).estado, 409, "la ficha de un usuario no se elimina");
  await prisma.articuloBorrador.create({ data: { articuloId: aNota.id, datos: { autorIds: [libre.id] }, baseVersion: new Date(), usuarioId: admin.id } });
  const enBorrador = await ana("DELETE", `/autores/${libre.id}`);
  assert.equal(enBorrador.estado, 409, "figura en cambios sin publicar");
  await prisma.articuloBorrador.deleteMany({ where: { articuloId: aNota.id } });
  assert.equal((await ana("DELETE", `/autores/${libre.id}`)).estado, 200);
  assert.equal(await prisma.autor.count({ where: { id: libre.id } }), 0);
  assert.equal((await ana("DELETE", `/autores/${libre.id}`)).estado, 404);

  // ---------- G. Unir ----------
  const A = await prisma.autor.create({
    data: { nombre: `${prefijo} lucafrondoni`, slug: `${slugBase}-lucafrondoni`, bio: doc(P(T("Bio del sobrante"))), instagram: "https://instagram.com/luca", fotoId: imagen.id, fotoAlt: "Foto de Luca", fotoPuntoFocalX: 0.2, fotoPuntoFocalY: 0.4 },
    select: { id: true, slug: true },
  });
  const B = await prisma.autor.create({ data: { nombre: `${prefijo} Luca Frondoni`, slug: `${slugBase}-luca-frondoni`, x: "https://x.com/luca" }, select: { id: true, slug: true } });
  const C = await prisma.autor.create({ data: { nombre: `${prefijo} Tercero`, slug: `${slugBase}-tercero` }, select: { id: true } });
  await prisma.redireccion.create({ data: { origen: `/author/${slugBase}-viejo-de-a/`, tipo: "AUTOR", codigo: 301, autorId: A.id } });
  const art1 = await articulo("solo-a", [A.id]);
  const art2 = await articulo("a-y-b", [C.id, A.id, B.id]);
  const art3 = await articulo("solo-b", [B.id]);
  const art4 = await articulo("con-borrador", [C.id]);
  await prisma.articuloBorrador.create({ data: { articuloId: art4.id, datos: { autorIds: [C.id, A.id, B.id], titulo: "x" }, baseVersion: new Date(), usuarioId: admin.id } });
  const antes = await prisma.articuloAutor.count({ where: { autorId: { in: [A.id, B.id] } } });

  assert.equal((await ana("POST", `/autores/${A.id}/unir`, { destinoId: A.id })).estado, 422, "no se une consigo mismo");
  assert.equal((await ana("POST", `/autores/${A.id}/unir`, { destinoId: 999_999_999 })).estado, 422, "el elegido tiene que existir");
  assert.equal((await ana("POST", `/autores/${A.id}/unir`, {})).estado, 422);
  assert.equal((await ana("POST", `/autores/${fichaRedactor.id}/unir`, { destinoId: B.id })).estado, 409, "la ficha de un usuario no se une");
  const vista = await ana("GET", `/autores/${A.id}/unir?destinoId=${B.id}`);
  assert.equal(vista.estado, 200, vista.texto);
  assert.equal(vista.json["articulos"], 2);
  assert.deepEqual(vista.json["seCompleta"], ["la bio", "la foto", "la dirección de Instagram"]);
  assert.deepEqual(
    (vista.json["muestra"] as J[]).map((m) => [m["id"], m["yaTieneAlElegido"]]).sort(),
    [[art1.id, false], [art2.id, true]].sort(),
    "la vista previa marca los artículos que ya tienen a los dos",
  );
  assert.equal(await prisma.autor.count({ where: { id: A.id } }), 1, "la vista previa no cambia nada");

  const unir = await ana("POST", `/autores/${A.id}/unir`, { destinoId: B.id });
  assert.equal(unir.estado, 200, unir.texto);
  assert.equal(unir.json["movidos"], 2);
  assert.equal(await prisma.autor.count({ where: { id: A.id } }), 0, "el sobrante se borró");
  const firmas = async (id: number) => (await prisma.articuloAutor.findMany({ where: { articuloId: id }, orderBy: { orden: "asc" }, select: { autorId: true } })).map((x) => x.autorId);
  assert.deepEqual(await firmas(art1.id), [B.id], "el artículo del sobrante pasó al elegido");
  assert.deepEqual(await firmas(art2.id), [C.id, B.id], "el que tenía a los dos queda con uno solo y conserva el orden");
  assert.deepEqual(await firmas(art3.id), [B.id]);
  assert.equal(await prisma.articuloAutor.count({ where: { autorId: B.id } }), 3, "ni se perdió ni se repitió ningún artículo");
  assert.ok(antes >= 3);
  const borr = await prisma.articuloBorrador.findUniqueOrThrow({ where: { articuloId: art4.id }, select: { datos: true } });
  assert.deepEqual((borr.datos as J)["autorIds"], [C.id, B.id], "los cambios sin publicar nombran al elegido, sin repetirlo");
  assert.equal((borr.datos as J)["titulo"], "x", "y no pierden nada más");
  const b = await prisma.autor.findUniqueOrThrow({ where: { id: B.id }, select: { bio: true, instagram: true, x: true, fotoId: true, fotoAlt: true, fotoPuntoFocalX: true } });
  assert.deepEqual(b.bio, doc(P(T("Bio del sobrante"))), "se completó la bio");
  assert.equal(b.instagram, "https://instagram.com/luca", "y la red que faltaba");
  assert.equal(b.x, "https://x.com/luca", "sin pisar la que el elegido ya tenía");
  assert.deepEqual([b.fotoId, b.fotoAlt, b.fotoPuntoFocalX], [imagen.id, "Foto de Luca", 0.2], "y la foto con su texto y su punto focal");
  const rA = await prisma.redireccion.findUniqueOrThrow({ where: { origen: `/author/${A.slug}/` }, select: { tipo: true, autorId: true } });
  assert.deepEqual(rA, { tipo: "AUTOR", autorId: B.id }, "la dirección del sobrante redirige al elegido");
  assert.equal((await prisma.redireccion.findUniqueOrThrow({ where: { origen: `/author/${slugBase}-viejo-de-a/` }, select: { autorId: true } })).autorId, B.id, "y las redirecciones que ya tenía también");

  // Si el elegido ya tiene bio, la del sobrante no la pisa
  const D = await prisma.autor.create({ data: { nombre: `${prefijo} D`, slug: `${slugBase}-d`, bio: doc(P(T("Bio de D"))) }, select: { id: true } });
  const E = await prisma.autor.create({ data: { nombre: `${prefijo} E`, slug: `${slugBase}-e`, bio: doc(P(T("Bio de E"))) }, select: { id: true } });
  assert.deepEqual((await ana("GET", `/autores/${D.id}/unir?destinoId=${E.id}`)).json["seCompleta"], []);
  assert.equal((await ana("POST", `/autores/${D.id}/unir`, { destinoId: E.id })).estado, 200);
  assert.deepEqual((await prisma.autor.findUniqueOrThrow({ where: { id: E.id }, select: { bio: true } })).bio, doc(P(T("Bio de E"))));
  void alvaro2Id;

  console.log("OK: los autores funcionan contra evaristo_cms_dev (permisos por rol, búsqueda y filtros, validaciones de bio, redes, foto y dirección, conflicto, cambio de dirección con redirección, la ficha propia de un redactor, eliminar y unir sin perder artículos ni repetir autores).");
} finally {
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  await prisma.redireccion.deleteMany({ where: { origen: { contains: slugBase } } });
  await prisma.autor.deleteMany({ where: { OR: [{ nombre: { startsWith: prefijo } }, { slug: { startsWith: slugBase } }] } });
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${dominio}` } } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
