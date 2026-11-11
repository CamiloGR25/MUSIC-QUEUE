import type { HealthResponse } from '@musica/shared'
import type { FastifyInstance } from 'fastify'

/** GET /api/health: lo usa Render y, desde E5, el KeepAwake (R-AWAKE-01). */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => {
    return { ok: true, uptimeSec: Math.floor(process.uptime()) }
  })
}
