import { healthResponseSchema } from '@musica/shared'
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, getJson } from './api-client.ts'

describe('getJson', () => {
  it('convierte una respuesta de error de la API en ApiRequestError con su código', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: { code: 'SESSION_NOT_FOUND', message: 'Este enlace ya no funciona.' } },
            { status: 404 },
          ),
        ),
      ),
    )
    const error = await getJson('/health', healthResponseSchema).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ code: 'SESSION_NOT_FOUND', status: 404 })
  })

  it('rechaza una respuesta que no cumple el esquema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ ok: 'sí' }))),
    )
    await expect(getJson('/health', healthResponseSchema)).rejects.toThrow()
  })
})
