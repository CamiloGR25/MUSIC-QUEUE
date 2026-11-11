import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FixedEntryPage } from './fixed-entry-page.tsx'

function renderAt(path = '/e/FIXED00001') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/e/:code" element={<FixedEntryPage />} />
        <Route path="/s/:code" element={<p>Sesión de la fiesta</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const error = (code: string, status = 404) =>
  Response.json({ error: { code, message: 'x' } }, { status })

describe('FixedEntryPage (QR impreso, D-21)', () => {
  it('con una fiesta activa entra directo a la sesión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ sessionCode: 'K7M2P9QX4D' })),
    )
    renderAt()
    expect(await screen.findByText('Sesión de la fiesta')).toBeInTheDocument()
  })

  it('sin fiesta activa lo dice y permite volver a intentar', async () => {
    let active = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        active ? Response.json({ sessionCode: 'K7M2P9QX4D' }) : error('NO_ACTIVE_SESSION'),
      ),
    )
    renderAt()
    expect(
      await screen.findByRole('heading', { name: 'Todavía no hay una fiesta activa' }),
    ).toBeInTheDocument()
    active = true
    await userEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }))
    expect(await screen.findByText('Sesión de la fiesta')).toBeInTheDocument()
  })

  it('un código que no existe lo dice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => error('SESSION_NOT_FOUND')),
    )
    renderAt()
    expect(
      await screen.findByRole('heading', { name: 'Este código no existe' }),
    ).toBeInTheDocument()
  })
})
