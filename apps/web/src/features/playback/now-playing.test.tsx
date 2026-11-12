import type { NowPlaying as NowPlayingData } from '@musica/shared'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BULBS, Garland } from './garland.tsx'
import { NowPlaying } from './now-playing.tsx'

const NOW = Date.UTC(2026, 10, 11, 22, 0, 0)

beforeEach(() => vi.useFakeTimers({ now: NOW }))
afterEach(() => vi.useRealTimers())

const playing = (overrides: Partial<NonNullable<NowPlayingData>> = {}): NowPlayingData => ({
  source: 'queue',
  trackId: 't1',
  name: 'La Gota Fría',
  artist: 'Carlos Vives',
  imageUrl: null,
  durationMs: 200_000,
  progressMs: 50_000,
  observedAt: new Date(NOW).toISOString(),
  isPlaying: true,
  addedBy: 'Tía Marta',
  ...overrides,
})

const lit = (container: HTMLElement) => container.querySelectorAll('[data-on="true"]').length

describe('Garland', () => {
  it('enciende bombillos según el progreso', () => {
    const { container, rerender } = render(<Garland progress={0} />)
    expect(lit(container)).toBe(0)
    rerender(<Garland progress={0.5} />)
    expect(lit(container)).toBe(BULBS / 2)
    rerender(<Garland progress={1.2} />)
    expect(lit(container)).toBe(BULBS)
  })
})

describe('NowPlaying', () => {
  it('muestra la canción, quién la pidió y el tiempo', () => {
    render(<NowPlaying nowPlaying={playing()} next={null} />)
    expect(screen.getByText('Sonando ahora')).toBeInTheDocument()
    expect(screen.getByText('La Gota Fría')).toBeInTheDocument()
    expect(screen.getByText('La pidió Tía Marta')).toBeInTheDocument()
    expect(screen.getByText('0:50 / 3:20')).toBeInTheDocument()
  })

  it('avanza sola cada segundo mientras suena', () => {
    const { container } = render(<NowPlaying nowPlaying={playing()} next={null} />)
    const before = lit(container)
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText('1:50 / 3:20')).toBeInTheDocument()
    expect(lit(container)).toBeGreaterThan(before)
  })

  it('en pausa no avanza y lo dice', () => {
    render(<NowPlaying nowPlaying={playing({ isPlaying: false })} next={null} />)
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.getByText('En pausa')).toBeInTheDocument()
    expect(screen.getByText('0:50 / 3:20')).toBeInTheDocument()
  })

  it('la música del anfitrión no dice quién la pidió', () => {
    render(<NowPlaying nowPlaying={playing({ source: 'host', addedBy: null })} next={null} />)
    expect(screen.queryByText(/La pidió/)).not.toBeInTheDocument()
  })

  it('sin música lo explica, y muestra la que sigue', () => {
    render(
      <NowPlaying
        nowPlaying={null}
        next={{
          id: 't2',
          spotifyTrackId: 'sp',
          spotifyUrl: 'u',
          name: 'Cumbia Cienaguera',
          artist: 'Aniceto Molina',
          album: 'a',
          imageUrl: null,
          durationMs: 1,
          explicit: false,
          votes: 3,
          addedBy: 'Beto',
        }}
      />,
    )
    expect(screen.getByText(/Todavía no suena nada/)).toBeInTheDocument()
    expect(screen.getByText('Sigue')).toBeInTheDocument()
    expect(screen.getByText('Aniceto Molina, la pidió Beto')).toBeInTheDocument()
  })
})
