import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AppConfig } from '../../config/env.ts'
import { AppError } from '../../lib/errors.ts'
import {
  cookieOptions,
  decodeHostSid,
  HOST_COOKIE_MAX_AGE_MS,
  HOST_RT,
  HOST_SID,
  openHostRt,
  sealHostRt,
} from './cookies.ts'
import type { HostTokenStore } from './token-store.ts'

export type HostAuth = {
  spotifyId: string
  name: string
  /** Refresh token que trae la cookie, para detectar si Spotify lo rotó. */
  cookieRefreshToken: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    hostAuth: HostAuth | null
  }
}

type GuardDeps = { config: AppConfig; tokens: HostTokenStore; now: () => number }

export function currentHost(request: FastifyRequest): HostAuth {
  if (!request.hostAuth)
    throw new AppError(401, 'HOST_UNAUTHENTICATED', 'Inicia sesión con Spotify.')
  return request.hostAuth
}

/**
 * Protege un grupo de rutas del anfitrión (R-SES, D-16):
 * 1. Cookie host_sid firmada y vigente, si no 401.
 * 2. La cuenta sigue en ALLOWED_HOST_SPOTIFY_IDS, si no 403.
 * 3. Si el servidor se reinició, recupera el refresh token desde host_rt (D-18).
 * 4. Si Spotify rotó el refresh token, actualiza la cookie al responder.
 */
export function registerHostGuard(scope: FastifyInstance, { config, tokens, now }: GuardDeps) {
  scope.addHook('preHandler', async (request) => {
    const signed = request.cookies[HOST_SID]
    const unsigned = signed ? request.unsignCookie(signed) : null
    const sid = unsigned?.valid && unsigned.value ? decodeHostSid(unsigned.value, now()) : null
    if (!sid) throw new AppError(401, 'HOST_UNAUTHENTICATED', 'Inicia sesión con Spotify.')
    if (!config.allowedHostIds.has(sid.sub)) {
      throw new AppError(
        403,
        'HOST_NOT_ALLOWED',
        'Esta cuenta de Spotify no está autorizada como anfitriona.',
      )
    }

    const rawRt = request.cookies[HOST_RT]
    const rt = rawRt ? openHostRt(rawRt, config.encryptionKey) : null
    const sameHost = rt?.sub === sid.sub ? rt : null
    if (sameHost && !tokens.get(sid.sub)) {
      tokens.set(sid.sub, {
        refreshToken: sameHost.rt,
        authorizedAt: sameHost.at,
        accessToken: null,
        accessExpiresAt: 0,
      })
    }
    request.hostAuth = {
      spotifyId: sid.sub,
      name: sid.name,
      cookieRefreshToken: sameHost?.rt ?? null,
    }
  })

  scope.addHook('onSend', async (request, reply, payload) => {
    const auth = request.hostAuth
    const credentials = auth ? tokens.get(auth.spotifyId) : undefined
    if (auth && credentials && credentials.refreshToken !== auth.cookieRefreshToken) {
      reply.setCookie(
        HOST_RT,
        sealHostRt(
          { sub: auth.spotifyId, rt: credentials.refreshToken, at: credentials.authorizedAt },
          config.encryptionKey,
        ),
        cookieOptions(config, '/api', HOST_COOKIE_MAX_AGE_MS),
      )
    }
    return payload
  })
}
