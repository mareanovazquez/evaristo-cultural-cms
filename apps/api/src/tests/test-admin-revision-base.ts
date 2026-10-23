// Prueba de las herramientas de revisión de la migración (src/admin/revision.ts) con la base de verdad, SOLO contra evaristo_cms_dev.
// Crea usuarios y artículos temporales y los borra al terminar; los avisos de los artículos reales que marca los deja como estaban.
// Comprueba: permisos, que el tablero cuente lo mismo que la base, los filtros, marcar y deshacer un aviso revisado (sin cambiar la versión
// del artículo), asignar la sección a un artículo de «Sin asignar» y eliminar un borrador (solo administrador).
//
// Uso: npm run test:admin-revision
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { obtenerClientePrisma } from "@evaristo/compartido/db";
import { crearApp } from "../app.js";
import { hashearClave } from "../auth/clave.js";
import { NOMBRE_COOKIE } from "../auth/rutas.js";
import { elegirBase } from "../entorno.js";
import { codigosDeAvisos } from "../admin/revision.js";

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
const prefijo = `Revtest ${sufijo}`;
const dominio = `${sufijo}.ejemplo.org`;
const CLAVE = "clave-de-prueba-larga-1";
let server: Server | undefined;
const tocados: Array<{ id: number; revisados: unknown }> = [];

try {
  await prisma.articulo.count({ where: { avisosRevisados: { not: undefined } } }).catch(() => fallar("falta la migración de avisos revisados en evaristo_cms_dev (db:deploy)"));
  const mk = (email: string, rol: "ADMINISTRADOR" | "EDITOR" | "REDACTOR") => hashearClave(CLAVE).then((passwordHash) => prisma.usuario.create({ data: { email: `${email}@${dominio}`, nombre: `${prefijo} ${email}`, rol, passwordHash }, select: { id: true } }));
  const admin = await mk("admin", "ADMINISTRADOR");
  await mk("editor", "EDITOR");
  await mk("redactor", "REDACTOR");

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
  for (const [m, r] of [["GET", "/revision/resumen"], ["GET", "/revision/articulos"], ["POST", "/articulos/1/avisos"], ["POST", "/articulos/1/seccion"], ["DELETE", "/articulos/1"]] as const) {
    assert.equal((await pedir(m, `/api/admin${r}`, m === "POST" ? {} : undefined)).estado, 401, `${m} ${r} sin sesión`);
  }
  for (const [m, r] of [["GET", "/revision/resumen"], ["GET", "/revision/articulos"]] as const) assert.equal((await red(m, r)).estado, 403, `${m} ${r} como redactor`);
  for (const [m, r] of [["POST", "/articulos/1/avisos"], ["POST", "/articulos/1/seccion"], ["DELETE", "/articulos/1"]] as const) assert.equal((await red(m, r, m === "POST" ? {} : undefined)).estado, 404, `${m} ${r} como redactor: lo ajeno no existe`);
  assert.equal((await edi("DELETE", "/articulos/1")).estado, 403, "un editor no elimina");

  // ---------- B. El tablero cuenta lo mismo que la base ----------
  const filas = await prisma.articulo.findMany({ select: { id: true, wpId: true, estado: true, avisosMigracion: true, avisosRevisados: true, altPendientes: true } });
  const esperado = new Map<string, number>();
  for (const f of filas) for (const c of codigosDeAvisos(f.avisosMigracion)) esperado.set(c, (esperado.get(c) ?? 0) + 1);
  assert.ok(esperado.size > 0, "la base de desarrollo tiene avisos de la migración");
  const resumen = await edi("GET", "/revision/resumen");
  assert.equal(resumen.estado, 200, resumen.texto);
  const avisos = resumen.json["avisos"] as J[];
  for (const [codigo, n] of esperado) {
    const a = avisos.find((x) => x["codigo"] === codigo);
    assert.ok(a, `el tablero lista ${codigo}`);
    assert.equal(a!["pendientes"] + a!["revisados"], n, `cantidad de ${codigo}`);
    assert.ok(a!["etiqueta"], "con una etiqueta en lenguaje común");
  }
  assert.ok(avisos.every((a, i, l) => i === 0 || l[i - 1]!["pendientes"] >= a["pendientes"]), "ordenados por lo que más falta");
  assert.equal(resumen.json["altPendientes"], filas.filter((f) => f.altPendientes > 0).length);
  assert.equal(resumen.json["borradoresMigrados"], filas.filter((f) => f.wpId !== null && f.estado === "BORRADOR").length);
  assert.equal(resumen.json["sinAsignar"], await prisma.articulo.count({ where: { seccion: { interna: true } } }));
  assert.equal(resumen.json["sinAutor"], await prisma.articulo.count({ where: { autores: { none: {} } } }));
  assert.ok(!resumen.texto.includes("passwordHash") && !resumen.texto.includes("visitasWp"));

  // ---------- C. Filtros de la lista ----------
  assert.equal((await edi("GET", "/revision/articulos?filtro=inventado")).estado, 400);
  assert.equal((await edi("GET", `/revision/articulos?filtro=${encodeURIComponent("aviso:' OR 1=1")}`)).estado, 400);
  const codigoElegido = [...esperado.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const porAviso = await edi("GET", `/revision/articulos?filtro=aviso:${codigoElegido}`);
  assert.equal(porAviso.estado, 200);
  assert.equal(porAviso.json["total"], esperado.get(codigoElegido));
  assert.ok((porAviso.json["articulos"] as J[]).every((a) => (a["avisos"] as J[]).some((x) => x["codigo"] === codigoElegido && x["revisado"] === false)));
  const fila0 = (porAviso.json["articulos"] as J[])[0]!;
  assert.deepEqual(Object.keys(fila0).sort(), ["altPendientes", "autores", "avisos", "estado", "id", "publicadoEn", "ruta", "seccion", "titulo", "wpId"], "sin el cuerpo ni campos de más");
  const conAlt = await edi("GET", "/revision/articulos?filtro=alt");
  assert.equal(conAlt.json["total"], resumen.json["altPendientes"]);
  assert.ok((conAlt.json["articulos"] as J[]).every((a) => a["altPendientes"] > 0));
  const sinAs = await edi("GET", "/revision/articulos?filtro=sin-asignar");
  assert.ok((sinAs.json["articulos"] as J[]).every((a) => a["seccion"]["interna"] === true));
  assert.equal((await edi("GET", "/revision/articulos?filtro=borrador-migrado")).json["total"], resumen.json["borradoresMigrados"]);
  const unaSeccion = (await prisma.seccion.findFirstOrThrow({ where: { interna: false, articulos: { some: {} } }, select: { id: true } })).id;
  const porSeccion = await edi("GET", `/revision/articulos?filtro=seccion:${unaSeccion}`);
  assert.equal(porSeccion.json["total"], await prisma.articulo.count({ where: { seccionId: unaSeccion } }));
  const buscado = await edi("GET", `/revision/articulos?q=${encodeURIComponent(fila0["titulo"].slice(0, 12))}&filtro=aviso:${codigoElegido}`);
  assert.ok((buscado.json["articulos"] as J[]).some((a) => a["id"] === fila0["id"]), "la búsqueda por título se combina con el filtro");

  // ---------- D. Marcar y deshacer un aviso revisado ----------
  const objetivo = await prisma.articulo.findUniqueOrThrow({ where: { id: fila0["id"] }, select: { id: true, actualizadoEn: true, avisosRevisados: true } });
  tocados.push({ id: objetivo.id, revisados: objetivo.avisosRevisados });
  const pendientesAntes = avisos.find((a) => a["codigo"] === codigoElegido)!["pendientes"] as number;
  assert.equal((await edi("POST", `/articulos/${objetivo.id}/avisos`, { codigo: "codigo_que_no_tiene", revisado: true })).estado, 422, "solo los avisos que el artículo tiene");
  assert.equal((await edi("POST", `/articulos/${objetivo.id}/avisos`, { codigo: codigoElegido })).estado, 422);
  assert.equal((await edi("POST", "/articulos/999999999/avisos", { codigo: codigoElegido, revisado: true })).estado, 404);
  const marcado = await edi("POST", `/articulos/${objetivo.id}/avisos`, { codigo: codigoElegido, revisado: true });
  assert.equal(marcado.estado, 200, marcado.texto);
  const guardado = (await prisma.articulo.findUniqueOrThrow({ where: { id: objetivo.id }, select: { avisosRevisados: true, actualizadoEn: true } }));
  assert.equal(guardado.actualizadoEn.getTime(), objetivo.actualizadoEn.getTime(), "marcar un aviso no cambia la versión del artículo");
  const reg = (guardado.avisosRevisados as J)[codigoElegido];
  assert.deepEqual({ por: reg.por, nombre: reg.nombre }, { por: (await prisma.usuario.findFirstOrThrow({ where: { email: `editor@${dominio}` }, select: { id: true } })).id, nombre: `${prefijo} editor` }, "queda quién lo revisó");
  assert.ok(!Number.isNaN(Date.parse(reg.en)));
  const despues = await edi("GET", "/revision/resumen");
  assert.equal((despues.json["avisos"] as J[]).find((a) => a["codigo"] === codigoElegido)!["pendientes"], pendientesAntes - 1, "sale de la cola");
  assert.ok(((await edi("GET", `/revision/articulos?filtro=aviso:${codigoElegido}`)).json["articulos"] as J[]).every((a) => a["id"] !== objetivo.id), "ya no está entre los pendientes");
  const revisadas = await edi("GET", `/revision/articulos?filtro=revisado:${codigoElegido}`);
  const filaRev = (revisadas.json["articulos"] as J[]).find((a) => a["id"] === objetivo.id)!;
  assert.ok(filaRev, "pero sí entre los revisados");
  assert.equal((filaRev["avisos"] as J[]).find((a) => a["codigo"] === codigoElegido)!["por"], `${prefijo} editor`);
  assert.ok(await prisma.articulo.findUnique({ where: { id: objetivo.id }, select: { avisosMigracion: true } }).then((a) => codigosDeAvisos(a!.avisosMigracion).includes(codigoElegido)), "el aviso original no se borra");
  const deshecho = await edi("POST", `/articulos/${objetivo.id}/avisos`, { codigo: codigoElegido, revisado: false });
  assert.equal(deshecho.estado, 200);
  assert.equal((await prisma.articulo.findUniqueOrThrow({ where: { id: objetivo.id }, select: { avisosRevisados: true } })).avisosRevisados, objetivo.avisosRevisados, "al deshacer vuelve a como estaba");

  // ---------- E. Asignar la sección a un artículo de «Sin asignar» ----------
  const interna = await prisma.seccion.findFirstOrThrow({ where: { interna: true }, select: { id: true } });
  const real = await prisma.seccion.findFirstOrThrow({ where: { interna: false }, orderBy: { orden: "asc" }, select: { id: true, nombre: true } });
  const nuevo = (titulo: string, estado: "BORRADOR" | "PUBLICADO" = "BORRADOR") =>
    prisma.articulo.create({ data: { slug: `revtest-${sufijo}-${titulo}`, titulo: `${prefijo} ${titulo}`, cuerpo: { type: "doc", content: [] }, textoPlano: "", estado, publicadoEn: estado === "PUBLICADO" ? new Date("2020-01-01T00:00:00Z") : null, seccionId: interna.id }, select: { id: true, actualizadoEn: true } });
  const sa = await nuevo("sin-seccion", "PUBLICADO");
  await prisma.articuloBorrador.create({ data: { articuloId: sa.id, datos: { seccionId: interna.id, titulo: "t" }, baseVersion: sa.actualizadoEn, usuarioId: admin.id } });
  assert.equal((await edi("POST", `/articulos/${sa.id}/seccion`, { seccionId: interna.id })).estado, 422, "no se asigna la interna");
  assert.equal((await edi("POST", `/articulos/${sa.id}/seccion`, { seccionId: 999_999_999 })).estado, 422);
  assert.equal((await edi("POST", `/articulos/${sa.id}/seccion`, {})).estado, 422);
  const asignada = await edi("POST", `/articulos/${sa.id}/seccion`, { seccionId: real.id });
  assert.equal(asignada.estado, 200, asignada.texto);
  const trasAsignar = await prisma.articulo.findUniqueOrThrow({ where: { id: sa.id }, select: { seccionId: true, actualizadoEn: true, borrador: { select: { datos: true } } } });
  assert.equal(trasAsignar.seccionId, real.id);
  assert.equal(trasAsignar.actualizadoEn.getTime(), sa.actualizadoEn.getTime(), "sin cambiar la versión (quien lo edita no tiene un conflicto)");
  assert.deepEqual(trasAsignar.borrador!.datos, { seccionId: real.id, titulo: "t" }, "y sus cambios sin publicar también");
  assert.equal((await edi("POST", `/articulos/${sa.id}/seccion`, { seccionId: real.id })).estado, 409, "si ya tiene sección no se cambia por acá");
  assert.equal((await edi("POST", "/articulos/999999999/seccion", { seccionId: real.id })).estado, 404);

  // ---------- F. Eliminar un borrador ----------
  const bo = await nuevo("borrador-a-borrar");
  await prisma.articuloBorrador.deleteMany({ where: { articuloId: bo.id } });
  assert.equal((await edi("DELETE", `/articulos/${bo.id}`)).estado, 403);
  assert.equal(await prisma.articulo.count({ where: { id: bo.id } }), 1, "el 403 no borró nada");
  assert.equal((await ana("DELETE", "/articulos/999999999")).estado, 404);
  const publicado = await prisma.articulo.findFirstOrThrow({ where: { estado: "PUBLICADO" }, select: { id: true } });
  const noBorra = await ana("DELETE", `/articulos/${publicado.id}`);
  assert.equal(noBorra.estado, 409, "un publicado no se elimina");
  assert.equal(await prisma.articulo.count({ where: { id: publicado.id } }), 1);
  assert.equal(sa.id === publicado.id, false);
  assert.equal((await ana("DELETE", `/articulos/${sa.id}`)).estado, 409, "tampoco el publicado de la prueba");
  assert.equal((await ana("DELETE", `/articulos/${bo.id}`)).estado, 200);
  assert.equal(await prisma.articulo.count({ where: { id: bo.id } }), 0);

  console.log("OK: la revisión de la migración funciona contra evaristo_cms_dev (permisos, tablero que cuenta lo mismo que la base, filtros, marcar y deshacer avisos sin cambiar la versión, asignar sección a un artículo de «Sin asignar» y eliminar borradores solo el administrador).");
} finally {
  for (const t of tocados) await prisma.$executeRaw`UPDATE articulos SET avisosRevisados = ${t.revisados === null || t.revisados === undefined ? null : JSON.stringify(t.revisados)}, actualizadoEn = actualizadoEn WHERE id = ${t.id}`;
  await prisma.articulo.deleteMany({ where: { titulo: { startsWith: prefijo } } });
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${dominio}` } } });
  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
}
