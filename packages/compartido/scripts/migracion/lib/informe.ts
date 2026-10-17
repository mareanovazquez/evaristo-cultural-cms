// Informe de la corrida (JSON + Markdown). Es un RESUMEN: no copia cuerpos de artículos ni bios, y los avisos de bio_con_correo traen
// solo el id y el nombre del autor y cuántos artículos afecta (nunca el correo). Lo único que escribe es en la carpeta de salida.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OpcionesCli, ConexionesVerificadas } from "./conexiones.ts";
import type { ResumenEjecucion } from "./ejecutor.ts";
import type { Preparado } from "./preparar.ts";
import { cuentaDe } from "./utilidades.ts";

export interface Informe {
  generadoEn: string;
  modo: "simular";
  alcance: OpcionesCli["alcance"];
  ids: number[];
  destino: { url: ConexionesVerificadas["destino"]; servidorCms: ConexionesVerificadas["servidorCms"]; servidorWordPress: ConexionesVerificadas["servidorWordPress"] };
  resumen: {
    articulosEnLaMuestra: number; articulosEnElPlan: number; convertidos: number; invalidos: number; excluidos: number; estados: Record<string, number>;
    bloqueantes: number; sinEncabezado: number[];
  };
  tablas: ResumenEjecucion["tablas"];
  articulos: Array<{ wpId: number; slug: string; estado: string; publicadoEn: string | null; seccion: string; categorias: string[]; categoriaPrincipal: string | null; autorWpUserId: number; encabezado: string | null; avisos: string[] }>;
  categoriasACrear: Array<{ slug: string; nombre: string | null; articulos: number[] }>;
  imagenes: {
    referenciadas: number; conFila: number; bytesTotales: number; porMime: Record<string, number>;
    originalesFaltantes: Array<{ adjuntoWpId: number; clave: string | null; usos: string[]; articulos: number[] }>;
    sinMedir: Array<{ adjuntoWpId: number; clave: string | null; motivo?: string; usos: string[]; articulos: number[] }>;
  };
  redirecciones: { total: number; porTipo: Record<string, number> };
  intercalaciones: Preparado["validacion"]["intercalaciones"];
  bloqueantes: Preparado["validacion"]["bloqueantes"];
  problemasDeArticulo: Preparado["validacion"]["deArticulo"];
  conflictos: Preparado["validacion"]["conflictos"];
  avisosPorCodigo: Record<string, { articulos: number; total: number }>;
  biosConCorreo: Array<{ wpUserId: number; nombre: string; articulos: number }>;
}

export function construirInforme(o: { generadoEn: string; opciones: OpcionesCli; ids: number[]; conexiones: Pick<ConexionesVerificadas, "destino" | "servidorCms" | "servidorWordPress">; preparado: Preparado; ejecucion: ResumenEjecucion }): Informe {
  const { plan, planCompleto, validacion } = o.preparado;
  const avisosPorCodigo: Informe["avisosPorCodigo"] = {};
  const sumar = (clave: string) => { const a = (avisosPorCodigo[clave] ??= { articulos: 0, total: 0 }); a.articulos++; a.total++; };
  for (const r of plan.articulos) {
    for (const w of r.avisosMigracion?.cuerpo ?? []) { const a = (avisosPorCodigo[`cuerpo:${w.code}`] ??= { articulos: 0, total: 0 }); a.articulos++; a.total += w.count; }
    for (const w of r.avisosMigracion?.titulo ?? []) sumar(`titulo:${String(w).split(":")[0]}`);
    for (const w of r.avisosMigracion?.migracion ?? []) sumar(`migracion:${w.code}`);
  }
  const bios = new Map<number, { wpUserId: number; nombre: string; articulos: number }>();
  for (const r of plan.articulos) {
    for (const w of r.avisosMigracion?.migracion ?? []) {
      if (w.code !== "bio_con_correo") continue;
      const d = w.detalle as { wpUserId: number; nombre: string };
      const b = bios.get(d.wpUserId) ?? { wpUserId: d.wpUserId, nombre: d.nombre, articulos: 0 };
      b.articulos++;
      bios.set(d.wpUserId, b);
    }
  }
  return {
    generadoEn: o.generadoEn, modo: "simular", alcance: o.opciones.alcance, ids: o.ids,
    destino: { url: o.conexiones.destino, servidorCms: o.conexiones.servidorCms, servidorWordPress: o.conexiones.servidorWordPress },
    resumen: {
      articulosEnLaMuestra: o.ids.length, articulosEnElPlan: plan.articulos.length, convertidos: planCompleto.articulos.length,
      invalidos: plan.articulos.filter((r) => r.validacion.errores.length || r.validacion.erroresBio.length).length,
      excluidos: o.ids.length - plan.articulos.length, estados: cuentaDe(plan.articulos.map((r) => r.estado)),
      bloqueantes: validacion.bloqueantes.length, sinEncabezado: plan.articulos.filter((r) => !r.imagenEncabezado).map((r) => r.wpId),
    },
    tablas: o.ejecucion.tablas,
    articulos: plan.articulos.map((r) => ({
      wpId: r.wpId, slug: r.slug, estado: r.estado, publicadoEn: r.publicadoEn, seccion: r.seccion, categorias: r.categorias, categoriaPrincipal: r.categoriaPrincipal,
      autorWpUserId: r.autores[0]!.wpUserId, encabezado: r.imagenEncabezado?.clave ?? null,
      avisos: [...(r.avisosMigracion?.migracion ?? []).map((w) => w.code)],
    })),
    categoriasACrear: plan.categoriasACrear,
    imagenes: {
      referenciadas: plan.imagenesReferenciadas.length, conFila: plan.imagenes.length, bytesTotales: plan.imagenes.reduce((n, i) => n + i.bytes, 0),
      porMime: cuentaDe(plan.imagenes.map((i) => i.tipoMime)),
      originalesFaltantes: plan.imagenesSinFila.filter((i) => i.codigo === "original_faltante").map(({ adjuntoWpId, clave, usos, articulos }) => ({ adjuntoWpId, clave, usos, articulos })),
      sinMedir: plan.imagenesSinFila.filter((i) => i.codigo === "imagen_sin_medir").map(({ adjuntoWpId, clave, motivo, usos, articulos }) => ({ adjuntoWpId, clave, motivo, usos, articulos })),
    },
    redirecciones: { total: plan.redirecciones.length, porTipo: cuentaDe(plan.redirecciones.map((r) => r.tipo)) },
    intercalaciones: validacion.intercalaciones, bloqueantes: validacion.bloqueantes, problemasDeArticulo: validacion.deArticulo, conflictos: validacion.conflictos,
    avisosPorCodigo, biosConCorreo: [...bios.values()].sort((a, b) => a.wpUserId - b.wpUserId),
  };
}

const j = (v: unknown) => "`" + JSON.stringify(v) + "`";

export function informeAMarkdown(i: Informe): string {
  const md: string[] = [];
  md.push("# Simulación de la migración", "", "Solo lectura: no se escribió nada en ninguna base. Generado por `scripts/migracion/migrar.ts --simular`.", "");
  md.push(`- Generado: ${i.generadoEn}; alcance ${j(i.alcance)}; ${i.ids.length} ids`);
  md.push(`- Destino verificado: ${i.destino.url.host}:${i.destino.url.puerto}/${i.destino.url.base}; servidor ${j(i.destino.servidorCms)}; WordPress ${j(i.destino.servidorWordPress)}`);
  md.push(`- Resumen: ${j(i.resumen)}`);
  md.push(`- Intercalación real de las columnas únicas: ${j(i.intercalaciones.map((c) => ({ columna: `${c.tabla}.${c.columna}`, real: c.real, ok: c.ok })))}`);
  md.push(`- Bloqueantes: ${i.bloqueantes.length ? j(i.bloqueantes) : "ninguno"}`);
  md.push(`- Artículos excluidos o con problema: ${i.problemasDeArticulo.length ? j(i.problemasDeArticulo) : "ninguno"}`);
  md.push(`- Conflictos: ${i.conflictos.length ? j(i.conflictos) : "ninguno"}`);
  md.push(`- Categorías a crear: ${j(i.categoriasACrear)}`);
  md.push(`- Redirecciones: ${j(i.redirecciones)}`);
  md.push(`- Imágenes: ${j({ referenciadas: i.imagenes.referenciadas, conFila: i.imagenes.conFila, bytesTotales: i.imagenes.bytesTotales, porMime: i.imagenes.porMime })}`);
  md.push(`- Originales faltantes: ${j(i.imagenes.originalesFaltantes)}; sin medir: ${j(i.imagenes.sinMedir)}`);
  md.push(`- Avisos por código (artículos / ocurrencias): ${j(i.avisosPorCodigo)}`);
  md.push(`- Bios con correo (el correo no se copia): ${j(i.biosConCorreo)}`, "");
  md.push("## Filas por tabla", "", "| tabla | en el plan | insertar | actualizar | omitir | ya existe (sin comparar) | clave natural |", "|---|---|---|---|---|---|---|");
  for (const t of i.tablas) md.push(`| ${t.tabla} | ${t.enElPlan} | ${t.insertar} | ${t.actualizar} | ${t.omitir} | ${t.yaExisteSinComparar ?? "—"} | ${t.claveNatural} |`);
  md.push("", "## Artículos", "", "| wpId | slug | estado | publicadoEn | sección | encabezado | avisos |", "|---|---|---|---|---|---|---|");
  for (const a of i.articulos) md.push(`| ${a.wpId} | ${a.slug} | ${a.estado} | ${a.publicadoEn ?? "null"} | ${a.seccion} | ${a.encabezado ?? "—"} | ${a.avisos.join(", ") || "—"} |`);
  return md.join("\n") + "\n";
}

export function nombreDeInforme(generadoEn: string): string {
  return `${generadoEn.slice(0, 19).replace(/:/g, "")}Z-simular`;
}

/** Escribe <carpeta>/<nombre>.json y .md. Devuelve las rutas. */
export function escribirInforme(carpeta: string, i: Informe): { json: string; md: string } {
  mkdirSync(carpeta, { recursive: true });
  const base = join(carpeta, nombreDeInforme(i.generadoEn));
  writeFileSync(`${base}.json`, JSON.stringify(i, null, 1));
  writeFileSync(`${base}.md`, informeAMarkdown(i));
  return { json: `${base}.json`, md: `${base}.md` };
}
