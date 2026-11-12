import { devicesResponseSchema, hostSnapshotSchema, sessionSnapshotSchema } from '@musica/shared'
import { describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/errors.ts'
import { trackUri } from '../src/modules/queue/views.ts'
import { catalogTrack, loginAsHost, ORIGIN, sessionWithGuests } from './helpers.ts'

async function setup() {
  const ctx = await sessionWithGuests()
  // El sincronizador se maneja a mano en estas pruebas.
  ctx.app.services.sync.stop(ctx.session.id)
  const { cookies } = await loginAsHost(ctx.app)
  const host = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object) =>
    ctx.app.inject({
      method,
      url: `/api/host/sessions/${ctx.session.id}${path}`,
      payload: method === 'GET' ? undefined : (payload ?? {}),
      headers: { origin: ORIGIN },
      cookies,
    })
  return { ...ctx, host }
}

describe('controles del anfitrión', () => {
  it('Reproducir sin nada cargado arranca con la primera de la cola (R-SYNC-04)', async () => {
    const { app, join, add, host, player, session, snapshot } = await setup()
    const guest = await join('Ana')
    const first = (await add(guest, catalogTrack(1).spotifyTrackId)).json().track
    await add(guest, catalogTrack(2).spotifyTrackId)

    const res = await host('POST', '/playback/play')
    expect(res.statusCode).toBe(204)
    expect(player.commands('play')[0]!.args[0]).toEqual({
      deviceId: undefined,
      uris: [trackUri(catalogTrack(1))],
    })
    const state = app.services.sessions.findById(session.id)!
    expect(state.playingTrackId).toBe(first.id)
    // Sale de la cola de votos.
    const snap = sessionSnapshotSchema.parse((await snapshot(guest)).json())
    expect(snap.queue.map((t) => t.name)).toEqual(['Canción 2'])
    await app.close()
  })

  it('Reproducir con la cola vacía y nada cargado lo explica', async () => {
    const { app, host } = await setup()
    const res = await host('POST', '/playback/play')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('NOTHING_TO_PLAY')
    await app.close()
  })

  it('Reproducir con algo en pausa lo reanuda en el dispositivo elegido', async () => {
    const { app, host, player } = await setup()
    player.playing('spotify:track:host1', 10_000, 200_000, false)
    await host('PUT', '/device', { deviceId: 'dev-sala' })
    await host('POST', '/playback/play')
    expect(player.commands('play').at(-1)!.args[0]).toEqual({ deviceId: 'dev-sala' })
    await app.close()
  })

  it('pausar y siguiente llegan a Spotify', async () => {
    const { app, host, player } = await setup()
    expect((await host('POST', '/playback/pause')).statusCode).toBe(204)
    expect((await host('POST', '/playback/next')).statusCode).toBe(204)
    expect(player.commands('pause')).toHaveLength(1)
    expect(player.commands('next')).toHaveLength(1)
    await app.close()
  })

  it('los errores de Spotify llegan con su código', async () => {
    const { app, host, player } = await setup()
    player.failNext = new AppError(409, 'NO_ACTIVE_DEVICE', 'Abre Spotify en el dispositivo.')
    const res = await host('POST', '/playback/pause')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('NO_ACTIVE_DEVICE')
    await app.close()
  })

  it('lista dispositivos y transfiere la música al elegido', async () => {
    const { app, host, player } = await setup()
    const list = devicesResponseSchema.parse((await host('GET', '/devices')).json())
    expect(list).toEqual({ devices: player.deviceList, selectedId: null })
    expect((await host('PUT', '/device', { deviceId: 'dev-sala' })).statusCode).toBe(204)
    expect(player.commands('transfer')[0]!.args).toEqual(['dev-sala'])
    expect(devicesResponseSchema.parse((await host('GET', '/devices')).json()).selectedId).toBe(
      'dev-sala',
    )
    const missing = await host('PUT', '/device', { deviceId: 'otro' })
    expect(missing.json().error.code).toBe('NO_ACTIVE_DEVICE')
    await app.close()
  })

  it('un invitado no puede controlar la música', async () => {
    const { app, join, session } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/api/host/sessions/${session.id}/playback/pause`,
      payload: {},
      headers: { origin: ORIGIN },
      cookies: await join(),
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('al finalizar la sesión se detiene el sincronizador', async () => {
    const { app, host, session } = await setup()
    app.services.sync.start(session.id)
    expect(app.services.sync.isRunning(session.id)).toBe(true)
    await host('POST', '/end')
    expect(app.services.sync.isRunning(session.id)).toBe(false)
    await app.close()
  })
})

describe('lo que ven invitados y panel', () => {
  it('la instantánea incluye "Sonando ahora" y "Sigue"', async () => {
    const { app, join, add, player, session, snapshot } = await setup()
    const guest = await join('Ana')
    await add(guest, catalogTrack(1).spotifyTrackId)
    player.playing('spotify:track:host1', 190_000, 200_000)
    await app.services.sync.tick(session.id)

    const snap = sessionSnapshotSchema.parse((await snapshot(guest)).json())
    expect(snap.nowPlaying).toMatchObject({ source: 'host', name: 'Tema spotify:track:host1' })
    expect(snap.next).toMatchObject({ name: 'Canción 1', addedBy: 'Ana', votes: 1 })
    expect(snap.queue).toEqual([])
    await app.close()
  })

  it('el panel recibe además el estado de la conexión con Spotify', async () => {
    const { app, host, player, session } = await setup()
    player.playing('spotify:track:host1', 10_000)
    await app.services.sync.tick(session.id)
    const snap = hostSnapshotSchema.parse((await host('GET', '')).json())
    expect(snap.sync).toEqual({ status: 'ok', deviceName: 'Sala TV', lastError: null })
    await app.close()
  })
})
