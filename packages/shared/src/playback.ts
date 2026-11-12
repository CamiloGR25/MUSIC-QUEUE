import { z } from 'zod'
import { trackViewSchema } from './tracks.ts'

/** La canción enviada a Spotify: "Sigue", fija, ya no se vota (R-COLA-02). */
export const upcomingTrackSchema = trackViewSchema.omit({ position: true })
export type UpcomingTrack = z.infer<typeof upcomingTrackSchema>

/**
 * Lo que suena en Spotify (docs/DISENO.md §4.1). Puede venir de la cola (`queue`) o de la música
 * del propio anfitrión cuando la cola está vacía (`host`).
 */
export const nowPlayingSchema = z
  .object({
    source: z.enum(['queue', 'host']),
    trackId: z.string().nullable(),
    name: z.string(),
    artist: z.string(),
    imageUrl: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    progressMs: z.number().int().nonnegative(),
    /** Momento (ISO) de la lectura de `progressMs`: el navegador interpola desde ahí. */
    observedAt: z.string(),
    isPlaying: z.boolean(),
    addedBy: z.string().nullable(),
  })
  .nullable()
export type NowPlaying = z.infer<typeof nowPlayingSchema>

/** Evento `playback.updated` y parte de las instantáneas. */
export const playbackSchema = z.object({
  nowPlaying: nowPlayingSchema,
  next: upcomingTrackSchema.nullable(),
})
export type Playback = z.infer<typeof playbackSchema>

export const SYNC_STATUSES = [
  'idle',
  'ok',
  'paused',
  'no_device',
  'auth_error',
  'premium_required',
  'rate_limited',
  'error',
] as const

/** Evento `sync.status`, solo para el panel del anfitrión. */
export const syncStatusSchema = z.object({
  status: z.enum(SYNC_STATUSES),
  deviceName: z.string().nullable(),
  lastError: z.string().nullable(),
})
export type SyncStatusView = z.infer<typeof syncStatusSchema>

export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  isActive: z.boolean(),
  isRestricted: z.boolean(),
})
export const devicesResponseSchema = z.object({
  devices: z.array(deviceSchema),
  selectedId: z.string().nullable(),
})
export type DeviceView = z.infer<typeof deviceSchema>

export const selectDeviceBodySchema = z.object({ deviceId: z.string().min(1).max(100) })
