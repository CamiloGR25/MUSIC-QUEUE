import { type ErrorCode, sessionCodeSchema } from '@musica/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.ts'
import { stableCode } from '../../lib/crypto.ts'
import { AppError } from '../../lib/errors.ts'
import type { SessionStore } from '../sessions/store.ts'

/**
 * Código del QR fijo del anfitrión (D-21): se deriva de su cuenta y de COOKIE_SECRET, así que
 * no cambia entre sesiones ni tras reinicios (no hay base de datos, D-18). Si se cambia
 * COOKIE_SECRET, cambia el código y hay que reimprimir el QR.
 */
export const fixedCodeFor = (hostSpotifyId: string, config: AppConfig) =>
  stableCode(`qr-fijo:${hostSpotifyId}`, config.cookieSecret)

export const fixedJoinUrl = (hostSpotifyId: string, config: AppConfig) =>
  `${config.guestBaseUrl}/e/${fixedCodeFor(hostSpotifyId, config)}`

const paramsSchema = z.object({ code: sessionCodeSchema })
const fail = (status: number, code: ErrorCode, message: string) =>
  new AppError(status, code, message)

/** QR impreso: lleva siempre a la sesión activa de su anfitrión (D-21, sin control D-22). */
export async function fixedQrRoutes(
  app: FastifyInstance,
  { config, sessions }: { config: AppConfig; sessions: SessionStore },
) {
  app.get(
    '/fixed/:code',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const params = paramsSchema.safeParse(request.params)
      const host = params.success
        ? [...config.allowedHostIds].find((id) => fixedCodeFor(id, config) === params.data.code)
        : undefined
      if (!host) throw fail(404, 'SESSION_NOT_FOUND', 'Este código no existe.')
      const active = sessions.findActiveByHost(host)
      if (!active) {
        throw fail(404, 'NO_ACTIVE_SESSION', 'Todavía no hay una fiesta activa.')
      }
      return { sessionCode: active.code }
    },
  )
}
