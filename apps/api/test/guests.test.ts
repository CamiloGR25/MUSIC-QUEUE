import { sessionSnapshotSchema } from '@musica/shared'
import type { LightMyRequestResponse } from 'fastify'
import { describe, expect, it } from 'vitest'
import { loginAsHost, ORIGIN, testApp } from './helpers.ts'

async function withSession() {
  const ctx = await testApp()
  const { cookies: host } = await loginAsHost(ctx.app)
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/host/sessions',
    payload: { name: 'Cumpleaños de la abuela' },
    headers: { origin: ORIGIN },
    cookies: host,
  })
  const session = created.json<{ id: string; code: string }>()

  const guestCookie = (res: LightMyRequestResponse) => {
    const cookie = res.cookies.find((c) => c.name.startsWith('p_'))
    return cookie ? { [cookie.name]: cookie.value } : {}
  }
  const join = (code: string, body: object = {}, cookies: Record<string, string> = {}) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${code}/participants`,
      payload: body,
      headers: { origin: ORIGIN },
      cookies,
    })
  const get = (code: string, cookies: Record<string, string> = {}) =>
    ctx.app.inject({ method: 'GET', url: `/api/sessions/${code}`, cookies })
  const hostPost = (url: string) =>
    ctx.app.inject({ method: 'POST', url, payload: {}, headers: { origin: ORIGIN }, cookies: host })

  return { ...ctx, session, join, get, guestCookie, hostPost }
}

describe('entrada de invitados (R-PAR-01, R-PAR-02)', () => {
  it('entra sin cuenta: crea el participante y una cookie httpOnly', async () => {
    const { app, session, join } = await withSession()
    const res = await join(session.code, { displayName: 'Tía Marta' })
    expect(res.statusCode).toBe(201)
    const snap = sessionSnapshotSchema.parse(res.json())
    expect(snap.session).toEqual({
      code: session.code,
      name: 'Cumpleaños de la abuela',
      status: 'active',
    })
    expect(snap.me?.name).toBe('Tía Marta')

    const cookie = res.cookies.find((c) => c.name.startsWith('p_'))
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/sessions' })
    // En memoria solo queda el hash del token.
    const stored = app.services.sessions.findById(session.id)!
    const participant = [...stored.participants.values()][0]!
    expect(participant.tokenHash).not.toBe(cookie!.value)
    await app.close()
  })

  it('sin apodo aparece como "Invitado N" en orden de llegada', async () => {
    const { app, session, join } = await withSession()
    const names = []
    for (const body of [{}, { displayName: '   ' }, { displayName: null }]) {
      names.push((await join(session.code, body)).json().me.name)
    }
    expect(names).toEqual(['Invitado 1', 'Invitado 2', 'Invitado 3'])
    await app.close()
  })

  it('volver a entrar con la misma cookie no crea otro participante', async () => {
    const { app, session, join, guestCookie } = await withSession()
    const first = await join(session.code)
    const again = await join(session.code, {}, guestCookie(first))
    expect(again.statusCode).toBe(200)
    expect(again.json().me.participantId).toBe(first.json().me.participantId)
    expect(app.services.sessions.findById(session.id)!.participants.size).toBe(1)
    await app.close()
  })

  it('la instantánea reconoce al invitado por su cookie', async () => {
    const { app, session, join, get, guestCookie } = await withSession()
    const joined = await join(session.code, { displayName: 'Pipe' })
    expect((await get(session.code)).json().me).toBeNull()
    expect((await get(session.code, guestCookie(joined))).json().me.name).toBe('Pipe')
    await app.close()
  })

  it('un token inventado no corresponde a nadie', async () => {
    const { app, session, join, get, guestCookie } = await withSession()
    const joined = await join(session.code)
    const name = Object.keys(guestCookie(joined))[0]!
    const res = await get(session.code, { [name]: 'token-inventado' })
    expect(res.json().me).toBeNull()

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.code}/participants/me`,
      payload: { displayName: 'Hacker' },
      headers: { origin: ORIGIN },
      cookies: { [name]: 'token-inventado' },
    })
    expect(rename.statusCode).toBe(401)
    expect(rename.json().error.code).toBe('NOT_PARTICIPANT')
    await app.close()
  })

  it('el invitado cambia o borra su apodo', async () => {
    const { app, session, join, guestCookie } = await withSession()
    const joined = await join(session.code)
    const patch = (displayName: string | null) =>
      app.inject({
        method: 'PATCH',
        url: `/api/sessions/${session.code}/participants/me`,
        payload: { displayName },
        headers: { origin: ORIGIN },
        cookies: guestCookie(joined),
      })
    expect((await patch('  Abuela  ')).json()).toEqual({ name: 'Abuela' })
    expect((await patch(null)).json()).toEqual({ name: 'Invitado 1' })
    expect((await patch('x'.repeat(25))).statusCode).toBe(400)
    await app.close()
  })

  it('acepta el código en minúsculas', async () => {
    const { app, session, get } = await withSession()
    expect((await get(session.code.toLowerCase())).statusCode).toBe(200)
    await app.close()
  })

  it('un código inexistente o mal escrito responde 404', async () => {
    const { app, get, join } = await withSession()
    for (const code of ['ZZZZZZZZZZ', 'corto', 'IIIIIIIIII']) {
      const res = await get(code)
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('SESSION_NOT_FOUND')
    }
    expect((await join('ZZZZZZZZZZ')).statusCode).toBe(404)
    await app.close()
  })

  it('entrar exige el origen de la app (CSRF)', async () => {
    const { app, session } = await withSession()
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.code}/participants`,
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('sesión finalizada (R-SES-02)', () => {
  it('no admite invitados nuevos y muestra el estado terminado', async () => {
    const { app, session, join, get, guestCookie, hostPost } = await withSession()
    const joined = await join(session.code)
    await hostPost(`/api/host/sessions/${session.id}/end`)

    const late = await join(session.code)
    expect(late.statusCode).toBe(409)
    expect(late.json().error.code).toBe('SESSION_ENDED')
    const snap = await get(session.code, guestCookie(joined))
    expect(snap.json().session.status).toBe('ended')
    await app.close()
  })
})

describe('rotar el enlace (R-SES-03)', () => {
  it('el código viejo deja de admitir nuevos; los que ya entraron pasan al nuevo', async () => {
    const { app, session, join, get, guestCookie, hostPost } = await withSession()
    const inside = await join(session.code, { displayName: 'Dentro' })
    const rotated = (await hostPost(`/api/host/sessions/${session.id}/rotate-code`)).json()
    expect(rotated.code).not.toBe(session.code)
    expect(rotated.joinUrl).toBe(`${ORIGIN}/s/${rotated.code}`)

    // Alguien nuevo con el QR viejo: no entra.
    expect((await get(session.code)).statusCode).toBe(404)
    expect((await join(session.code)).statusCode).toBe(404)

    // Quien ya estaba: sigue dentro y recibe el código nuevo.
    const mine = await get(session.code, guestCookie(inside))
    expect(mine.statusCode).toBe(200)
    expect(mine.json()).toMatchObject({ session: { code: rotated.code }, me: { name: 'Dentro' } })
    expect((await get(rotated.code, guestCookie(inside))).json().me.name).toBe('Dentro')

    // Y alguien nuevo con el QR nuevo sí entra.
    expect((await join(rotated.code)).statusCode).toBe(201)
    await app.close()
  })

  it('el panel cuenta los invitados', async () => {
    const { app, session, join } = await withSession()
    await join(session.code)
    await join(session.code)
    const { cookies } = await loginAsHost(app)
    const me = await app.inject({ method: 'GET', url: '/api/host/me', cookies })
    expect(me.json().activeSession.participantsCount).toBe(2)
    await app.close()
  })
})
