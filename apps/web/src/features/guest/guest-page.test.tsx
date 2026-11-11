import type { SessionSnapshot } from '@musica/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { GuestPage } from './guest-page.tsx'

const CODE = 'K7M2P9QX4D'

const snapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  session: { code: CODE, name: 'Cumpleaños de la abuela', status: 'active' },
  me: null,
  version: 0,
  queue: [],
  ...overrides,
})

function stubApi(route: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit) =>
      route(url, init) ??
      Response.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderAt(code = CODE) {
  return render(
    <MemoryRouter initialEntries={[`/s/${code}`]}>
      <Routes>
        <Route path="/s/:code" element={<GuestPage />} />
      </Routes>
      <Location />
    </MemoryRouter>,
  )
}

describe('GuestPage', () => {
  it('entra sin cuenta con apodo opcional', async () => {
    const fetchMock = stubApi((url, init) => {
      if (url === `/api/sessions/${CODE}`) return Response.json(snapshot())
      if (init?.method === 'POST') {
        return Response.json(
          snapshot({ me: { participantId: 'p1', name: 'Tía Marta', votedTrackIds: [] } }),
          {
            status: 201,
          },
        )
      }
      return undefined
    })
    renderAt()
    expect(
      await screen.findByRole('heading', { name: 'Cumpleaños de la abuela' }),
    ).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('¿Cómo te llamamos?'), 'Tía Marta')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Tía Marta')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe(`/api/sessions/${CODE}/participants`)
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ displayName: 'Tía Marta' })
  })

  it('quien ya entró ve la sesión sin volver a entrar', async () => {
    stubApi(() =>
      Response.json(
        snapshot({ me: { participantId: 'p1', name: 'Invitado 4', votedTrackIds: [] } }),
      ),
    )
    renderAt()
    expect(await screen.findByText('Invitado 4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument()
  })

  it('cambia el nombre', async () => {
    stubApi((_url, init) => {
      if (init?.method === 'PATCH') return Response.json({ name: 'Abuela' })
      return Response.json(
        snapshot({ me: { participantId: 'p1', name: 'Invitado 1', votedTrackIds: [] } }),
      )
    })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar nombre' }))
    await userEvent.type(screen.getByLabelText('Tu nombre'), 'Abuela')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Abuela')).toBeInTheDocument()
  })

  it('un enlace que no existe pide el QR nuevo', async () => {
    stubApi(() =>
      Response.json(
        { error: { code: 'SESSION_NOT_FOUND', message: 'Este enlace ya no funciona.' } },
        { status: 404 },
      ),
    )
    renderAt('ZZZZZZZZZZ')
    expect(
      await screen.findByRole('heading', { name: 'Este enlace ya no funciona' }),
    ).toBeInTheDocument()
  })

  it('una sesión terminada lo dice', async () => {
    stubApi(() =>
      Response.json(snapshot({ session: { code: CODE, name: 'Fiesta', status: 'ended' } })),
    )
    renderAt()
    expect(await screen.findByRole('heading', { name: 'La sesión terminó' })).toBeInTheDocument()
  })

  it('si el anfitrión rotó el enlace, pasa al código nuevo (R-SES-03)', async () => {
    stubApi(() =>
      Response.json(
        snapshot({
          session: { code: 'ABCDEFGH12', name: 'Fiesta', status: 'active' },
          me: { participantId: 'p1', name: 'Pipe', votedTrackIds: [] },
        }),
      ),
    )
    renderAt()
    expect(await screen.findByText('Pipe')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/s/ABCDEFGH12'))
  })
})

const track = (n: number, votes = 1) => ({
  id: `t${n}`,
  spotifyTrackId: `sp${String(n).padStart(20, '0')}`,
  spotifyUrl: `https://open.spotify.com/track/${n}`,
  name: `Canción ${n}`,
  artist: `Artista ${n}`,
  album: `Álbum ${n}`,
  imageUrl: null,
  durationMs: 215_000,
  explicit: n === 2,
  votes,
  addedBy: 'Tía Marta',
  position: n,
})

describe('cola y buscador en la pantalla del invitado', () => {
  const inside = { participantId: 'p1', name: 'Pipe', votedTrackIds: [] }

  it('muestra la cola en orden con posición, quién la pidió, duración y votos', async () => {
    stubApi(() => Response.json(snapshot({ me: inside, queue: [track(1, 3), track(2, 1)] })))
    renderAt()
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('1')
    expect(rows[0]).toHaveTextContent('Canción 1')
    expect(rows[0]).toHaveTextContent('La pidió Tía Marta, 3:35')
    expect(screen.getByRole('button', { name: 'Votar por Canción 1, 3 votos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Explícita')).toBeInTheDocument()
    // El nombre no es enlace: tocarlo no saca a nadie de la app al querer votar.
    expect(screen.queryByRole('link', { name: 'Canción 1' })).not.toBeInTheDocument()
    expect(screen.getByText(/la que tenga más votos suena primero/)).toBeInTheDocument()
  })

  it('con la cola vacía invita a pedir la primera', async () => {
    stubApi(() => Response.json(snapshot({ me: inside })))
    renderAt()
    expect(
      await screen.findByText('Todavía no hay canciones. Pide la primera.'),
    ).toBeInTheDocument()
  })

  it('busca, confirma y agrega una canción', async () => {
    let queue: ReturnType<typeof track>[] = []
    const result = { ...track(5), inQueue: null }
    const fetchMock = stubApi((url, init) => {
      if (url.includes('/search?')) return Response.json({ items: [result], nextOffset: null })
      if (url.endsWith('/tracks') && init?.method === 'POST') {
        queue = [track(5)]
        return Response.json({ track: track(5) }, { status: 201 })
      }
      return Response.json(snapshot({ me: inside, queue }))
    })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: '+ Añadir canción' }))
    await userEvent.type(screen.getByLabelText('Buscar canción, artista o álbum'), 'cancion')
    await userEvent.click(await screen.findByRole('button', { name: /Canción 5/ }))
    // Confirmación con los datos antes de agregar.
    expect(screen.getByRole('dialog')).toHaveTextContent('Álbum 5')
    // El enlace a Spotify (política de Spotify) queda en la confirmación.
    expect(screen.getByRole('link', { name: 'Abrir en Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/track/5',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Agregaste Canción 5. Tu voto ya cuenta.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Canción 5')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([u]) => u.endsWith('/tracks'))
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ spotifyTrackId: result.spotifyTrackId })
  })

  it('"Ya en la cola" cierra el buscador y muestra la canción para votarla', async () => {
    stubApi((url) => {
      if (url.includes('/search?')) {
        return Response.json({
          items: [{ ...track(1), inQueue: { trackId: 't1' } }],
          nextOffset: null,
        })
      }
      return Response.json(snapshot({ me: inside, queue: [track(1)] }))
    })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: '+ Añadir canción' }))
    await userEvent.type(screen.getByLabelText('Buscar canción, artista o álbum'), 'cancion')
    await userEvent.click(await screen.findByRole('button', { name: /Ya en la cola/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.getElementById('track-t1')).toHaveClass('bg-hoja/15')
  })

  it('si alguien la pidió justo antes, avisa que ya está en la cola', async () => {
    stubApi((url, init) => {
      if (url.includes('/search?'))
        return Response.json({ items: [{ ...track(1), inQueue: null }], nextOffset: null })
      if (init?.method === 'POST') {
        return Response.json(
          { error: { code: 'DUPLICATE_TRACK', message: 'Ya está en la cola. Puedes votarla.' } },
          { status: 409 },
        )
      }
      return Response.json(snapshot({ me: inside }))
    })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: '+ Añadir canción' }))
    await userEvent.type(screen.getByLabelText('Buscar canción, artista o álbum'), 'cancion')
    await userEvent.click(await screen.findByRole('button', { name: /Canción 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/Alguien ya la pidió/)).toBeInTheDocument()
  })
})
