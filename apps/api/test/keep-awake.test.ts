import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextLocalTime } from '../src/lib/time.ts'
import { KeepAwake } from '../src/modules/keep-awake/keep-awake.ts'
import { loginAsHost, ORIGIN, testApp } from './helpers.ts'

const MINUTE = 60_000
/** 2026-11-11 22:00 en Bogotá = 2026-11-12 03:00 UTC (Bogotá es UTC-5, sin horario de verano). */
const BOGOTA_22H = Date.UTC(2026, 10, 12, 3, 0)

afterEach(() => vi.useRealTimers())

describe('nextLocalTime', () => {
  it('a las 10 p. m. la próxima 4:00 a. m. es la del día siguiente', () => {
    expect(new Date(nextLocalTime(BOGOTA_22H, '04:00', 'America/Bogota')).toISOString()).toBe(
      '2026-11-12T09:00:00.000Z',
    )
  })

  it('a las 2 a. m. la próxima 4:00 a. m. es la de esa misma madrugada', () => {
    const twoAm = Date.UTC(2026, 10, 12, 7, 0)
    expect(nextLocalTime(twoAm, '04:00', 'America/Bogota') - twoAm).toBe(2 * 60 * MINUTE)
  })

  it('exactamente a las 4:00 pasa al día siguiente (R-AWAKE-04)', () => {
    const fourAm = Date.UTC(2026, 10, 12, 9, 0)
    expect(nextLocalTime(fourAm, '04:00', 'America/Bogota') - fourAm).toBe(24 * 60 * MINUTE)
  })
})

function keepAwake(enabled = true) {
  vi.useFakeTimers({ now: BOGOTA_22H })
  const ping = vi.fn(async () => {})
  const ka = new KeepAwake({
    enabled,
    intervalMs: 10 * MINUTE,
    until: '04:00',
    timeZone: 'America/Bogota',
    ping,
    now: Date.now,
  })
  return { ka, ping }
}

describe('KeepAwake (D-19, R-AWAKE-01…05)', () => {
  it('consulta cada 10 minutos desde que se activa', async () => {
    const { ka, ping } = keepAwake()
    ka.start()
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(ping).toHaveBeenCalledTimes(3)
    ka.stop()
  })

  it('se detiene sola a las 4:00 a. m. de Bogotá', async () => {
    const { ka, ping } = keepAwake()
    ka.start()
    expect(new Date(ka.until!).toISOString()).toBe('2026-11-12T09:00:00.000Z')
    await vi.advanceTimersByTimeAsync(6 * 60 * MINUTE + 10 * MINUTE)
    const calls = ping.mock.calls.length
    expect(calls).toBe(35) // de 22:10 a 3:50
    expect(ka.until).toBeNull()
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(ping).toHaveBeenCalledTimes(calls)
  })

  it('se detiene al finalizar la sesión', async () => {
    const { ka, ping } = keepAwake()
    ka.start()
    ka.stop()
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(ping).not.toHaveBeenCalled()
  })

  it('un fallo al consultar no la detiene', async () => {
    const { ka, ping } = keepAwake()
    ping.mockRejectedValueOnce(new Error('sin red'))
    ka.start()
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(ping).toHaveBeenCalledTimes(2)
    ka.stop()
  })

  it('desactivada (desarrollo) no hace nada', async () => {
    const { ka, ping } = keepAwake(false)
    ka.start()
    expect(ka.until).toBeNull()
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(ping).not.toHaveBeenCalled()
  })
})

describe('KeepAwake en la app', () => {
  it('en desarrollo y pruebas no se activa al crear la sesión', async () => {
    const { app } = await testApp()
    const { cookies } = await loginAsHost(app)
    await app.inject({
      method: 'POST',
      url: '/api/host/sessions',
      payload: { name: 'Fiesta' },
      headers: { origin: ORIGIN },
      cookies,
    })
    const me = await app.inject({ method: 'GET', url: '/api/host/me', cookies })
    expect(me.json().keepAwakeUntil).toBeNull()
    await app.close()
  })
  it('en producción se activa al crear la sesión y se apaga al finalizarla', async () => {
    const { app } = await testApp({ env: { NODE_ENV: 'production' } })
    const { cookies } = await loginAsHost(app)
    const post = (url: string, payload: object) =>
      app.inject({ method: 'POST', url, payload, headers: { origin: ORIGIN }, cookies })
    const me = async () =>
      (await app.inject({ method: 'GET', url: '/api/host/me', cookies })).json()

    const session = (await post('/api/host/sessions', { name: 'Fiesta' })).json()
    expect((await me()).keepAwakeUntil).not.toBeNull()
    await post(`/api/host/sessions/${session.id}/end`, {})
    expect((await me()).keepAwakeUntil).toBeNull()
    await app.close()
  })
})
