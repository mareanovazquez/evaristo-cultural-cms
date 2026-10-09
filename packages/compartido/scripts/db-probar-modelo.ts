// Prueba el modelo del núcleo (artículos, secciones, categorías y autores) contra la base real.
// Todo lo que crea lo borra al final, por id. Nunca modifica ni borra las secciones sembradas.
//
// Uso: npm run db:probar-modelo
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { crearClientePrisma } from "../src/db.js";
import type { Prisma } from "../src/generated/prisma/client.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

if (!process.env["DATABASE_URL"]) {
  console.error("FALLÓ: falta DATABASE_URL en el .env");
  process.exit(1);
}

const prisma = crearClientePrisma();
let hayFallos = false;

function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (!condicion) hayFallos = true;
  console.log(`${condicion ? "OK" : "FALLÓ"}: ${nombre}${detalle ? ` (${detalle})` : ""}`);
}

function codigoDe(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String((error as { code: unknown }).code);
  return "sin código";
}

function sinUrl(error: unknown): string {
  return error instanceof Error ? error.message.replace(/(mysql|mariadb):\/\/\S+/g, "$1://[TACHADO]") : "error desconocido";
}

// Devuelve el código del error si la operación falla, o undefined si se completó.
async function falla(operacion: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await operacion();
    return undefined;
  } catch (error) {
    return codigoDe(error);
  }
}

const sufijo = Date.now().toString(36);
const idsArticulos: number[] = [];
const idsCategorias: number[] = [];
const idsAutores: number[] = [];
let idSeccionPrueba: number | undefined;

const textoControl = "Ñandú, canción, “comillas” y ¿tildes?";
const cuerpoOriginal: Prisma.InputJsonObject = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Título de prueba" }] },
    { type: "paragraph", content: [{ type: "text", text: textoControl }] },
    { type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Negrita" }, { type: "text", text: " y texto normal." }] },
  ],
};

type DatosArticulo = Omit<Prisma.ArticuloUncheckedCreateInput, "cuerpo" | "textoPlano"> & {
  cuerpo?: Prisma.InputJsonValue;
  textoPlano?: string;
};

async function crearArticulo(datos: DatosArticulo) {
  const creado = await prisma.articulo.create({
    data: { cuerpo: { type: "doc", content: [] }, textoPlano: "", ...datos },
  });
  idsArticulos.push(creado.id);
  return creado;
}

function olvidar(lista: number[], id: number): void {
  const posicion = lista.indexOf(id);
  if (posicion >= 0) lista.splice(posicion, 1);
}

try {
  const resena = await prisma.seccion.findUniqueOrThrow({ where: { slug: "resena" } });

  // a) Artículo completo con relaciones.
  const catA = await prisma.categoria.create({ data: { slug: `prueba-cat-a-${sufijo}`, nombre: "Prueba A" } });
  idsCategorias.push(catA.id);
  const catB = await prisma.categoria.create({ data: { slug: `prueba-cat-b-${sufijo}`, nombre: "Prueba B" } });
  idsCategorias.push(catB.id);
  const autorPersona = await prisma.autor.create({ data: { slug: `prueba-autor-persona-${sufijo}`, nombre: "Autora de Prueba" } });
  idsAutores.push(autorPersona.id);
  const autorTexto = await prisma.autor.create({ data: { slug: `prueba-autor-texto-${sufijo}`, nombre: "Redacción", soloTexto: true } });
  idsAutores.push(autorTexto.id);

  const articulo = await crearArticulo({
    slug: `prueba-articulo-${sufijo}`,
    titulo: "Artículo de prueba",
    seccionId: resena.id,
    cuerpo: cuerpoOriginal,
    textoPlano: textoControl,
    categoriaPrincipalId: catB.id,
    categorias: { create: [{ categoriaId: catA.id }, { categoriaId: catB.id }] },
    autores: {
      create: [
        { autorId: autorTexto.id, orden: 1 },
        { autorId: autorPersona.id, orden: 0 },
      ],
    },
  });
  const leido = await prisma.articulo.findUniqueOrThrow({
    where: { id: articulo.id },
    include: { categorias: true, autores: { orderBy: { orden: "asc" } } },
  });
  comprobar("a) el cuerpo vuelve estructuralmente igual (comparación profunda)", isDeepStrictEqual(leido.cuerpo, cuerpoOriginal));
  comprobar("a) el texto con ñ, tildes y comillas llega intacto", JSON.stringify(leido.cuerpo).includes(textoControl) && leido.textoPlano === textoControl);
  comprobar("a) los autores vuelven en orden", isDeepStrictEqual(leido.autores.map((x) => x.autorId), [autorPersona.id, autorTexto.id]));
  comprobar("a) las categorías coinciden", isDeepStrictEqual(leido.categorias.map((x) => x.categoriaId).sort(), [catA.id, catB.id].sort()));
  comprobar("a) la categoría principal coincide", leido.categoriaPrincipalId === catB.id);
  comprobar("a) estado BORRADOR por defecto", leido.estado === "BORRADOR", leido.estado);
  comprobar("a) novedadHasta es null", leido.novedadHasta === null);
  comprobar("a) schemaVersion vale 1", leido.schemaVersion === 1, String(leido.schemaVersion));

  // b) Fechas en UTC.
  const instante = new Date("2026-10-09T15:30:00.123Z");
  const conFecha = await crearArticulo({ slug: `prueba-fecha-${sufijo}`, titulo: "Fecha", seccionId: resena.id, publicadoEn: instante });
  const fechaLeida = (await prisma.articulo.findUniqueOrThrow({ where: { id: conFecha.id } })).publicadoEn;
  comprobar("b) publicadoEn vuelve con el mismo instante", fechaLeida?.getTime() === instante.getTime(), `${instante.toISOString()} -> ${fechaLeida?.toISOString()}`);

  // c) Cuerpo grande (unos 5 MB de JSON) y texto plano grande (unos 2 MB).
  const parrafo = "Lorem ipsum dolor sit amet, consectetur adipiscing elit; ñandú, canción y “comillas” ¿sí? ".repeat(2);
  const cuerpoGrande: Prisma.InputJsonObject = {
    type: "doc",
    content: Array.from({ length: 20000 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `${i}: ${parrafo}` }] })),
  };
  const bytesCuerpo = Buffer.byteLength(JSON.stringify(cuerpoGrande), "utf8");
  const textoGrande = "Ñandú y canción. ".repeat(Math.ceil((2 * 1024 * 1024) / 17));
  const bytesTexto = Buffer.byteLength(textoGrande, "utf8");
  const grande = await crearArticulo({ slug: `prueba-grande-${sufijo}`, titulo: "Grande", seccionId: resena.id, cuerpo: cuerpoGrande, textoPlano: textoGrande });
  const grandeLeido = await prisma.articulo.findUniqueOrThrow({ where: { id: grande.id } });
  const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(2)} MB`;
  console.log(`   cuerpo enviado: ${mb(bytesCuerpo)}; textoPlano enviado: ${mb(bytesTexto)}`);
  comprobar("c) el cuerpo grande vuelve completo", isDeepStrictEqual(grandeLeido.cuerpo, cuerpoGrande), `${mb(Buffer.byteLength(JSON.stringify(grandeLeido.cuerpo), "utf8"))} de vuelta`);
  comprobar("c) el textoPlano grande vuelve completo", grandeLeido.textoPlano === textoGrande, `${mb(Buffer.byteLength(grandeLeido.textoPlano, "utf8"))} de vuelta`);
  await prisma.articulo.delete({ where: { id: grande.id } });
  olvidar(idsArticulos, grande.id);

  // d) Restricciones, con una sección, una categoría y un autor creados solo para esta prueba.
  const seccionPrueba = await prisma.seccion.create({ data: { slug: `prueba-seccion-${sufijo}`, nombre: "Sección de prueba" } });
  idSeccionPrueba = seccionPrueba.id;
  const catPrueba = await prisma.categoria.create({ data: { slug: `prueba-cat-d-${sufijo}`, nombre: "Prueba D" } });
  idsCategorias.push(catPrueba.id);
  const autorPrueba = await prisma.autor.create({ data: { slug: `prueba-autor-d-${sufijo}`, nombre: "Autor D" } });
  idsAutores.push(autorPrueba.id);
  const enUso = await crearArticulo({
    slug: `prueba-uso-${sufijo}`,
    titulo: "En uso",
    seccionId: seccionPrueba.id,
    categoriaPrincipalId: catPrueba.id,
    categorias: { create: [{ categoriaId: catPrueba.id }] },
    autores: { create: [{ autorId: autorPrueba.id }] },
  });
  const codSeccion = await falla(() => prisma.seccion.delete({ where: { id: seccionPrueba.id } }));
  comprobar("d) borrar una sección en uso falla (Restrict)", codSeccion !== undefined, codSeccion);
  const codCategoria = await falla(() => prisma.categoria.delete({ where: { id: catPrueba.id } }));
  comprobar("d) borrar una categoría en uso falla (Restrict)", codCategoria !== undefined, codCategoria);
  const codAutor = await falla(() => prisma.autor.delete({ where: { id: autorPrueba.id } }));
  comprobar("d) borrar un autor con artículos falla (Restrict)", codAutor !== undefined, codAutor);

  await prisma.articulo.delete({ where: { id: enUso.id } });
  olvidar(idsArticulos, enUso.id);
  const restoCategorias = await prisma.articuloCategoria.count({ where: { articuloId: enUso.id } });
  const restoAutores = await prisma.articuloAutor.count({ where: { articuloId: enUso.id } });
  comprobar(
    "d) al borrar el artículo se borran sus filas de articulos_categorias y articulos_autores (Cascade)",
    restoCategorias === 0 && restoAutores === 0,
    `categorías: ${restoCategorias}, autores: ${restoAutores}`,
  );
  // Sin el artículo, la categoría y el autor de prueba ya se pueden borrar.
  const codLimpio = await falla(async () => {
    await prisma.categoria.delete({ where: { id: catPrueba.id } });
    olvidar(idsCategorias, catPrueba.id);
    await prisma.autor.delete({ where: { id: autorPrueba.id } });
    olvidar(idsAutores, autorPrueba.id);
  });
  comprobar("d) sin artículos, se pueden borrar la categoría y el autor de prueba", codLimpio === undefined, codLimpio);

  // e) Unicidad del slug (con la sección de prueba).
  const slugBase = `Prueba-Mayus-${sufijo}`;
  await crearArticulo({ slug: slugBase, titulo: "Único", seccionId: seccionPrueba.id });
  const codRepetido = await falla(() => crearArticulo({ slug: slugBase, titulo: "Repetido", seccionId: seccionPrueba.id }));
  comprobar("e) un slug repetido falla (unicidad)", codRepetido !== undefined, codRepetido);
  const codMayusculas = await falla(() => crearArticulo({ slug: slugBase.toLowerCase(), titulo: "Minúsculas", seccionId: seccionPrueba.id }));
  console.log(`DATO e) mismo slug distinto en mayúsculas: ${codMayusculas !== undefined ? `lo rechaza (${codMayusculas})` : "NO lo rechaza"}`);

  // f) Sección inexistente.
  const codSinSeccion = await falla(() => crearArticulo({ slug: `prueba-sin-seccion-${sufijo}`, titulo: "Sin sección", seccionId: 2147483647 }));
  comprobar("f) un artículo con sección inexistente falla", codSinSeccion !== undefined, codSinSeccion);
} catch (error) {
  hayFallos = true;
  console.error("FALLÓ (error inesperado):", sinUrl(error));
} finally {
  // Limpieza por id: artículos primero (las tablas intermedias caen por Cascade), después el resto.
  try {
    if (idsArticulos.length > 0) await prisma.articulo.deleteMany({ where: { id: { in: idsArticulos } } });
    if (idsCategorias.length > 0) await prisma.categoria.deleteMany({ where: { id: { in: idsCategorias } } });
    if (idsAutores.length > 0) await prisma.autor.deleteMany({ where: { id: { in: idsAutores } } });
    if (idSeccionPrueba !== undefined) await prisma.seccion.deleteMany({ where: { id: idSeccionPrueba } });
    const restos = {
      articulos: await prisma.articulo.count({ where: { id: { in: idsArticulos } } }),
      categorias: await prisma.categoria.count({ where: { id: { in: idsCategorias } } }),
      autores: await prisma.autor.count({ where: { id: { in: idsAutores } } }),
      secciones: idSeccionPrueba === undefined ? 0 : await prisma.seccion.count({ where: { id: idSeccionPrueba } }),
    };
    comprobar("limpieza: no quedan filas de prueba", Object.values(restos).every((n) => n === 0), JSON.stringify(restos));
  } catch (error) {
    hayFallos = true;
    console.error("FALLÓ la limpieza:", sinUrl(error));
  }
  await prisma.$disconnect();
}
process.exit(hayFallos ? 1 : 0);
