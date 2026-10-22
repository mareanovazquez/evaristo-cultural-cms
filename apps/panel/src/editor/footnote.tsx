import React from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

export interface FootnoteOptions {
  HTMLAttributes: Record<string, unknown>
  onOpenDialog?: (pos: number, content: Record<string, unknown>, isNew?: boolean) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /**
       * Insert a footnote at current position
       */
      insertFootnote: (attributes?: { content?: Record<string, unknown> }) => ReturnType
    }
  }
}

export const FootnoteView: React.FC<NodeViewProps> = (props) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const getPos = props.getPos
    if (typeof getPos === 'function') {
      const pos = getPos()
      if (typeof pos === 'number') {
        const options = props.extension.options as FootnoteOptions
        if (options.onOpenDialog) {
          options.onOpenDialog(pos, props.node.attrs.content || {}, false)
        }
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      const getPos = props.getPos
      if (typeof getPos === 'function') {
        const pos = getPos()
        if (typeof pos === 'number') {
          const options = props.extension.options as FootnoteOptions
          if (options.onOpenDialog) {
            options.onOpenDialog(pos, props.node.attrs.content || {}, false)
          }
        }
      }
    }
  }

  return (
    <NodeViewWrapper as="span" className="footnote-nodeview-wrapper" style={{ display: 'inline' }}>
      <sup
        className={`footnote-ref ${props.selected ? 'ProseMirror-selectednode is-selected' : ''}`}
        data-footnote="true"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label="Nota al pie. Presione Enter para editar"
        title="Nota al pie (clic para editar)"
      />
    </NodeViewWrapper>
  )
}

export const Footnote = Node.create<FootnoteOptions>({
  name: 'footnote',

  group: 'inline',

  inline: true,

  atom: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onOpenDialog: undefined,
    }
  },

  addAttributes() {
    return {
      content: {
        default: {
          type: 'doc',
          content: [{ type: 'paragraph' }],
        },
        parseHTML: (element) => {
          const raw = element.getAttribute('data-content')
          if (raw) {
            try {
              return JSON.parse(raw)
            } catch (e) {
              console.error('Error parsing footnote data-content', e)
            }
          }
          return {
            type: 'doc',
            content: [{ type: 'paragraph' }],
          }
        },
        renderHTML: (attributes) => {
          return {
            'data-footnote': 'true',
            'data-content': JSON.stringify(attributes.content || {}),
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'sup[data-footnote]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView)
  },

  addCommands() {
    return {
      insertFootnote:
        (attributes) =>
        ({ chain, state }) => {
          const content = attributes?.content || {
            type: 'doc',
            content: [{ type: 'paragraph' }],
          }
          const { to } = state.selection
          return chain()
            .insertContentAt(to, {
              type: this.name,
              attrs: { content },
            })
            .setTextSelection(to + 1)
            .run()
        },
    }
  },
})
