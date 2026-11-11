import { describe, expect, it } from 'vitest'
import { apiErrorSchema } from './errors.ts'

describe('apiErrorSchema', () => {
  it('acepta un error con código conocido', () => {
    const parsed = apiErrorSchema.parse({
      error: { code: 'DUPLICATE_TRACK', message: 'Ya está en la cola. Puedes votarla.' },
    })
    expect(parsed.error.code).toBe('DUPLICATE_TRACK')
  })

  it('rechaza un código desconocido', () => {
    expect(() => apiErrorSchema.parse({ error: { code: 'BOOM', message: 'x' } })).toThrow()
  })
})
