import { describe, expect, it, vi } from 'vitest'
import { HOST_SCOPES, HttpSpotifyAccounts } from '../src/providers/spotify/accounts.ts'

const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:5180/cb' }
const NOW = 1_000_000

function accountsWith(response: Response | Error) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (response instanceof Error) throw response
    return response
  })
  return {
    accounts: new HttpSpotifyAccounts(config, fetchMock as typeof fetch, () => NOW),
    fetchMock,
  }
}

describe('HttpSpotifyAccounts', () => {
  it('arma la URL de autorización con PKCE S256, scopes y URL de retorno', () => {
    const { accounts } = accountsWith(new Response())
    const url = new URL(accounts.authorizeUrl({ state: 'st', codeChallenge: 'ch' }))
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:5180/cb',
      scope: HOST_SCOPES.join(' '),
      state: 'st',
      code_challenge_method: 'S256',
      code_challenge: 'ch',
    })
  })

  it('intercambia el código con autenticación Basic y el code_verifier', async () => {
    const { accounts, fetchMock } = accountsWith(
      Response.json({ access_token: 'a', expires_in: 3600, refresh_token: 'r', scope: 'x' }),
    )
    const token = await accounts.exchangeCode({ code: 'c', codeVerifier: 'v' })
    expect(token).toEqual({ accessToken: 'a', accessExpiresAt: NOW + 3_600_000, refreshToken: 'r' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://accounts.spotify.com/api/token')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('cid:secret').toString('base64')}`,
    )
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: 'http://127.0.0.1:5180/cb',
      code_verifier: 'v',
    })
  })

  it('al renovar sin refresh token nuevo lo deja sin definir (se conserva el anterior)', async () => {
    const { accounts } = accountsWith(Response.json({ access_token: 'a2', expires_in: 3600 }))
    expect((await accounts.refresh('r')).refreshToken).toBeUndefined()
  })

  it('invalid_grant pide volver a conectar', async () => {
    const { accounts } = accountsWith(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    await expect(accounts.refresh('r')).rejects.toMatchObject({
      code: 'SPOTIFY_RECONNECT_REQUIRED',
    })
  })

  it('un error de red se informa como Spotify no disponible', async () => {
    const { accounts } = accountsWith(new TypeError('fetch failed'))
    await expect(accounts.refresh('r')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' })
  })

  it('un 5xx de Spotify se informa como Spotify no disponible', async () => {
    const { accounts } = accountsWith(new Response('error', { status: 503 }))
    await expect(accounts.refresh('r')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' })
  })

  it('lee el perfil y usa el id si no hay nombre visible', async () => {
    const { accounts, fetchMock } = accountsWith(Response.json({ id: 'user1', display_name: null }))
    expect(await accounts.getProfile('tok')).toEqual({ id: 'user1', name: 'user1' })
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('authorization')).toBe(
      'Bearer tok',
    )
  })
})
