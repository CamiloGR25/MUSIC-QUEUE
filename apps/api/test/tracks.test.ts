import { addTrackResponseSchema, searchResponseSchema, sessionSnapshotSchema } from '@musica/shared'
import { describe, expect, it } from 'vitest'
import { catalogTrack, sessionWithGuests } from './helpers.ts'

const id = (n: number) => catalogTrack(n).spotifyTrackId

describe('buscador', () => {
  it('exige haber entrado a la sesión', async () => {
    const { app, search } = await sessionWithGuests()
    const res = await search({}, 'gota fria')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('NOT_PARTICIPANT')
    await app.close()
  })

  it('busca en el mercado de la sesión y pagina de a 10', async () => {
    const { app, join, search, catalog } = await sessionWithGuests()
    const guest = await join()
    const first = searchResponseSchema.parse((await search(guest, 'gota fria')).json())
    expect(first.items).toHaveLength(10)
    expect(first.nextOffset).toBe(10)
    const second = searchResponseSchema.parse((await search(guest, 'gota fria', 10)).json())
    expect(second.items).toHaveLength(5)
    expect(second.nextOffset).toBeNull()
    expect(catalog.searches[0]).toEqual({ query: 'gota fria', offset: 0, market: 'CO' })
    await app.close()
  })

  it('marca las canciones que ya están en la cola', async () => {
    const { app, join, search, add } = await sessionWithGuests()
    const guest = await join()
    const added = addTrackResponseSchema.parse((await add(guest, id(2))).json())
    const { items } = searchResponseSchema.parse((await search(guest, 'algo')).json())
    expect(items[1]!.inQueue).toEqual({ trackId: added.track.id })
    expect(items[0]!.inQueue).toBeNull()
    await app.close()
  })

  it('valida la consulta', async () => {
    const { app, join, search } = await sessionWithGuests()
    const guest = await join()
    expect((await search(guest, 'a')).statusCode).toBe(400)
    expect((await search(guest, 'abc', 15)).statusCode).toBe(400)
    expect((await search(guest, 'abc', 50)).statusCode).toBe(400)
    await app.close()
  })

  it('si Spotify no responde, lo dice', async () => {
    const { app, join, search, catalog } = await sessionWithGuests()
    const guest = await join()
    catalog.failing = true
    const res = await search(guest, 'gota fria')
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('SPOTIFY_UNAVAILABLE')
    await app.close()
  })

  it('en una sesión terminada no se busca', async () => {
    const { app, join, search, end } = await sessionWithGuests()
    const guest = await join()
    await end()
    expect((await search(guest, 'gota fria')).json().error.code).toBe('SESSION_ENDED')
    await app.close()
  })
})

describe('agregar canciones (R-CAN, R-VOT-02)', () => {
  it('agrega con los datos de Spotify y el voto de quien la pidió', async () => {
    const { app, join, add, snapshot } = await sessionWithGuests()
    const guest = await join('Tía Marta')
    const res = await add(guest, id(3))
    expect(res.statusCode).toBe(201)
    const { track } = addTrackResponseSchema.parse(res.json())
    expect(track).toMatchObject({
      spotifyTrackId: id(3),
      name: 'Canción 3',
      artist: 'Artista 3',
      votes: 1,
      addedBy: 'Tía Marta',
      position: 1,
    })
    const snap = sessionSnapshotSchema.parse((await snapshot(guest)).json())
    expect(snap.queue.map((t) => t.id)).toEqual([track.id])
    expect(snap.version).toBe(1)
    await app.close()
  })

  it('R-CAN-01: no permite la misma canción dos veces en la cola', async () => {
    const { app, join, add, session } = await sessionWithGuests()
    const first = addTrackResponseSchema.parse((await add(await join(), id(4))).json())
    const again = await add(await join(), id(4))
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatchObject({
      code: 'DUPLICATE_TRACK',
      details: { trackId: first.track.id },
    })
    expect(app.services.sessions.findById(session.id)!.tracks.size).toBe(1)
    await app.close()
  })

  it('dos personas agregando la misma canción a la vez: entra una sola', async () => {
    const { app, join, add, catalog, session } = await sessionWithGuests()
    catalog.delayMs = 20
    const [a, b] = await Promise.all([join(), join()])
    const results = await Promise.all([add(a, id(5)), add(b, id(5))])
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409])
    expect(app.services.sessions.findById(session.id)!.tracks.size).toBe(1)
    await app.close()
  })

  it('una canción que Spotify no tiene disponible no entra', async () => {
    const { app, join, add } = await sessionWithGuests()
    const res = await add(await join(), 'NoExiste0000000000000x')
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('TRACK_NOT_FOUND')
    await app.close()
  })

  it('rechaza ids con formato inválido', async () => {
    const { app, join, add } = await sessionWithGuests()
    const res = await add(await join(), '../../me')
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exige haber entrado y que la sesión siga activa', async () => {
    const { app, join, add, end } = await sessionWithGuests()
    expect((await add({}, id(1))).statusCode).toBe(401)
    const guest = await join()
    await end()
    expect((await add(guest, id(1))).json().error.code).toBe('SESSION_ENDED')
    await app.close()
  })

  it('limita a 10 canciones por minuto por invitado (R-CAN-04)', async () => {
    const { app, join, add } = await sessionWithGuests()
    const guest = await join()
    for (let n = 1; n <= 10; n++) expect((await add(guest, id(n))).statusCode).toBe(201)
    const eleventh = await add(guest, id(11))
    expect(eleventh.statusCode).toBe(429)
    expect(eleventh.json().error.code).toBe('RATE_LIMITED')
    // Otro invitado no se ve afectado.
    expect((await add(await join(), id(12))).statusCode).toBe(201)
    await app.close()
  })
})

describe('orden de la cola (R-COLA-01)', () => {
  it('con los mismos votos, la más antigua va primero', async () => {
    const { app, join, add, snapshot, clock } = await sessionWithGuests()
    const guest = await join()
    for (const n of [7, 3, 9]) {
      await add(guest, id(n))
      clock.advance(1000)
    }
    const snap = sessionSnapshotSchema.parse((await snapshot()).json())
    expect(snap.queue.map((t) => [t.name, t.position])).toEqual([
      ['Canción 7', 1],
      ['Canción 3', 2],
      ['Canción 9', 3],
    ])
    await app.close()
  })

  it('agregadas en el mismo milisegundo respetan el orden de llegada', async () => {
    const { app, join, add, snapshot } = await sessionWithGuests()
    const guest = await join()
    for (const n of [2, 1, 3]) await add(guest, id(n))
    const snap = sessionSnapshotSchema.parse((await snapshot()).json())
    expect(snap.queue.map((t) => t.name)).toEqual(['Canción 2', 'Canción 1', 'Canción 3'])
    await app.close()
  })
})
