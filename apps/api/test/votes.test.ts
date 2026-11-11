import { sessionSnapshotSchema, voteResponseSchema } from '@musica/shared'
import { describe, expect, it } from 'vitest'
import { catalogTrack, ORIGIN, sessionWithGuests } from './helpers.ts'

const id = (n: number) => catalogTrack(n).spotifyTrackId

async function withTracks(count = 3) {
  const ctx = await sessionWithGuests()
  const adder = await ctx.join('Quien agrega')
  const trackIds: string[] = []
  for (let n = 1; n <= count; n++) {
    trackIds.push((await ctx.add(adder, id(n))).json().track.id)
    ctx.clock.advance(1000)
  }
  const vote = (guest: Record<string, string>, trackId: string, method: 'PUT' | 'DELETE' = 'PUT') =>
    ctx.app.inject({
      method,
      url: `/api/sessions/${ctx.session.code}/tracks/${trackId}/vote`,
      headers: { origin: ORIGIN },
      cookies: guest,
    })
  const queue = async (guest: Record<string, string> = {}) =>
    sessionSnapshotSchema.parse((await ctx.snapshot(guest)).json())
  return { ...ctx, adder, trackIds, vote, queue }
}

describe('votos (R-VOT)', () => {
  it('votar suma un voto y reordena la cola (R-COLA-01)', async () => {
    const { app, join, trackIds, vote, queue } = await withTracks()
    const guest = await join()
    const res = await vote(guest, trackIds[2]!)
    expect(voteResponseSchema.parse(res.json())).toEqual({ voted: true, votes: 2 })
    const snap = await queue(guest)
    expect(snap.queue.map((t) => t.id)).toEqual([trackIds[2], trackIds[0], trackIds[1]])
    expect(snap.me?.votedTrackIds).toEqual([trackIds[2]])
    await app.close()
  })

  it('R-VOT-01: votar dos veces la misma canción cuenta una sola vez', async () => {
    const { app, join, trackIds, vote } = await withTracks(1)
    const guest = await join()
    await vote(guest, trackIds[0]!)
    const again = await vote(guest, trackIds[0]!)
    expect(again.json()).toEqual({ voted: true, votes: 2 })
    await app.close()
  })

  it('un invitado puede votar varias canciones', async () => {
    const { app, join, trackIds, vote, queue } = await withTracks()
    const guest = await join()
    for (const trackId of trackIds) await vote(guest, trackId)
    expect((await queue(guest)).me?.votedTrackIds.sort()).toEqual([...trackIds].sort())
    await app.close()
  })

  it('R-VOT-03: quitar el voto lo resta, también el voto inicial de quien la agregó', async () => {
    const { app, adder, trackIds, vote, queue } = await withTracks(2)
    const res = await vote(adder, trackIds[0]!, 'DELETE')
    expect(res.json()).toEqual({ voted: false, votes: 0 })
    const snap = await queue(adder)
    // Con 0 votos baja detrás de la que tiene 1.
    expect(snap.queue.map((t) => [t.id, t.votes])).toEqual([
      [trackIds[1], 1],
      [trackIds[0], 0],
    ])
    expect(snap.me?.votedTrackIds).toEqual([trackIds[1]])
    // Quitar un voto que no existe no cambia nada.
    expect((await vote(adder, trackIds[0]!, 'DELETE')).json()).toEqual({ voted: false, votes: 0 })
    await app.close()
  })

  it('R-COLA-01: con empate de votos gana la más antigua', async () => {
    const { app, join, trackIds, vote, queue } = await withTracks()
    const [a, b] = [await join(), await join()]
    await vote(a, trackIds[1]!)
    await vote(b, trackIds[2]!)
    // Las dos tienen 2 votos: la 2 se agregó antes que la 3.
    expect((await queue()).queue.map((t) => t.id)).toEqual([trackIds[1], trackIds[2], trackIds[0]])
    await app.close()
  })

  it('50 votos simultáneos sobre la misma canción dejan el contador exacto', async () => {
    const { app, join, trackIds, vote, queue } = await withTracks(1)
    const guests = await Promise.all(Array.from({ length: 50 }, () => join()))
    // Cada invitado vota dos veces a la vez: deben quedar 50 votos nuevos, ni uno más.
    const results = await Promise.all(
      guests.flatMap((guest) => [vote(guest, trackIds[0]!), vote(guest, trackIds[0]!)]),
    )
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    expect((await queue()).queue[0]!.votes).toBe(51)
    await app.close()
  })

  it('exige haber entrado; la canción debe existir y la sesión seguir activa', async () => {
    const { app, join, trackIds, vote, end } = await withTracks(1)
    expect((await vote({}, trackIds[0]!)).statusCode).toBe(401)
    const guest = await join()
    const missing = await vote(guest, '6f1b0f1e-0000-4000-8000-000000000000')
    expect(missing.json().error.code).toBe('TRACK_NOT_FOUND')
    expect((await vote(guest, 'no-es-uuid')).statusCode).toBe(400)
    await end()
    expect((await vote(guest, trackIds[0]!)).json().error.code).toBe('SESSION_ENDED')
    await app.close()
  })

  it('R-VOT-04: una canción que ya no está pendiente no se vota', async () => {
    const { app, join, trackIds, vote, session } = await withTracks(1)
    const guest = await join()
    app.services.sessions.findById(session.id)!.tracks.get(trackIds[0]!)!.status = 'queued'
    const res = await vote(guest, trackIds[0]!)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('TRACK_NOT_VOTABLE')
    await app.close()
  })

  it('votar exige el origen de la app (CSRF)', async () => {
    const { app, join, trackIds, session } = await withTracks(1)
    const res = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${session.code}/tracks/${trackIds[0]}/vote`,
      cookies: await join(),
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('quitar canciones (R-CAN-06)', () => {
  it('el anfitrión quita una pendiente; deja de estar en la cola y se puede volver a pedir', async () => {
    const { app, adder, trackIds, session, queue, add } = await withTracks(2)
    const { loginAsHost } = await import('./helpers.ts')
    const { cookies } = await loginAsHost(app)
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/host/sessions/${session.id}/tracks/${trackIds[0]}`,
      headers: { origin: ORIGIN },
      cookies,
    })
    expect(res.statusCode).toBe(204)
    expect((await queue()).queue.map((t) => t.id)).toEqual([trackIds[1]])
    expect((await add(adder, id(1))).statusCode).toBe(201)
    await app.close()
  })

  it('un invitado no puede quitar canciones', async () => {
    const { app, adder, trackIds, session } = await withTracks(1)
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/host/sessions/${session.id}/tracks/${trackIds[0]}`,
      headers: { origin: ORIGIN },
      cookies: adder,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
