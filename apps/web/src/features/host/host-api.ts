import { devicesResponseSchema, hostMeSchema, hostSessionSchema } from '@musica/shared'
import { z } from 'zod'
import { getJson, postJson, sendJson } from '../../lib/api-client.ts'

/** Inicia el OAuth con Spotify: es una navegación completa, no una llamada fetch. */
export const SPOTIFY_LOGIN_URL = '/api/auth/spotify/login'

const nothing = z.null()

export const hostApi = {
  me: (signal?: AbortSignal) => getJson('/host/me', hostMeSchema, signal),
  createSession: (name: string) => postJson('/host/sessions', { name }, hostSessionSchema),
  endSession: (id: string) => postJson(`/host/sessions/${id}/end`, {}, hostSessionSchema),
  rotateCode: (id: string) => postJson(`/host/sessions/${id}/rotate-code`, {}, hostSessionSchema),
  /** R-CAN-06: quitar una canción pendiente. */
  removeTrack: (sessionId: string, trackId: string) =>
    sendJson('DELETE', `/host/sessions/${sessionId}/tracks/${trackId}`, {}, nothing),
  eventsUrl: (sessionId: string) => `/api/host/sessions/${sessionId}/events`,
  play: (sessionId: string) => postJson(`/host/sessions/${sessionId}/playback/play`, {}, nothing),
  pause: (sessionId: string) => postJson(`/host/sessions/${sessionId}/playback/pause`, {}, nothing),
  next: (sessionId: string) => postJson(`/host/sessions/${sessionId}/playback/next`, {}, nothing),
  devices: (sessionId: string) =>
    getJson(`/host/sessions/${sessionId}/devices`, devicesResponseSchema),
  selectDevice: (sessionId: string, deviceId: string) =>
    sendJson('PUT', `/host/sessions/${sessionId}/device`, { deviceId }, nothing),
  logout: () => postJson('/auth/logout', {}, nothing),
  disconnect: () => postJson('/auth/spotify/disconnect', {}, nothing),
}

/** Mensajes del regreso desde Spotify (`/anfitrion?error=…`, apps/api host-auth). */
export const LOGIN_ERRORS: Record<string, string> = {
  denied: 'Cancelaste el permiso en Spotify. Puedes intentarlo de nuevo cuando quieras.',
  state: 'El inicio de sesión se interrumpió o tardó demasiado. Inténtalo de nuevo.',
  not_allowed: 'Esta cuenta de Spotify no está autorizada como anfitriona.',
  spotify: 'Spotify no respondió. Inténtalo de nuevo en un momento.',
}

const DAY_MS = 24 * 60 * 60 * 1000
/** El panel avisa 14 días antes de que venza el permiso de Spotify (docs/DISENO.md §6). */
export function reconnectWarning(reconnectBy: string | null, now = Date.now()): string | null {
  if (!reconnectBy) return null
  const days = Math.ceil((Date.parse(reconnectBy) - now) / DAY_MS)
  if (days > 14) return null
  return days <= 0
    ? 'El permiso de Spotify venció. Vuelve a conectar.'
    : `El permiso de Spotify vence en ${days} ${days === 1 ? 'día' : 'días'}. Vuelve a conectar para renovarlo.`
}
