// Comparación de cuerpos del editor para las pruebas: ignora el orden de las claves y de las marcas, y los atributos que valen su valor por defecto
// (ver la lista en test-ida-vuelta.ts). Toda otra diferencia cuenta.

const PREDETERMINADOS: Record<string, Record<string, unknown>> = {
  '*': { textAlign: 'left', altPendiente: false, decorativa: false, epigrafe: '', imagenId: null, colspan: 1, rowspan: 1 },
  orderedList: { start: 1, type: null },
  link: { class: null, rel: null, target: null, title: null },
}

/** Forma canónica: claves ordenadas y sin los atributos que valen su valor por defecto. */
export function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico)
  if (valor && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>
    const tipo = typeof objeto['type'] === 'string' ? objeto['type'] : ''
    const salida: Record<string, unknown> = {}
    for (const clave of Object.keys(objeto).sort()) {
      const v = objeto[clave]
      if (clave === 'attrs' && v && typeof v === 'object') {
        const attrs = canonico(v) as Record<string, unknown>
        for (const [k, porDefecto] of Object.entries({ ...PREDETERMINADOS['*'], ...PREDETERMINADOS[tipo] })) if (k in attrs && attrs[k] === porDefecto) delete attrs[k]
        if (Object.keys(attrs).length > 0) salida[clave] = attrs
      } else if (clave === 'marks' && Array.isArray(v)) {
        salida[clave] = v.map(canonico).sort((x, y) => String((x as { type: string }).type).localeCompare(String((y as { type: string }).type)))
      } else {
        salida[clave] = canonico(v)
      }
    }
    return salida
  }
  return valor
}

/** Primera diferencia entre dos valores canónicos, con su ruta. */
export function diferencia(a: unknown, b: unknown, ruta = '$'): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = diferencia(a[i], b[i], `${ruta}[${i}]`)
      if (d) return d
    }
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = diferencia((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${ruta}.${k}`)
      if (d) return d
    }
  }
  return `${ruta}: original ${JSON.stringify(a)?.slice(0, 160)} / editor ${JSON.stringify(b)?.slice(0, 160)}`
}

