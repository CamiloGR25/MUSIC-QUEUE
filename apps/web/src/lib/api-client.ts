import { apiErrorSchema, type ErrorCode } from '@musica/shared'
import type { z } from 'zod'

/** Error de la API con su código (docs/DISENO.md §4.4), listo para mostrar su mensaje. */
export class ApiRequestError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR'
  readonly status: number

  constructor(code: ErrorCode | 'NETWORK_ERROR', message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

/** GET a la API del mismo dominio, validando la respuesta con su esquema compartido. */
export async function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) {
  let response: Response
  try {
    response = await fetch(`/api${path}`, { signal, credentials: 'same-origin' })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiRequestError('NETWORK_ERROR', 'Sin conexión con el servidor.', 0)
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(data)
    if (parsed.success) {
      throw new ApiRequestError(parsed.data.error.code, parsed.data.error.message, response.status)
    }
    throw new ApiRequestError('INTERNAL_ERROR', 'Algo falló en el servidor.', response.status)
  }
  return schema.parse(data)
}
