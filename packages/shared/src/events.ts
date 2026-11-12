import { z } from 'zod'
import { hostSessionSchema } from './host.ts'
import { nowPlayingSchema, syncStatusSchema, upcomingTrackSchema } from './playback.ts'
import { trackViewSchema } from './tracks.ts'

/**
 * Eventos en tiempo real por SSE (docs/DISENO.md §5). Todos llevan el estado completo de lo que
 * cambió (no diferencias), así un aviso perdido no deja la pantalla desincronizada.
 */
export const queueUpdatedSchema = z.object({
  /** R-COLA-03: el cliente ignora versiones menores o iguales a la que ya tiene. */
  version: z.number().int().nonnegative(),
  queue: z.array(trackViewSchema),
})
export type QueueUpdated = z.infer<typeof queueUpdatedSchema>

/** Cambió el código (rotar enlace) o el estado (finalizada). */
export const sessionUpdatedSchema = z.object({
  code: z.string(),
  name: z.string(),
  status: z.enum(['active', 'ended']),
})
export type SessionUpdated = z.infer<typeof sessionUpdatedSchema>

/** Solo para el panel del anfitrión. */
export const participantsUpdatedSchema = z.object({ count: z.number().int().nonnegative() })

/** Estado inicial del panel al conectarse (y al reconectarse). */
export const hostSnapshotSchema = z.object({
  session: hostSessionSchema,
  version: z.number().int().nonnegative(),
  queue: z.array(trackViewSchema),
  nowPlaying: nowPlayingSchema,
  next: upcomingTrackSchema.nullable(),
  sync: syncStatusSchema,
})
export type HostSnapshot = z.infer<typeof hostSnapshotSchema>

export const voteResponseSchema = z.object({
  voted: z.boolean(),
  votes: z.number().int().nonnegative(),
})
export type VoteResponse = z.infer<typeof voteResponseSchema>
