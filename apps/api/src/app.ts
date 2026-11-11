import fastifyHelmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from './config/env.ts'
import { notFoundBody, registerErrorHandling } from './lib/errors.ts'
import { healthRoutes } from './routes/health.ts'

type BuildOptions = {
  /** false en pruebas para no ensuciar la salida. */
  logger?: boolean
}

/**
 * Construye la aplicación sin escuchar en ningún puerto, para poder probarla con `inject`.
 * Un solo servicio sirve la API (/api) y el frontend compilado en el mismo dominio
 * (docs/ANALISIS.md §3: las cookies del invitado dependen de ello).
 */
export async function buildApp(
  config: AppConfig,
  { logger = true }: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger && {
      level: config.env === 'production' ? 'info' : 'debug',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: config.env === 'production',
  })

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        // Portadas de Spotify (docs/DISENO.md §8).
        imgSrc: ["'self'", 'data:', 'https://i.scdn.co'],
      },
    },
  })

  registerErrorHandling(app)

  await app.register(healthRoutes, { prefix: '/api' })

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
