import React, { useEffect, useState } from 'react'
import type { ImagenAttributes } from './imagen'
import { atributosAlGuardar, imagenPendiente, validarFormularioImagen } from './imagen-alt'

interface ImagenDialogProps {
  isOpen: boolean
  initialAttrs: ImagenAttributes | null
  isNew: boolean
  onSave: (attrs: ImagenAttributes) => void
  onCancel: () => void
  onDelete: () => void
}

const EMPTY_IMAGEN: ImagenAttributes = { imagenId: null, src: '', alt: '', decorativa: false, epigrafe: '', altPendiente: false }

// El formulario se monta de nuevo cada vez que se abre la ventana, así toma los datos de la imagen elegida
export const ImagenDialog: React.FC<ImagenDialogProps> = ({ isOpen, ...rest }) => {
  if (!isOpen) return null
  return <ImagenDialogForm {...rest} />
}

const ImagenDialogForm: React.FC<Omit<ImagenDialogProps, 'isOpen'>> = ({ initialAttrs, isNew, onSave, onCancel, onDelete }) => {
  const [form, setForm] = useState<ImagenAttributes>(initialAttrs ?? EMPTY_IMAGEN)
  const [showErrors, setShowErrors] = useState(false)

  const errors = validarFormularioImagen(form)
  const pendiente = imagenPendiente(form)

  const handleSave = () => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true)
      return
    }
    onSave(atributosAlGuardar(form))
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const update = (patch: Partial<ImagenAttributes>) => setForm((prev) => ({ ...prev, ...patch }))

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="imagen-dialog-title">
      <div className="modal-container">
        <div className="modal-header">
          <h3 id="imagen-dialog-title">{isNew ? 'Insertar imagen' : 'Editar imagen'}</h3>
          <button type="button" className="btn-close" onClick={onCancel} aria-label="Cerrar ventana">
            ×
          </button>
        </div>

        <div className="modal-body modal-form">
          <div className="form-field">
            <label htmlFor="imagen-src">URL de la imagen</label>
            <input
              id="imagen-src"
              type="text"
              placeholder="https://… o /ruta/imagen.jpg"
              value={form.src}
              onChange={(e) => update({ src: e.target.value })}
              aria-invalid={showErrors && !!errors.src}
              autoFocus
            />
            {showErrors && errors.src && <p className="form-error">{errors.src}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="imagen-alt">Texto alternativo</label>
            {pendiente && (
              <p className="form-aviso" role="alert">
                Falta el texto alternativo de esta imagen. Completalo para quitar el aviso.
              </p>
            )}
            <input
              id="imagen-alt"
              type="text"
              placeholder="Descripción de la imagen para quien no puede verla"
              value={form.decorativa ? '' : form.alt}
              disabled={form.decorativa}
              onChange={(e) => update({ alt: e.target.value })}
              aria-invalid={showErrors && !!errors.alt}
            />
            {showErrors && errors.alt && <p className="form-error">{errors.alt}</p>}
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={form.decorativa}
                onChange={(e) => update({ decorativa: e.target.checked })}
              />
              Imagen decorativa (sin texto alternativo)
            </label>
          </div>

          <div className="form-field">
            <label htmlFor="imagen-epigrafe">Epígrafe</label>
            <input
              id="imagen-epigrafe"
              type="text"
              placeholder="Opcional. Se muestra debajo de la imagen"
              value={form.epigrafe}
              onChange={(e) => update({ epigrafe: e.target.value })}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-danger" onClick={onDelete}>
            Eliminar imagen
          </button>
          <div className="modal-footer-right">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancelar (Esc)
            </button>
            <button type="button" className="btn-primary" onClick={handleSave}>
              Guardar (Ctrl+Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
