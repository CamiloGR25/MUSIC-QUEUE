import { z } from 'zod'

/** Respuesta de GET /api/health (docs/DISENO.md §4.3). Sin base de datos (D-18): solo el proceso. */
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  uptimeSec: z.number().int().nonnegative(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
