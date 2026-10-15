/**
 * Reconoce enlaces de YouTube y Vimeo. Es una función pura, sin dependencias,
 * para usar igual en el editor, el conversor de la migración y las páginas de Astro.
 *
 * Solo se guardan el proveedor y el id: la URL y el HTML del reproductor
 * se generan al renderizar, con una lista blanca.
 */

export type VideoProvider = 'youtube' | 'vimeo'
export interface VideoRef {
  provider: VideoProvider
  id: string
}

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/
const VIMEO_ID = /^\d{5,12}$/

export function parseVideoUrl(input: string): VideoRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id: string | undefined
    if (parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1]
    return id && YT_ID.test(id) ? { provider: 'youtube', id } : null
  }
  if (host === 'youtu.be') {
    const id = parts[0]
    return id && YT_ID.test(id) ? { provider: 'youtube', id } : null
  }
  if (host === 'vimeo.com') {
    const id = parts.find((p) => /^\d+$/.test(p))
    return id && VIMEO_ID.test(id) ? { provider: 'vimeo', id } : null
  }
  if (host === 'player.vimeo.com') {
    const id = parts[0] === 'video' ? parts[1] : undefined
    return id && VIMEO_ID.test(id) ? { provider: 'vimeo', id } : null
  }
  return null
}

export function videoUrl(v: VideoRef): string {
  return v.provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${v.id}`
    : `https://vimeo.com/${v.id}`
}
