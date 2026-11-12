import {
  createSessionBodySchema,
  type HostMe,
  type HostSession,
  type HostSnapshot,
  selectDeviceBodySchema,
} from '@musica/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../../lib/errors.ts'
import type { SseConnections } from '../../lib/sse.ts'
import { parseWith } from '../../lib/validation.ts'
import { HOST_COOKIE_MAX_AGE_MS } from '../host-auth/cookies.ts'
import { fixedJoinUrl } from '../fixed-qr/routes.ts'
import { currentHost, registerHostGuard } from '../host-auth/host-guard.ts'
import type { HostAuthDeps } from '../host-auth/routes.ts'
import type { KeepAwake } from '../keep-awake/keep-awake.ts'
import type { PlaybackControls } from '../playback/controls.ts'
import type { PlaybackSync } from '../playback/sync.ts'
import type { EventBus } from '../realtime/event-bus.ts'
import type { Notifier } from '../realtime/notifier.ts'
import type { SessionState, SessionStore } from '../sessions/store.ts'

type HostDeps = HostAuthDeps & {
  sessions: SessionStore
  keepAwake: KeepAwake
  bus: EventBus
  notify: Notifier
  sse: SseConnections
  sync: PlaybackSync
  controls: PlaybackControls
}

const sessionParamsSchema = z.object({ id: z.uuid() })
const trackParamsSchema = z.object({ id: z.uuid(), trackId: z.uuid() })

export function toHostSession(session: SessionState, guestBaseUrl: string): HostSession {
  return {
    id: session.id,
    code: session.code,
    name: session.name,
    status: session.status,
    createdAt: new Date(session.createdAt).toISOString(),
    endedAt: session.endedAt === null ? null : new Date(session.endedAt).toISOString(),
    joinUrl: `${guestBaseUrl}/s/${session.code}`,
    participantsCount: session.participants.size,
  }
}

/** Panel del anfitrión (docs/DISENO.md §4.3). Todas las rutas exigen la cookie del anfitrión. */
export async function hostRoutes(app: FastifyInstance, deps: HostDeps): Promise<void> {
  const { config, tokens, sessions, keepAwake, bus, notify, sse, sync, controls } = deps
  registerHostGuard(app, deps)
  const view = (session: SessionState) => toHostSession(session, config.guestBaseUrl)

  /** Solo el dueño ve o cambia su sesión; una ajena se responde igual que una inexistente. */
  const ownSession = (id: string, hostSpotifyId: string) => {
    const session = sessions.findById(id)
    if (!session || session.hostSpotifyId !== hostSpotifyId) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'La sesión no existe.')
    }
    return session
  }

  /** Comprueba el permiso de Spotify (lo renueva si hace falta) y devuelve el estado del panel. */
  app.get('/host/me', async (request): Promise<HostMe> => {
    const host = currentHost(request)
    let spotifyConnected = false
    try {
      await tokens.getAccessToken(host.spotifyId)
      spotifyConnected = true
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      // Si Spotify no responde, el permiso puede seguir siendo válido.
      spotifyConnected = error.code === 'SPOTIFY_UNAVAILABLE' && !!tokens.get(host.spotifyId)
    }
    const credentials = tokens.get(host.spotifyId)
    const active = sessions.findActiveByHost(host.spotifyId)
    return {
      spotifyId: host.spotifyId,
      name: host.name,
      reconnectBy: credentials
        ? new Date(credentials.authorizedAt + HOST_COOKIE_MAX_AGE_MS).toISOString()
        : null,
      spotifyConnected,
      activeSession: active ? view(active) : null,
      keepAwakeUntil: keepAwake.until === null ? null : new Date(keepAwake.until).toISOString(),
      fixedJoinUrl: fixedJoinUrl(host.spotifyId, config),
    }
  })

  app.post('/host/sessions', async (request, reply) => {
    const host = currentHost(request)
    const { name } = parseWith(createSessionBodySchema, request.body)
    if (!tokens.get(host.spotifyId)) {
      throw new AppError(409, 'SPOTIFY_RECONNECT_REQUIRED', 'Vuelve a conectar Spotify.')
    }
    const session = sessions.create({
      hostSpotifyId: host.spotifyId,
      name,
      market: config.spotify.market,
    })
    keepAwake.start()
    sync.start(session.id)
    request.log.info({ sessionId: session.id }, 'Sesión creada')
    return reply.status(201).send(view(session))
  })

  app.get('/host/sessions/active', async (request) => {
    const active = sessions.findActiveByHost(currentHost(request).spotifyId)
    return { session: active ? view(active) : null }
  })

  app.post('/host/sessions/:id/end', async (request) => {
    const host = currentHost(request)
    const { id } = parseWith(sessionParamsSchema, request.params)
    ownSession(id, host.spotifyId)
    const ended = sessions.end(id)
    keepAwake.stop()
    sync.stop(id)
    notify.session(id)
    request.log.info({ sessionId: id }, 'Sesión finalizada')
    return view(ended)
  })

  /** R-SES-03: nuevo enlace y QR; los invitados que ya entraron siguen dentro. */
  app.post('/host/sessions/:id/rotate-code', async (request) => {
    const host = currentHost(request)
    const { id } = parseWith(sessionParamsSchema, request.params)
    ownSession(id, host.spotifyId)
    const rotated = sessions.rotateCode(id)
    notify.session(id)
    request.log.info({ sessionId: id }, 'Enlace rotado')
    return view(rotated)
  })

  const hostSnapshot = (session: SessionState): HostSnapshot => ({
    session: view(session),
    ...notify.queuePayload(session.id)!,
    ...notify.playbackPayload(session.id)!,
    sync: notify.syncPayload(session.id)!,
  })

  /** Sesión activa del anfitrión para los controles; si terminó, 409. */
  const activeOwn = (request: Parameters<typeof currentHost>[0]) => {
    const { id } = parseWith(sessionParamsSchema, request.params)
    const session = ownSession(id, currentHost(request).spotifyId)
    if (session.status === 'ended') throw new AppError(409, 'SESSION_ENDED', 'La sesión terminó.')
    return session
  }

  app.get('/host/sessions/:id', async (request) => {
    const { id } = parseWith(sessionParamsSchema, request.params)
    return hostSnapshot(ownSession(id, currentHost(request).spotifyId))
  })

  /** Canal en vivo del panel (docs/DISENO.md §5): cola, invitados y estado de la sesión. */
  app.get('/host/sessions/:id/events', async (request, reply) => {
    const { id } = parseWith(sessionParamsSchema, request.params)
    const session = ownSession(id, currentHost(request).spotifyId)
    const stream = sse.start(request, reply)
    stream.send('snapshot', hostSnapshot(session))
    stream.onClose(bus.subscribe(session.id, (event) => stream.send(event.name, event.data)))
  })

  /** Controles de la música (docs/DISENO.md §4.3). */
  app.post('/host/sessions/:id/playback/play', async (request, reply) => {
    await controls.play(activeOwn(request))
    return reply.status(204).send()
  })
  app.post('/host/sessions/:id/playback/pause', async (request, reply) => {
    await controls.pause(activeOwn(request))
    return reply.status(204).send()
  })
  app.post('/host/sessions/:id/playback/next', async (request, reply) => {
    await controls.next(activeOwn(request))
    return reply.status(204).send()
  })
  app.get('/host/sessions/:id/devices', async (request) => controls.devices(activeOwn(request)))
  app.put('/host/sessions/:id/device', async (request, reply) => {
    const session = activeOwn(request)
    const { deviceId } = parseWith(selectDeviceBodySchema, request.body)
    await controls.selectDevice(session, deviceId)
    return reply.status(204).send()
  })

  /** R-CAN-06: quitar una canción pendiente. */
  app.delete('/host/sessions/:id/tracks/:trackId', async (request, reply) => {
    const { id, trackId } = parseWith(trackParamsSchema, request.params)
    ownSession(id, currentHost(request).spotifyId)
    sessions.removeTrack(id, trackId)
    notify.queue(id)
    request.log.info({ sessionId: id, trackId }, 'Canción quitada por el anfitrión')
    return reply.status(204).send()
  })
}
