import { hostSnapshotSchema, sessionSnapshotSchema } from '@musica/shared'
import { describe, expect, it } from 'vitest'
import { catalogTrack, loginAsHost, ORIGIN, sessionWithGuests } from './helpers.ts'

async function setup() {
  const ctx = await sessionWithGuests()
  ctx.app.services.sync.stop(ctx.session.id)
  const { cookies } = await loginAsHost(ctx.app)
  const host = (method: 'GET' | 'POST', path: string) =>
    ctx.app.inject({
      method,
      url: `/api/host/sessions/${ctx.session.id}${path}`,
      payload: method === 'GET' ? undefined : {},
      headers: { origin: ORIGIN },
      cookies,
    })
  return { ...ctx, host }
}

describe('invitados en el panel (R-PAR-03)', () => {
  it('el panel lista a los invitados en orden de llegada con lo que pidieron', async () => {
    const { app, join, add, host } = await setup()
    const ana = await join('Ana')
    await join()
    await add(ana, catalogTrack(1).spotifyTrackId)
    await add(ana, catalogTrack(2).spotifyTrackId)
    const snap = hostSnapshotSchema.parse((await host('GET', '')).json())
    expect(snap.participants.map((p) => [p.name, p.status, p.tracksAdded])).toEqual([
      ['Ana', 'active', 2],
      ['Invitado 2', 'active', 0],
    ])
    await app.close()
  })

  it('un invitado bloqueado no puede agregar ni votar, y lo sabe', async () => {
    const { app, join, add, host, snapshot, session } = await setup()
    const ana = await join('Ana')
    const beto = await join('Beto')
    const trackId = (await add(beto, catalogTrack(1).spotifyTrackId)).json().track.id
    const anaId = sessionSnapshotSchema.parse((await snapshot(ana)).json()).me!.participantId

    expect((await host('POST', `/participants/${anaId}/block`)).statusCode).toBe(204)
    const blockedAdd = await add(ana, catalogTrack(2).spotifyTrackId)
    expect(blockedAdd.statusCode).toBe(403)
    expect(blockedAdd.json().error.code).toBe('PARTICIPANT_BLOCKED')
    const blockedVote = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${session.code}/tracks/${trackId}/vote`,
      headers: { origin: ORIGIN },
      cookies: ana,
    })
    expect(blockedVote.json().error.code).toBe('PARTICIPANT_BLOCKED')
    expect(sessionSnapshotSchema.parse((await snapshot(ana)).json()).me!.blocked).toBe(true)

    expect((await host('POST', `/participants/${anaId}/unblock`)).statusCode).toBe(204)
    expect((await add(ana, catalogTrack(2).spotifyTrackId)).statusCode).toBe(201)
    await app.close()
  })

  it('bloquear a alguien que no está en la sesión responde 404', async () => {
    const { app, host } = await setup()
    const res = await host('POST', '/participants/6f1b0f1e-0000-4000-8000-000000000000/block')
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('un invitado no puede bloquear a otros', async () => {
    const { app, join, session } = await setup()
    const ana = await join('Ana')
    const res = await app.inject({
      method: 'POST',
      url: `/api/host/sessions/${session.id}/participants/6f1b0f1e-0000-4000-8000-000000000000/block`,
      payload: {},
      headers: { origin: ORIGIN },
      cookies: ana,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
