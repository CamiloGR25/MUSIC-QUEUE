import type { FastifyInstance } from 'fastify'
import { AppError } from './errors.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Protección CSRF (docs/DISENO.md §8): toda mutación de la API debe venir de la propia app
 * (cabecera Origin igual a PUBLIC_BASE_URL o GUEST_BASE_URL). Las cookies además son SameSite=Lax.
 */
export function registerOriginCheck(app: FastifyInstance, origins: ReadonlySet<string>): void {
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method) || !request.url.startsWith('/api/')) return
    if (!request.headers.origin || !origins.has(request.headers.origin)) {
      throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Solicitud de un origen no permitido.')
    }
  })
}
