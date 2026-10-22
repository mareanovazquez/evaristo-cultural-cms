// Reglas del texto alternativo de las imágenes (especificación del artículo, 13.2), sin React:
//  - una imagen NUEVA sin texto alternativo se rechaza (hay que completarlo o marcarla como decorativa);
//  - una imagen migrada sin texto alternativo lleva altPendiente: true y se puede guardar con un aviso visible;
//  - al completar el texto alternativo se quita la marca; si después se borra el texto, NO se vuelve a poner (pasa a ser un error del modo estricto);
//  - el editor nunca activa la marca en imágenes nuevas: solo la conserva en las que ya la traían.
import type { Editor } from '@tiptap/core'
import { isAllowedImageSrc, type JSONNode } from '@evaristo/compartido/schema'
import type { ImagenAttributes } from './imagen'

/** Errores del formulario de imagen. Con altPendiente (imagen migrada) el texto alternativo puede seguir vacío. */
export function validarFormularioImagen(form: ImagenAttributes): Partial<Record<'src' | 'alt', string>> {
  const errors: Partial<Record<'src' | 'alt', string>> = {}
  if (!isAllowedImageSrc(form.src)) {
    errors.src = 'Ingresá una dirección válida: http://, https:// o una ruta que empiece con "/".'
  }
  if (!form.decorativa && !form.alt.trim() && !form.altPendiente) {
    errors.alt = 'El texto alternativo es obligatorio, salvo que la imagen sea decorativa.'
  }
  return errors
}

/** Está pendiente ahora mismo: viene marcada y todavía no tiene texto alternativo ni es decorativa. */
export const imagenPendiente = (form: Pick<ImagenAttributes, 'alt' | 'decorativa' | 'altPendiente'>): boolean =>
  form.altPendiente && !form.decorativa && !form.alt.trim()

/** Atributos a guardar a partir del formulario: la marca se conserva solo si sigue pendiente. */
export function atributosAlGuardar(form: ImagenAttributes): ImagenAttributes {
  return {
    imagenId: form.imagenId,
    src: form.src.trim(),
    alt: form.decorativa ? '' : form.alt.trim(),
    decorativa: form.decorativa,
    epigrafe: form.epigrafe.trim(),
    altPendiente: imagenPendiente(form),
  }
}

/** Guarda los atributos de la imagen que está en `pos`. Devuelve false si ahí no hay una imagen. */
export function guardarAtributosImagen(editor: Editor, pos: number, form: ImagenAttributes): boolean {
  const attrs = atributosAlGuardar(form)
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const node = state.doc.nodeAt(pos)
      if (node && node.type.name === 'imagen') {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
        return true
      }
      return false
    })
    .run()
}

/** Copia del documento sin los atributos de imagen vacíos: altPendiente solo se serializa cuando es true e imagenId cuando es un número. */
export function sinAltPendienteFalso(doc: JSONNode): JSONNode {
  const copia: JSONNode = { ...doc }
  if (copia.type === 'imagen' && copia.attrs) {
    const resto = { ...copia.attrs }
    if (resto.altPendiente !== true) delete resto.altPendiente
    if (resto.imagenId === null || resto.imagenId === undefined) delete resto.imagenId
    copia.attrs = resto
  }
  if (copia.content) copia.content = copia.content.map(sinAltPendienteFalso)
  return copia
}
