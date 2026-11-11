import { z } from 'zod'

/** Nombre del evento (R-SES, docs/DISENO.md §2). */
export const sessionNameSchema = z
  .string()
  .trim()
  .min(1, 'Escribe el nombre del evento.')
  .max(60, 'Máximo 60 caracteres.')

export const createSessionBodySchema = z.object({ name: sessionNameSchema })
export type CreateSessionBody = z.infer<typeof createSessionBodySchema>

/** Sesión vista desde el panel del anfitrión. */
export const hostSessionSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.enum(['active', 'ended']),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  joinUrl: z.string(),
  participantsCount: z.number().int().nonnegative(),
})
export type HostSession = z.infer<typeof hostSessionSchema>

/** GET /api/host/me (docs/DISENO.md §4.3). */
export const hostMeSchema = z.object({
  spotifyId: z.string(),
  name: z.string(),
  /** El permiso de Spotify vence 6 meses después de autorizar; hay que reconectar antes. */
  reconnectBy: z.string().nullable(),
  spotifyConnected: z.boolean(),
  activeSession: hostSessionSchema.nullable(),
  /** D-19: hasta cuándo se mantiene despierto el servidor (null si no aplica, p. ej. en desarrollo). */
  keepAwakeUntil: z.string().nullable(),
  /** D-21: enlace fijo para imprimir; siempre lleva a la sesión activa. */
  fixedJoinUrl: z.string(),
})
export type HostMe = z.infer<typeof hostMeSchema>

/** GET /api/fixed/:code (D-21): código de la sesión activa del anfitrión dueño del QR fijo. */
export const fixedEntrySchema = z.object({ sessionCode: z.string() })
