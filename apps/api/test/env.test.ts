import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/env.ts'

describe('loadConfig', () => {
  it('aplica los valores por defecto y quita la barra final de la URL', () => {
    const config = loadConfig({ PUBLIC_BASE_URL: 'http://127.0.0.1:5180/' }, null)
    expect(config).toMatchObject({
      env: 'development',
      port: 3180,
      host: '127.0.0.1',
      publicBaseUrl: 'http://127.0.0.1:5180',
      timezone: 'America/Bogota',
    })
  })

  it('exige PUBLIC_BASE_URL', () => {
    expect(() => loadConfig({}, null)).toThrow(/PUBLIC_BASE_URL/)
  })

  it('rechaza localhost porque Spotify no lo acepta como URL de retorno', () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: 'http://localhost:5180' }, null)).toThrow(
      /127\.0\.0\.1/,
    )
  })

  it('rechaza un puerto inválido', () => {
    expect(() =>
      loadConfig({ PUBLIC_BASE_URL: 'http://127.0.0.1:5180', API_PORT: '99999' }, null),
    ).toThrow(/API_PORT/)
  })

  it('en desarrollo ignora PORT (es del frontend) y usa API_PORT', () => {
    const config = loadConfig({ PUBLIC_BASE_URL: 'http://127.0.0.1:5180', PORT: '5180' }, null)
    expect(config.port).toBe(3180)
  })

  it('en producción usa el PORT que define Render', () => {
    const config = loadConfig(
      { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://musica.onrender.com', PORT: '10000' },
      null,
    )
    expect(config.port).toBe(10000)
    expect(config.host).toBe('0.0.0.0')
  })
})
