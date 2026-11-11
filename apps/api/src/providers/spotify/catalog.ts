import { z } from 'zod'
import { AppError } from '../../lib/errors.ts'
import { TtlCache } from '../../lib/ttl-cache.ts'
import type { SpotifyAccountsConfig } from './accounts.ts'

const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const API = 'https://api.spotify.com/v1'
/** Máximo por solicitud en modo de desarrollo (verificado: 20 responde "Invalid limit"). */
export const SEARCH_PAGE_SIZE = 10
const SEARCH_MAX_OFFSET = 40
const SEARCH_CACHE_MS = 60_000
const TRACK_CACHE_MS = 10 * 60_000
const TOKEN_MARGIN_MS = 60_000

const imageSchema = z.object({ url: z.string(), width: z.number().nullable().optional() })
const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  duration_ms: z.number(),
  explicit: z.boolean(),
  is_playable: z.boolean().optional(),
  external_urls: z.object({ spotify: z.string() }),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({ name: z.string(), images: z.array(imageSchema) }),
})
const searchSchema = z.object({
  tracks: z.object({ items: z.array(trackSchema.nullable()), next: z.string().nullable() }),
})
const appTokenSchema = z.object({ access_token: z.string(), expires_in: z.number() })

/** Canción del catálogo, ya traducida a nuestro modelo. */
export type CatalogTrack = {
  spotifyTrackId: string
  spotifyUrl: string
  name: string
  artist: string
  album: string
  imageUrl: string | null
  durationMs: number
  explicit: boolean
}

export type CatalogPage = { items: CatalogTrack[]; nextOffset: number | null }

/** Contrato que usan las rutas; las pruebas lo reemplazan por un doble. */
export interface SpotifyCatalog {
  search(query: string, offset: number, market: string): Promise<CatalogPage>
  /** null si no existe o no se puede reproducir en ese mercado. */
  getTrack(id: string, market: string): Promise<CatalogTrack | null>
}

const unavailable = (message = 'Spotify no responde. Intenta de nuevo.') =>
  new AppError(503, 'SPOTIFY_UNAVAILABLE', message)

/** Portada de unos 300 px: la más pequeña que mida al menos 300, o la más grande. */
function pickImage(images: z.infer<typeof imageSchema>[]): string | null {
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (sorted.find((image) => (image.width ?? 0) >= 300) ?? sorted.at(-1))?.url ?? null
}

function toCatalogTrack(track: z.infer<typeof trackSchema>): CatalogTrack {
  return {
    spotifyTrackId: track.id,
    spotifyUrl: track.external_urls.spotify,
    name: track.name,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album.name,
    imageUrl: pickImage(track.album.images),
    durationMs: track.duration_ms,
    explicit: track.explicit,
  }
}

/**
 * Catálogo de Spotify con el token de la aplicación (Client Credentials, docs/DISENO.md §6):
 * los invitados buscan sin cuenta y no gastan el permiso del anfitrión.
 */
export class HttpSpotifyCatalog implements SpotifyCatalog {
  private readonly config: SpotifyAccountsConfig
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private token: { value: string; expiresAt: number } | null = null
  private tokenRequest: Promise<string> | null = null
  private readonly searches: TtlCache<CatalogPage>
  private readonly tracks: TtlCache<CatalogTrack | null>

  constructor(config: SpotifyAccountsConfig, fetchImpl: typeof fetch = fetch, now = Date.now) {
    this.config = config
    this.fetch = fetchImpl
    this.now = now
    this.searches = new TtlCache(SEARCH_CACHE_MS, 300, now)
    this.tracks = new TtlCache(TRACK_CACHE_MS, 1000, now)
  }

  async search(query: string, offset: number, market: string): Promise<CatalogPage> {
    const key = `${market}|${offset}|${query.toLowerCase()}`
    const cached = this.searches.get(key)
    if (cached) return cached

    const params = new URLSearchParams({
      q: query,
      type: 'track',
      market,
      limit: String(SEARCH_PAGE_SIZE),
      offset: String(offset),
    })
    const data = searchSchema.parse(await this.get(`/search?${params}`))
    const items = data.tracks.items
      .filter((track) => track !== null && track.is_playable !== false)
      .map((track) => toCatalogTrack(track!))
    const next = offset + SEARCH_PAGE_SIZE
    const page = {
      items,
      nextOffset: data.tracks.next && next <= SEARCH_MAX_OFFSET ? next : null,
    }
    this.searches.set(key, page)
    for (const item of items) this.tracks.set(`${market}|${item.spotifyTrackId}`, item)
    return page
  }

  async getTrack(id: string, market: string): Promise<CatalogTrack | null> {
    const key = `${market}|${id}`
    const cached = this.tracks.get(key)
    if (cached !== undefined) return cached
    const data = await this.get(`/tracks/${id}?market=${market}`, { allowNotFound: true })
    const parsed = data === null ? null : trackSchema.parse(data)
    const track = parsed && parsed.is_playable !== false ? toCatalogTrack(parsed) : null
    this.tracks.set(key, track)
    return track
  }

  private async get(path: string, { allowNotFound = false } = {}): Promise<unknown> {
    let response = await this.send(path, await this.appToken())
    if (response.status === 401) {
      this.token = null // token revocado o vencido antes de tiempo: uno nuevo y reintento
      response = await this.send(path, await this.appToken())
    }
    if (allowNotFound && (response.status === 404 || response.status === 400)) return null
    if (response.status === 429) {
      throw unavailable('Spotify está recibiendo muchas solicitudes. Intenta en unos segundos.')
    }
    if (!response.ok) throw unavailable()
    return response.json()
  }

  private async send(path: string, token: string): Promise<Response> {
    try {
      return await this.fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw unavailable()
    }
  }

  /** Token de la app en memoria; varias búsquedas a la vez comparten una sola renovación. */
  private appToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > this.now()) {
      return Promise.resolve(this.token.value)
    }
    this.tokenRequest ??= this.requestAppToken().finally(() => {
      this.tokenRequest = null
    })
    return this.tokenRequest
  }

  private async requestAppToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    )
    let response: Response
    try {
      response = await this.fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw unavailable()
    }
    if (!response.ok) throw unavailable()
    const token = appTokenSchema.parse(await response.json())
    this.token = { value: token.access_token, expiresAt: this.now() + token.expires_in * 1000 }
    return token.access_token
  }
}
