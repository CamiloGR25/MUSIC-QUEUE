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

async function request(path: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new ApiRequestError('NETWORK_ERROR', 'Sin conexión con el servidor.', 0)
  }
  if (response.status === 204) return null

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(data)
    if (parsed.success) {
      throw new ApiRequestError(parsed.data.error.code, parsed.data.error.message, response.status)
    }
    throw new ApiRequestError('INTERNAL_ERROR', 'Algo falló en el servidor.', response.status)
  }
  return data
}

/** GET a la API del mismo dominio, validando la respuesta con su esquema compartido. */
export async function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) {
  return schema.parse(await request(path, { signal }))
}

/** Mutación con cuerpo JSON (el servidor exige JSON y el mismo origen, docs/DISENO.md §8). */
export async function sendJson<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
) {
  const data = await request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return schema.parse(data)
}

export const postJson = <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
  sendJson('POST', path, body, schema)

/** Mensaje para mostrar: el del servidor si es un error conocido, uno genérico si no. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Algo falló. Intenta de nuevo.'
}
