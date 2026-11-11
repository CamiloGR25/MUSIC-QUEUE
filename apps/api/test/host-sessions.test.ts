import { hostSessionSchema } from '@musica/shared'
import { describe, expect, it } from 'vitest'
import { Clock, FakeAccounts, type HostCookies, loginAsHost, ORIGIN, testApp } from './helpers.ts'

async function setup() {
  const ctx = await testApp()
  const { cookies } = await loginAsHost(ctx.app)
  const post = (url: string, body: unknown, as: HostCookies = cookies) =>
    ctx.app.inject({
      method: 'POST',
      url,
      payload: body as object,
      headers: { origin: ORIGIN },
      cookies: as,
    })
  return { ...ctx, cookies, post }
}

describe('sesiones del anfitrión', () => {
  it('crea una sesión con código y enlace para invitados', async () => {
    const { app, post } = await setup()
    const res = await post('/api/host/sessions', { name: '  Cumpleaños de la abuela  ' })
    expect(res.statusCode).toBe(201)
    const session = hostSessionSchema.parse(res.json())
    expect(session).toMatchObject({
      name: 'Cumpleaños de la abuela',
      status: 'active',
      endedAt: null,
    })
    expect(session.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
    expect(session.joinUrl).toBe(`${ORIGIN}/s/${session.code}`)
    await app.close()
  })

  it('R-SES-01: no permite una segunda sesión activa', async () => {
    const { app, post } = await setup()
    await post('/api/host/sessions', { name: 'Una' })
    const res = await post('/api/host/sessions', { name: 'Dos' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ACTIVE_SESSION_EXISTS')
    await app.close()
  })

  it('valida el nombre del evento', async () => {
    const { app, post } = await setup()
    for (const name of ['', '   ', 'x'.repeat(61)]) {
      const res = await post('/api/host/sessions', { name })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    }
    await app.close()
  })

  it('devuelve la sesión activa y la incluye en /host/me', async () => {
    const { app, post, cookies } = await setup()
    const created = (await post('/api/host/sessions', { name: 'Fiesta' })).json()
    const active = await app.inject({ method: 'GET', url: '/api/host/sessions/active', cookies })
    expect(active.json().session.id).toBe(created.id)
    const me = await app.inject({ method: 'GET', url: '/api/host/me', cookies })
    expect(me.json().activeSession.id).toBe(created.id)
    await app.close()
  })

  it('R-SES-02: finaliza la sesión y no se puede finalizar dos veces', async () => {
    const { app, post, cookies } = await setup()
    const created = (await post('/api/host/sessions', { name: 'Fiesta' })).json()
    const ended = await post(`/api/host/sessions/${created.id}/end`, {})
    expect(ended.statusCode).toBe(200)
    expect(ended.json()).toMatchObject({ status: 'ended' })
    expect(ended.json().endedAt).not.toBeNull()

    const again = await post(`/api/host/sessions/${created.id}/end`, {})
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('SESSION_ENDED')

    const active = await app.inject({ method: 'GET', url: '/api/host/sessions/active', cookies })
    expect(active.json().session).toBeNull()
    // Después de finalizar se puede crear otra.
    expect((await post('/api/host/sessions', { name: 'Otra' })).statusCode).toBe(201)
    await app.close()
  })

  it('otro anfitrión no puede finalizar una sesión ajena', async () => {
    const clock = new Clock()
    const accounts = new FakeAccounts(clock)
    const { app } = await testApp({ clock, accounts })
    const one = await loginAsHost(app)
    accounts.profileId = 'anfitrion2'
    const two = await loginAsHost(app)
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/host/sessions',
        payload: { name: 'Mía' },
        headers: { origin: ORIGIN },
        cookies: one.cookies,
      })
    ).json()
    const res = await app.inject({
      method: 'POST',
      url: `/api/host/sessions/${created.id}/end`,
      payload: {},
      headers: { origin: ORIGIN },
      cookies: two.cookies,
    })
    expect(res.statusCode).toBe(404)
    expect(app.services.sessions.findById(created.id)?.status).toBe('active')
    await app.close()
  })

  it('crear una sesión exige estar conectado a Spotify', async () => {
    const { app, cookies } = await setup()
    // Servidor sin el permiso en memoria y navegador sin la cookie host_rt.
    app.services.tokens.remove('anfitrion1')
    const res = await app.inject({
      method: 'POST',
      url: '/api/host/sessions',
      payload: { name: 'Fiesta' },
      headers: { origin: ORIGIN },
      cookies: { host_sid: cookies.host_sid },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('SPOTIFY_RECONNECT_REQUIRED')
    await app.close()
  })
})
