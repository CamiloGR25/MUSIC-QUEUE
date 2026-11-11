import {
  addTrackBodySchema,
  joinBodySchema,
  renameBodySchema,
  searchQuerySchema,
  type SearchResponse,
  sessionCodeSchema,
  type SessionSnapshot,
  type VoteResponse,
} from '@musica/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.ts'
import { randomToken, sha256Base64Url } from '../../lib/crypto.ts'
import { AppError } from '../../lib/errors.ts'
import type { SseConnections } from '../../lib/sse.ts'
import { parseWith } from '../../lib/validation.ts'
import type { SpotifyCatalog } from '../../providers/spotify/catalog.ts'
import { cookieOptions } from '../host-auth/cookies.ts'
import { toTrackView } from '../queue/views.ts'
import type { EventBus } from '../realtime/event-bus.ts'
import type { Notifier } from '../realtime/notifier.ts'
import {
  type Participant,
  participantName,
  type SessionState,
  type SessionStore,
} from '../sessions/store.ts'

type GuestDeps = {
  config: AppConfig
  sessions: SessionStore
  catalog: SpotifyCatalog
  bus: EventBus
  notify: Notifier
  sse: SseConnections
}

const codeParamsSchema = z.object({ code: sessionCodeSchema })
const trackParamsSchema = z.object({ code: z.string(), trackId: z.uuid() })

/** Límites por invitado (docs/DISENO.md §8); en una casa todos comparten la IP del Wi-Fi. */
const perGuest = (max: number) => ({
  rateLimit: {
    max,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) =>
      Object.entries(request.cookies).find(([name]) => name.startsWith('p_'))?.[1] ?? request.ip,
  },
})
// Por IP: en una casa todos comparten la del Wi-Fi; 120/min deja entrar a una fiesta grande de golpe.
const joinRateLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } }

/** Eventos que reciben los invitados (el conteo de participantes es solo del panel). */
const GUEST_EVENTS = new Set(['queue.updated', 'session.updated'])

/**
 * Cookie del invitado (R-PAR-01): token aleatorio de 256 bits, `httpOnly`. Se nombra por el id
 * de la sesión (no por el código) para que siga sirviendo si el anfitrión rota el enlace (R-SES-03).
 */
export const participantCookieName = (session: SessionState) =>
  `p_${session.id.replaceAll('-', '')}`

const notFound = () =>
  new AppError(
    404,
    'SESSION_NOT_FOUND',
    'Este enlace ya no funciona. Pide el QR nuevo al anfitrión.',
  )

/** Rutas de invitados (docs/DISENO.md §4.2) y su canal en tiempo real (§5). */
export async function guestRoutes(app: FastifyInstance, deps: GuestDeps) {
  const { config, sessions, catalog, bus, notify, sse } = deps
  const participantCookie = cookieOptions(
    config,
    '/api/sessions',
    config.sessionTtlHours * 3_600_000,
  )

  function resolve(request: FastifyRequest) {
    // Un código mal escrito se trata igual que uno inexistente.
    const params = codeParamsSchema.safeParse(request.params)
    const found = params.success ? sessions.lookupCode(params.data.code) : undefined
    if (!found) throw notFound()
    const token = request.cookies[participantCookieName(found.session)]
    const participant = token
      ? sessions.findParticipant(found.session.id, sha256Base64Url(token))
      : undefined
    // R-SES-03: un código retirado solo sirve a quien ya había entrado.
    if (found.retired && !participant) throw notFound()
    return { ...found, participant }
  }

  /** Invitado dentro de una sesión activa; si no, el error que corresponde. */
  function requireGuest(request: FastifyRequest) {
    const { session, participant } = resolve(request)
    if (!participant) {
      throw new AppError(401, 'NOT_PARTICIPANT', 'Entra a la sesión para pedir canciones.')
    }
    if (session.status === 'ended') throw new AppError(409, 'SESSION_ENDED', 'La sesión terminó.')
    return { session, participant }
  }

  function snapshot(session: SessionState, participant: Participant | undefined): SessionSnapshot {
    const queue = notify.queuePayload(session.id)!
    return {
      session: { code: session.code, name: session.name, status: session.status },
      me: participant
        ? {
            participantId: participant.id,
            name: participantName(participant),
            votedTrackIds: sessions.votedTrackIds(session.id, participant.id),
          }
        : null,
      ...queue,
    }
  }

  app.get('/sessions/:code', async (request) => {
    const { session, participant } = resolve(request)
    return snapshot(session, participant)
  })

  /**
   * Canal en tiempo real (docs/DISENO.md §5). Al conectar (y al reconectar) envía la instantánea
   * completa; después, cada cambio de la cola o de la sesión.
   */
  app.get('/sessions/:code/events', async (request, reply) => {
    const { session, participant } = resolve(request)
    const stream = sse.start(request, reply)
    stream.send('snapshot', snapshot(session, participant))
    const unsubscribe = bus.subscribe(session.id, (event) => {
      if (GUEST_EVENTS.has(event.name)) stream.send(event.name, event.data)
    })
    stream.onClose(unsubscribe)
  })

  app.post('/sessions/:code/participants', { config: joinRateLimit }, async (request, reply) => {
    const { session, participant } = resolve(request)
    if (participant) return reply.status(200).send(snapshot(session, participant))

    const { displayName } = parseWith(joinBodySchema, request.body ?? {})
    const token = randomToken(32)
    const joined = sessions.join(session.id, sha256Base64Url(token), displayName ?? null)
    reply.setCookie(participantCookieName(session), token, participantCookie)
    notify.participants(session.id)
    return reply.status(201).send(snapshot(session, joined))
  })

  app.patch('/sessions/:code/participants/me', async (request) => {
    const { session, participant } = resolve(request)
    if (!participant) {
      throw new AppError(401, 'NOT_PARTICIPANT', 'Entra a la sesión para pedir canciones.')
    }
    const { displayName } = parseWith(renameBodySchema, request.body)
    const renamed = sessions.rename(session.id, participant.id, displayName)
    // "La pidió …" cambia en la cola si esta persona agregó canciones.
    notify.queue(session.id)
    return { name: participantName(renamed) }
  })

  /** Buscador (docs/DISENO.md §4.2): 10 por página y la marca "Ya en la cola". */
  app.get('/sessions/:code/search', { config: perGuest(30) }, async (request) => {
    const { session } = requireGuest(request)
    const { q, offset } = parseWith(searchQuerySchema, request.query)
    const page = await catalog.search(q, offset, session.market)
    const response: SearchResponse = {
      nextOffset: page.nextOffset,
      items: page.items.map((item) => {
        const trackId = sessions.activeTrackId(session.id, item.spotifyTrackId)
        return { ...item, inQueue: trackId ? { trackId } : null }
      }),
    }
    return response
  })

  /** Agregar (R-CAN-01…03, R-VOT-02): los datos se piden a Spotify, nunca al navegador. */
  app.post('/sessions/:code/tracks', { config: perGuest(10) }, async (request, reply) => {
    const { session } = requireGuest(request)
    const { spotifyTrackId } = parseWith(addTrackBodySchema, request.body)
    const existing = sessions.activeTrackId(session.id, spotifyTrackId)
    if (existing) {
      throw new AppError(409, 'DUPLICATE_TRACK', 'Ya está en la cola. Puedes votarla.', {
        trackId: existing,
      })
    }
    const catalogTrack = await catalog.getTrack(spotifyTrackId, session.market)
    if (!catalogTrack) {
      throw new AppError(404, 'TRACK_NOT_FOUND', 'Spotify no tiene disponible esa canción aquí.')
    }
    // Tras esperar a Spotify se valida todo de nuevo: la sesión pudo terminar o alguien
    // pudo agregar la misma canción en ese instante (addTrack lo comprueba sin pausas).
    const { participant } = requireGuest(request)
    const track = sessions.addTrack(session.id, participant.id, catalogTrack)
    const ranked = sessions.queue(session.id).find((item) => item.id === track.id)!
    notify.queue(session.id)
    request.log.info({ sessionId: session.id, trackId: track.id }, 'Canción agregada')
    return reply.status(201).send({ track: toTrackView(ranked, session) })
  })

  /** Votar y quitar el voto (R-VOT-01, R-VOT-03, R-VOT-04). Repetir no cambia nada. */
  for (const [method, voted] of [
    ['PUT', true],
    ['DELETE', false],
  ] as const) {
    app.route({
      method,
      url: '/sessions/:code/tracks/:trackId/vote',
      config: perGuest(60),
      handler: async (request): Promise<VoteResponse> => {
        const { session, participant } = requireGuest(request)
        const { trackId } = parseWith(trackParamsSchema, request.params)
        const result = sessions.setVote(session.id, trackId, participant.id, voted)
        if (result.changed) notify.queue(session.id)
        return { voted, votes: result.votes }
      },
    })
  }
}
