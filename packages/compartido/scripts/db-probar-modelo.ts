// Prueba el modelo del núcleo (artículos, secciones, categorías y autores) contra la base real.
// Todo lo que crea lo borra al final, por id. Nunca modifica ni borra las secciones sembradas.
//
// Uso: npm run db:probar-modelo
import { randomBytes } from "node:crypto";
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
const idsImagenes: number[] = [];
const idsUsuarios: number[] = [];
const idsRedirecciones: number[] = [];
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

let contadorImagenes = 0;

// Crea una imagen de prueba con clave y wpId únicos y un hash hexadecimal de 64 caracteres.
async function crearImagen(extra: Partial<Prisma.ImagenUncheckedCreateInput> = {}) {
  contadorImagenes++;
  const imagen = await prisma.imagen.create({
    data: {
      clave: `prueba/${sufijo}/imagen-${contadorImagenes}.jpg`,
      nombreOriginal: `prueba-imagen-${contadorImagenes}.jpg`,
      tipoMime: "image/jpeg",
      ancho: 1200,
      alto: 800,
      bytes: 123456,
      hash: randomBytes(32).toString("hex"),
      wpId: 2_000_000_000 + Math.floor(Math.random() * 1_000_000),
      ...extra,
    },
  });
  idsImagenes.push(imagen.id);
  return imagen;
}

async function crearUsuario(datos: { email: string } & Partial<Prisma.UsuarioUncheckedCreateInput>) {
  const usuario = await prisma.usuario.create({ data: { nombre: "Usuario de prueba", passwordHash: "no-es-un-hash", ...datos } });
  idsUsuarios.push(usuario.id);
  return usuario;
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

  // g) Imágenes y sus usos: encabezado, galería, datos para redes y foto de autor.
  const img1 = await crearImagen();
  const img2 = await crearImagen();
  const altEncabezado = "El ñandú junto al “río”, ¿se ve?";
  const descripcionRedes = "Descripción para redes con ñ y “comillas”. ".repeat(75).slice(0, 3000);
  const epigrafeConEnie = "Epígrafe: el niño y la cigüeña";
  const autorFoto = await prisma.autor.create({
    data: {
      slug: `prueba-autor-foto-${sufijo}`,
      nombre: "Autora con foto",
      fotoId: img1.id,
      fotoAlt: "Retrato de la autora, con “ñ” en el alt",
      fotoPuntoFocalX: 0.2,
      fotoPuntoFocalY: 0.8,
    },
  });
  idsAutores.push(autorFoto.id);
  const artG = await crearArticulo({
    slug: `prueba-imagenes-${sufijo}`,
    titulo: "Imágenes",
    seccionId: seccionPrueba.id,
    imagenEncabezadoId: img1.id,
    encabezadoAlt: altEncabezado,
    encabezadoCredito: "Foto: Ñandú Pérez",
    encabezadoPuntoFocalX: 0.25,
    encabezadoPuntoFocalY: 0.75,
    redesDescripcion: descripcionRedes,
    redesImagenId: img2.id,
    altPendientes: 2,
    autores: { create: [{ autorId: autorFoto.id }] },
    galeria: {
      create: [
        { imagenId: img2.id, orden: 0, alt: "Vista del puerto", epigrafe: null },
        { imagenId: img1.id, orden: 1, alt: "", epigrafe: epigrafeConEnie },
        { imagenId: img2.id, orden: 2, alt: "Tercera imagen", epigrafe: null },
      ],
    },
  });
  const g = await prisma.articulo.findUniqueOrThrow({
    where: { id: artG.id },
    include: { galeria: { orderBy: { orden: "asc" } }, autores: { include: { autor: true } } },
  });
  comprobar("g) el encabezado (imagen, alt, crédito y punto focal) vuelve exacto",
    g.imagenEncabezadoId === img1.id && g.encabezadoAlt === altEncabezado && g.encabezadoCredito === "Foto: Ñandú Pérez" &&
      g.encabezadoPuntoFocalX === 0.25 && g.encabezadoPuntoFocalY === 0.75);
  comprobar("g) la galería vuelve en orden, con alt vacío y epígrafe intactos",
    isDeepStrictEqual(g.galeria.map((x) => [x.orden, x.imagenId, x.alt, x.epigrafe]), [
      [0, img2.id, "Vista del puerto", null],
      [1, img1.id, "", epigrafeConEnie],
      [2, img2.id, "Tercera imagen", null],
    ]));
  comprobar("g) los datos para redes vuelven exactos (descripción de 3000 caracteres e imagen)",
    g.redesDescripcion === descripcionRedes && g.redesDescripcion.length === 3000 && g.redesImagenId === img2.id);
  comprobar("g) altPendientes vale 2", g.altPendientes === 2, String(g.altPendientes));
  const autorLeido = g.autores[0]?.autor;
  comprobar("g) la foto del autor (imagen, alt y puntos focales) vuelve exacta",
    autorLeido?.fotoId === img1.id && autorLeido.fotoAlt === "Retrato de la autora, con “ñ” en el alt" &&
      autorLeido.fotoPuntoFocalX === 0.2 && autorLeido.fotoPuntoFocalY === 0.8);
  comprobar("g) una imagen se usa a la vez como encabezado y en la galería", g.imagenEncabezadoId === img1.id && g.galeria.some((x) => x.imagenId === img1.id));
  const porDefecto = await prisma.articulo.findUniqueOrThrow({ where: { id: articulo.id } });
  comprobar("g) por defecto: puntos focales 0.5 y altPendientes 0",
    porDefecto.encabezadoPuntoFocalX === 0.5 && porDefecto.encabezadoPuntoFocalY === 0.5 && porDefecto.altPendientes === 0);

  // h) Ficha técnica (uno a uno).
  await prisma.fichaTecnica.create({
    data: {
      articuloId: artG.id,
      titulo: "El ñandú y otros cuentos",
      autor: "María Peña",
      editorial: "Editorial Sudamericana",
      anio: 2024,
      paginas: 192,
      isbn: "978-950-04-1234-5",
      precio: "$ 12.000",
    },
  });
  const ficha = await prisma.fichaTecnica.findUniqueOrThrow({ where: { articuloId: artG.id } });
  comprobar("h) la ficha técnica vuelve exacta, con traductor y colección en null",
    isDeepStrictEqual(ficha, {
      articuloId: artG.id,
      titulo: "El ñandú y otros cuentos",
      autor: "María Peña",
      traductor: null,
      editorial: "Editorial Sudamericana",
      coleccion: null,
      anio: 2024,
      paginas: 192,
      isbn: "978-950-04-1234-5",
      precio: "$ 12.000",
    }));
  const codSegundaFicha = await falla(() => prisma.fichaTecnica.create({ data: { articuloId: artG.id, titulo: "Otra" } }));
  comprobar("h) una segunda ficha para el mismo artículo falla (uno a uno)", codSegundaFicha !== undefined, codSegundaFicha);

  // i) Restrict de las imágenes en uso (una imagen distinta por cada uso) y Cascade del artículo.
  const imgEnc = await crearImagen();
  const imgGal = await crearImagen();
  const imgRedes = await crearImagen();
  const imgFoto = await crearImagen();
  const autorI = await prisma.autor.create({ data: { slug: `prueba-autor-i-${sufijo}`, nombre: "Autor I", fotoId: imgFoto.id } });
  idsAutores.push(autorI.id);
  const artI = await crearArticulo({
    slug: `prueba-restrict-${sufijo}`,
    titulo: "Restrict",
    seccionId: seccionPrueba.id,
    imagenEncabezadoId: imgEnc.id,
    redesImagenId: imgRedes.id,
    galeria: { create: [{ imagenId: imgGal.id, orden: 0 }] },
    fichaTecnica: { create: { titulo: "Ficha de i" } },
    redirecciones: {
      create: [
        { origen: `/prueba-i/${sufijo}/uno/`, tipo: "ARTICULO" },
        { origen: `/prueba-i/${sufijo}/dos/`, tipo: "SLUG_ANTERIOR" },
      ],
    },
  });
  const usos: [string, number][] = [
    ["encabezado de un artículo", imgEnc.id],
    ["fila de la galería", imgGal.id],
    ["datos para redes", imgRedes.id],
    ["foto de un autor", imgFoto.id],
  ];
  for (const [uso, idImagen] of usos) {
    const cod = await falla(() => prisma.imagen.delete({ where: { id: idImagen } }));
    comprobar(`i) borrar una imagen usada como ${uso} falla (Restrict)`, cod !== undefined, cod);
  }
  const antes = {
    galeria: await prisma.galeriaItem.count({ where: { articuloId: artI.id } }),
    ficha: await prisma.fichaTecnica.count({ where: { articuloId: artI.id } }),
    redirecciones: await prisma.redireccion.count({ where: { articuloId: artI.id } }),
  };
  comprobar("i) antes de borrar, el artículo tiene 1 fila de galería, 1 ficha y 2 redirecciones", antes.galeria === 1 && antes.ficha === 1 && antes.redirecciones === 2, JSON.stringify(antes));
  await prisma.articulo.delete({ where: { id: artI.id } });
  olvidar(idsArticulos, artI.id);
  const despues = {
    galeria: await prisma.galeriaItem.count({ where: { articuloId: artI.id } }),
    ficha: await prisma.fichaTecnica.count({ where: { articuloId: artI.id } }),
    redirecciones: await prisma.redireccion.count({ where: { articuloId: artI.id } }),
  };
  comprobar("i) al borrar el artículo se borran su galería, su ficha técnica y sus redirecciones (Cascade)", despues.galeria === 0 && despues.ficha === 0 && despues.redirecciones === 0, JSON.stringify(despues));
  const codLiberadas = await falla(async () => {
    for (const id of [imgEnc.id, imgGal.id, imgRedes.id]) {
      await prisma.imagen.delete({ where: { id } });
      olvidar(idsImagenes, id);
    }
  });
  comprobar("i) sin el artículo, se pueden borrar las imágenes de encabezado, galería y redes", codLiberadas === undefined, codLiberadas);
  const codFotoAun = await falla(() => prisma.imagen.delete({ where: { id: imgFoto.id } }));
  comprobar("i) la imagen que es foto de un autor sigue protegida mientras el autor exista", codFotoAun !== undefined, codFotoAun);
  const codLiberarAutor = await falla(async () => {
    await prisma.autor.delete({ where: { id: autorI.id } });
    olvidar(idsAutores, autorI.id);
    await prisma.imagen.delete({ where: { id: imgFoto.id } });
    olvidar(idsImagenes, imgFoto.id);
  });
  comprobar("i) borrado el autor, se puede borrar su foto", codLiberarAutor === undefined, codLiberarAutor);

  // j) Unicidad.
  const codClave = await falla(() => crearImagen({ clave: img1.clave }));
  comprobar("j) una imagen con clave repetida falla", codClave !== undefined, codClave);
  const codWp = await falla(() => crearImagen({ wpId: img1.wpId }));
  comprobar("j) una imagen con wpId repetido falla", codWp !== undefined, codWp);
  const codHash = await falla(() => crearImagen({ hash: img1.hash, wpId: null }));
  console.log(`DATO j) imagen con hash repetido: ${codHash === undefined ? "se acepta (como se esperaba)" : `se rechaza (${codHash})`}`);
  comprobar("j) una imagen con hash repetido se acepta (el hash no es único a propósito)", codHash === undefined, codHash);

  // k) Usuarios (con un texto de relleno en lugar de un hash).
  const emailBase = `Prueba-${sufijo}@Ejemplo.com`;
  const editor = await crearUsuario({ email: emailBase });
  comprobar("k) un usuario sin rol ni activo sale EDITOR y activo", editor.rol === "EDITOR" && editor.activo === true, `${editor.rol}, activo: ${editor.activo}`);
  const admin = await crearUsuario({ email: `prueba-admin-${sufijo}@ejemplo.com`, rol: "ADMINISTRADOR" });
  comprobar("k) se puede crear un ADMINISTRADOR", admin.rol === "ADMINISTRADOR", admin.rol);

  // j, continuación) Email y origen de redirección repetidos.
  const codEmail = await falla(() => crearUsuario({ email: emailBase }));
  comprobar("j) un usuario con email repetido falla", codEmail !== undefined, codEmail);
  const codEmailMinusculas = await falla(() => crearUsuario({ email: emailBase.toLowerCase() }));
  console.log(`DATO j) email igual salvo mayúsculas: ${codEmailMinusculas !== undefined ? `lo rechaza (${codEmailMinusculas})` : "NO lo rechaza"}`);
  const codEmailTilde = await falla(() => crearUsuario({ email: `prúeba-${sufijo}@ejemplo.com` }));
  console.log(`DATO j) email igual salvo una tilde: ${codEmailTilde !== undefined ? `lo rechaza (${codEmailTilde})` : "NO lo rechaza"}`);

  // l) Redirecciones, con orígenes con ñ y tildes.
  const autorL = await prisma.autor.create({ data: { slug: `prueba-autor-l-${sufijo}`, nombre: "Autor L" } });
  idsAutores.push(autorL.id);
  const redirecciones = [
    { origen: `/2016/05/12/ñandú-y-canción-${sufijo}/`, tipo: "ARTICULO", articuloId: artG.id },
    { origen: `/2016/05/12/título-anterior-${sufijo}/`, tipo: "SLUG_ANTERIOR", articuloId: artG.id },
    { origen: `/autor/ñoño-${sufijo}/`, tipo: "AUTOR", autorId: autorL.id },
    { origen: `/categoría/ñu-${sufijo}/`, tipo: "MANUAL", destino: "/secciones/música/" },
  ] as const;
  const creadas = [];
  for (const r of redirecciones) {
    const creada = await prisma.redireccion.create({ data: r });
    idsRedirecciones.push(creada.id);
    creadas.push(creada);
  }
  const leidas = await prisma.redireccion.findMany({ where: { id: { in: creadas.map((c) => c.id) } }, orderBy: { id: "asc" } });
  comprobar("l) las cuatro redirecciones vuelven idénticas, con código 301 por defecto",
    leidas.length === 4 &&
      leidas.every((x, i) => {
        const r: { origen: string; tipo: string; articuloId?: number; autorId?: number; destino?: string } = redirecciones[i]!;
        return x.origen === r.origen && x.tipo === r.tipo && x.codigo === 301 &&
          x.articuloId === (r.articuloId ?? null) && x.autorId === (r.autorId ?? null) && x.destino === (r.destino ?? null);
      }));
  const codOrigen = await falla(() => prisma.redireccion.create({ data: { origen: redirecciones[0].origen, tipo: "MANUAL", destino: "/otro/" } }));
  comprobar("j) una redirección con origen repetido falla", codOrigen !== undefined, codOrigen);
  const redAutor = creadas[2]!;
  await prisma.autor.delete({ where: { id: autorL.id } });
  olvidar(idsAutores, autorL.id);
  const sigue = await prisma.redireccion.count({ where: { id: redAutor.id } });
  comprobar("l) al borrar el autor (sin artículos) se borra su redirección (Cascade)", sigue === 0, `filas: ${sigue}`);
  olvidar(idsRedirecciones, redAutor.id);
} catch (error) {
  hayFallos = true;
  console.error("FALLÓ (error inesperado):", sinUrl(error));
} finally {
  // Limpieza por id: artículos primero (las tablas intermedias caen por Cascade), después el resto.
  try {
    // Las imágenes se borran después de los artículos y los autores que las usan.
    if (idsRedirecciones.length > 0) await prisma.redireccion.deleteMany({ where: { id: { in: idsRedirecciones } } });
    if (idsArticulos.length > 0) await prisma.articulo.deleteMany({ where: { id: { in: idsArticulos } } });
    if (idsCategorias.length > 0) await prisma.categoria.deleteMany({ where: { id: { in: idsCategorias } } });
    if (idsAutores.length > 0) await prisma.autor.deleteMany({ where: { id: { in: idsAutores } } });
    if (idsImagenes.length > 0) await prisma.imagen.deleteMany({ where: { id: { in: idsImagenes } } });
    if (idsUsuarios.length > 0) await prisma.usuario.deleteMany({ where: { id: { in: idsUsuarios } } });
    if (idSeccionPrueba !== undefined) await prisma.seccion.deleteMany({ where: { id: idSeccionPrueba } });
    const restos = {
      articulos: await prisma.articulo.count({ where: { id: { in: idsArticulos } } }),
      categorias: await prisma.categoria.count({ where: { id: { in: idsCategorias } } }),
      autores: await prisma.autor.count({ where: { id: { in: idsAutores } } }),
      imagenes: await prisma.imagen.count({ where: { id: { in: idsImagenes } } }),
      usuarios: await prisma.usuario.count({ where: { id: { in: idsUsuarios } } }),
      redirecciones: await prisma.redireccion.count({ where: { id: { in: idsRedirecciones } } }),
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
