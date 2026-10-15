// Funciones puras para videos. Sin dependencias, para reutilizar en Astro y en el conversor.

export type VideoProvider = 'youtube' | 'vimeo'

export interface ParsedVideo {
  provider: VideoProvider
  id: string
}

export const VIDEO_PROVIDERS: readonly VideoProvider[] = ['youtube', 'vimeo']

const ID_PATTERNS: Record<VideoProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{6,20}$/,
  vimeo: /^\d+$/,
}

export function isVideoProvider(provider: unknown): provider is VideoProvider {
  return typeof provider === 'string' && (VIDEO_PROVIDERS as readonly string[]).includes(provider)
}

export function isValidVideoId(provider: unknown, id: unknown): boolean {
  return isVideoProvider(provider) && typeof id === 'string' && ID_PATTERNS[provider].test(id)
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const YOUTUBE_PATH_PREFIXES = new Set(['embed', 'shorts', 'live'])

export function parseVideoUrl(url: string): ParsedVideo | null {
  if (typeof url !== 'string') return null
  const raw = url.trim()
  if (!raw) return null

  let parsed: URL
  try {
    // Admite enlaces pegados sin protocolo ("youtu.be/ID")
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname.split('/').filter(Boolean)
  let candidate: ParsedVideo | null = null

  if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') {
      const id = parsed.searchParams.get('v')
      if (id) candidate = { provider: 'youtube', id }
    } else if (segments.length >= 2 && YOUTUBE_PATH_PREFIXES.has(segments[0])) {
      candidate = { provider: 'youtube', id: segments[1] }
    }
  } else if (host === 'youtu.be') {
    if (segments[0]) candidate = { provider: 'youtube', id: segments[0] }
  } else if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    if (segments[0]) candidate = { provider: 'vimeo', id: segments[0] }
  } else if (host === 'player.vimeo.com') {
    if (segments[0] === 'video' && segments[1]) candidate = { provider: 'vimeo', id: segments[1] }
  }

  return candidate && isValidVideoId(candidate.provider, candidate.id) ? candidate : null
}

export function videoEmbedUrl(provider: VideoProvider, id: string): string {
  return provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${id}`
    : `https://player.vimeo.com/video/${id}`
}

export function videoWatchUrl(provider: VideoProvider, id: string): string {
  return provider === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`
}

export function videoProviderLabel(provider: VideoProvider): string {
  return provider === 'youtube' ? 'YouTube' : 'Vimeo'
}
