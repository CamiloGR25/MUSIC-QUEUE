import type { LightMyRequestResponse } from 'fastify'
import { buildApp } from '../src/app.ts'
import { AppError } from '../src/lib/errors.ts'
import { type AppConfig, loadConfig } from '../src/config/env.ts'
import {
  reconnectRequired,
  type SpotifyAccounts,
  type TokenSet,
} from '../src/providers/spotify/accounts.ts'
import type { CatalogPage, CatalogTrack, SpotifyCatalog } from '../src/providers/spotify/catalog.ts'
import type { Device, PlayerState, SpotifyPlayer } from '../src/providers/spotify/player.ts'

export const ORIGIN = 'http://127.0.0.1:5180'
export const HOST_ID = 'anfitrion1'

/** Variables mínimas válidas para pruebas (valores de prueba, no reales). */
export const TEST_ENV = {
  NODE_ENV: 'test',
  PUBLIC_BASE_URL: ORIGIN,
  SPOTIFY_CLIENT_ID: '0'.repeat(32),
  SPOTIFY_CLIENT_SECRET: '1'.repeat(32),
  SPOTIFY_REDIRECT_URI: `${ORIGIN}/api/auth/spotify/callback`,
  ALLOWED_HOST_SPOTIFY_IDS: `${HOST_ID},anfitrion2`,
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  COOKIE_SECRET: 'secreto-de-prueba-con-mas-de-32-caracteres',
} satisfies Record<string, string>

export function testConfig(
  webDistDir: string | null = null,
  overrides: Record<string, string> = {},
): AppConfig {
  return loadConfig({ ...TEST_ENV, ...overrides }, webDistDir)
}

/** Reloj controlable para probar vencimientos. */
export class Clock {
  value = Date.UTC(2026, 10, 11, 20, 0, 0)
  now = () => this.value
  advance(ms: number) {
    this.value += ms
  }
}

/** Doble de Spotify Accounts: registra las llamadas y permite simular respuestas. */
export class FakeAccounts implements SpotifyAccounts {
  profileId = HOST_ID
  refreshCalls = 0
  lastVerifier: string | null = null
  /** Siguiente respuesta de refresh; por defecto, token nuevo sin rotar el refresh token. */
  nextRefresh: (() => Promise<TokenSet>) | null = null
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }) {
    return `https://accounts.spotify.com/authorize?state=${state}&code_challenge=${codeChallenge}`
  }

  async exchangeCode({ codeVerifier }: { code: string; codeVerifier: string }) {
    this.lastVerifier = codeVerifier
    return {
      accessToken: 'access-1',
      accessExpiresAt: this.clock.now() + 3_600_000,
      refreshToken: 'refresh-1',
    }
  }

  async refresh(): Promise<TokenSet> {
    this.refreshCalls++
    if (this.nextRefresh) return this.nextRefresh()
    return {
      accessToken: `access-r${this.refreshCalls}`,
      accessExpiresAt: this.clock.now() + 3_600_000,
      refreshToken: undefined,
    }
  }

  async getProfile() {
    return { id: this.profileId, name: 'Camilo' }
  }

  failRefreshWithInvalidGrant() {
    this.nextRefresh = () => Promise.reject(reconnectRequired())
  }
}

/** Canción de prueba con un id de Spotify válido (22 caracteres base62). */
export function catalogTrack(n: number, overrides: Partial<CatalogTrack> = {}): CatalogTrack {
  const id = `track${String(n).padStart(17, '0')}`
  return {
    spotifyTrackId: id,
    spotifyUrl: `https://open.spotify.com/track/${id}`,
    name: `Canción ${n}`,
    artist: `Artista ${n}`,
    album: `Álbum ${n}`,
    imageUrl: 'https://i.scdn.co/image/portada',
    durationMs: 200_000 + n,
    explicit: false,
    ...overrides,
  }
}

/** Doble del catálogo: 15 canciones fijas; `delayMs` simula la espera de Spotify. */
export class FakeCatalog implements SpotifyCatalog {
  tracks = Array.from({ length: 15 }, (_, i) => catalogTrack(i + 1))
  searches: Array<{ query: string; offset: number; market: string }> = []
  delayMs = 0
  failing = false

  async search(query: string, offset: number, market: string): Promise<CatalogPage> {
    this.searches.push({ query, offset, market })
    await this.wait()
    const items = this.tracks.slice(offset, offset + 10)
    return { items, nextOffset: offset + 10 < this.tracks.length ? offset + 10 : null }
  }

  async getTrack(id: string): Promise<CatalogTrack | null> {
    await this.wait()
    return this.tracks.find((track) => track.spotifyTrackId === id) ?? null
  }

  private async wait() {
    if (this.failing) throw reconnectRequiredUnavailable()
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
  }
}

/** Doble del reproductor de Spotify: estado controlable y registro de comandos. */
export class FakePlayer implements SpotifyPlayer {
  state: PlayerState | null = null
  nativeQueue: string[] = []
  deviceList: Device[] = [
    { id: 'dev-sala', name: 'Sala TV', type: 'TV', isActive: true, isRestricted: false },
  ]
  calls: Array<{ command: string; args: unknown[] }> = []
  /** Error que lanzará el próximo comando (una vez). */
  failNext: Error | null = null

  private record(command: string, ...args: unknown[]) {
    this.calls.push({ command, args })
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }
  }

  commands(name: string) {
    return this.calls.filter((call) => call.command === name)
  }

  async getState() {
    this.record('getState')
    return this.state
  }
  async getQueueUris() {
    this.record('getQueueUris')
    return this.nativeQueue
  }
  async addToQueue(_token: string, uri: string, deviceId?: string) {
    this.record('addToQueue', uri, deviceId)
    this.nativeQueue.push(uri)
  }
  async play(_token: string, options?: { deviceId?: string; uris?: string[] }) {
    this.record('play', options)
  }
  async pause() {
    this.record('pause')
  }
  async next() {
    this.record('next')
  }
  async devices() {
    this.record('devices')
    return this.deviceList
  }
  async transfer(_token: string, deviceId: string) {
    this.record('transfer', deviceId)
  }

  /** Suena `uri` en el dispositivo de la sala. */
  playing(uri: string, progressMs: number, durationMs = 200_000, isPlaying = true) {
    this.state = {
      isPlaying,
      progressMs,
      item: { uri, name: `Tema ${uri}`, artist: 'Artista', imageUrl: null, durationMs },
      device: { id: 'dev-sala', name: 'Sala TV' },
    }
  }
}

export async function testApp(
  options: {
    webDistDir?: string | null
    clock?: Clock
    accounts?: FakeAccounts
    env?: Record<string, string>
    catalog?: FakeCatalog
    player?: FakePlayer
    ping?: () => Promise<void>
  } = {},
) {
  const clock = options.clock ?? new Clock()
  const accounts = options.accounts ?? new FakeAccounts(clock)
  const catalog = options.catalog ?? new FakeCatalog()
  const player = options.player ?? new FakePlayer()
  const app = await buildApp(testConfig(options.webDistDir ?? null, options.env), {
    logger: false,
    accounts,
    catalog,
    player,
    now: clock.now,
    ping: options.ping ?? (async () => {}),
  })
  return { app, clock, accounts, catalog, player }
}

export function cookieValue(res: LightMyRequestResponse, name: string): string | undefined {
  const found = res.cookies.find((cookie) => cookie.name === name)
  return found?.value
}

export type HostCookies = { host_sid: string; host_rt: string }

/** Recorre el OAuth completo con el doble y devuelve las cookies del anfitrión. */
export async function loginAsHost(app: Awaited<ReturnType<typeof testApp>>['app']) {
  const login = await app.inject({ method: 'GET', url: '/api/auth/spotify/login' })
  const tx = cookieValue(login, 'oauth_tx')
  const state = new URL(String(login.headers.location)).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/spotify/callback?code=codigo&state=${state}`,
    cookies: tx ? { oauth_tx: tx } : {},
  })
  const hostSid = cookieValue(callback, 'host_sid')
  const hostRt = cookieValue(callback, 'host_rt')
  if (!hostSid || !hostRt) throw new Error(`Login falló: ${callback.headers.location}`)
  return { cookies: { host_sid: hostSid, host_rt: hostRt } as HostCookies, login, callback }
}

function reconnectRequiredUnavailable() {
  return new AppError(503, 'SPOTIFY_UNAVAILABLE', 'Spotify no responde. Intenta de nuevo.')
}

/** Crea una sesión como anfitrión y devuelve atajos para actuar como invitados. */
export async function sessionWithGuests(options: Parameters<typeof testApp>[0] = {}) {
  const ctx = await testApp(options)
  const { cookies: host } = await loginAsHost(ctx.app)
  const session = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/host/sessions',
      payload: { name: 'Fiesta' },
      headers: { origin: ORIGIN },
      cookies: host,
    })
  ).json<{ id: string; code: string }>()

  const join = async (displayName?: string) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${session.code}/participants`,
      payload: displayName ? { displayName } : {},
      headers: { origin: ORIGIN },
    })
    const cookie = res.cookies.find((c) => c.name.startsWith('p_'))!
    return { [cookie.name]: cookie.value }
  }
  const add = (guest: Record<string, string>, spotifyTrackId: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${session.code}/tracks`,
      payload: { spotifyTrackId },
      headers: { origin: ORIGIN },
      cookies: guest,
    })
  const search = (guest: Record<string, string>, q: string, offset = 0) =>
    ctx.app.inject({
      method: 'GET',
      url: `/api/sessions/${session.code}/search?q=${encodeURIComponent(q)}&offset=${offset}`,
      cookies: guest,
    })
  const snapshot = (guest: Record<string, string> = {}) =>
    ctx.app.inject({ method: 'GET', url: `/api/sessions/${session.code}`, cookies: guest })
  const end = () =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/host/sessions/${session.id}/end`,
      payload: {},
      headers: { origin: ORIGIN },
      cookies: host,
    })
  return { ...ctx, session, join, add, search, snapshot, end }
}
