import type { HostMe } from '@musica/shared'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '../../test/fake-event-source.ts'
import { reconnectWarning } from './host-api.ts'
import { HostPage } from './host-page.tsx'

type Route = (url: string, init?: RequestInit) => Response | undefined

/** Simula la API: cada llamada pasa por `route`; lo no previsto responde 404. */
function stubApi(route: Route) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    return (
      route(url, init) ??
      Response.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 })
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const me = (overrides: Partial<HostMe> = {}): HostMe => ({
  spotifyId: 'anfitrion1',
  name: 'Camilo',
  reconnectBy: new Date(Date.now() + 100 * 86_400_000).toISOString(),
  spotifyConnected: true,
  activeSession: null,
  keepAwakeUntil: null,
  fixedJoinUrl: 'http://127.0.0.1:5180/e/FIXED00001',
  ...overrides,
})

const session = {
  id: '6f1b0f1e-0000-4000-8000-000000000000',
  code: 'K7M2P9QX4D',
  name: 'Cumpleaños de la abuela',
  status: 'active' as const,
  createdAt: '2026-11-11T20:00:00.000Z',
  endedAt: null,
  joinUrl: 'http://127.0.0.1:5180/s/K7M2P9QX4D',
  participantsCount: 0,
}

function renderAt(path = '/anfitrion') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HostPage />
    </MemoryRouter>,
  )
}

describe('HostPage', () => {
  it('sin sesión iniciada ofrece conectar Spotify', async () => {
    stubApi(() =>
      Response.json(
        { error: { code: 'HOST_UNAUTHENTICATED', message: 'Inicia sesión con Spotify.' } },
        { status: 401 },
      ),
    )
    renderAt()
    const link = await screen.findByRole('link', { name: 'Conectar Spotify' })
    expect(link).toHaveAttribute('href', '/api/auth/spotify/login')
  })

  it('muestra el motivo cuando Spotify devuelve un error', async () => {
    stubApi(() =>
      Response.json({ error: { code: 'HOST_UNAUTHENTICATED', message: 'x' } }, { status: 401 }),
    )
    renderAt('/anfitrion?error=not_allowed')
    expect(
      await screen.findByText('Esta cuenta de Spotify no está autorizada como anfitriona.'),
    ).toBeInTheDocument()
  })

  it('crea la sesión del evento', async () => {
    let current = me()
    const fetchMock = stubApi((url, init) => {
      if (url === '/api/host/me') return Response.json(current)
      if (url === '/api/host/sessions' && init?.method === 'POST') {
        current = me({ activeSession: session })
        return Response.json(session, { status: 201 })
      }
      return undefined
    })
    renderAt()
    await userEvent.type(
      await screen.findByLabelText('Nombre del evento'),
      'Cumpleaños de la abuela',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Crear sesión' }))

    expect(await screen.findByText(session.joinUrl)).toBeInTheDocument()
    expect(await screen.findByAltText(/Código QR para entrar/)).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/host/sessions')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'Cumpleaños de la abuela' })
  })

  it('pide confirmación antes de finalizar la sesión', async () => {
    let current = me({ activeSession: session })
    const fetchMock = stubApi((url) => {
      if (url === '/api/host/me') return Response.json(current)
      if (url.endsWith('/end')) {
        current = me()
        return Response.json({ ...session, status: 'ended', endedAt: session.createdAt })
      }
      return undefined
    })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar sesión' }))
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/end'))).toBe(false)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('¿Finalizar la sesión?')

    await userEvent.click(screen.getAllByRole('button', { name: 'Finalizar sesión' }).at(-1)!)
    expect(await screen.findByLabelText('Nombre del evento')).toBeInTheDocument()
  })

  it('avisa que hay que reconectar cuando Spotify revocó el permiso', async () => {
    stubApi(() => Response.json(me({ spotifyConnected: false, reconnectBy: null })))
    renderAt()
    expect(await screen.findByText(/Spotify ya no tiene el permiso/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear sesión' })).toBeDisabled()
  })
})

describe('reconnectWarning', () => {
  const now = Date.UTC(2026, 10, 11)
  const inDays = (days: number) => new Date(now + days * 86_400_000).toISOString()

  it('no avisa si faltan más de 14 días', () => {
    expect(reconnectWarning(inDays(30), now)).toBeNull()
  })

  it('avisa con los días que faltan', () => {
    expect(reconnectWarning(inDays(3), now)).toMatch(/vence en 3 días/)
    expect(reconnectWarning(inDays(1), now)).toMatch(/vence en 1 día\./)
  })

  it('avisa si ya venció', () => {
    expect(reconnectWarning(inDays(-1), now)).toMatch(/venció/)
  })
})

describe('sesión activa en el panel', () => {
  it('pide confirmación y crea un enlace nuevo', async () => {
    let current = me({ activeSession: session })
    stubApi((url) => {
      if (url === '/api/host/me') return Response.json(current)
      if (url.endsWith('/rotate-code')) {
        const rotated = {
          ...session,
          code: 'ABCDEFGH12',
          joinUrl: 'http://127.0.0.1:5180/s/ABCDEFGH12',
        }
        current = me({ activeSession: rotated })
        return Response.json(rotated)
      }
      return undefined
    })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: 'Crear enlace nuevo' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('quienes ya están dentro siguen')
    await userEvent.click(screen.getAllByRole('button', { name: 'Crear enlace nuevo' }).at(-1)!)
    expect(await screen.findByText('http://127.0.0.1:5180/s/ABCDEFGH12')).toBeInTheDocument()
  })

  it('muestra el QR en pantalla completa', async () => {
    stubApi(() => Response.json(me({ activeSession: session })))
    renderAt()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Mostrar QR en pantalla completa' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Código QR en pantalla completa' })
    expect(dialog).toHaveTextContent('Escanea para pedir canciones y votar')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('QR para imprimir (D-21)', () => {
  it('muestra el QR fijo listo para imprimir', async () => {
    stubApi(() => Response.json(me()))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: 'Ver e imprimir el QR' }))
    const dialog = screen.getByRole('dialog', { name: 'QR para imprimir' })
    expect(dialog).toHaveTextContent('El Imperio Bar')
    expect(dialog).toHaveTextContent('Pide tu canción')
    expect(await screen.findByAltText('QR fijo para entrar a la fiesta')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(print).toHaveBeenCalled()
  })
})

const guest = (name: string, status: 'active' | 'blocked' = 'active') => ({
  id: `6f1b0f1e-0000-4000-8000-0000000000${name.length}${name.charCodeAt(0) % 10}`,
  name,
  status,
  joinedAt: '2026-11-12T20:00:00.000Z',
  tracksAdded: 0,
})

describe('panel en vivo (SSE)', () => {
  const track = {
    id: '6f1b0f1e-0000-4000-8000-0000000000a1',
    spotifyTrackId: 'sp000000000000000000a1',
    spotifyUrl: 'https://open.spotify.com/track/a1',
    name: 'La gota fría',
    artist: 'Carlos Vives',
    album: 'Clásicos',
    imageUrl: null,
    durationMs: 272_000,
    explicit: false,
    votes: 3,
    addedBy: 'Tía Marta',
    position: 1,
  }

  async function renderLive(route?: (url: string, init?: RequestInit) => Response | undefined) {
    const fetchMock = stubApi(
      (url, init) => route?.(url, init) ?? Response.json(me({ activeSession: session })),
    )
    renderAt()
    await screen.findByText('Sesión activa')
    await waitFor(() => expect(FakeEventSource.instances).not.toHaveLength(0))
    const source = FakeEventSource.latest()
    act(() => {
      source.open()
      source.emit('snapshot', {
        session: { ...session, participantsCount: 2 },
        version: 1,
        queue: [track],
        nowPlaying: null,
        next: null,
        sync: { status: 'ok', deviceName: 'Sala TV', lastError: null },
        participants: [guest('Ana'), guest('Beto', 'blocked')],
      })
    })
    return { source, fetchMock }
  }

  it('se conecta al canal del panel y muestra la cola y los invitados', async () => {
    const { source } = await renderLive()
    expect(source.url).toBe(`/api/host/sessions/${session.id}/events`)
    expect(screen.getByText('2 invitados')).toBeInTheDocument()
    expect(screen.getByText('Bloqueado: no puede pedir ni votar')).toBeInTheDocument()
    expect(screen.getByText('La gota fría')).toBeInTheDocument()
    act(() =>
      source.emit('participants.updated', {
        count: 3,
        items: [guest('Ana'), guest('Beto', 'blocked'), guest('Carla')],
      }),
    )
    expect(screen.getByText('3 invitados')).toBeInTheDocument()
  })

  it('quita una canción después de confirmar', async () => {
    const { source, fetchMock } = await renderLive((_url, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Quitar La gota fría de la cola' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Sí, quitar' }))
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(call?.[0]).toBe(`/api/host/sessions/${session.id}/tracks/${track.id}`)
    // El servidor avisa por SSE que la cola cambió.
    act(() => source.emit('queue.updated', { version: 2, queue: [] }))
    expect(screen.getByText('Todavía no hay canciones. Pide la primera.')).toBeInTheDocument()
  })
})

describe('música en el panel (E5)', () => {
  async function renderPanel(
    sync: { status: string; deviceName: string | null; lastError: string | null },
    nowPlaying: unknown = null,
    route?: (url: string, init?: RequestInit) => Response | undefined,
  ) {
    const fetchMock = stubApi(
      (url, init) => route?.(url, init) ?? Response.json(me({ activeSession: session })),
    )
    renderAt()
    await screen.findByText('Sesión activa')
    await waitFor(() => expect(FakeEventSource.instances).not.toHaveLength(0))
    const source = FakeEventSource.latest()
    act(() => {
      source.open()
      source.emit('snapshot', {
        session,
        version: 1,
        queue: [],
        nowPlaying,
        next: null,
        sync,
        participants: [],
      })
    })
    return { source, fetchMock }
  }

  const playingNow = {
    source: 'host',
    trackId: null,
    name: 'Tema del anfitrión',
    artist: 'Alguien',
    imageUrl: null,
    durationMs: 200_000,
    progressMs: 1_000,
    observedAt: new Date().toISOString(),
    isPlaying: true,
    addedBy: null,
  }

  it('Reproducir llama a Spotify y, mientras suena, el botón es Pausar', async () => {
    const { source, fetchMock } = await renderPanel(
      { status: 'idle', deviceName: null, lastError: null },
      null,
      (url) => (url.includes('/playback/') ? new Response(null, { status: 204 }) : undefined),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reproducir' }))
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/playback/play'))).toBe(true)

    act(() => source.emit('playback.updated', { nowPlaying: playingNow, next: null }))
    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/playback/pause'))).toBe(true)
  })

  it('explica el estado de la conexión con Spotify', async () => {
    const { source } = await renderPanel({ status: 'ok', deviceName: 'Sala TV', lastError: null })
    expect(screen.getByText('Spotify conectado en Sala TV.')).toBeInTheDocument()
    act(() =>
      source.emit('sync.status', { status: 'no_device', deviceName: null, lastError: null }),
    )
    expect(screen.getByText(/Abre Spotify en el dispositivo/)).toBeInTheDocument()
    act(() =>
      source.emit('sync.status', { status: 'premium_required', deviceName: null, lastError: null }),
    )
    expect(
      screen.getByText('El control de la música requiere Spotify Premium.'),
    ).toBeInTheDocument()
  })

  it('muestra el error de Spotify al reproducir', async () => {
    await renderPanel({ status: 'idle', deviceName: null, lastError: null }, null, (url) =>
      url.endsWith('/playback/play')
        ? Response.json(
            {
              error: {
                code: 'NOTHING_TO_PLAY',
                message: 'Agrega canciones a la cola para empezar.',
              },
            },
            { status: 409 },
          )
        : undefined,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reproducir' }))
    expect(await screen.findByText('Agrega canciones a la cola para empezar.')).toBeInTheDocument()
  })

  it('elige el dispositivo donde suena la música', async () => {
    const { fetchMock } = await renderPanel(
      { status: 'no_device', deviceName: null, lastError: null },
      null,
      (url, init) => {
        if (url.endsWith('/devices')) {
          return Response.json({
            devices: [
              { id: 'd1', name: 'Sala TV', type: 'TV', isActive: false, isRestricted: false },
              {
                id: 'd2',
                name: 'Celular',
                type: 'Smartphone',
                isActive: true,
                isRestricted: false,
              },
            ],
            selectedId: null,
          })
        }
        if (url.endsWith('/device') && init?.method === 'PUT')
          return new Response(null, { status: 204 })
        return undefined
      },
    )
    await userEvent.click(screen.getByRole('button', { name: 'Elegir dispositivo' }))
    await userEvent.click(await screen.findByRole('button', { name: /Sala TV/ }))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ deviceId: 'd1' })
    expect(screen.queryByRole('group', { name: 'Dispositivos de Spotify' })).not.toBeInTheDocument()
  })
})

describe('invitados en el panel (R-PAR-03)', () => {
  it('bloquea con confirmación y desbloquea sin ella', async () => {
    const ana = guest('Ana')
    const fetchMock = stubApi((url) =>
      url.includes('/participants/')
        ? new Response(null, { status: 204 })
        : Response.json(me({ activeSession: session })),
    )
    renderAt()
    await screen.findByText('Sesión activa')
    await waitFor(() => expect(FakeEventSource.instances).not.toHaveLength(0))
    const source = FakeEventSource.latest()
    act(() => {
      source.open()
      source.emit('snapshot', {
        session,
        version: 1,
        queue: [],
        nowPlaying: null,
        next: null,
        sync: { status: 'ok', deviceName: 'Sala', lastError: null },
        participants: [ana],
      })
    })
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear a Ana' }))
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/block'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Sí, bloquear' }))
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith(`/participants/${ana.id}/block`)),
    ).toBe(true)

    act(() =>
      source.emit('participants.updated', { count: 1, items: [{ ...ana, status: 'blocked' }] }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Desbloquear a Ana' }))
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith(`/participants/${ana.id}/unblock`)),
    ).toBe(true)
  })
})
