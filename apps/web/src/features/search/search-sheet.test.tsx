import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS, SearchSheet } from './search-sheet.tsx'

const result = (n: number) => ({
  spotifyTrackId: `sp${String(n).padStart(20, '0')}`,
  spotifyUrl: `https://open.spotify.com/track/${n}`,
  name: `Canción ${n}`,
  artist: 'Carlos Vives',
  album: 'Álbum',
  imageUrl: null,
  durationMs: 215_000,
  explicit: false,
  inQueue: null,
})

function stubSearch(handler: (url: URL) => Response) {
  const fetchMock = vi.fn(async (input: string) => handler(new URL(input, 'http://x')))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.useRealTimers())

function renderSheet() {
  const onClose = vi.fn()
  render(<SearchSheet code="K7M2P9QX4D" onAdded={vi.fn()} onClose={onClose} />)
  return { onClose, input: screen.getByLabelText('Buscar canción, artista o álbum') }
}

describe('SearchSheet', () => {
  it('espera a que dejes de escribir antes de buscar (debounce)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = stubSearch(() => Response.json({ items: [result(1)], nextOffset: null }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { input } = renderSheet()
    await user.type(input, 'gota')
    expect(fetchMock).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(fetchMock.mock.calls[0]![0], 'http://x').searchParams.get('q')).toBe('gota')
    expect(await screen.findByText('Canción 1')).toBeInTheDocument()
  })

  it('con menos de 2 letras no busca y explica qué escribir', async () => {
    const fetchMock = stubSearch(() => Response.json({ items: [], nextOffset: null }))
    const { input } = renderSheet()
    await userEvent.type(input, 'g')
    await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 50))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Escribe el nombre de una canción/)).toBeInTheDocument()
  })

  it('sin resultados sugiere buscar por artista', async () => {
    stubSearch(() => Response.json({ items: [], nextOffset: null }))
    const { input } = renderSheet()
    await userEvent.type(input, 'xyzxyz')
    expect(await screen.findByText(/No encontramos «xyzxyz»/)).toBeInTheDocument()
  })

  it('carga más resultados', async () => {
    const fetchMock = stubSearch((url) =>
      url.searchParams.get('offset') === '0'
        ? Response.json({ items: [result(1)], nextOffset: 10 })
        : Response.json({ items: [result(11)], nextOffset: null }),
    )
    const { input } = renderSheet()
    await userEvent.type(input, 'gota')
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más resultados' }))
    expect(await screen.findByText('Canción 11')).toBeInTheDocument()
    expect(screen.getByText('Canción 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver más resultados' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('si Spotify falla, permite reintentar', async () => {
    let fail = true
    stubSearch(() =>
      fail
        ? Response.json(
            {
              error: {
                code: 'SPOTIFY_UNAVAILABLE',
                message: 'Spotify no responde. Intenta de nuevo.',
              },
            },
            { status: 503 },
          )
        : Response.json({ items: [result(1)], nextOffset: null }),
    )
    const { input } = renderSheet()
    await userEvent.type(input, 'gota')
    expect(await screen.findByText('Spotify no responde. Intenta de nuevo.')).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Canción 1')).toBeInTheDocument()
  })

  it('se cierra con Escape o con el botón', async () => {
    stubSearch(() => Response.json({ items: [], nextOffset: null }))
    const { onClose } = renderSheet()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar buscador' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
