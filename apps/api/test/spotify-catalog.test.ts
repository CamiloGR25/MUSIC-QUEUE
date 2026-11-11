import { describe, expect, it, vi } from 'vitest'
import { HttpSpotifyCatalog } from '../src/providers/spotify/catalog.ts'

const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'x' }

const apiTrack = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Canción ${id}`,
  duration_ms: 215_493,
  explicit: false,
  is_playable: true,
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  artists: [{ name: 'Carlos Vives' }, { name: 'Invitado' }],
  album: {
    name: 'Clásicos de la Provincia',
    images: [
      { url: 'big', width: 640 },
      { url: 'mid', width: 300 },
      { url: 'small', width: 64 },
    ],
  },
  ...overrides,
})

/** Simula Spotify: token de la app y respuestas de la API según la ruta. */
function setup(api: (url: URL) => Response) {
  let now = 1_000_000
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url.pathname)
    if (url.host === 'accounts.spotify.com') {
      return Response.json({ access_token: `tok${calls.length}`, expires_in: 3600 })
    }
    return api(url)
  })
  const catalog = new HttpSpotifyCatalog(config, fetchMock as typeof fetch, () => now)
  return { catalog, calls, fetchMock, advance: (ms: number) => (now += ms) }
}

const searchResponse = (items: unknown[], next: string | null = 'next') =>
  Response.json({ tracks: { items, next } })

describe('HttpSpotifyCatalog', () => {
  it('pide un token de la app una vez y lo reutiliza', async () => {
    const { catalog, calls } = setup(() => searchResponse([]))
    await catalog.search('uno', 0, 'CO')
    await catalog.search('dos', 0, 'CO')
    expect(calls.filter((p) => p === '/api/token')).toHaveLength(1)
  })

  it('busca canciones de a 10 en el mercado de la sesión', async () => {
    const { catalog, fetchMock } = setup(() => searchResponse([apiTrack('a')]))
    const page = await catalog.search('gota fria', 10, 'CO')
    const url = new URL(String(fetchMock.mock.calls[1]![0]))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'gota fria',
      type: 'track',
      market: 'CO',
      limit: '10',
      offset: '10',
    })
    expect(page.items[0]).toEqual({
      spotifyTrackId: 'a',
      spotifyUrl: 'https://open.spotify.com/track/a',
      name: 'Canción a',
      artist: 'Carlos Vives, Invitado',
      album: 'Clásicos de la Provincia',
      imageUrl: 'mid',
      durationMs: 215_493,
      explicit: false,
    })
    expect(page.nextOffset).toBe(20)
  })

  it('omite lo que no se puede reproducir y los resultados vacíos', async () => {
    const { catalog } = setup(() =>
      searchResponse([apiTrack('a'), null, apiTrack('b', { is_playable: false })]),
    )
    const page = await catalog.search('x', 0, 'CO')
    expect(page.items.map((t) => t.spotifyTrackId)).toEqual(['a'])
  })

  it('no ofrece más páginas después de la quinta ni si Spotify no tiene más', async () => {
    const { catalog } = setup((url) =>
      searchResponse([], url.searchParams.get('q') === 'fin' ? null : 'next'),
    )
    expect((await catalog.search('x', 40, 'CO')).nextOffset).toBeNull()
    expect((await catalog.search('fin', 0, 'CO')).nextOffset).toBeNull()
  })

  it('guarda la búsqueda 60 segundos', async () => {
    const { catalog, calls, advance } = setup(() => searchResponse([apiTrack('a')]))
    await catalog.search('Gota', 0, 'CO')
    await catalog.search('gota', 0, 'CO')
    expect(calls.filter((p) => p === '/v1/search')).toHaveLength(1)
    advance(60_001)
    await catalog.search('gota', 0, 'CO')
    expect(calls.filter((p) => p === '/v1/search')).toHaveLength(2)
  })

  it('obtiene una canción y responde null si no existe', async () => {
    const { catalog } = setup((url) =>
      url.pathname.endsWith('/existe')
        ? Response.json(apiTrack('existe'))
        : Response.json({ error: { status: 404 } }, { status: 404 }),
    )
    expect((await catalog.getTrack('existe', 'CO'))?.name).toBe('Canción existe')
    expect(await catalog.getTrack('otra', 'CO')).toBeNull()
  })

  it('una canción no reproducible en el mercado cuenta como no disponible', async () => {
    const { catalog } = setup(() => Response.json(apiTrack('x', { is_playable: false })))
    expect(await catalog.getTrack('x', 'CO')).toBeNull()
  })

  it('si el token de la app falla con 401, pide otro y reintenta una vez', async () => {
    let first = true
    const { catalog, calls } = setup(() => {
      if (first) {
        first = false
        return new Response('', { status: 401 })
      }
      return searchResponse([apiTrack('a')])
    })
    const page = await catalog.search('x', 0, 'CO')
    expect(page.items).toHaveLength(1)
    expect(calls.filter((p) => p === '/api/token')).toHaveLength(2)
  })

  it('429 y errores de red se informan como Spotify no disponible', async () => {
    const limited = setup(() => new Response('', { status: 429 }))
    await expect(limited.catalog.search('x', 0, 'CO')).rejects.toMatchObject({
      code: 'SPOTIFY_UNAVAILABLE',
    })
    const offline = setup(() => {
      throw new TypeError('fetch failed')
    })
    await expect(offline.catalog.search('x', 0, 'CO')).rejects.toMatchObject({
      code: 'SPOTIFY_UNAVAILABLE',
    })
  })
})
