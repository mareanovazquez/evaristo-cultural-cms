// Ejecutores del Plan. Un ejecutor recibe el Plan ya validado y dice (o hace) lo que corresponde tabla por tabla.
// En este tramo solo existe el ejecutor NULO, que no escribe: consulta el CMS con consultar() (solo SELECT) y cuenta lo que haría.
// El que escribe todavía no existe a propósito: nada de este módulo importa un cliente con permiso de escritura.
import type { Plan } from "./armar.ts";
import type { Consulta } from "./leer-wordpress.ts";
import { marcas, str } from "./utilidades.ts";

export interface ResumenTabla {
  tabla: string;
  /** Filas que el plan quiere dejar en la tabla. */
  enElPlan: number;
  /** Filas nuevas: las del plan que no existen todavía (por clave natural). */
  insertar: number;
  /** Todavía no se compara contra lo existente: siempre 0 en este tramo. */
  actualizar: number;
  omitir: number;
  /** Filas del plan que ya existen por su clave natural. Se informan "ya existe (sin comparar)". null: la tabla no se cuenta. */
  yaExisteSinComparar: number | null;
  /** Claves naturales (hasta 20) de las que ya existen. */
  existentes: string[];
  claveNatural: string;
}

export interface ResumenEjecucion { modo: "simular"; tablas: ResumenTabla[] }

export interface Ejecutor {
  ejecutar(plan: Plan): Promise<ResumenEjecucion>;
}

const LOTE = 400;

/** No escribe nada. Cuenta, por tabla, lo que haría y cuántas filas ya existen por su clave natural. */
export class EjecutorNulo implements Ejecutor {
  constructor(private readonly bd: Consulta) {}

  /** Claves naturales (texto) que ya existen en `tabla.columna`, de entre `claves`. Solo SELECT, en lotes. */
  private async existentes(tabla: string, columna: string, claves: readonly (string | number)[]): Promise<string[]> {
    const encontradas: string[] = [];
    for (let i = 0; i < claves.length; i += LOTE) {
      const lote = claves.slice(i, i + LOTE);
      const filas = await this.bd(`SELECT ${columna} AS clave FROM ${tabla} WHERE ${columna} IN (${marcas(lote.length)})`, ...lote);
      for (const f of filas) encontradas.push(str(f["clave"]));
    }
    return encontradas;
  }

  private async tabla(tabla: string, columna: string, claveNatural: string, claves: readonly (string | number)[]): Promise<ResumenTabla> {
    const existentes = claves.length ? await this.existentes(tabla, columna, claves) : [];
    return {
      tabla, enElPlan: claves.length, insertar: claves.length - existentes.length, actualizar: 0, omitir: 0,
      yaExisteSinComparar: existentes.length, existentes: existentes.slice(0, 20), claveNatural,
    };
  }

  async ejecutar(plan: Plan): Promise<ResumenEjecucion> {
    const sinConteo = (tabla: string, enElPlan: number, claveNatural: string): ResumenTabla => ({
      tabla, enElPlan, insertar: enElPlan, actualizar: 0, omitir: 0, yaExisteSinComparar: null, existentes: [], claveNatural,
    });
    const tablas = [
      await this.tabla("categorias", "slug", "slug", plan.categoriasACrear.map((c) => c.slug)),
      await this.tabla("autores", "wpUserId", "wpUserId", plan.autores.map((a) => a.wpUserId)),
      await this.tabla("imagenes", "wpId", "wpId", plan.imagenes.map((i) => i.wpId)),
      await this.tabla("articulos", "wpId", "wpId", plan.articulos.map((a) => a.wpId)),
      sinConteo("articulos_categorias", plan.articulos.reduce((n, a) => n + a.categorias.length, 0), "(articuloId, categoriaId)"),
      sinConteo("articulos_autores", plan.articulos.reduce((n, a) => n + a.autores.length, 0), "(articuloId, autorId)"),
      sinConteo("articulos_galeria", 0, "(sin clave única)"),
      sinConteo("fichas_tecnicas", 0, "articuloId"),
      await this.tabla("redirecciones", "origen", "origen", plan.redirecciones.map((r) => r.origen)),
    ];
    return { modo: "simular", tablas };
  }
}
