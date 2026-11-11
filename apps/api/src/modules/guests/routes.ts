import {
  addTrackBodySchema,
  joinBodySchema,
  renameBodySchema,
  searchQuerySchema,
  type SearchResponse,
  sessionCodeSchema,
  type SessionSnapshot,
  type TrackView,
} from '@musica/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.ts'
import { randomToken, sha256Base64Url } from '../../lib/crypto.ts'
import { AppError } from '../../lib/errors.ts'
import { parseWith } from '../../lib/validation.ts'
import type { SpotifyCatalog } from '../../providers/spotify/catalog.ts'
import { cookieOptions } from '../host-auth/cookies.ts'
import {
  type Participant,
  participantName,
  type RankedTrack,
  type SessionState,
  type SessionStore,
} from '../sessions/store.ts'

type GuestDeps = { config: AppConfig; sessions: SessionStore; catalog: SpotifyCatalog }

const codeParamsSchema = z.object({ code: sessionCodeSchema })

/** Límites por invitado (docs/DISENO.md §8); en una casa todos comparten la IP del Wi-Fi. */
const perGuest = (max: number) => ({
  rateLimit: {
    max,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) =>
      Object.entries(request.cookies).find(([name]) => name.startsWith('p_'))?.[1] ?? request.ip,
  },
})
const joinRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } }

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

export function toTrackView(track: RankedTrack, session: SessionState): TrackView {
  const adder = session.participants.get(track.addedBy)
  return {
    id: track.id,
    spotifyTrackId: track.spotifyTrackId,
    spotifyUrl: track.spotifyUrl,
    name: track.name,
    artist: track.artist,
    album: track.album,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
    explicit: track.explicit,
    votes: track.votes,
    addedBy: adder ? participantName(adder) : 'Invitado',
    position: track.position,
  }
}

/** Rutas de invitados (docs/DISENO.md §4.2). */
export async function guestRoutes(app: FastifyInstance, { config, sessions, catalog }: GuestDeps) {
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
    return {
      session: { code: session.code, name: session.name, status: session.status },
      me: participant
        ? { participantId: participant.id, name: participantName(participant) }
        : null,
      version: session.queueVersion,
      queue: sessions.queue(session.id).map((track) => toTrackView(track, session)),
    }
  }

  app.get('/sessions/:code', async (request) => {
    const { session, retired, participant } = resolve(request)
    // R-SES-03: un código retirado solo sirve a quien ya había entrado (pasa al código nuevo).
    if (retired && !participant) throw notFound()
    return snapshot(session, participant)
  })

  app.post('/sessions/:code/participants', { config: joinRateLimit }, async (request, reply) => {
    const { session, retired, participant } = resolve(request)
    if (retired && !participant) throw notFound()
    if (participant) return reply.status(200).send(snapshot(session, participant))

    const { displayName } = parseWith(joinBodySchema, request.body ?? {})
    const token = randomToken(32)
    const joined = sessions.join(session.id, sha256Base64Url(token), displayName ?? null)
    reply.setCookie(participantCookieName(session), token, participantCookie)
    return reply.status(201).send(snapshot(session, joined))
  })

  app.patch('/sessions/:code/participants/me', async (request) => {
    const { session, participant } = resolve(request)
    if (!participant) {
      throw new AppError(401, 'NOT_PARTICIPANT', 'Entra a la sesión para pedir canciones.')
    }
    const { displayName } = parseWith(renameBodySchema, request.body)
    return { name: participantName(sessions.rename(session.id, participant.id, displayName)) }
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
    request.log.info({ sessionId: session.id, trackId: track.id }, 'Canción agregada')
    return reply.status(201).send({ track: toTrackView(ranked, session) })
  })
}
