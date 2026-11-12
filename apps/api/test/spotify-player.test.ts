import { describe, expect, it, vi } from 'vitest'
import { HttpSpotifyPlayer } from '../src/providers/spotify/player.ts'

function setup(response: Response | ((url: URL, init?: RequestInit) => Response)) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    return typeof response === 'function' ? response(url, init) : response
  })
  return { player: new HttpSpotifyPlayer(fetchMock as typeof fetch), fetchMock }
}

const trackItem = {
  uri: 'spotify:track:abc',
  name: 'La Gota Fría',
  duration_ms: 215_493,
  artists: [{ name: 'Carlos Vives' }],
  album: {
    images: [
      { url: 'grande', width: 640 },
      { url: 'media', width: 300 },
    ],
  },
}

describe('HttpSpotifyPlayer', () => {
  it('lee el estado y lo traduce', async () => {
    const { player, fetchMock } = setup(
      Response.json({
        is_playing: true,
        progress_ms: 1_000,
        item: trackItem,
        device: { id: 'd1', name: 'Sala TV' },
      }),
    )
    expect(await player.getState('tok')).toEqual({
      isPlaying: true,
      progressMs: 1_000,
      item: {
        uri: 'spotify:track:abc',
        name: 'La Gota Fría',
        artist: 'Carlos Vives',
        imageUrl: 'media',
        durationMs: 215_493,
      },
      device: { id: 'd1', name: 'Sala TV' },
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.spotify.com/v1/me/player?additional_types=track,episode')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok')
  })

  it('204 significa que no hay nada cargado', async () => {
    const { player } = setup(new Response(null, { status: 204 }))
    expect(await player.getState('tok')).toBeNull()
  })

  it('agrega a la cola con la URI y el dispositivo', async () => {
    const { player, fetchMock } = setup(new Response(null, { status: 204 }))
    await player.addToQueue('tok', 'spotify:track:abc', 'd1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(init?.method).toBe('POST')
    expect(String(url)).toBe(
      'https://api.spotify.com/v1/me/player/queue?uri=spotify%3Atrack%3Aabc&device_id=d1',
    )
  })

  it('reproduce una lista de URIs en un dispositivo', async () => {
    const { player, fetchMock } = setup(new Response(null, { status: 204 }))
    await player.play('tok', { deviceId: 'd1', uris: ['spotify:track:abc'] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(init?.method).toBe('PUT')
    expect(String(url)).toBe('https://api.spotify.com/v1/me/player/play?device_id=d1')
    expect(JSON.parse(String(init?.body))).toEqual({ uris: ['spotify:track:abc'] })
  })

  it('transfiere sin arrancar la música', async () => {
    const { player, fetchMock } = setup(new Response(null, { status: 204 }))
    await player.transfer('tok', 'd2')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.spotify.com/v1/me/player')
    expect(JSON.parse(String(init?.body))).toEqual({ device_ids: ['d2'], play: false })
  })

  it('lista dispositivos y omite los que no tienen id', async () => {
    const { player } = setup(
      Response.json({
        devices: [
          { id: 'd1', name: 'Sala', type: 'TV', is_active: true, is_restricted: false },
          { id: null, name: 'Raro', type: 'Speaker', is_active: false, is_restricted: false },
        ],
      }),
    )
    expect(await player.devices('tok')).toEqual([
      { id: 'd1', name: 'Sala', type: 'TV', isActive: true, isRestricted: false },
    ])
  })

  it('lee las URIs de la cola nativa', async () => {
    const { player } = setup(
      Response.json({ currently_playing: null, queue: [{ uri: 'u1' }, { uri: 'u2' }] }),
    )
    expect(await player.getQueueUris('tok')).toEqual(['u1', 'u2'])
  })

  describe('errores', () => {
    const fail = (status: number, body?: unknown, headers?: Record<string, string>) =>
      setup(Response.json(body ?? {}, { status, headers })).player.pause('tok')

    it('Premium requerido', async () => {
      await expect(
        fail(403, {
          error: {
            status: 403,
            message: 'Player command failed: Premium required',
            reason: 'PREMIUM_REQUIRED',
          },
        }),
      ).rejects.toMatchObject({ code: 'PREMIUM_REQUIRED' })
    })
    it('otro 403: acción no permitida', async () => {
      await expect(fail(403, { error: { reason: 'UNKNOWN' } })).rejects.toMatchObject({
        code: 'PLAYBACK_RESTRICTED',
      })
    })
    it('sin dispositivo activo', async () => {
      await expect(fail(404, { error: { reason: 'NO_ACTIVE_DEVICE' } })).rejects.toMatchObject({
        code: 'NO_ACTIVE_DEVICE',
      })
    })
    it('demasiadas solicitudes, con la espera que pide Spotify', async () => {
      await expect(fail(429, {}, { 'retry-after': '7' })).rejects.toMatchObject({
        code: 'SPOTIFY_UNAVAILABLE',
        details: { retryAfterSec: 7 },
      })
    })
    it('token rechazado: volver a conectar', async () => {
      await expect(fail(401)).rejects.toMatchObject({ code: 'SPOTIFY_RECONNECT_REQUIRED' })
    })
    it('error de red', async () => {
      const { player } = setup(() => {
        throw new TypeError('fetch failed')
      })
      await expect(player.next('tok')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' })
    })
  })
})
