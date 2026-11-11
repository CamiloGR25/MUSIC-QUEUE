import { AppError } from '../../lib/errors.ts'
import { reconnectRequired, type SpotifyAccounts } from '../../providers/spotify/accounts.ts'

/** Margen para renovar antes de que venza el access token (docs/DISENO.md §6). */
export const REFRESH_MARGIN_MS = 60_000

export type HostCredentials = {
  refreshToken: string
  /** Momento de la autorización: el refresh token vence 6 meses después. */
  authorizedAt: number
  accessToken: string | null
  accessExpiresAt: number
}

/**
 * Credenciales de Spotify de cada anfitrión, solo en memoria (D-18). La copia duradera del
 * refresh token va cifrada en la cookie del anfitrión.
 */
export class HostTokenStore {
  private readonly credentials = new Map<string, HostCredentials>()
  private readonly refreshing = new Map<string, Promise<string>>()
  private readonly accounts: SpotifyAccounts
  private readonly now: () => number

  constructor(accounts: SpotifyAccounts, now = Date.now) {
    this.accounts = accounts
    this.now = now
  }

  set(spotifyId: string, credentials: HostCredentials): void {
    this.credentials.set(spotifyId, credentials)
  }

  get(spotifyId: string): HostCredentials | undefined {
    return this.credentials.get(spotifyId)
  }

  remove(spotifyId: string): void {
    this.credentials.delete(spotifyId)
  }

  /**
   * Access token vigente; lo renueva 60 s antes de vencer. Si hay varias solicitudes a la vez,
   * todas esperan la misma renovación (un solo llamado a Spotify por anfitrión).
   */
  async getAccessToken(spotifyId: string): Promise<string> {
    const current = this.credentials.get(spotifyId)
    if (!current) throw reconnectRequired()
    if (current.accessToken && current.accessExpiresAt - REFRESH_MARGIN_MS > this.now()) {
      return current.accessToken
    }
    const pending = this.refreshing.get(spotifyId)
    if (pending) return pending

    const refresh = this.renew(spotifyId, current).finally(() => this.refreshing.delete(spotifyId))
    this.refreshing.set(spotifyId, refresh)
    return refresh
  }

  private async renew(spotifyId: string, current: HostCredentials): Promise<string> {
    try {
      const token = await this.accounts.refresh(current.refreshToken)
      this.credentials.set(spotifyId, {
        ...current,
        accessToken: token.accessToken,
        accessExpiresAt: token.accessExpiresAt,
        // Si Spotify rota el refresh token, se guarda el nuevo; si no, se conserva el anterior.
        refreshToken: token.refreshToken ?? current.refreshToken,
      })
      return token.accessToken
    } catch (error) {
      if (error instanceof AppError && error.code === 'SPOTIFY_RECONNECT_REQUIRED') {
        this.credentials.delete(spotifyId)
      }
      throw error
    }
  }
}
