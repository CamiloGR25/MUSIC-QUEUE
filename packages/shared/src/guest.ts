import { z } from 'zod'
import { nowPlayingSchema, upcomingTrackSchema } from './playback.ts'
import { trackViewSchema } from './tracks.ts'

/** R-PAR-02: apodo opcional de 1 a 24 caracteres; vacío = "Invitado N". */
export const displayNameSchema = z
  .string()
  .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
  .pipe(z.string().max(24, 'Máximo 24 caracteres.'))
  .transform((value) => (value === '' ? null : value))

export const joinBodySchema = z.object({ displayName: displayNameSchema.nullish() })
export type JoinBody = z.input<typeof joinBodySchema>

export const renameBodySchema = z.object({ displayName: displayNameSchema.nullable() })

/**
 * Instantánea de la sesión para el invitado (docs/DISENO.md §4.1). Se envía al cargar y al
 * conectarse por SSE.
 */
export const sessionSnapshotSchema = z.object({
  session: z.object({
    /** Código vigente: si el anfitrión lo rotó, el invitado ya unido pasa al nuevo. */
    code: z.string(),
    name: z.string(),
    status: z.enum(['active', 'ended']),
  }),
  me: z
    .object({
      participantId: z.string(),
      name: z.string(),
      /** Canciones pendientes que este invitado votó (su botón aparece marcado). */
      votedTrackIds: z.array(z.string()),
      /** R-PAR-03: el anfitrión desactivó sus pedidos y votos. */
      blocked: z.boolean(),
    })
    .nullable(),
  /** R-COLA-03: versión de la cola. */
  version: z.number().int().nonnegative(),
  /** Pendientes en orden (R-COLA-01). */
  queue: z.array(trackViewSchema),
  /** Lo que suena y la que sigue (E5). */
  nowPlaying: nowPlayingSchema,
  next: upcomingTrackSchema.nullable(),
})
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>

/** Código público: 10 caracteres Crockford base32. */
export const sessionCodeSchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/))
