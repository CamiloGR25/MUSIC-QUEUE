import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apiErrorSchema, healthResponseSchema } from '@musica/shared'
import { afterAll, describe, expect, it } from 'vitest'
import { testApp } from './helpers.ts'

describe('GET /api/health', () => {
  it('responde ok con el tiempo encendido', async () => {
    const app = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(healthResponseSchema.parse(res.json()).ok).toBe(true)
    await app.close()
  })

  it('envía cabeceras de seguridad con las portadas de Spotify permitidas', async () => {
    const app = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers['content-security-policy']).toContain('https://i.scdn.co')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    await app.close()
  })
})

describe('rutas inexistentes', () => {
  it('una ruta de la API que no existe responde 404 con el formato de error', async () => {
    const app = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/no-existe' })
    expect(res.statusCode).toBe(404)
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('NOT_FOUND')
    await app.close()
  })
})

describe('frontend compilado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'musica-web-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Cola musical</title>')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('las rutas del frontend devuelven index.html (las resuelve React Router)', async () => {
    const app = await testApp(dir)
    const res = await app.inject({ method: 'GET', url: '/s/K7M2P9QX4D' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('Cola musical')
    await app.close()
  })

  it('una ruta de la API inexistente sigue respondiendo JSON aunque haya frontend', async () => {
    const app = await testApp(dir)
    const res = await app.inject({ method: 'GET', url: '/api/nada' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
    await app.close()
  })
})
