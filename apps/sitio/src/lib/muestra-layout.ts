import type { JSONNode } from "@evaristo/compartido/render";

// Artículo sintético para mirar el layout y los estilos del cuerpo (páginas /prueba-layout/*).
// Cubre lo que no está en los 35 de la muestra, como la cita destacada.
const T = (text: string, marks?: JSONNode["marks"]): JSONNode => (marks ? { type: "text", text, marks } : { type: "text", text });
const P = (...content: JSONNode[]): JSONNode => ({ type: "paragraph", content });
const nota = (texto: string): JSONNode => ({ type: "footnote", attrs: { content: { type: "doc", content: [P(T(texto))] } } });
const FOTO = "https://commons.wikimedia.org/wiki/Special:FilePath/LOC_Main_Reading_Room_Highsmith.jpg?width=1200";
const item = (x: string): JSONNode => ({ type: "listItem", content: [P(T(x))] });
const celda = (tipo: "tableHeader" | "tableCell", x: string): JSONNode => ({ type: tipo, content: [P(T(x))] });

export const MUESTRA: JSONNode = {
  type: "doc",
  content: [
    P(
      T("Nadie recuerda con precisión cuándo empezaron los traslados. Los registros más antiguos hablan de un martes de invierno en que el estante de los atlas amaneció tres salas más allá"),
      nota("Según el registro de mudanzas de 1923, que se conserva en el archivo de la biblioteca."),
      T(". La bibliotecaria de turno se limitó a corregir el cartel de la puerta."),
    ),
    P(
      T("Lo que sigue es un intento de ordenar esas versiones. "),
      T("No hay un culpable claro", [{ type: "bold" }]),
      T(" ni una explicación única, pero sí un conjunto de "),
      T("hábitos compartidos", [{ type: "italic" }]),
      T(" que fueron pasando de un turno a otro."),
    ),
    { type: "heading", attrs: { level: 2 }, content: [T("Los primeros traslados")] },
    {
      type: "paragraph",
      attrs: { textAlign: "justify" },
      content: [
        T(
          "Durante las primeras décadas, los cambios se hacían a la luz del día y con carros de madera. Había un plano colgado detrás del mostrador que se reescribía a lápiz cada vez que una sección cambiaba de lugar. Con el tiempo el plano se volvió ilegible, de tanto borrar, y se decidió que lo más sensato era aprenderlo de memoria.",
        ),
      ],
    },
    {
      type: "cita",
      attrs: { variante: "destacada", autor: "Marina Oyarzún, bibliotecaria jubilada" },
      content: [P(T("Una biblioteca no es un lugar sino una costumbre: la de volver a buscar lo que ya sabíamos dónde estaba."), nota("Declaración de una entrevista de 2019."))],
    },
    { type: "imagen", attrs: { src: FOTO, alt: "Sala principal de lectura de una biblioteca", epigrafe: "Sala principal de lectura. Fotografía de Carol M. Highsmith, dominio público." } },
    { type: "heading", attrs: { level: 3 }, content: [T("El catálogo de papel")] },
    P(T("Entre sus costumbres, el equipo conserva tres reglas simples:")),
    {
      type: "bulletList",
      content: [
        item("Nada se mueve sin dejar una nota en el estante vacío."),
        item("Los traslados se anuncian al cierre y se confirman a la apertura."),
        item("El plano se actualiza al final, nunca antes."),
      ],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [
        T("Cada estante guarda el lugar"),
        { type: "hardBreak" },
        T("donde antes hubo otro estante;"),
        { type: "hardBreak" },
        T("los libros no saben mudarse,"),
        { type: "hardBreak" },
        T("pero aprenden a esperar."),
      ],
    },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [celda("tableHeader", "Sala"), celda("tableHeader", "Año del traslado")] },
        { type: "tableRow", content: [celda("tableCell", "Atlas"), celda("tableCell", "1923")] },
      ],
    },
    { type: "video", attrs: { provider: "youtube", id: "aqz-KE-bpKQ" } },
    P(T("Quizás eso sea lo más parecido a una respuesta. "), T("Los libros no se movían solos", [{ type: "italic" }]), T("; se movía la manera de mirarlos.")),
  ],
};
