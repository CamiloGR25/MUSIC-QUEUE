import type { FastifyBaseLogger } from 'fastify'
import { describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/errors.ts'
import { HostTokenStore } from '../src/modules/host-auth/token-store.ts'
import { SKIP_GRACE_MS, SYNC_DELAYS, PlaybackSync } from '../src/modules/playback/sync.ts'
import { toPlayback, trackUri } from '../src/modules/queue/views.ts'
import { EventBus, type BusEvent } from '../src/modules/realtime/event-bus.ts'
import { Notifier } from '../src/modules/realtime/notifier.ts'
import { MemoryStore } from '../src/modules/sessions/store.ts'
import { catalogTrack, Clock, FakeAccounts, FakePlayer } from './helpers.ts'

const LEAD = 20_000
const silent = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger

function setup(trackCount = 3) {
  const clock = new Clock()
  const store = new MemoryStore(clock.now)
  const bus = new EventBus()
  const events: BusEvent[] = []
  const tokens = new HostTokenStore(new FakeAccounts(clock), clock.now)
  tokens.set('host', {
    refreshToken: 'r',
    authorizedAt: clock.now(),
    accessToken: 'a',
    accessExpiresAt: clock.now() + 3_600_000,
  })
  const player = new FakePlayer()
  const session = store.create({ hostSpotifyId: 'host', name: 'Fiesta', market: 'CO' })
  bus.subscribe(session.id, (event) => events.push(event))
  const sync = new PlaybackSync({
    sessions: store,
    tokens,
    player,
    notify: new Notifier(store, bus),
    now: clock.now,
    leadMs: LEAD,
    log: silent,
  })
  const guest = store.join(session.id, 'hash', 'Ana')
  const tracks = Array.from({ length: trackCount }, (_, i) => {
    clock.advance(10)
    return store.addTrack(session.id, guest.id, catalogTrack(i + 1))
  })
  return { clock, store, player, session, sync, tracks, guest, events, tokens }
}

describe('sincronizador (R-SYNC, docs/DISENO.md §7)', () => {
  it('sin dispositivo activo lo informa y no toca la cola', async () => {
    const { sync, session, store, player } = setup()
    expect(await sync.tick(session.id)).toBe(SYNC_DELAYS.noDevice)
    expect(store.findById(session.id)!.playback.syncStatus).toBe('no_device')
    expect(player.commands('addToQueue')).toHaveLength(0)
  })

  it('con la música del anfitrión sonando, espera hasta 20 s antes del final', async () => {
    const { sync, session, store, player } = setup()
    player.playing('spotify:track:host1', 100_000, 200_000)
    const delay = await sync.tick(session.id)
    expect(delay).toBe(SYNC_DELAYS.max) // faltan 100 s: espera el máximo entre consultas
    expect(player.commands('addToQueue')).toHaveLength(0)
    const playback = toPlayback(store.findById(session.id)!)
    expect(playback.nowPlaying).toMatchObject({
      source: 'host',
      isPlaying: true,
      progressMs: 100_000,
    })
  })

  it('R-SYNC-02: faltando 20 s envía la más votada y queda fija como "Sigue"', async () => {
    const { sync, session, store, player, tracks, guest } = setup()
    // La 3 tiene un voto más: debe ir primero.
    const other = store.join(session.id, 'hash2', null)
    store.setVote(session.id, tracks[2]!.id, other.id, true)
    player.playing('spotify:track:host1', 185_000, 200_000)
    await sync.tick(session.id)

    expect(player.commands('addToQueue').map((call) => call.args)).toEqual([
      [trackUri(tracks[2]!), 'dev-sala'],
    ])
    const state = store.findById(session.id)!
    expect(state.queuedTrackId).toBe(tracks[2]!.id)
    expect(store.queue(session.id).map((t) => t.id)).toEqual([tracks[0]!.id, tracks[1]!.id])
    expect(toPlayback(state).next).toMatchObject({ id: tracks[2]!.id, votes: 2 })
    // Ya no se vota (R-VOT-04).
    expect(() => store.setVote(session.id, tracks[2]!.id, guest.id, false)).toThrow(/se cerraron/)
  })

  it('cuando Spotify la empieza a sonar pasa a "Sonando ahora" y la anterior termina', async () => {
    const { sync, session, store, player, tracks } = setup()
    player.playing('spotify:track:host1', 185_000, 200_000)
    await sync.tick(session.id)
    player.playing(trackUri(tracks[0]!), 1_000, 210_000)
    await sync.tick(session.id)

    const state = store.findById(session.id)!
    expect(state.playingTrackId).toBe(tracks[0]!.id)
    expect(state.queuedTrackId).toBeNull()
    expect(toPlayback(state).nowPlaying).toMatchObject({
      source: 'queue',
      trackId: tracks[0]!.id,
      addedBy: 'Ana',
    })

    // Al terminar y sonar la siguiente, la primera queda como sonada y se puede volver a pedir (D-6).
    player.playing(trackUri(tracks[1]!), 0)
    store.takeNext(session.id) // simula que ya se había enviado la 2
    await sync.tick(session.id)
    expect(state.tracks.get(tracks[0]!.id)!.status).toBe('played')
    expect(store.activeTrackId(session.id, tracks[0]!.spotifyTrackId)).toBeUndefined()
  })

  it('R-SYNC-01: dos vueltas a la vez envían una sola canción', async () => {
    const { sync, session, player } = setup()
    player.playing('spotify:track:host1', 190_000, 200_000)
    await Promise.all([sync.tick(session.id), sync.tick(session.id)])
    expect(player.commands('addToQueue')).toHaveLength(1)
  })

  it('si Spotify no la acepta, vuelve a la cola con sus votos (R-SYNC-03)', async () => {
    const { sync, session, store, player, tracks } = setup()
    player.playing('spotify:track:host1', 190_000, 200_000)
    // getState funciona; addToQueue falla.
    const original = player.addToQueue.bind(player)
    player.addToQueue = async () => {
      throw new AppError(409, 'NO_ACTIVE_DEVICE', 'Abre Spotify.')
    }
    const delay = await sync.tick(session.id)
    expect(delay).toBe(SYNC_DELAYS.noDevice)
    const state = store.findById(session.id)!
    expect(state.queuedTrackId).toBeNull()
    expect(store.queue(session.id)[0]!.id).toBe(tracks[0]!.id)
    expect(state.playback.syncStatus).toBe('no_device')
    player.addToQueue = original
  })

  it('si la enviada nunca suena y ya no está en la cola de Spotify, se omite', async () => {
    const { sync, session, store, player, tracks, clock } = setup()
    player.playing('spotify:track:host1', 190_000, 200_000)
    await sync.tick(session.id)
    player.nativeQueue = [] // el anfitrión vació su cola en Spotify
    player.playing('spotify:track:host2', 5_000, 200_000)
    clock.advance(10_000 + SKIP_GRACE_MS + 1)
    await sync.tick(session.id)
    const state = store.findById(session.id)!
    expect(state.tracks.get(tracks[0]!.id)!.status).toBe('skipped')
    expect(state.queuedTrackId).toBeNull()
  })

  it('en pausa consulta cada 10 s y no envía nada', async () => {
    const { sync, session, store, player } = setup()
    player.playing('spotify:track:host1', 195_000, 200_000, false)
    expect(await sync.tick(session.id)).toBe(SYNC_DELAYS.paused)
    expect(player.commands('addToQueue')).toHaveLength(0)
    expect(store.findById(session.id)!.playback.syncStatus).toBe('paused')
  })

  it('Premium requerido: lo informa y reintenta en 60 s', async () => {
    const { sync, session, store, player, events } = setup()
    player.failNext = new AppError(403, 'PREMIUM_REQUIRED', 'Requiere Premium.')
    expect(await sync.tick(session.id)).toBe(SYNC_DELAYS.blocked)
    expect(store.findById(session.id)!.playback.syncStatus).toBe('premium_required')
    expect(events.some((e) => e.name === 'sync.status')).toBe(true)
  })

  it('si Spotify pide esperar (429), respeta la espera', async () => {
    const { sync, session, store, player } = setup()
    player.failNext = new AppError(503, 'SPOTIFY_UNAVAILABLE', 'Espera.', { retryAfterSec: 40 })
    expect(await sync.tick(session.id)).toBe(40_000)
    expect(store.findById(session.id)!.playback.syncStatus).toBe('rate_limited')
  })

  it('sin permiso de Spotify (revocado) lo informa', async () => {
    const { sync, session, store, tokens } = setup()
    tokens.remove('host')
    expect(await sync.tick(session.id)).toBe(SYNC_DELAYS.blocked)
    expect(store.findById(session.id)!.playback.syncStatus).toBe('auth_error')
  })

  it('una sesión finalizada detiene el sincronizador', async () => {
    const { sync, session, store } = setup()
    store.end(session.id)
    expect(await sync.tick(session.id)).toBeNull()
  })

  it('avisa a todos lo que suena en cada vuelta', async () => {
    const { sync, session, player, events } = setup()
    player.playing('spotify:track:host1', 50_000)
    await sync.tick(session.id)
    expect(events.filter((e) => e.name === 'playback.updated').length).toBeGreaterThan(0)
  })
})
