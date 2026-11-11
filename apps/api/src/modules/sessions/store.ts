import { randomUUID } from 'node:crypto'
import { randomCode } from '../../lib/crypto.ts'
import { AppError } from '../../lib/errors.ts'
import type { CatalogTrack } from '../../providers/spotify/catalog.ts'
import { rankQueue } from '../queue/ranking.ts'

/** Invitado anónimo (R-PAR-01, R-PAR-02). El token en claro solo vive en su cookie. */
export type Participant = {
  id: string
  sessionId: string
  tokenHash: string
  displayName: string | null
  /** Orden de llegada: "Invitado N" cuando no hay apodo. */
  guestNumber: number
  joinedAt: number
}

/** Estados de una canción (docs/DISENO.md §10). En E3 solo existe `pending`. */
export type TrackStatus = 'pending' | 'queued' | 'playing' | 'played' | 'skipped' | 'removed'

/** Canción de la sesión; los metadatos vienen siempre de Spotify (R-CAN-03). */
export type Track = CatalogTrack & {
  id: string
  sessionId: string
  addedBy: string
  status: TrackStatus
  createdAt: number
  /** Orden de llegada dentro de la sesión, para desempatar en el mismo milisegundo. */
  seq: number
}

/** Canción pendiente con sus votos y su posición en la cola (R-COLA-01). */
export type RankedTrack = Track & { votes: number; position: number }

/**
 * Estado de una sesión en memoria (docs/DISENO.md §2.1, D-18). Cada etapa agrega lo suyo:
 * votos desde la pantalla (E4), reproducción (E5).
 */
export type SessionState = {
  id: string
  code: string
  name: string
  hostSpotifyId: string
  status: 'active' | 'ended'
  market: string
  createdAt: number
  endedAt: number | null
  guestCounter: number
  participants: Map<string, Participant>
  participantByTokenHash: Map<string, string>
  tracks: Map<string, Track>
  /** spotifyTrackId → id de la canción mientras está en la cola (R-CAN-01). */
  activeBySpotifyId: Map<string, string>
  /** id de la canción → participantes que la votaron (R-VOT-01: un voto por persona). */
  votes: Map<string, Set<string>>
  trackSeq: number
  /** R-COLA-03: sube con cada cambio de la cola. */
  queueVersion: number
}

export type CreateSessionInput = { hostSpotifyId: string; name: string; market: string }

/** Resultado de buscar por código: `retired` si el código fue reemplazado al rotarlo. */
export type CodeLookup = { session: SessionState; retired: boolean }

/** Límite de memoria por sesión (docs/DISENO.md §8). */
export const MAX_PARTICIPANTS = 300
/** R-SES-02 / §2.3: la sesión finalizada se conserva 30 min para mostrar "terminó". */
export const ENDED_RETENTION_MS = 30 * 60 * 1000
export const MAX_TRACKS = 500

/** Contrato del almacenamiento: hoy solo memoria; una base de datos podría implementarlo. */
export interface SessionStore {
  create(input: CreateSessionInput): SessionState
  findById(id: string): SessionState | undefined
  lookupCode(code: string): CodeLookup | undefined
  findActiveByHost(hostSpotifyId: string): SessionState | undefined
  end(id: string): SessionState
  rotateCode(id: string): SessionState
  join(sessionId: string, tokenHash: string, displayName: string | null): Participant
  findParticipant(sessionId: string, tokenHash: string): Participant | undefined
  rename(sessionId: string, participantId: string, displayName: string | null): Participant
  /** R-CAN-01…02 y R-VOT-02: agrega la canción con el voto de quien la pidió. */
  addTrack(sessionId: string, participantId: string, track: CatalogTrack): Track
  /** Id de la canción si ya está en la cola. */
  activeTrackId(sessionId: string, spotifyTrackId: string): string | undefined
  /** Pendientes en orden de la cola (R-COLA-01). */
  queue(sessionId: string): RankedTrack[]
  /**
   * R-VOT-01/03/04: pone o quita el voto de un participante. Idempotente: repetir no cambia nada.
   * Devuelve los votos de la canción y si la cola cambió.
   */
  setVote(
    sessionId: string,
    trackId: string,
    participantId: string,
    voted: boolean,
  ): { votes: number; changed: boolean }
  /** Canciones pendientes que votó el participante (para marcar su botón). */
  votedTrackIds(sessionId: string, participantId: string): string[]
  /** R-CAN-06: el anfitrión quita una canción pendiente. */
  removeTrack(sessionId: string, trackId: string): Track
  /** Borra sesiones vencidas (§2.3) y devuelve cuántas borró. */
  sweep(): number
}

export function participantName(participant: Participant): string {
  return participant.displayName ?? `Invitado ${participant.guestNumber}`
}

export class MemoryStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>()
  /** Código vigente o retirado → id de la sesión. */
  private readonly codes = new Map<string, { sessionId: string; retired: boolean }>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(now = Date.now, ttlHours = 24) {
    this.now = now
    this.ttlMs = ttlHours * 60 * 60 * 1000
  }

  /** R-SES-01: un anfitrión tiene como máximo una sesión activa. */
  create({ hostSpotifyId, name, market }: CreateSessionInput): SessionState {
    if (this.findActiveByHost(hostSpotifyId)) {
      throw new AppError(
        409,
        'ACTIVE_SESSION_EXISTS',
        'Ya tienes una sesión activa. Finalízala para crear otra.',
      )
    }
    const session: SessionState = {
      id: randomUUID(),
      code: this.uniqueCode(),
      name,
      hostSpotifyId,
      status: 'active',
      market,
      createdAt: this.now(),
      endedAt: null,
      guestCounter: 0,
      participants: new Map(),
      participantByTokenHash: new Map(),
      tracks: new Map(),
      activeBySpotifyId: new Map(),
      votes: new Map(),
      trackSeq: 0,
      queueVersion: 0,
    }
    this.sessions.set(session.id, session)
    this.codes.set(session.code, { sessionId: session.id, retired: false })
    return session
  }

  findById(id: string) {
    return this.sessions.get(id)
  }

  lookupCode(code: string): CodeLookup | undefined {
    const entry = this.codes.get(code)
    const session = entry && this.sessions.get(entry.sessionId)
    return session ? { session, retired: entry.retired } : undefined
  }

  findActiveByHost(hostSpotifyId: string) {
    for (const session of this.sessions.values()) {
      if (session.hostSpotifyId === hostSpotifyId && session.status === 'active') return session
    }
    return undefined
  }

  /** R-SES-02: una sesión finalizada ya no admite cambios. */
  end(id: string): SessionState {
    const session = this.activeSession(id)
    session.status = 'ended'
    session.endedAt = this.now()
    return session
  }

  /** R-SES-03: el código anterior deja de admitir invitados nuevos. */
  rotateCode(id: string): SessionState {
    const session = this.activeSession(id)
    this.codes.set(session.code, { sessionId: session.id, retired: true })
    session.code = this.uniqueCode()
    this.codes.set(session.code, { sessionId: session.id, retired: false })
    return session
  }

  join(sessionId: string, tokenHash: string, displayName: string | null): Participant {
    const session = this.activeSession(sessionId)
    if (session.participants.size >= MAX_PARTICIPANTS) {
      throw new AppError(409, 'SESSION_FULL', 'La sesión está llena.')
    }
    session.guestCounter += 1
    const participant: Participant = {
      id: randomUUID(),
      sessionId,
      tokenHash,
      displayName,
      guestNumber: session.guestCounter,
      joinedAt: this.now(),
    }
    session.participants.set(participant.id, participant)
    session.participantByTokenHash.set(tokenHash, participant.id)
    return participant
  }

  findParticipant(sessionId: string, tokenHash: string): Participant | undefined {
    const session = this.sessions.get(sessionId)
    const id = session?.participantByTokenHash.get(tokenHash)
    return id ? session?.participants.get(id) : undefined
  }

  rename(sessionId: string, participantId: string, displayName: string | null): Participant {
    const session = this.activeSession(sessionId)
    const participant = session.participants.get(participantId)
    if (!participant) {
      throw new AppError(401, 'NOT_PARTICIPANT', 'Entra a la sesión para pedir canciones.')
    }
    participant.displayName = displayName
    return participant
  }

  addTrack(sessionId: string, participantId: string, catalog: CatalogTrack): Track {
    const session = this.activeSession(sessionId)
    if (!session.participants.has(participantId)) {
      throw new AppError(401, 'NOT_PARTICIPANT', 'Entra a la sesión para pedir canciones.')
    }
    const existing = session.activeBySpotifyId.get(catalog.spotifyTrackId)
    if (existing) {
      throw new AppError(409, 'DUPLICATE_TRACK', 'Ya está en la cola. Puedes votarla.', {
        trackId: existing,
      })
    }
    if (session.tracks.size >= MAX_TRACKS) {
      throw new AppError(409, 'QUEUE_FULL', 'La cola llegó al máximo de canciones.')
    }
    session.trackSeq += 1
    const track: Track = {
      ...catalog,
      id: randomUUID(),
      sessionId,
      addedBy: participantId,
      status: 'pending',
      createdAt: this.now(),
      seq: session.trackSeq,
    }
    session.tracks.set(track.id, track)
    session.activeBySpotifyId.set(track.spotifyTrackId, track.id)
    session.votes.set(track.id, new Set([participantId]))
    session.queueVersion += 1
    return track
  }

  activeTrackId(sessionId: string, spotifyTrackId: string): string | undefined {
    return this.sessions.get(sessionId)?.activeBySpotifyId.get(spotifyTrackId)
  }

  queue(sessionId: string): RankedTrack[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    const pending = [...session.tracks.values()]
      .filter((track) => track.status === 'pending')
      .map((track) => ({ ...track, votes: session.votes.get(track.id)?.size ?? 0 }))
    return rankQueue(pending).map((track, index) => ({ ...track, position: index + 1 }))
  }

  setVote(sessionId: string, trackId: string, participantId: string, voted: boolean) {
    const session = this.activeSession(sessionId)
    if (!session.participants.has(participantId)) {
      throw new AppError(401, 'NOT_PARTICIPANT', 'Entra a la sesión para pedir canciones.')
    }
    const track = this.pendingTrack(session, trackId)
    const voters = session.votes.get(track.id)!
    const before = voters.size
    if (voted) voters.add(participantId)
    else voters.delete(participantId)
    const changed = voters.size !== before
    if (changed) session.queueVersion += 1
    return { votes: voters.size, changed }
  }

  votedTrackIds(sessionId: string, participantId: string): string[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return [...session.votes]
      .filter(
        ([trackId, voters]) =>
          voters.has(participantId) && session.tracks.get(trackId)?.status === 'pending',
      )
      .map(([trackId]) => trackId)
  }

  removeTrack(sessionId: string, trackId: string): Track {
    const session = this.activeSession(sessionId)
    const track = this.pendingTrack(session, trackId)
    track.status = 'removed'
    session.activeBySpotifyId.delete(track.spotifyTrackId)
    session.votes.delete(track.id)
    session.queueVersion += 1
    return track
  }

  sweep(): number {
    const now = this.now()
    let removed = 0
    for (const session of this.sessions.values()) {
      const endedLongAgo = session.endedAt !== null && now - session.endedAt >= ENDED_RETENTION_MS
      const tooOld = now - session.createdAt >= this.ttlMs
      if (endedLongAgo || tooOld) {
        this.sessions.delete(session.id)
        for (const [code, entry] of this.codes) {
          if (entry.sessionId === session.id) this.codes.delete(code)
        }
        removed += 1
      }
    }
    return removed
  }

  private activeSession(id: string): SessionState {
    const session = this.sessions.get(id)
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'La sesión no existe.')
    if (session.status === 'ended') {
      throw new AppError(409, 'SESSION_ENDED', 'La sesión terminó.')
    }
    return session
  }

  /** R-VOT-04: solo las pendientes admiten votos o cambios. */
  private pendingTrack(session: SessionState, trackId: string): Track {
    const track = session.tracks.get(trackId)
    if (!track) throw new AppError(404, 'TRACK_NOT_FOUND', 'Esa canción ya no está en la cola.')
    if (track.status !== 'pending') {
      throw new AppError(
        409,
        'TRACK_NOT_VOTABLE',
        'Esa canción ya va a sonar; los votos se cerraron.',
      )
    }
    return track
  }

  private uniqueCode(): string {
    let code = randomCode()
    while (this.codes.has(code)) code = randomCode()
    return code
  }
}
