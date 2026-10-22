import React, { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { isAllowedUrl } from '@evaristo/compartido/render'

interface FootnoteDialogProps {
  isOpen: boolean
  initialContent: Record<string, unknown> | null
  isNew: boolean
  onSave: (contentDoc: Record<string, unknown>) => void
  onCancel: () => void
  onDelete: () => void
}

export const FootnoteDialog: React.FC<FootnoteDialogProps> = ({
  isOpen,
  initialContent,
  onSave,
  onCancel,
  onDelete,
}) => {
  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: {
          openOnClick: false,
          HTMLAttributes: {
            rel: 'noopener noreferrer',
          },
          isAllowedUri: (url) => isAllowedUrl(url),
        },
      }),
    ],
    content: initialContent || {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'footnote-editor-content',
      },
    },
  })

  // Sync content when dialog opens with new initialContent
  useEffect(() => {
    if (isOpen && editor && initialContent) {
      editor.commands.setContent(initialContent)
      setTimeout(() => {
        editor.commands.focus('end')
      }, 50)
    }
  }, [isOpen, initialContent, editor])

  useEffect(() => {
    if (!isOpen) return

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
  }, [isOpen, editor, onSave, onCancel])

  if (!isOpen || !editor) return null

  const handleSave = () => {
    const json = editor.getJSON()
    // Check if empty
    const isEmpty =
      !json.content ||
      json.content.length === 0 ||
      (json.content.length === 1 &&
        json.content[0].type === 'paragraph' &&
        (!json.content[0].content || json.content[0].content.length === 0))

    if (isEmpty) {
      onDelete()
    } else {
      onSave(json as Record<string, unknown>)
    }
  }

  const setLink = () => {
    if (linkUrl) {
      if (isAllowedUrl(linkUrl)) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
      } else {
        alert('Solo se admiten enlaces http://, https:// o mailto:')
      }
    } else {
      editor.chain().focus().unsetLink().run()
    }
    setLinkInputOpen(false)
    setLinkUrl('')
  }

  const openLinkPrompt = () => {
    const previousUrl = editor.getAttributes('link').href || ''
    setLinkUrl(previousUrl)
    setLinkInputOpen(true)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="footnote-dialog-title">
      <div className="modal-container">
        <div className="modal-header">
          <h3 id="footnote-dialog-title">Editar nota al pie</h3>
          <button type="button" className="btn-close" onClick={onCancel} aria-label="Cerrar ventana">
            ×
          </button>
        </div>

        <div className="modal-toolbar">
          <button
            type="button"
            className={`btn-toolbar ${editor.isActive('bold') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Negrita"
          >
            <strong>N</strong>
          </button>
          <button
            type="button"
            className={`btn-toolbar ${editor.isActive('italic') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Itálica"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={`btn-toolbar ${editor.isActive('link') ? 'is-active' : ''}`}
            onClick={openLinkPrompt}
            title="Enlace"
          >
            🔗 Enlace
          </button>
          {editor.isActive('link') && (
            <button
              type="button"
              className="btn-toolbar"
              onClick={() => editor.chain().focus().unsetLink().run()}
              title="Quitar enlace"
            >
              Quitar enlace
            </button>
          )}
        </div>

        {linkInputOpen && (
          <div className="link-input-inline">
            <input
              type="url"
              placeholder="https://ejemplo.com o mailto:..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  setLink()
                } else if (e.key === 'Escape') {
                  setLinkInputOpen(false)
                }
              }}
              autoFocus
            />
            <button type="button" className="btn-small" onClick={setLink}>
              Aplicar
            </button>
            <button type="button" className="btn-small btn-secondary" onClick={() => setLinkInputOpen(false)}>
              Cancelar
            </button>
          </div>
        )}

        <div className="modal-body">
          <EditorContent editor={editor} />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-danger" onClick={onDelete}>
            Eliminar nota
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
