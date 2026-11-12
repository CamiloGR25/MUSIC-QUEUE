import { z } from 'zod'

/**
 * Códigos de error de la API (docs/DISENO.md §4.4).
 * El frontend muestra el mensaje según el código; el servidor nunca expone detalles internos.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'NOT_PARTICIPANT',
  'HOST_UNAUTHENTICATED',
  'HOST_NOT_ALLOWED',
  'FORBIDDEN_ORIGIN',
  'PARTICIPANT_BLOCKED',
  'SESSION_NOT_FOUND',
  'NO_ACTIVE_SESSION',
  'TRACK_NOT_FOUND',
  'SESSION_ENDED',
  'SESSION_FULL',
  'DUPLICATE_TRACK',
  'QUEUE_FULL',
  'TRACK_NOT_VOTABLE',
  'ACTIVE_SESSION_EXISTS',
  'NO_ACTIVE_DEVICE',
  'PLAYBACK_RESTRICTED',
  'NOTHING_TO_PLAY',
  'PREMIUM_REQUIRED',
  'SPOTIFY_RECONNECT_REQUIRED',
  'RATE_LIMITED',
  'SPOTIFY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
})

export type ApiError = z.infer<typeof apiErrorSchema>
