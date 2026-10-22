import React from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  isValidVideoId,
  isVideoProvider,
  parseVideoUrl,
  videoProviderLabel,
  videoWatchUrl,
} from '@evaristo/compartido/render'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      /**
       * Insert a video block (provider + id, never the URL or HTML)
       */
      insertVideo: (attributes: { provider: string; id: string }) => ReturnType
    }
  }
}

export const VideoView: React.FC<NodeViewProps> = (props) => {
  const { provider, id } = props.node.attrs
  const valid = isVideoProvider(provider) && isValidVideoId(provider, id)

  return (
    <NodeViewWrapper
      as="figure"
      className={`video-editor-box ${props.selected ? 'ProseMirror-selectednode is-selected' : ''}`}
      data-drag-handle=""
    >
      {valid ? (
        <>
          <span className="video-editor-provider">Video de {videoProviderLabel(provider)}</span>
          <code className="video-editor-id">{id}</code>
          <a href={videoWatchUrl(provider, id)} target="_blank" rel="noopener noreferrer">
            Abrir en una pestaña nueva
          </a>
        </>
      ) : (
        <span className="video-editor-provider">Video no válido</span>
      )}
    </NodeViewWrapper>
  )
}

export const Video = Node.create({
  name: 'video',

  group: 'block',

  atom: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      provider: {
        default: 'youtube',
        renderHTML: (attributes) => ({ 'data-provider': attributes.provider }),
      },
      id: {
        default: '',
        renderHTML: (attributes) => ({ 'data-id': attributes.id }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-provider][data-id]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          const provider = el.getAttribute('data-provider')
          const id = el.getAttribute('data-id')
          return isValidVideoId(provider, id) ? { provider, id } : false
        },
      },
      {
        // Reproductores pegados desde otros sitios (p. ej. WordPress): se guarda solo provider + id
        tag: 'iframe[src]',
        getAttrs: (element) => {
          const parsed = parseVideoUrl((element as HTMLElement).getAttribute('src') || '')
          return parsed ? { provider: parsed.provider, id: parsed.id } : false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'video' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoView)
  },

  addCommands() {
    return {
      insertVideo:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    }
  },
})
