import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.ts'
import { randomToken, sha256Base64Url } from '../../lib/crypto.ts'
import { AppError } from '../../lib/errors.ts'
import type { SpotifyAccounts } from '../../providers/spotify/accounts.ts'
import {
  cookieOptions,
  encodeHostSid,
  HOST_COOKIE_MAX_AGE_MS,
  HOST_RT,
  HOST_SID,
  OAUTH_TX,
  OAUTH_TX_MAX_AGE_MS,
  openOAuthTx,
  sealHostRt,
  sealOAuthTx,
} from './cookies.ts'
import { currentHost, registerHostGuard } from './host-guard.ts'
import type { HostTokenStore } from './token-store.ts'

export type HostAuthDeps = {
  config: AppConfig
  accounts: SpotifyAccounts
  tokens: HostTokenStore
  now: () => number
}

/** Motivos que el panel convierte en mensajes (apps/web, página del anfitrión). */
export type LoginError = 'denied' | 'state' | 'not_allowed' | 'spotify'

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})

const OAUTH_PATH = '/api/auth/spotify'
/** Límite de OAuth por IP (docs/DISENO.md §8). */
const oauthRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } }

/** OAuth del anfitrión con Spotify (docs/DISENO.md §6, R-SES, D-16). */
export async function hostAuthRoutes(app: FastifyInstance, deps: HostAuthDeps): Promise<void> {
  const { config, accounts, tokens, now } = deps
  const hostCookie = cookieOptions(config, '/api', HOST_COOKIE_MAX_AGE_MS)
  const txCookie = cookieOptions(config, OAUTH_PATH, OAUTH_TX_MAX_AGE_MS)

  const backToPanel = (reply: FastifyReply, error?: LoginError) =>
    reply.redirect(error ? `/anfitrion?error=${error}` : '/anfitrion')

  app.get('/auth/spotify/login', { config: oauthRateLimit }, async (_request, reply) => {
    const state = randomToken(16)
    const verifier = randomToken(48)
    reply.setCookie(
      OAUTH_TX,
      sealOAuthTx({ state, verifier, exp: now() + OAUTH_TX_MAX_AGE_MS }, config.encryptionKey),
      txCookie,
    )
    return reply.redirect(
      accounts.authorizeUrl({ state, codeChallenge: sha256Base64Url(verifier) }),
    )
  })

  app.get('/auth/spotify/callback', { config: oauthRateLimit }, async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query)
    const rawTx = request.cookies[OAUTH_TX]
    const tx = rawTx ? openOAuthTx(rawTx, config.encryptionKey) : null
    reply.clearCookie(OAUTH_TX, { path: OAUTH_PATH })

    if (query.error) return backToPanel(reply, 'denied')
    if (!tx || tx.exp < now() || !query.state || tx.state !== query.state || !query.code) {
      return backToPanel(reply, 'state')
    }

    try {
      const token = await accounts.exchangeCode({ code: query.code, codeVerifier: tx.verifier })
      const profile = await accounts.getProfile(token.accessToken)
      if (!config.allowedHostIds.has(profile.id)) return backToPanel(reply, 'not_allowed')
      if (!token.refreshToken) return backToPanel(reply, 'spotify')

      const authorizedAt = now()
      tokens.set(profile.id, {
        refreshToken: token.refreshToken,
        authorizedAt,
        accessToken: token.accessToken,
        accessExpiresAt: token.accessExpiresAt,
      })
      reply.setCookie(
        HOST_SID,
        encodeHostSid({ sub: profile.id, name: profile.name, exp: now() + HOST_COOKIE_MAX_AGE_MS }),
        { ...hostCookie, signed: true },
      )
      reply.setCookie(
        HOST_RT,
        sealHostRt(
          { sub: profile.id, rt: token.refreshToken, at: authorizedAt },
          config.encryptionKey,
        ),
        hostCookie,
      )
      return backToPanel(reply)
    } catch (error) {
      if (error instanceof AppError) {
        request.log.warn({ code: error.code }, 'Falló el inicio de sesión con Spotify')
        return backToPanel(reply, 'spotify')
      }
      throw error
    }
  })

  // Cerrar la sesión del panel: el permiso de Spotify se conserva para entrar de nuevo rápido.
  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(HOST_SID, { path: '/api' })
    return reply.status(204).send()
  })

  // Desconectar Spotify: se borra el permiso de la memoria y del navegador.
  await app.register(async (scope) => {
    registerHostGuard(scope, deps)
    scope.post('/auth/spotify/disconnect', async (request, reply) => {
      const host = currentHost(request)
      tokens.remove(host.spotifyId)
      // Evita que el onSend del guardia vuelva a escribir la cookie.
      request.hostAuth = null
      reply.clearCookie(HOST_SID, { path: '/api' })
      reply.clearCookie(HOST_RT, { path: '/api' })
      return reply.status(204).send()
    })
  })
}
