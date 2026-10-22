import React, { useEffect, useState } from 'react'
import { parseVideoUrl, type ParsedVideo } from '@evaristo/compartido/render'

interface VideoDialogProps {
  isOpen: boolean
  onSave: (video: ParsedVideo) => void
  onCancel: () => void
}

// El formulario se monta de nuevo cada vez que se abre la ventana, así arranca vacío
export const VideoDialog: React.FC<VideoDialogProps> = ({ isOpen, ...rest }) => {
  if (!isOpen) return null
  return <VideoDialogForm {...rest} />
}

const VideoDialogForm: React.FC<Omit<VideoDialogProps, 'isOpen'>> = ({ onSave, onCancel }) => {
  const [url, setUrl] = useState('')
  const [showError, setShowError] = useState(false)

  const handleSave = () => {
    const parsed = parseVideoUrl(url)
    if (!parsed) {
      setShowError(true)
      return
    }
    onSave(parsed)
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

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="video-dialog-title">
      <div className="modal-container">
        <div className="modal-header">
          <h3 id="video-dialog-title">Insertar video</h3>
          <button type="button" className="btn-close" onClick={onCancel} aria-label="Cerrar ventana">
            ×
          </button>
        </div>

        <div className="modal-body modal-form">
          <div className="form-field">
            <label htmlFor="video-url">Enlace del video (YouTube o Vimeo)</label>
            <input
              id="video-url"
              type="text"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setShowError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  handleSave()
                }
              }}
              aria-invalid={showError}
              autoFocus
            />
            {showError && <p className="form-error">Por ahora solo se admiten enlaces de YouTube y Vimeo</p>}
          </div>
        </div>

        <div className="modal-footer">
          <span />
          <div className="modal-footer-right">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancelar (Esc)
            </button>
            <button type="button" className="btn-primary" onClick={handleSave}>
              Insertar (Ctrl+Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
