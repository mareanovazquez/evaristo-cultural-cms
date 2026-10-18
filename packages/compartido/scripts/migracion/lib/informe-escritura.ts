// Informe de la escritura (JSON + Markdown). Es un RESUMEN: no copia cuerpos de artículos ni bios, las diferencias se informan con los NOMBRES
// de los campos (nunca con sus valores) y todo el texto pasa por sinCorreos() antes de guardarse. Lo único que escribe es la carpeta de salida.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IdsSobrescritura } from "./confirmaciones.ts";
import type { PlanEscribible, ResultadoEscritura, ServidorEscritura } from "./escribir.ts";

const REGEX_CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Reemplaza cualquier dirección de correo que aparezca en un texto. */
export const sinCorreos = (texto: string) => texto.replace(REGEX_CORREO, "[correo omitido]");

export interface FilaTabla { tabla: string; enElPlan: number; insertadas: number; sinCambios: number; difieren: number; sobrescritas: number; conflictos: number; fallidos: number }

export interface InformeEscritura {
  generadoEn: string;
  modo: "escribir";
  destino: { host: string; puerto: number; base: string };
  servidor: ServidorEscritura;
  opciones: { abortarAlPrimerError: boolean; sobrescribir: boolean; esperarArticulos: number | null; esperarSobrescribir: number | null };
  estado: ResultadoEscritura["estado"];
  abortado: boolean;
  codigoDeSalida: number;
  tablas: FilaTabla[];
  /** Filas que ya existían y difieren del plan: solo los nombres de los campos. */
  difieren: Array<{ tabla: string; clave: string; campos: string[]; sobrescrita: boolean }>;
  conflictos: Array<{ tabla: string; clave: string; detalle: unknown }>;
  fallidos: Array<{ wpId: number; slug: string; motivo: string }>;
  /** Ids de las filas que la sobrescritura reescribió, por tipo: wpId de artículos, wpUserId de autores y wpId de imágenes (nunca valores). */
  idsSobrescritos: IdsSobrescritura;
  /** Cuántos artículos del plan llevan cada aviso (solo el código). */
  avisosPorCodigo: Record<string, number>;
}

/** 0 si todo salió bien; 1 si hubo artículos fallidos o conflictos. (Una corrida rechazada por las confirmaciones sale con 2.) */
export function codigoDeSalida(r: ResultadoEscritura): number {
  return r.conteos.fallidos > 0 || r.conflictos.length > 0 ? 1 : 0;
}

export function construirInformeEscritura(o: {
  generadoEn: string; destino: { host: string; puerto: number; base: string }; servidor: ServidorEscritura; opciones: InformeEscritura["opciones"];
  plan: PlanEscribible; resultado: ResultadoEscritura;
}): InformeEscritura {
  const { plan, resultado: r } = o;
  const fila = (tabla: string, enElPlan: number, x: Partial<Omit<FilaTabla, "tabla" | "enElPlan">>): FilaTabla =>
    ({ tabla, enElPlan, insertadas: 0, sinCambios: 0, difieren: 0, sobrescritas: 0, conflictos: 0, fallidos: 0, ...x });
  const b = r.base;
  const avisos: Record<string, number> = {};
  for (const a of plan.articulos) {
    const codigos = [
      ...(a.avisosMigracion?.migracion ?? []).map((w) => `migracion:${w.code}`),
      ...(a.avisosMigracion?.cuerpo ?? []).map((w) => `cuerpo:${w.code}`),
      ...(a.avisosMigracion?.titulo ?? []).map((w) => `titulo:${String(w).split(":")[0]}`),
    ];
    for (const c of new Set(codigos)) avisos[c] = (avisos[c] ?? 0) + 1;
  }
  return {
    generadoEn: o.generadoEn, modo: "escribir", destino: o.destino, servidor: o.servidor, opciones: o.opciones, estado: r.estado, abortado: r.abortado, codigoDeSalida: codigoDeSalida(r),
    tablas: [
      fila("categorias", b.categorias.enElPlan, { insertadas: b.categorias.creadas, sinCambios: b.categorias.existentes }),
      fila("autores", b.autores.enElPlan, { insertadas: b.autores.creados, sinCambios: b.autores.sinCambios, difieren: b.autores.difieren, sobrescritas: b.autores.sobrescritos, conflictos: b.autores.conflictos }),
      fila("imagenes", b.imagenes.enElPlan, { insertadas: b.imagenes.creadas, sinCambios: b.imagenes.sinCambios, difieren: b.imagenes.difieren, sobrescritas: b.imagenes.sobrescritas, conflictos: b.imagenes.conflictos }),
      fila("articulos", plan.articulos.length, { insertadas: r.conteos.escritos, sinCambios: r.conteos.sinCambios, difieren: r.conteos.difieren, sobrescritas: r.conteos.sobrescritos, fallidos: r.conteos.fallidos }),
      fila("redirecciones", plan.redirecciones.length, { insertadas: r.redirecciones.creadas, sinCambios: r.redirecciones.sinCambios, conflictos: r.redirecciones.conflictos }),
    ],
    difieren: [
      ...b.difieren.map((d) => ({ tabla: d.tabla, clave: d.clave, campos: d.campos, sobrescrita: d.sobrescrita })),
      ...r.articulos.filter((x) => x.resultado === "difiere" || x.resultado === "sobrescrito").map((x) => ({ tabla: "articulos", clave: String(x.wpId), campos: x.campos ?? [], sobrescrita: x.resultado === "sobrescrito" })),
    ],
    conflictos: r.conflictos.map((c) => ({ tabla: c.tabla, clave: c.clave, detalle: c.detalle })),
    fallidos: r.articulos.filter((x) => x.resultado === "fallido").map((x) => ({ wpId: x.wpId, slug: x.slug, motivo: sinCorreos(x.motivo ?? "") })),
    idsSobrescritos: r.idsSobrescritos, avisosPorCodigo: avisos,
  };
}

const j = (v: unknown) => "`" + JSON.stringify(v) + "`";

export function informeEscrituraAMarkdown(i: InformeEscritura): string {
  const md: string[] = [];
  md.push("# Escritura de la migración", "", "Generado por la corrida de escritura. No copia cuerpos ni bios; las diferencias son nombres de campos.", "");
  md.push(`- Generado: ${i.generadoEn}; estado ${i.estado}${i.abortado ? " (abortada al primer error)" : ""}; código de salida ${i.codigoDeSalida}`);
  md.push(`- Destino verificado: ${i.destino.host}:${i.destino.puerto}/${i.destino.base}; servidor ${j(i.servidor)}`);
  md.push(`- Opciones: ${j(i.opciones)}`);
  const total = i.idsSobrescritos.articulos.length + i.idsSobrescritos.autores.length + i.idsSobrescritos.imagenes.length;
  md.push(`- Filas reescritas por la sobrescritura (solo ids): ${total ? j(i.idsSobrescritos) : "ninguna"}`);
  md.push(`- Conflictos: ${i.conflictos.length ? j(i.conflictos) : "ninguno"}`);
  md.push(`- Artículos fallidos: ${i.fallidos.length ? j(i.fallidos) : "ninguno"}`);
  md.push(`- Avisos por código (artículos): ${j(i.avisosPorCodigo)}`, "");
  md.push("## Filas por tabla", "", "| tabla | en el plan | insertadas | sin cambios | difieren | sobrescritas | conflictos | fallidos |", "|---|---|---|---|---|---|---|---|");
  for (const t of i.tablas) md.push(`| ${t.tabla} | ${t.enElPlan} | ${t.insertadas} | ${t.sinCambios} | ${t.difieren} | ${t.sobrescritas} | ${t.conflictos} | ${t.fallidos} |`);
  md.push("", "## Filas que difieren del plan (campos)", "");
  if (!i.difieren.length) md.push("ninguna");
  for (const d of i.difieren) md.push(`- ${d.tabla} ${d.clave}: ${d.campos.join(", ")} (${d.sobrescrita ? "sobrescrita" : "no se pisó"})`);
  return sinCorreos(md.join("\n")) + "\n";
}

export function nombreDeInformeEscritura(generadoEn: string): string {
  return `${generadoEn.slice(0, 19).replace(/:/g, "")}Z-escribir`;
}

/** Escribe <carpeta>/<fecha>-escribir.json y .md. Devuelve las rutas. */
export function escribirInformeEscritura(carpeta: string, i: InformeEscritura): { json: string; md: string } {
  mkdirSync(carpeta, { recursive: true });
  const base = join(carpeta, nombreDeInformeEscritura(i.generadoEn));
  writeFileSync(`${base}.json`, sinCorreos(JSON.stringify(i, null, 1)));
  writeFileSync(`${base}.md`, informeEscrituraAMarkdown(i));
  return { json: `${base}.json`, md: `${base}.md` };
}
