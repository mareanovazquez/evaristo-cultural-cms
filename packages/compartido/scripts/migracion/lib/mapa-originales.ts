// Del mapa de originales (`mapa-originales.csv`, lo escribe `extraer:originales`) a lo que necesita armar(). Pura: sin disco ni base.
//
// El mapa dice, por adjunto, su clave en el CMS (decisión 81: 45 renombrados con -wp<id>) y si su original es una miniatura (decisión 79).
// Con el mapa, la carpeta de originales es la que escribió el extractor (archivos con la clave del CMS). Sin el mapa, todo sigue como antes.
import type { EntradaMapa } from "./extraer-originales.ts";

export interface ClavesDelMapa {
  /** id del adjunto -> clave en el CMS, solo de los que no conservan su `_wp_attached_file`. */
  clavesCms: Map<number, string>;
  /** Adjuntos cuyo original es su miniatura más grande (coincidencia `miniatura`). */
  originalesReducidos: Set<number>;
  /** El mapa no corresponde a esta base de WordPress: un adjunto que falta en el mapa o tiene otra clave. Si hay alguno, no se sigue. */
  errores: string[];
}

/** `adjuntoPorClave`: los pares (_wp_attached_file, id) de la base de WordPress que se lee; el mapa tiene que tenerlos todos, con la misma clave. */
export function clavesDesdeMapa(mapa: ReadonlyMap<number, EntradaMapa>, adjuntoPorClave: ReadonlyArray<readonly [string, number]>): ClavesDelMapa {
  const r: ClavesDelMapa = { clavesCms: new Map(), originalesReducidos: new Set(), errores: [] };
  for (const [clave, id] of adjuntoPorClave) {
    if (!clave.trim()) continue;
    const e = mapa.get(id);
    if (!e) { r.errores.push(`el adjunto ${id} («${clave}») no está en el mapa`); continue; }
    if (e.clave.normalize("NFC") !== clave.normalize("NFC")) { r.errores.push(`el adjunto ${id} tiene la clave «${clave}» en WordPress y «${e.clave}» en el mapa`); continue; }
  }
  for (const [id, e] of mapa) {
    if (e.claveCms.normalize("NFC") !== e.clave.normalize("NFC")) r.clavesCms.set(id, e.claveCms.normalize("NFC"));
    if (e.coincidencia === "miniatura") r.originalesReducidos.add(id);
  }
  return r;
}
