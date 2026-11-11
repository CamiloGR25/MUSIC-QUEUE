import { fixedEntrySchema, hostMeSchema } from '@musica/shared'
import { describe, expect, it } from 'vitest'
import { fixedCodeFor } from '../src/modules/fixed-qr/routes.ts'
import { HOST_ID, loginAsHost, ORIGIN, testApp, testConfig } from './helpers.ts'

describe('QR fijo (D-21)', () => {
  it('el código es siempre el mismo para el anfitrión y cambia si cambia la clave', () => {
    const config = testConfig()
    expect(fixedCodeFor(HOST_ID, config)).toBe(fixedCodeFor(HOST_ID, testConfig()))
    expect(fixedCodeFor(HOST_ID, config)).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
    expect(fixedCodeFor(HOST_ID, config)).not.toBe(fixedCodeFor('anfitrion2', config))
    const otherKey = testConfig(null, {
      COOKIE_SECRET: 'otra-clave-distinta-de-mas-de-32-caracteres',
    })
    expect(fixedCodeFor(HOST_ID, otherKey)).not.toBe(fixedCodeFor(HOST_ID, config))
  })

  it('lleva a la sesión activa de turno, incluso después de rotar o cambiar de sesión', async () => {
    const { app } = await testApp()
    const { cookies } = await loginAsHost(app)
    const me = hostMeSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/host/me', cookies })).json(),
    )
    const code = me.fixedJoinUrl.split('/e/')[1]!
    expect(me.fixedJoinUrl).toBe(`${ORIGIN}/e/${code}`)
    const resolve = () => app.inject({ method: 'GET', url: `/api/fixed/${code}` })
    const post = (url: string, payload: object = {}) =>
      app.inject({ method: 'POST', url, payload, headers: { origin: ORIGIN }, cookies })

    // Sin sesión activa.
    const none = await resolve()
    expect(none.statusCode).toBe(404)
    expect(none.json().error.code).toBe('NO_ACTIVE_SESSION')

    const first = (await post('/api/host/sessions', { name: 'Primera' })).json()
    expect(fixedEntrySchema.parse((await resolve()).json()).sessionCode).toBe(first.code)

    const rotated = (await post(`/api/host/sessions/${first.id}/rotate-code`)).json()
    expect((await resolve()).json().sessionCode).toBe(rotated.code)

    await post(`/api/host/sessions/${first.id}/end`)
    expect((await resolve()).json().error.code).toBe('NO_ACTIVE_SESSION')

    const second = (await post('/api/host/sessions', { name: 'Segunda' })).json()
    expect((await resolve()).json().sessionCode).toBe(second.code)
    await app.close()
  })

  it('un código que no es de ningún anfitrión responde 404', async () => {
    const { app } = await testApp()
    for (const code of ['ZZZZZZZZZZ', 'malo']) {
      const res = await app.inject({ method: 'GET', url: `/api/fixed/${code}` })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('SESSION_NOT_FOUND')
    }
    await app.close()
  })
})
