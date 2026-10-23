// Prueba de los usuarios, los roles y la propiedad de los artículos (src/admin/usuarios.ts, src/app.ts) con la base de verdad,
// SOLO contra evaristo_cms_dev. Crea usuarios, fichas de autor y artículos temporales y los borra al terminar.
// Comprueba: permisos por rol, alta y duplicados, que el hash nunca salga, el último administrador, sesiones que se cortan al revocar el
// acceso, contraseña puesta por el administrador (cambio obligatorio) y que un Redactor solo vea, edite y publique lo suyo (lo ajeno, 404).
//
// Uso: npm run test:admin-usuarios
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
const prefijo = `Usrtest ${sufijo}`;
const dominio = `${sufijo}.ejemplo.org`;
const CLAVE = "clave-de-prueba-larga-1";
let server: Server | undefined;

const T = (text: string): J => ({ type: "text", text });
const P = (...content: J[]): J => ({ type: "paragraph", content });
const doc = (...content: J[]): J => ({ type: "doc", content });

try {
  await prisma.usuario.count({ where: { debeCambiarClave: false } }).catch(() => fallar("falta la migración de roles en evaristo_cms_dev (db:deploy)"));
  const admin = await prisma.usuario.create({ data: { email: `admin@${dominio}`, nombre: "Admin de prueba", rol: "ADMINISTRADOR", passwordHash: await hashearClave(CLAVE) }, select: { id: true } });
  const editor = await prisma.usuario.create({ data: { email: `editor@${dominio}`, nombre: "Editor de prueba", rol: "EDITOR", passwordHash: await hashearClave(CLAVE) }, select: { id: true } });
  const administradoresAntes = await prisma.usuario.count({ where: { rol: "ADMINISTRADOR", activo: true } });

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
  const ingresar = async (email: string, clave = CLAVE) => {
    const r = await pedir("POST", "/api/auth/ingresar", { email, clave });
    assert.equal(r.estado, 200, `ingreso de ${email}: ${r.texto}`);
    return `${NOMBRE_COOKIE}=${new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(r.cookie ?? "")?.[1] ?? ""}`;
  };
  const como = (cookie: string) => (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, `/api/admin${ruta}`, cuerpo, cookie);
  const ana = como(await ingresar(`admin@${dominio}`));
  const edi = como(await ingresar(`editor@${dominio}`));

  // ---------- A. Permisos de la administración de usuarios ----------
  for (const [m, r] of [["GET", "/usuarios"], ["POST", "/usuarios"], ["PATCH", "/usuarios/1"], ["POST", "/usuarios/1/desactivar"], ["POST", "/usuarios/1/clave"], ["GET", "/usuarios/autores-disponibles"]] as const) {
    assert.equal((await pedir(m, `/api/admin${r}`, m === "GET" ? undefined : {})).estado, 401, `${m} ${r} sin sesión`);
    assert.equal((await edi(m, r, m === "GET" ? undefined : {})).estado, 403, `${m} ${r} como editor`);
  }
  const lista0 = await ana("GET", "/usuarios");
  assert.equal(lista0.estado, 200);
  assert.ok(!lista0.texto.includes("passwordHash") && !lista0.texto.includes("scrypt$"), "el listado no devuelve el hash");

  // ---------- B. Alta ----------
  const alta = (extra: J) => ana("POST", "/usuarios", { email: `rita@${dominio}`, nombre: `${prefijo} Rita Redactora`, rol: "REDACTOR", clave: CLAVE, ficha: { modo: "crear" }, ...extra });
  assert.equal((await alta({ email: "no-es-un-email" })).estado, 422);
  assert.equal((await alta({ clave: "corta" })).estado, 422);
  assert.equal((await alta({ rol: "JEFE" })).estado, 422);
  assert.equal((await alta({ campoDeMas: 1 })).estado, 422, "no acepta campos de más");
  const sinFicha = await ana("POST", "/usuarios", { email: `rita@${dominio}`, nombre: `${prefijo} Rita`, rol: "REDACTOR", clave: CLAVE });
  assert.equal(sinFicha.estado, 422, "un redactor sin ficha de autor se rechaza");
  assert.equal(await prisma.usuario.count({ where: { email: `rita@${dominio}` } }), 0, "el rechazo no deja un usuario a medias");

  const rita = await alta({});
  assert.equal(rita.estado, 201, rita.texto);
  const u = rita.json["usuario"] as J;
  assert.equal(u["rol"], "REDACTOR");
  assert.equal(u["debeCambiarClave"], true);
  assert.equal(u["activo"], true);
  assert.ok(u["autor"] && u["autor"]["nombre"] === `${prefijo} Rita Redactora`, "se creó su ficha de autor");
  assert.ok(!rita.texto.includes("passwordHash") && !rita.texto.includes("scrypt$") && !rita.texto.includes(CLAVE), "la respuesta no trae la contraseña ni el hash");
  const ritaId = u["id"] as number;
  const fichaRita = u["autor"]["id"] as number;
  assert.equal((await alta({})).estado, 409, "el email repetido da 409");
  assert.equal((await alta({ email: `RITA@${dominio.toUpperCase()}` })).estado, 409, "el email se compara en minúsculas");

  // Enlazar una ficha existente: una ajena a otro usuario se rechaza; una libre se acepta.
  const fichaLibre = await prisma.autor.create({ data: { nombre: `${prefijo} Ficha libre`, slug: `usrtest-libre-${sufijo}` }, select: { id: true } });
  const disp = await ana("GET", `/usuarios/autores-disponibles?q=${encodeURIComponent(`${prefijo} Ficha`)}`);
  assert.deepEqual((disp.json["autores"] as J[]).map((a) => a["id"]), [fichaLibre.id], "la lista de fichas libres no incluye las ya enlazadas");
  const ocupada = await ana("POST", "/usuarios", { email: `ocupada@${dominio}`, nombre: `${prefijo} Otra`, rol: "REDACTOR", clave: CLAVE, ficha: { modo: "vincular", autorId: fichaRita } });
  assert.equal(ocupada.estado, 422);
  assert.equal(await prisma.usuario.count({ where: { email: `ocupada@${dominio}` } }), 0, "la ficha ocupada no deja un usuario a medias");
  const tomas = await ana("POST", "/usuarios", { email: `tomas@${dominio}`, nombre: `${prefijo} Tomás`, rol: "REDACTOR", clave: CLAVE, ficha: { modo: "vincular", autorId: fichaLibre.id } });
  assert.equal(tomas.estado, 201, tomas.texto);
  const tomasId = tomas.json["usuario"]["id"] as number;
  assert.equal((await ana("GET", "/usuarios/autores-disponibles")).json["autores"].some((a: J) => a["id"] === fichaLibre.id), false);

  // ---------- C. Primer ingreso: la contraseña del administrador solo sirve para elegir una propia ----------
  const cookieRita = await ingresar(`rita@${dominio}`);
  const r1 = como(cookieRita);
  const bloqueado = await r1("GET", "/articulos");
  assert.equal(bloqueado.estado, 403);
  assert.equal(bloqueado.json["codigo"], "cambiar_clave");
  const yo = await pedir("GET", "/api/auth/yo", undefined, cookieRita);
  assert.equal(yo.json["usuario"]["debeCambiarClave"], true);
  assert.deepEqual(yo.json["usuario"]["permisos"], ["articulos.crear"]);
  const cambio = await pedir("POST", "/api/auth/clave", { claveActual: CLAVE, claveNueva: "clave-propia-de-rita-9" }, cookieRita);
  assert.equal(cambio.estado, 200, cambio.texto);
  assert.equal((await r1("GET", "/articulos")).estado, 200, "con la contraseña propia ya puede usar el panel");
  assert.equal((await pedir("POST", "/api/auth/ingresar", { email: `rita@${dominio}`, clave: CLAVE })).estado, 401, "la que puso el administrador ya no sirve");

  // ---------- D. Un redactor solo ve, edita y publica lo suyo ----------
  const secciones = await prisma.seccion.findMany({ where: { interna: false }, orderBy: { id: "asc" }, take: 1, select: { id: true } });
  const imagen = await prisma.imagen.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } });
  const otraFicha = await prisma.autor.findFirstOrThrow({ where: { usuarioId: null, soloTexto: false, id: { not: fichaRita } }, orderBy: { id: "asc" }, select: { id: true } });
  const migrado = await prisma.articulo.findFirstOrThrow({ where: { wpId: { not: null } }, orderBy: { id: "asc" }, select: { id: true, actualizadoEn: true, creadoPorId: true } });
  assert.equal(migrado.creadoPorId, null, "los migrados no tienen creador");

  const crearComo = async (api: ReturnType<typeof como>, titulo: string) => {
    const r = await api("POST", "/articulos", { titulo: `${prefijo} ${titulo}`, seccionId: secciones[0]!.id });
    assert.equal(r.estado, 201, r.texto);
    return { id: r.json["id"] as number, version: r.json["version"] as string };
  };
  const datosDe = (titulo: string, autorIds: number[]): J => ({
    titulo: `${prefijo} ${titulo}`,
    bajada: null,
    cuerpo: doc(P(T("Texto del artículo de prueba."))),
    seccionId: secciones[0]!.id,
    categoriaIds: [],
    categoriaPrincipalId: null,
    autorIds,
    imagenEncabezadoId: imagen.id,
    encabezadoAlt: "Texto alternativo",
    encabezadoCredito: null,
    encabezadoPuntoFocalX: 0.5,
    encabezadoPuntoFocalY: 0.5,
    conCapital: false,
    novedadHasta: null,
  });

  const suyo = await crearComo(r1, "De Rita");
  const art = await prisma.articulo.findUniqueOrThrow({ where: { id: suyo.id }, select: { creadoPorId: true, autores: { select: { autorId: true } } } });
  assert.equal(art.creadoPorId, ritaId, "queda registrado quién lo creó");
  assert.deepEqual(art.autores.map((a) => a.autorId), [fichaRita], "el artículo nuevo de un redactor sale con su firma");
  const delEditor = await crearComo(edi, "Del editor");
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: delEditor.id }, select: { autores: true } })).autores.length, 0, "el del editor sale sin firma");

  const listaRita = await r1("GET", "/articulos?pagina=1");
  assert.deepEqual((listaRita.json["articulos"] as J[]).map((a) => a["id"]), [suyo.id], "el listado del redactor muestra solo lo suyo");
  assert.equal(listaRita.json["total"], 1);
  assert.equal(Object.values(listaRita.json["conteos"] as Record<string, number>).reduce((x, y) => x + y, 0), 1, "los conteos también");
  const listaEditor = await edi("GET", "/articulos");
  assert.ok((listaEditor.json["total"] as number) > 1 && (listaEditor.json["articulos"] as J[]).some((a) => a["id"] === delEditor.id), "el editor ve todos");

  // Lo ajeno (de otra persona o migrado) responde 404, en todas las rutas.
  const ajenos = [delEditor.id, migrado.id, 999_999_999];
  for (const id of ajenos) {
    const v = "2026-01-01T00:00:00.000Z";
    for (const [m, r, c] of [["GET", `/articulos/${id}`], ["PUT", `/articulos/${id}`, { version: v, datos: {} }], ["GET", `/articulos/${id}/publicacion`], ["POST", `/articulos/${id}/publicar`, { version: v }], ["POST", `/articulos/${id}/publicar-cambios`, { version: v }], ["POST", `/articulos/${id}/despublicar`, { version: v }], ["DELETE", `/articulos/${id}/borrador`], ["POST", `/articulos/${id}/pasar`, { usuarioId: ritaId }]] as Array<[string, string, J?]>) {
      const resp = await r1(m, r, c);
      assert.equal(resp.estado, 404, `${m} ${r} como redactor debe dar 404 y dio ${resp.estado}`);
    }
  }
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: delEditor.id }, select: { creadoPorId: true } })).creadoPorId, editor.id, "el 404 no cambió nada");
  assert.equal((await edi("GET", `/articulos/${migrado.id}`)).estado, 200, "el editor sí abre un migrado");

  // La firma: solo la propia (o dejar la que armó otra persona)
  const ver = suyo.version;
  const otraFirma = await r1("PUT", `/articulos/${suyo.id}`, { version: ver, datos: datosDe("De Rita", [otraFicha.id]) });
  assert.equal(otraFirma.estado, 422, "no puede firmar con otra ficha");
  const dosFirmas = await r1("PUT", `/articulos/${suyo.id}`, { version: ver, datos: datosDe("De Rita", [fichaRita, otraFicha.id]) });
  assert.equal(dosFirmas.estado, 422, "no puede sumar otras firmas");
  const sinFirma = await r1("PUT", `/articulos/${suyo.id}`, { version: ver, datos: datosDe("De Rita", []) });
  assert.equal(sinFirma.estado, 422, "no puede dejarlo sin su firma (si la tenía)");
  const guardado = await r1("PUT", `/articulos/${suyo.id}`, { version: ver, datos: datosDe("De Rita", [fichaRita]) });
  assert.equal(guardado.estado, 200, guardado.texto);

  // Publica lo suyo, con su dirección propia
  const pub = await r1("POST", `/articulos/${suyo.id}/publicar`, { version: guardado.json["version"] });
  assert.equal(pub.estado, 200, pub.texto);
  const leido = await r1("GET", `/articulos/${suyo.id}`);
  assert.equal(leido.json["articulo"]["estado"], "PUBLICADO");
  assert.equal(leido.json["articulo"]["creadoPor"]["id"], ritaId);

  // El catálogo de un redactor trae solo su ficha; el de un editor, todas y la lista de usuarios para pasar artículos.
  const catRita = await r1("GET", "/catalogos");
  assert.deepEqual((catRita.json["autores"] as J[]).map((a) => a["id"]), [fichaRita]);
  assert.deepEqual(catRita.json["usuarios"], []);
  const catEditor = await edi("GET", "/catalogos");
  assert.ok((catEditor.json["autores"] as J[]).length > 1 && (catEditor.json["usuarios"] as J[]).some((x) => x["id"] === ritaId));

  // Borrar imágenes: un redactor no puede (403); un editor sí tiene el permiso (con una que no existe da 404, y no se borra nada real).
  assert.equal((await r1("DELETE", "/imagenes/999999999")).estado, 403);
  assert.equal((await edi("DELETE", "/imagenes/999999999")).estado, 404);

  // Pasar un artículo a otra persona: lo hace un editor; la nueva dueña lo ve, la anterior ya no.
  const antesPasar = await prisma.articulo.findUniqueOrThrow({ where: { id: suyo.id }, select: { actualizadoEn: true } });
  assert.equal((await edi("POST", `/articulos/${suyo.id}/pasar`, { usuarioId: tomasId })).estado, 200);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: suyo.id }, select: { creadoPorId: true, actualizadoEn: true } })).creadoPorId, tomasId);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: suyo.id }, select: { actualizadoEn: true } })).actualizadoEn.getTime(), antesPasar.actualizadoEn.getTime(), "pasar un artículo no cambia su versión");
  assert.equal((await r1("GET", `/articulos/${suyo.id}`)).estado, 404, "la anterior dueña ya no lo ve");
  assert.equal((await edi("POST", `/articulos/${suyo.id}/pasar`, { usuarioId: 999_999_999 })).estado, 422);
  assert.equal((await edi("POST", `/articulos/${suyo.id}/pasar`, { usuarioId: tomasId, otro: 1 })).estado, 422);
  assert.equal((await edi("POST", `/articulos/${suyo.id}/pasar`, { usuarioId: ritaId })).estado, 200, "se le devuelve");

  // ---------- E. Revocar el acceso ----------
  assert.equal((await r1("GET", "/articulos")).estado, 200);
  const rev = await ana("POST", `/usuarios/${ritaId}/desactivar`);
  assert.equal(rev.estado, 200, rev.texto);
  assert.equal(rev.json["usuario"]["activo"], false);
  assert.equal((await r1("GET", "/articulos")).estado, 401, "su sesión dejó de servir en el acto");
  assert.equal(await prisma.sesion.count({ where: { usuarioId: ritaId } }), 0, "se borraron sus sesiones");
  assert.equal((await pedir("POST", "/api/auth/ingresar", { email: `rita@${dominio}`, clave: "clave-propia-de-rita-9" })).estado, 401, "no puede volver a entrar");
  const conservado = await prisma.articulo.findUniqueOrThrow({ where: { id: suyo.id }, select: { estado: true, creadoPorId: true, autores: { select: { autorId: true } } } });
  assert.equal(conservado.estado, "PUBLICADO");
  assert.deepEqual(conservado.autores.map((a) => a.autorId), [fichaRita], "su artículo conserva la firma");
  assert.equal((await prisma.autor.findUniqueOrThrow({ where: { id: fichaRita }, select: { usuarioId: true } })).usuarioId, ritaId, "su ficha sigue enlazada");
  const act = await ana("POST", `/usuarios/${ritaId}/activar`);
  assert.equal(act.estado, 200);
  assert.equal((await pedir("POST", "/api/auth/ingresar", { email: `rita@${dominio}`, clave: "clave-propia-de-rita-9" })).estado, 200, "se le puede volver a dar acceso");

  // ---------- F. Contraseña de otro, sesiones, nombre y rol ----------
  assert.equal((await ana("POST", `/usuarios/${ritaId}/clave`, { clave: "corta" })).estado, 422);
  assert.equal((await ana("POST", `/usuarios/${admin.id}/clave`, { clave: "otra-clave-larga-77" })).estado, 422, "la propia se cambia en Mi cuenta");
  const sesionAntes = await ingresar(`rita@${dominio}`, "clave-propia-de-rita-9");
  assert.equal((await ana("POST", `/usuarios/${ritaId}/clave`, { clave: "restablecida-por-admin-1" })).estado, 200);
  assert.equal((await como(sesionAntes)("GET", "/articulos")).estado, 401, "restablecer la contraseña corta sus sesiones");
  const trasRestablecer = await pedir("POST", "/api/auth/ingresar", { email: `rita@${dominio}`, clave: "restablecida-por-admin-1" });
  assert.equal(trasRestablecer.json["usuario"]["debeCambiarClave"], true, "tiene que elegir una propia otra vez");
  const sesionX = await ingresar(`rita@${dominio}`, "restablecida-por-admin-1");
  const cerradas = await ana("POST", `/usuarios/${ritaId}/cerrar-sesiones`);
  assert.equal(cerradas.estado, 200);
  assert.ok((cerradas.json["cerradas"] as number) >= 1);
  assert.equal((await como(sesionX)("GET", "/articulos")).estado, 401);

  assert.equal((await ana("PATCH", `/usuarios/${ritaId}`, { nombre: `${prefijo} Rita Gómez` })).json["usuario"]["nombre"], `${prefijo} Rita Gómez`);
  assert.equal((await ana("PATCH", `/usuarios/${ritaId}`, { rol: "EDITOR" })).json["usuario"]["rol"], "EDITOR", "cambio de rol");
  assert.equal((await ana("PATCH", `/usuarios/${ritaId}`, { rol: "REDACTOR" })).json["usuario"]["rol"], "REDACTOR");
  assert.equal((await ana("PATCH", `/usuarios/${ritaId}`, { email: "otro@x.org" })).estado, 422, "el email no se cambia por acá");
  assert.equal((await ana("PATCH", "/usuarios/999999999", { nombre: "X" })).estado, 404);
  const sinFichaEditor = editor;
  assert.equal((await ana("PATCH", `/usuarios/${sinFichaEditor.id}`, { rol: "REDACTOR" })).estado, 422, "no se hace redactor a quien no tiene ficha");
  assert.equal((await ana("POST", `/usuarios/${sinFichaEditor.id}/ficha`, { modo: "crear" })).estado, 200, "se le da una ficha");
  assert.equal((await ana("POST", `/usuarios/${sinFichaEditor.id}/ficha`, { modo: "crear" })).estado, 409, "y no una segunda");

  // ---------- G. El último administrador ----------
  // Se deja como único administrador activo al de la prueba (los reales, que haya, se desactivan y se reactivan al final).
  const otros = await prisma.usuario.findMany({ where: { rol: "ADMINISTRADOR", activo: true, id: { not: admin.id } }, select: { id: true } });
  await prisma.usuario.updateMany({ where: { id: { in: otros.map((o) => o.id) } }, data: { activo: false } });
  try {
    const ultimo = await ana("PATCH", `/usuarios/${admin.id}`, { rol: "EDITOR" });
    assert.equal(ultimo.estado, 409, "no se puede sacar el rol al último administrador");
    assert.equal((await ana("POST", `/usuarios/${admin.id}/desactivar`)).estado, 409, "ni desactivarlo (ni él mismo)");
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: admin.id }, select: { rol: true, activo: true } })).rol, "ADMINISTRADOR");
    // Con un segundo administrador sí se puede.
    const segundo = await ana("POST", "/usuarios", { email: `admin2@${dominio}`, nombre: `${prefijo} Segundo`, rol: "ADMINISTRADOR", clave: CLAVE });
    assert.equal(segundo.estado, 201, segundo.texto);
    assert.equal((await ana("PATCH", `/usuarios/${segundo.json["usuario"]["id"]}`, { rol: "EDITOR" })).estado, 200);
  } finally {
    await prisma.usuario.updateMany({ where: { id: { in: otros.map((o) => o.id) } }, data: { activo: true } });
  }
  assert.equal(await prisma.usuario.count({ where: { rol: "ADMINISTRADOR", activo: true } }) >= administradoresAntes, true, "no quedó el sistema sin administradores");

  console.log(`OK: usuarios, roles y propiedad de artículos funcionan contra evaristo_cms_dev (permisos por rol, alta y duplicados, contraseña inicial, un redactor solo ve y edita lo suyo con 404 en lo ajeno, firma propia, revocar y devolver el acceso, restablecer contraseña, cerrar sesiones y último administrador).`);
} finally {
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  await prisma.autor.deleteMany({ where: { OR: [{ nombre: { startsWith: prefijo } }, { usuario: { email: { endsWith: `@${dominio}` } } }] } });
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${dominio}` } } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
