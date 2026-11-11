import type { SessionSnapshot, TrackView } from '@musica/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '../../test/fake-event-source.ts'
import { GuestPage } from './guest-page.tsx'

const CODE = 'K7M2P9QX4D'

const track = (n: number, votes = 1, position = n): TrackView => ({
  id: `6f1b0f1e-0000-4000-8000-00000000000${n}`,
  spotifyTrackId: `sp${String(n).padStart(20, '0')}`,
  spotifyUrl: `https://open.spotify.com/track/${n}`,
  name: `Canción ${n}`,
  artist: `Artista ${n}`,
  album: `Álbum ${n}`,
  imageUrl: null,
  durationMs: 215_000,
  explicit: false,
  votes,
  addedBy: 'Tía Marta',
  position,
})

const snapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  session: { code: CODE, name: 'Fiesta', status: 'active' },
  me: { participantId: 'p1', name: 'Pipe', votedTrackIds: [] },
  version: 2,
  queue: [track(1), track(2)],
  ...overrides,
})

function stubApi(route: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit) => route(url, init) ?? Response.json(snapshot()),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/s/${CODE}`]}>
      <Routes>
        <Route path="/s/:code" element={<GuestPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Fiesta' })
  await waitFor(() => expect(FakeEventSource.instances).not.toHaveLength(0))
  const source = FakeEventSource.latest()
  act(() => source.open())
  return source
}

const names = () =>
  within(screen.getByRole('list', { name: 'Cola de canciones' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent)

describe('votar (R-VOT)', () => {
  it('un toque vota y otro quita el voto', async () => {
    const fetchMock = stubApi((url, init) => {
      if (url.endsWith('/vote')) {
        return Response.json({
          voted: init?.method === 'PUT',
          votes: init?.method === 'PUT' ? 2 : 1,
        })
      }
      return undefined
    })
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Votar por Canción 1, 1 voto' }))
    const pressed = await screen.findByRole('button', {
      name: 'Quitar tu voto de Canción 1, 2 votos',
    })
    expect(pressed).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(pressed)
    expect(
      await screen.findByRole('button', { name: 'Votar por Canción 1, 1 voto' }),
    ).toHaveAttribute('aria-pressed', 'false')
    const methods = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/vote'))
      .map(([, init]) => init?.method)
    expect(methods).toEqual(['PUT', 'DELETE'])
  })

  it('las canciones que ya votó aparecen marcadas', async () => {
    stubApi(() =>
      Response.json(
        snapshot({ me: { participantId: 'p1', name: 'Pipe', votedTrackIds: [track(2).id] } }),
      ),
    )
    await renderPage()
    expect(screen.getByRole('button', { name: /Quitar tu voto de Canción 2/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('si el voto falla, lo deshace y explica por qué', async () => {
    stubApi((url) =>
      url.endsWith('/vote')
        ? Response.json(
            {
              error: {
                code: 'TRACK_NOT_VOTABLE',
                message: 'Esa canción ya va a sonar; los votos se cerraron.',
              },
            },
            { status: 409 },
          )
        : undefined,
    )
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Votar por Canción 1, 1 voto' }))
    expect(
      await screen.findByText('Esa canción ya va a sonar; los votos se cerraron.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Votar por Canción 1, 1 voto' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('doble toque = like', () => {
  const row = (name: string) => screen.getByText(name).closest('li')!
  /** Toques en instantes controlados (ms): `performance.now()` devuelve cada valor en orden. */
  const tapsAt = (element: Element | Element[], ...times: number[]) => {
    const now = vi.spyOn(performance, 'now')
    for (const time of times) now.mockReturnValueOnce(time)
    const targets = Array.isArray(element) ? element : times.map(() => element)
    for (const target of targets) fireEvent.pointerUp(target)
    now.mockRestore()
  }
  const doubleTap = (element: Element) => tapsAt(element, 1000, 1150)
  const voteCalls = (fetchMock: ReturnType<typeof stubApi>) =>
    fetchMock.mock.calls.filter(([url]) => url.endsWith('/vote')).map(([, init]) => init?.method)

  it('dos toques seguidos en cualquier parte de la canción la votan', async () => {
    const fetchMock = stubApi((url) =>
      url.endsWith('/vote') ? Response.json({ voted: true, votes: 2 }) : undefined,
    )
    await renderPage()
    doubleTap(screen.getByText('Artista 1'))
    expect(
      await screen.findByRole('button', { name: 'Quitar tu voto de Canción 1, 2 votos' }),
    ).toBeInTheDocument()
    expect(voteCalls(fetchMock)).toEqual(['PUT'])
  })

  it('si ya la votó, el doble toque no le quita el voto', async () => {
    const fetchMock = stubApi(() =>
      Response.json(
        snapshot({ me: { participantId: 'p1', name: 'Pipe', votedTrackIds: [track(1).id] } }),
      ),
    )
    await renderPage()
    doubleTap(row('Canción 1'))
    expect(voteCalls(fetchMock)).toEqual([])
  })

  it('dos toques separados no cuentan como doble toque', async () => {
    const fetchMock = stubApi(() => undefined)
    await renderPage()
    tapsAt(row('Canción 1'), 1000, 1600)
    expect(voteCalls(fetchMock)).toEqual([])
  })

  it('tocar dos canciones distintas no vota ninguna', async () => {
    const fetchMock = stubApi(() => undefined)
    await renderPage()
    tapsAt([row('Canción 1'), row('Canción 2')], 1000, 1100)
    expect(voteCalls(fetchMock)).toEqual([])
  })
})

describe('tiempo real (SSE)', () => {
  it('se conecta al canal de su sesión', async () => {
    stubApi(() => undefined)
    const source = await renderPage()
    expect(source.url).toBe(`/api/sessions/${CODE}/events`)
  })

  it('reordena la cola cuando llega un cambio y descarta avisos viejos (R-COLA-03)', async () => {
    stubApi(() => undefined)
    const source = await renderPage()
    expect(names()).toEqual(['Canción 1', 'Canción 2'])

    act(() => source.emit('queue.updated', { version: 3, queue: [track(2, 2, 1), track(1, 1, 2)] }))
    expect(names()).toEqual(['Canción 2', 'Canción 1'])

    act(() => source.emit('queue.updated', { version: 1, queue: [track(1)] }))
    expect(names()).toEqual(['Canción 2', 'Canción 1'])
  })

  it('al reconectar la instantánea reemplaza el estado', async () => {
    stubApi(() => undefined)
    const source = await renderPage()
    act(() => source.emit('snapshot', snapshot({ version: 9, queue: [track(3)] })))
    expect(names()).toEqual(['Canción 3'])
  })

  it('si el anfitrión finaliza la sesión, lo ve al instante', async () => {
    stubApi(() => undefined)
    const source = await renderPage()
    act(() => source.emit('session.updated', { code: CODE, name: 'Fiesta', status: 'ended' }))
    expect(screen.getByRole('heading', { name: 'La sesión terminó' })).toBeInTheDocument()
  })

  it('muestra "Sin conexión" mientras reconecta', async () => {
    stubApi(() => undefined)
    const source = await renderPage()
    act(() => source.fail())
    expect(screen.getByText('Sin conexión. Reconectando…')).toBeInTheDocument()
    act(() => source.open())
    expect(screen.queryByText('Sin conexión. Reconectando…')).not.toBeInTheDocument()
  })
  it('si al reconectar la sesión ya no existe, lo dice en vez de seguir intentando', async () => {
    let gone = false
    stubApi(() =>
      gone
        ? Response.json(
            { error: { code: 'SESSION_NOT_FOUND', message: 'Este enlace ya no funciona.' } },
            { status: 404 },
          )
        : undefined,
    )
    const source = await renderPage()
    gone = true
    act(() => source.fail({ closed: true }))
    expect(
      await screen.findByRole('heading', { name: 'Este enlace ya no funciona' }),
    ).toBeInTheDocument()
  })
})
