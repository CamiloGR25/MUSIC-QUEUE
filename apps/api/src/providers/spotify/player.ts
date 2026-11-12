import { z } from 'zod'
import { AppError } from '../../lib/errors.ts'

const API = 'https://api.spotify.com/v1/me/player'

/** Lo que suena, ya traducido a nuestro modelo (canción o episodio). */
export type PlayerItem = {
  uri: string
  name: string
  artist: string
  imageUrl: string | null
  durationMs: number
}

export type PlayerState = {
  isPlaying: boolean
  progressMs: number
  item: PlayerItem | null
  device: { id: string | null; name: string } | null
}

export type Device = {
  id: string
  name: string
  type: string
  isActive: boolean
  isRestricted: boolean
}

/**
 * Comandos del reproductor del anfitrión (docs/DISENO.md §7). Todos exigen Spotify Premium.
 * Spotify no permite quitar ni reordenar su cola: solo agregar al final (R-SYNC).
 */
export interface SpotifyPlayer {
  /** null si no hay nada cargado en ningún dispositivo (Spotify responde 204). */
  getState(token: string): Promise<PlayerState | null>
  /** URIs de la cola nativa de Spotify (solo lectura). */
  getQueueUris(token: string): Promise<string[]>
  addToQueue(token: string, uri: string, deviceId?: string): Promise<void>
  play(token: string, options?: { deviceId?: string; uris?: string[] }): Promise<void>
  pause(token: string): Promise<void>
  next(token: string): Promise<void>
  devices(token: string): Promise<Device[]>
  transfer(token: string, deviceId: string): Promise<void>
}

const imageSchema = z.object({ url: z.string(), width: z.number().nullable().optional() })
const itemSchema = z.object({
  uri: z.string(),
  name: z.string(),
  duration_ms: z.number(),
  // Canción: artistas y álbum. Episodio: programa.
  artists: z.array(z.object({ name: z.string() })).optional(),
  album: z.object({ images: z.array(imageSchema) }).optional(),
  show: z.object({ name: z.string(), images: z.array(imageSchema) }).optional(),
})
const stateSchema = z.object({
  is_playing: z.boolean(),
  progress_ms: z.number().nullable(),
  item: itemSchema.nullable(),
  device: z.object({ id: z.string().nullable(), name: z.string() }).nullable().optional(),
})
const queueSchema = z.object({ queue: z.array(z.object({ uri: z.string() }).nullable()) })
const devicesSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string().nullable(),
      name: z.string(),
      type: z.string(),
      is_active: z.boolean(),
      is_restricted: z.boolean(),
    }),
  ),
})
const errorSchema = z.object({
  error: z.object({ reason: z.string().optional(), message: z.string().optional() }),
})

function pickImage(images: z.infer<typeof imageSchema>[]): string | null {
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (sorted.find((image) => (image.width ?? 0) >= 300) ?? sorted.at(-1))?.url ?? null
}

function toItem(item: z.infer<typeof itemSchema>): PlayerItem {
  return {
    uri: item.uri,
    name: item.name,
    artist: item.artists?.map((artist) => artist.name).join(', ') ?? item.show?.name ?? '',
    imageUrl: pickImage(item.album?.images ?? item.show?.images ?? []),
    durationMs: item.duration_ms,
  }
}

/**
 * Traduce los errores del reproductor. El formato de `reason` (PREMIUM_REQUIRED,
 * NO_ACTIVE_DEVICE) no está en la referencia oficial; lo confirman los foros de Spotify.
 */
async function toError(response: Response): Promise<AppError> {
  const body = errorSchema.safeParse(await response.json().catch(() => null))
  const reason = body.success ? body.data.error.reason : undefined
  if (response.status === 401) {
    return new AppError(409, 'SPOTIFY_RECONNECT_REQUIRED', 'Vuelve a conectar Spotify.')
  }
  if (response.status === 403 && reason === 'PREMIUM_REQUIRED') {
    return new AppError(
      403,
      'PREMIUM_REQUIRED',
      'El control de la música requiere Spotify Premium.',
    )
  }
  if (response.status === 403) {
    return new AppError(
      409,
      'PLAYBACK_RESTRICTED',
      'Spotify no permitió esa acción en este momento o en este dispositivo.',
    )
  }
  if (response.status === 404) {
    return new AppError(
      409,
      'NO_ACTIVE_DEVICE',
      'Abre Spotify en el dispositivo donde quieres la música.',
    )
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 5)
    return new AppError(
      503,
      'SPOTIFY_UNAVAILABLE',
      'Spotify está recibiendo muchas solicitudes. Intenta en unos segundos.',
      { retryAfterSec: retryAfter },
    )
  }
  return new AppError(503, 'SPOTIFY_UNAVAILABLE', 'Spotify no responde. La cola sigue guardada.')
}

export class HttpSpotifyPlayer implements SpotifyPlayer {
  private readonly fetch: typeof fetch

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetch = fetchImpl
  }

  async getState(token: string): Promise<PlayerState | null> {
    const response = await this.send(token, 'GET', '?additional_types=track,episode')
    if (response.status === 204) return null
    if (!response.ok) throw await toError(response)
    const data = stateSchema.parse(await response.json())
    return {
      isPlaying: data.is_playing,
      progressMs: data.progress_ms ?? 0,
      item: data.item ? toItem(data.item) : null,
      device: data.device ?? null,
    }
  }

  async getQueueUris(token: string): Promise<string[]> {
    const response = await this.send(token, 'GET', '/queue')
    if (!response.ok) throw await toError(response)
    return queueSchema
      .parse(await response.json())
      .queue.flatMap((item) => (item ? [item.uri] : []))
  }

  async addToQueue(token: string, uri: string, deviceId?: string): Promise<void> {
    const params = new URLSearchParams({ uri })
    if (deviceId) params.set('device_id', deviceId)
    await this.command(token, 'POST', `/queue?${params}`)
  }

  async play(token: string, { deviceId, uris }: { deviceId?: string; uris?: string[] } = {}) {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''
    await this.command(token, 'PUT', `/play${query}`, uris ? { uris } : undefined)
  }

  async pause(token: string): Promise<void> {
    await this.command(token, 'PUT', '/pause')
  }

  async next(token: string): Promise<void> {
    await this.command(token, 'POST', '/next')
  }

  async devices(token: string): Promise<Device[]> {
    const response = await this.send(token, 'GET', '/devices')
    if (!response.ok) throw await toError(response)
    return devicesSchema.parse(await response.json()).devices.flatMap((device) =>
      device.id
        ? [
            {
              id: device.id,
              name: device.name,
              type: device.type,
              isActive: device.is_active,
              isRestricted: device.is_restricted,
            },
          ]
        : [],
    )
  }

  async transfer(token: string, deviceId: string): Promise<void> {
    await this.command(token, 'PUT', '', { device_ids: [deviceId], play: false })
  }

  private async command(token: string, method: string, path: string, body?: unknown) {
    const response = await this.send(token, method, path, body)
    if (!response.ok) throw await toError(response)
  }

  private async send(token: string, method: string, path: string, body?: unknown) {
    try {
      return await this.fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new AppError(503, 'SPOTIFY_UNAVAILABLE', 'Spotify no responde. La cola sigue guardada.')
    }
  }
}
