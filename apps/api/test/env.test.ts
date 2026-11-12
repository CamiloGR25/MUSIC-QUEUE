import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/env.ts'
import { TEST_ENV } from './helpers.ts'

const load = (overrides: Record<string, string | undefined>) =>
  loadConfig({ ...TEST_ENV, NODE_ENV: undefined, ...overrides }, null)

describe('loadConfig', () => {
  it('aplica los valores por defecto y quita la barra final de la URL', () => {
    const config = load({ PUBLIC_BASE_URL: 'http://127.0.0.1:5180/' })
    expect(config).toMatchObject({
      env: 'development',
      port: 3180,
      host: '127.0.0.1',
      publicBaseUrl: 'http://127.0.0.1:5180',
      timezone: 'America/Bogota',
      secureCookies: false,
    })
    expect(config.spotify.market).toBe('CO')
  })

  it('exige PUBLIC_BASE_URL', () => {
    expect(() => load({ PUBLIC_BASE_URL: undefined })).toThrow(/PUBLIC_BASE_URL/)
  })

  it('rechaza localhost porque Spotify no lo acepta como URL de retorno', () => {
    expect(() => load({ PUBLIC_BASE_URL: 'http://localhost:5180' })).toThrow(/127\.0\.0\.1/)
  })

  it('rechaza un puerto inválido', () => {
    expect(() => load({ API_PORT: '99999' })).toThrow(/API_PORT/)
  })

  it('en desarrollo ignora PORT (es del frontend) y usa API_PORT', () => {
    expect(load({ PORT: '5180' }).port).toBe(3180)
  })

  it('en producción usa el PORT de Render, escucha en 0.0.0.0 y usa cookies Secure', () => {
    const config = load({
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'https://musica.onrender.com',
      PORT: '10000',
    })
    expect(config).toMatchObject({ port: 10000, host: '0.0.0.0', secureCookies: true })
  })

  it('en Render toma la URL pública y la de retorno de RENDER_EXTERNAL_URL', () => {
    const config = load({
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: undefined,
      SPOTIFY_REDIRECT_URI: undefined,
      RENDER_EXTERNAL_URL: 'https://el-imperio-bar.onrender.com',
    })
    expect(config.publicBaseUrl).toBe('https://el-imperio-bar.onrender.com')
    expect(config.guestBaseUrl).toBe('https://el-imperio-bar.onrender.com')
    expect(config.spotify.redirectUri).toBe(
      'https://el-imperio-bar.onrender.com/api/auth/spotify/callback',
    )
  })

  it('las URL escritas a mano mandan sobre RENDER_EXTERNAL_URL', () => {
    const config = load({ RENDER_EXTERNAL_URL: 'https://otra.onrender.com' })
    expect(config.publicBaseUrl).toBe(TEST_ENV.PUBLIC_BASE_URL)
    expect(config.spotify.redirectUri).toBe(TEST_ENV.SPOTIFY_REDIRECT_URI)
  })

  it('lee la lista de anfitriones permitidos separada por comas (D-16)', () => {
    const config = load({ ALLOWED_HOST_SPOTIFY_IDS: ' uno , dos ,' })
    expect([...config.allowedHostIds]).toEqual(['uno', 'dos'])
  })

  it('exige al menos un anfitrión permitido', () => {
    expect(() => load({ ALLOWED_HOST_SPOTIFY_IDS: ' , ' })).toThrow(/ALLOWED_HOST_SPOTIFY_IDS/)
  })

  it('exige una clave de cifrado de 32 bytes', () => {
    expect(() => load({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    )
  })

  it('valida el formato del Client ID', () => {
    expect(() => load({ SPOTIFY_CLIENT_ID: 'no-es-un-id' })).toThrow(/SPOTIFY_CLIENT_ID/)
  })
})
