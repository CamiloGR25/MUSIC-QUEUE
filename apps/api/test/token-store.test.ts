import { describe, expect, it } from 'vitest'
import { HostTokenStore, REFRESH_MARGIN_MS } from '../src/modules/host-auth/token-store.ts'
import { Clock, FakeAccounts } from './helpers.ts'

function setup() {
  const clock = new Clock()
  const accounts = new FakeAccounts(clock)
  const store = new HostTokenStore(accounts, clock.now)
  store.set('h', {
    refreshToken: 'refresh-1',
    authorizedAt: clock.now(),
    accessToken: 'access-1',
    accessExpiresAt: clock.now() + 3_600_000,
  })
  return { clock, accounts, store }
}

describe('HostTokenStore', () => {
  it('reutiliza el access token vigente sin llamar a Spotify', async () => {
    const { store, accounts } = setup()
    expect(await store.getAccessToken('h')).toBe('access-1')
    expect(accounts.refreshCalls).toBe(0)
  })

  it('renueva 60 s antes de que venza', async () => {
    const { store, accounts, clock } = setup()
    clock.advance(3_600_000 - REFRESH_MARGIN_MS + 1)
    expect(await store.getAccessToken('h')).toBe('access-r1')
    expect(accounts.refreshCalls).toBe(1)
  })

  it('conserva el refresh token si Spotify no envía uno nuevo', async () => {
    const { store, clock } = setup()
    clock.advance(3_600_000)
    await store.getAccessToken('h')
    expect(store.get('h')?.refreshToken).toBe('refresh-1')
  })

  it('guarda el refresh token nuevo si Spotify lo rota', async () => {
    const { store, accounts, clock } = setup()
    accounts.nextRefresh = async () => ({
      accessToken: 'access-2',
      accessExpiresAt: clock.now() + 3_600_000,
      refreshToken: 'refresh-2',
    })
    clock.advance(3_600_000)
    await store.getAccessToken('h')
    expect(store.get('h')?.refreshToken).toBe('refresh-2')
  })

  it('varias solicitudes simultáneas comparten una sola renovación', async () => {
    const { store, accounts, clock } = setup()
    clock.advance(3_600_000)
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => store.getAccessToken('h')))
    expect(new Set(tokens)).toEqual(new Set(['access-r1']))
    expect(accounts.refreshCalls).toBe(1)
  })

  it('invalid_grant borra las credenciales y pide volver a conectar', async () => {
    const { store, accounts, clock } = setup()
    accounts.failRefreshWithInvalidGrant()
    clock.advance(3_600_000)
    await expect(store.getAccessToken('h')).rejects.toMatchObject({
      code: 'SPOTIFY_RECONNECT_REQUIRED',
    })
    expect(store.get('h')).toBeUndefined()
  })

  it('sin credenciales pide volver a conectar', async () => {
    const { store } = setup()
    await expect(store.getAccessToken('otro')).rejects.toMatchObject({
      code: 'SPOTIFY_RECONNECT_REQUIRED',
    })
  })
})
