// Estado de un artículo tal como lo ve el panel.
//
// Programar un artículo es dejarlo PUBLICADO con una fecha futura (decisión del 22/10/2026): el sitio ya oculta todo lo que tenga fecha
// futura y lo muestra solo cuando llega, sin procesos. Por eso el estado que se muestra se calcula:
//  - BORRADOR: no se ve.
//  - PROGRAMADO: PUBLICADO con la fecha todavía por llegar (o, en datos viejos, estado PROGRAMADO).
//  - PUBLICADO: PUBLICADO con la fecha ya cumplida (lo que se ve en el sitio).
// El estado PROGRAMADO de la base queda sin usar, pero se sigue entendiendo.

export type EstadoBase = "BORRADOR" | "PUBLICADO" | "PROGRAMADO";

export function estadoEfectivo(estado: EstadoBase, publicadoEn: Date | null, ahora: Date = new Date()): EstadoBase {
  if (estado === "BORRADOR") return "BORRADOR";
  if (estado === "PROGRAMADO") return "PROGRAMADO";
  return publicadoEn && publicadoEn > ahora ? "PROGRAMADO" : "PUBLICADO";
}
