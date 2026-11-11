import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './app.tsx'

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App (E0)', () => {
  it('muestra "Servidor listo." cuando la API responde', async () => {
    const fetchMock = stubFetch(Response.json({ ok: true, uptimeSec: 3 }))
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Cola musical' })).toBeInTheDocument()
    expect(await screen.findByText('Servidor listo.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything())
  })

  it('avisa cuando el servidor no responde', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    render(<App />)
    expect(await screen.findByText(/El servidor no responde/)).toBeInTheDocument()
  })
})
