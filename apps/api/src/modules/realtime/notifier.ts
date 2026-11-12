import type {
  HostParticipant,
  Playback,
  QueueUpdated,
  SessionUpdated,
  SyncStatusView,
} from '@musica/shared'
import { toPlayback, toSyncStatus, toTrackView } from '../queue/views.ts'
import { participantName, type SessionStore } from '../sessions/store.ts'
import type { EventBus } from './event-bus.ts'

/**
 * Arma cada aviso una sola vez y lo publica a todas las pantallas de la sesión
 * (docs/DISENO.md §5). Las rutas lo llaman después de cada cambio.
 */
export class Notifier {
  private readonly sessions: SessionStore
  private readonly bus: EventBus

  constructor(sessions: SessionStore, bus: EventBus) {
    this.sessions = sessions
    this.bus = bus
  }

  queuePayload(sessionId: string): QueueUpdated | null {
    const session = this.sessions.findById(sessionId)
    if (!session) return null
    return {
      version: session.queueVersion,
      queue: this.sessions.queue(sessionId).map((track) => toTrackView(track, session)),
    }
  }

  sessionPayload(sessionId: string): SessionUpdated | null {
    const session = this.sessions.findById(sessionId)
    return session ? { code: session.code, name: session.name, status: session.status } : null
  }

  /** R-COLA-03: la cola cambió (agregar, votar, quitar, renombrar a quien la pidió). */
  queue(sessionId: string): void {
    const data = this.queuePayload(sessionId)
    if (data) this.bus.publish(sessionId, { name: 'queue.updated', data })
  }

  /** Cambió el código (rotar) o la sesión terminó. */
  session(sessionId: string): void {
    const data = this.sessionPayload(sessionId)
    if (data) this.bus.publish(sessionId, { name: 'session.updated', data })
  }

  playbackPayload(sessionId: string): Playback | null {
    const session = this.sessions.findById(sessionId)
    return session ? toPlayback(session) : null
  }

  syncPayload(sessionId: string): SyncStatusView | null {
    const session = this.sessions.findById(sessionId)
    return session ? toSyncStatus(session) : null
  }

  /** Cambió lo que suena, la pausa o la que sigue (E5). */
  playback(sessionId: string): void {
    const data = this.playbackPayload(sessionId)
    if (data) this.bus.publish(sessionId, { name: 'playback.updated', data })
  }

  /** Estado de la conexión con Spotify, solo para el panel. */
  sync(sessionId: string): void {
    const data = this.syncPayload(sessionId)
    if (data) this.bus.publish(sessionId, { name: 'sync.status', data })
  }

  /** Invitados en orden de llegada, con cuántas canciones pidió cada uno (panel). */
  participantsPayload(sessionId: string): HostParticipant[] {
    const session = this.sessions.findById(sessionId)
    if (!session) return []
    const added = new Map<string, number>()
    for (const track of session.tracks.values()) {
      added.set(track.addedBy, (added.get(track.addedBy) ?? 0) + 1)
    }
    return [...session.participants.values()]
      .sort((a, b) => a.guestNumber - b.guestNumber)
      .map((participant) => ({
        id: participant.id,
        name: participantName(participant),
        status: participant.status,
        joinedAt: new Date(participant.joinedAt).toISOString(),
        tracksAdded: added.get(participant.id) ?? 0,
      }))
  }

  participants(sessionId: string): void {
    const items = this.participantsPayload(sessionId)
    this.bus.publish(sessionId, {
      name: 'participants.updated',
      data: { count: items.length, items },
    })
  }
}
