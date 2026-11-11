import { hostMeSchema } from '@musica/shared'
import { describe, expect, it } from 'vitest'
import { sha256Base64Url } from '../src/lib/crypto.ts'
import {
  Clock,
  cookieValue,
  FakeAccounts,
  HOST_ID,
  loginAsHost,
  ORIGIN,
  testApp,
} from './helpers.ts'

describe('inicio de sesión con Spotify', () => {
  it('redirige a Spotify con state y PKCE, y guarda el verificador cifrado', async () => {
    const { app, accounts } = await testApp()
    const { login } = await loginAsHost(app)
    expect(login.statusCode).toBe(302)
    const url = new URL(String(login.headers.location))
    expect(url.host).toBe('accounts.spotify.com')
    const tx = login.cookies.find((c) => c.name === 'oauth_tx')
    expect(tx).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth/spotify' })
    // El challenge enviado corresponde al verificador usado en el intercambio.
    expect(url.searchParams.get('code_challenge')).toBe(sha256Base64Url(accounts.lastVerifier!))
    await app.close()
  })

  it('al volver crea las cookies del anfitrión y lleva al panel', async () => {
    const { app } = await testApp()
    const { callback } = await loginAsHost(app)
    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toBe('/anfitrion')
    const sid = callback.cookies.find((c) => c.name === 'host_sid')
    const rt = callback.cookies.find((c) => c.name === 'host_rt')
    expect(sid).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api' })
    // El refresh token nunca viaja en claro.
    expect(rt?.value).not.toContain('refresh-1')
    expect(app.services.tokens.get(HOST_ID)?.refreshToken).toBe('refresh-1')
    await app.close()
  })

  it('rechaza un state que no coincide', async () => {
    const { app } = await testApp()
    const login = await app.inject({ method: 'GET', url: '/api/auth/spotify/login' })
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/spotify/callback?code=c&state=otro',
      cookies: { oauth_tx: cookieValue(login, 'oauth_tx')! },
    })
    expect(res.headers.location).toBe('/anfitrion?error=state')
    expect(cookieValue(res, 'host_sid')).toBeUndefined()
    await app.close()
  })

  it('rechaza el regreso sin la cookie del inicio', async () => {
    const { app } = await testApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/spotify/callback?code=c&state=s',
    })
    expect(res.headers.location).toBe('/anfitrion?error=state')
    await app.close()
  })

  it('rechaza el regreso después de 10 minutos', async () => {
    const clock = new Clock()
    const { app } = await testApp({ clock })
    const login = await app.inject({ method: 'GET', url: '/api/auth/spotify/login' })
    const state = new URL(String(login.headers.location)).searchParams.get('state')
    clock.advance(11 * 60 * 1000)
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/spotify/callback?code=c&state=${state}`,
      cookies: { oauth_tx: cookieValue(login, 'oauth_tx')! },
    })
    expect(res.headers.location).toBe('/anfitrion?error=state')
    await app.close()
  })

  it('si la persona cancela en Spotify vuelve al panel con el motivo', async () => {
    const { app } = await testApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/spotify/callback?error=access_denied&state=s',
    })
    expect(res.headers.location).toBe('/anfitrion?error=denied')
    await app.close()
  })

  it('no deja entrar a una cuenta que no está en ALLOWED_HOST_SPOTIFY_IDS (D-16)', async () => {
    const clock = new Clock()
    const accounts = new FakeAccounts(clock)
    accounts.profileId = 'intruso'
    const { app } = await testApp({ clock, accounts })
    const login = await app.inject({ method: 'GET', url: '/api/auth/spotify/login' })
    const state = new URL(String(login.headers.location)).searchParams.get('state')
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/spotify/callback?code=c&state=${state}`,
      cookies: { oauth_tx: cookieValue(login, 'oauth_tx')! },
    })
    expect(res.headers.location).toBe('/anfitrion?error=not_allowed')
    expect(cookieValue(res, 'host_sid')).toBeUndefined()
    expect(app.services.tokens.get('intruso')).toBeUndefined()
    await app.close()
  })
})

describe('GET /api/host/me', () => {
  it('sin cookie responde 401', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/host/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('HOST_UNAUTHENTICATED')
    await app.close()
  })

  it('con la cookie devuelve el anfitrión conectado', async () => {
    const { app, clock } = await testApp()
    const { cookies } = await loginAsHost(app)
    const res = await app.inject({ method: 'GET', url: '/api/host/me', cookies })
    expect(res.statusCode).toBe(200)
    const me = hostMeSchema.parse(res.json())
    expect(me).toMatchObject({ spotifyId: HOST_ID, name: 'Camilo', spotifyConnected: true })
    expect(me.activeSession).toBeNull()
    // Reconectar antes de 6 meses (docs/DISENO.md §6).
    expect(Date.parse(me.reconnectBy!)).toBe(clock.now() + 180 * 24 * 60 * 60 * 1000)
    await app.close()
  })

  it('una cookie host_sid alterada responde 401', async () => {
    const { app } = await testApp()
    const { cookies } = await loginAsHost(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/host/me',
      cookies: { ...cookies, host_sid: cookies.host_sid.replace(/.$/, 'x') },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('tras un reinicio del servidor recupera el permiso desde la cookie (D-18)', async () => {
    const first = await testApp()
    const { cookies } = await loginAsHost(first.app)
    await first.app.close()

    // Servidor nuevo: memoria vacía.
    const { app, accounts } = await testApp()
    expect(app.services.tokens.get(HOST_ID)).toBeUndefined()
    const res = await app.inject({ method: 'GET', url: '/api/host/me', cookies })
    expect(res.json()).toMatchObject({ spotifyConnected: true })
    expect(accounts.refreshCalls).toBe(1)
    expect(app.services.tokens.get(HOST_ID)?.refreshToken).toBe('refresh-1')
    await app.close()
  })

  it('si Spotify rota el refresh token, actualiza la cookie cifrada', async () => {
    const { app, accounts, clock } = await testApp()
    const { cookies } = await loginAsHost(app)
    accounts.nextRefresh = async () => ({
      accessToken: 'access-2',
      accessExpiresAt: clock.now() + 3_600_000,
      refreshToken: 'refresh-2',
    })
    clock.advance(3_600_000)
    const res = await app.inject({ method: 'GET', url: '/api/host/me', cookies })
    const newRt = cookieValue(res, 'host_rt')
    expect(newRt).toBeDefined()
    expect(newRt).not.toBe(cookies.host_rt)

    // La cookie nueva sirve tras un reinicio y lleva el refresh token rotado.
    const restarted = await testApp()
    await restarted.app.inject({
      method: 'GET',
      url: '/api/host/me',
      cookies: { ...cookies, host_rt: newRt! },
    })
    expect(restarted.app.services.tokens.get(HOST_ID)?.refreshToken).toBe('refresh-2')
    await Promise.all([app.close(), restarted.app.close()])
  })

  it('si Spotify revocó el permiso, informa que hay que reconectar', async () => {
    const { app, accounts, clock } = await testApp()
    const { cookies } = await loginAsHost(app)
    accounts.failRefreshWithInvalidGrant()
    clock.advance(3_600_000)
    const res = await app.inject({ method: 'GET', url: '/api/host/me', cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ spotifyConnected: false, reconnectBy: null })
    await app.close()
  })
})

describe('cerrar sesión y desconectar', () => {
  it('cerrar sesión borra la cookie del panel', async () => {
    const { app } = await testApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: ORIGIN },
    })
    expect(res.statusCode).toBe(204)
    const sid = res.cookies.find((c) => c.name === 'host_sid')
    expect(sid?.value).toBe('')
    await app.close()
  })

  it('desconectar Spotify borra el permiso de la memoria y del navegador', async () => {
    const { app } = await testApp()
    const { cookies } = await loginAsHost(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/spotify/disconnect',
      headers: { origin: ORIGIN },
      cookies,
    })
    expect(res.statusCode).toBe(204)
    expect(app.services.tokens.get(HOST_ID)).toBeUndefined()
    expect(cookieValue(res, 'host_rt')).toBe('')
    expect(cookieValue(res, 'host_sid')).toBe('')
    await app.close()
  })
})
