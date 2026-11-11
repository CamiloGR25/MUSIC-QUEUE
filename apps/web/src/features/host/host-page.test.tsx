import type { HostMe } from '@musica/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
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

  it('muestra cuántos invitados hay y el QR en pantalla completa', async () => {
    stubApi(() => Response.json(me({ activeSession: { ...session, participantsCount: 3 } })))
    renderAt()
    expect(await screen.findByText('3 invitados')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar QR en pantalla completa' }))
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
    expect(dialog).toHaveTextContent('Pide tu canción')
    expect(await screen.findByAltText('QR fijo para entrar a la fiesta')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(print).toHaveBeenCalled()
  })
})
