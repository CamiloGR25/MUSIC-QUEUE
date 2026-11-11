import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from './config/env.ts'
import { registerOriginCheck } from './lib/csrf.ts'
import { SseConnections } from './lib/sse.ts'
import { notFoundBody, registerErrorHandling } from './lib/errors.ts'
import { hostAuthRoutes } from './modules/host-auth/routes.ts'
import { HostTokenStore } from './modules/host-auth/token-store.ts'
import { fixedQrRoutes } from './modules/fixed-qr/routes.ts'
import { guestRoutes } from './modules/guests/routes.ts'
import { hostRoutes } from './modules/host/routes.ts'
import { KeepAwake } from './modules/keep-awake/keep-awake.ts'
import { EventBus } from './modules/realtime/event-bus.ts'
import { Notifier } from './modules/realtime/notifier.ts'
import { MemoryStore, type SessionStore } from './modules/sessions/store.ts'
import { HttpSpotifyAccounts, type SpotifyAccounts } from './providers/spotify/accounts.ts'
import { HttpSpotifyCatalog, type SpotifyCatalog } from './providers/spotify/catalog.ts'
import { healthRoutes } from './routes/health.ts'

type BuildOptions = {
  /** false en pruebas para no ensuciar la salida. */
  logger?: boolean
  /** Dependencias externas reemplazables en pruebas. */
  accounts?: SpotifyAccounts
  catalog?: SpotifyCatalog
  now?: () => number
  /** Consulta a la URL pública que hace KeepAwake (R-AWAKE-01). */
  ping?: () => Promise<void>
}

export type AppServices = {
  tokens: HostTokenStore
  sessions: SessionStore
  keepAwake: KeepAwake
  bus: EventBus
  sse: SseConnections
}

/** Barrido de sesiones vencidas (docs/DISENO.md §2.3). */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

declare module 'fastify' {
  interface FastifyInstance {
    /** Estado en memoria del servidor (D-18); las pruebas lo inspeccionan. */
    services: AppServices
  }
}

/**
 * Construye la aplicación sin escuchar en ningún puerto, para poder probarla con `inject`.
 * Un solo servicio sirve la API (/api) y el frontend compilado en el mismo dominio
 * (docs/ANALISIS.md §3: las cookies del invitado dependen de ello).
 */
export async function buildApp(
  config: AppConfig,
  { logger = true, accounts, catalog, now = Date.now, ping }: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger && {
      level: config.env === 'production' ? 'info' : 'debug',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: config.env === 'production',
  })

  const spotifyAccounts = accounts ?? new HttpSpotifyAccounts(config.spotify)
  const spotifyCatalog = catalog ?? new HttpSpotifyCatalog(config.spotify)
  const sessions = new MemoryStore(now, config.sessionTtlHours)
  const bus = new EventBus()
  const services: AppServices = {
    tokens: new HostTokenStore(spotifyAccounts, now),
    sessions,
    bus,
    sse: new SseConnections(),
    keepAwake: new KeepAwake({
      ...config.keepAwake,
      timeZone: config.timezone,
      now,
      ping: ping ?? (() => pingHealth(config.publicBaseUrl)),
      onError: (error) => app.log.warn({ err: error }, 'KeepAwake no pudo consultar /api/health'),
    }),
  }

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        // Portadas de Spotify (docs/DISENO.md §8).
        imgSrc: ["'self'", 'data:', 'https://i.scdn.co'],
      },
    },
  })
  await app.register(fastifyCookie, { secret: config.cookieSecret })
  await app.register(fastifyRateLimit, { global: false })

  app.decorate('services', services)
  registerErrorHandling(app)
  registerOriginCheck(app, config.allowedOrigins)
  app.decorateRequest('hostAuth', null)

  const deps = { config, accounts: spotifyAccounts, tokens: services.tokens, now }
  const live = { bus, notify: new Notifier(sessions, bus), sse: services.sse }
  const api = { prefix: '/api' }
  await app.register(healthRoutes, api)
  await app.register((scope) => hostAuthRoutes(scope, deps), api)
  await app.register(
    (scope) => hostRoutes(scope, { ...deps, ...live, sessions, keepAwake: services.keepAwake }),
    api,
  )
  await app.register(
    (scope) => guestRoutes(scope, { ...live, config, sessions, catalog: spotifyCatalog }),
    api,
  )
  await app.register((scope) => fixedQrRoutes(scope, { config, sessions }), api)

  const sweeper = setInterval(() => {
    const removed = services.sessions.sweep()
    if (removed > 0) app.log.info({ removed }, 'Sesiones vencidas borradas')
  }, SWEEP_INTERVAL_MS)
  sweeper.unref()
  // Las conexiones SSE se cierran antes de apagar; si no, el servidor esperaría por ellas.
  app.addHook('preClose', async () => services.sse.closeAll())
  app.addHook('onClose', async () => {
    clearInterval(sweeper)
    services.keepAwake.stop()
  })

  if (config.webDistDir) {
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false })
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/')
    if (!isApi && request.method === 'GET' && config.webDistDir) {
      // Rutas del frontend (/s/:codigo, /anfitrion…): las resuelve React Router.
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.status(404).send(notFoundBody())
  })

  return app
}

async function pingHealth(publicBaseUrl: string): Promise<void> {
  const response = await fetch(`${publicBaseUrl}/api/health`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`/api/health respondió ${response.status}`)
}
