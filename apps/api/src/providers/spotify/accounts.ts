import { z } from 'zod'
import { AppError } from '../../lib/errors.ts'

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const ME_URL = 'https://api.spotify.com/v1/me'

/** Permisos del anfitrión (docs/DISENO.md §6). */
export const HOST_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
] as const

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
  // Al renovar, Spotify puede o no devolver uno nuevo (docs/ANALISIS.md, hechos verificados).
  refresh_token: z.string().optional(),
})

const tokenErrorSchema = z.object({ error: z.string() })

const meSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable().optional(),
})

export type TokenSet = {
  accessToken: string
  /** Momento (ms) en que vence el access token. */
  accessExpiresAt: number
  refreshToken: string | undefined
}

export type SpotifyProfile = { id: string; name: string }

type Fetch = typeof fetch

export type SpotifyAccountsConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/** Contrato que usan las rutas; las pruebas lo reemplazan por un doble. */
export interface SpotifyAccounts {
  authorizeUrl(params: { state: string; codeChallenge: string }): string
  exchangeCode(params: { code: string; codeVerifier: string }): Promise<TokenSet>
  refresh(refreshToken: string): Promise<TokenSet>
  getProfile(accessToken: string): Promise<SpotifyProfile>
}

export const reconnectRequired = () =>
  new AppError(409, 'SPOTIFY_RECONNECT_REQUIRED', 'Vuelve a conectar Spotify.')

const unavailable = () =>
  new AppError(502, 'SPOTIFY_UNAVAILABLE', 'Spotify no responde. Intenta de nuevo en un momento.')

/**
 * Cliente de Spotify Accounts: Authorization Code con PKCE y client secret en el servidor
 * (docs/DISENO.md §6). Recibe `fetch` para poder probarlo sin red.
 */
export class HttpSpotifyAccounts implements SpotifyAccounts {
  private readonly config: SpotifyAccountsConfig
  private readonly fetch: Fetch
  private readonly now: () => number

  constructor(config: SpotifyAccountsConfig, fetchImpl: Fetch = fetch, now = Date.now) {
    this.config = config
    this.fetch = fetchImpl
    this.now = now
  }

  authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const url = new URL(AUTHORIZE_URL)
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: HOST_SCOPES.join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    }).toString()
    return url.toString()
  }

  exchangeCode({ code, codeVerifier }: { code: string; codeVerifier: string }) {
    return this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    })
  }

  refresh(refreshToken: string) {
    return this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  async getProfile(accessToken: string): Promise<SpotifyProfile> {
    const response = await this.send(ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (response.status === 401) throw reconnectRequired()
    if (!response.ok) throw unavailable()
    const me = meSchema.parse(await response.json())
    return { id: me.id, name: me.display_name?.trim() || me.id }
  }

  private async requestToken(form: Record<string, string>): Promise<TokenSet> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    )
    const response = await this.send(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      // invalid_grant: código usado, permiso revocado o refresh token vencido (6 meses).
      if (tokenErrorSchema.safeParse(data).data?.error === 'invalid_grant')
        throw reconnectRequired()
      throw unavailable()
    }
    const token = tokenResponseSchema.parse(data)
    return {
      accessToken: token.access_token,
      accessExpiresAt: this.now() + token.expires_in * 1000,
      refreshToken: token.refresh_token,
    }
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })
    } catch {
      throw unavailable()
    }
  }
}
