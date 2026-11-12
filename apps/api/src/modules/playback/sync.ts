import type { FastifyBaseLogger } from 'fastify'
import { AppError } from '../../lib/errors.ts'
import type { PlayerState, SpotifyPlayer } from '../../providers/spotify/player.ts'
import type { HostTokenStore } from '../host-auth/token-store.ts'
import { trackUri } from '../queue/views.ts'
import type { Notifier } from '../realtime/notifier.ts'
import type { SessionState, SessionStore, SyncStatus } from '../sessions/store.ts'

/** Esperas entre consultas a Spotify (docs/DISENO.md §7). */
export const SYNC_DELAYS = {
  min: 2_000,
  max: 15_000,
  paused: 10_000,
  noDevice: 10_000,
  blocked: 60_000,
  backoff: [5_000, 10_000, 20_000, 30_000],
}
/** Margen tras el final esperado antes de dar por saltada una canción enviada (R-SYNC). */
export const SKIP_GRACE_MS = 90_000

export type SyncDeps = {
  sessions: SessionStore
  tokens: HostTokenStore
  player: SpotifyPlayer
  notify: Notifier
  now: () => number
  /** D-14: cuánto antes del final se envía la siguiente (20 s). */
  leadMs: number
  log: FastifyBaseLogger
}

const clamp = (ms: number) => Math.min(SYNC_DELAYS.max, Math.max(SYNC_DELAYS.min, ms))

/**
 * Sincronizador de cada sesión activa (docs/DISENO.md §7, R-SYNC-01…04). Spotify no deja
 * reordenar ni quitar su cola, así que la cola colaborativa vive aquí y a Spotify se le envía
 * solo la siguiente, `leadMs` antes de que termine la que suena. Consulta el estado con un
 * intervalo que se adapta a lo que falta de la canción (4 a 12 consultas por minuto).
 */
export class PlaybackSync {
  private readonly deps: SyncDeps
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly running = new Set<string>()
  private readonly failures = new Map<string, number>()
  /** Hasta cuándo se espera que suene la canción enviada a Spotify. */
  private readonly queuedDeadline = new Map<string, number>()

  constructor(deps: SyncDeps) {
    this.deps = deps
  }

  start(sessionId: string): void {
    if (!this.timers.has(sessionId)) this.schedule(sessionId, 0)
  }

  stop(sessionId: string): void {
    clearTimeout(this.timers.get(sessionId))
    this.timers.delete(sessionId)
    this.failures.delete(sessionId)
    this.queuedDeadline.delete(sessionId)
  }

  stopAll(): void {
    for (const sessionId of [...this.timers.keys()]) this.stop(sessionId)
  }

  isRunning(sessionId: string): boolean {
    return this.timers.has(sessionId)
  }

  /** Tras un comando del anfitrión (reproducir, pausar, siguiente) se mira de nuevo enseguida. */
  poke(sessionId: string): void {
    if (this.timers.has(sessionId)) this.schedule(sessionId, 800)
  }

  private schedule(sessionId: string, delayMs: number): void {
    clearTimeout(this.timers.get(sessionId))
    const timer = setTimeout(() => void this.run(sessionId), delayMs)
    timer.unref()
    this.timers.set(sessionId, timer)
  }

  private async run(sessionId: string): Promise<void> {
    if (this.running.has(sessionId)) return
    this.running.add(sessionId)
    let delay: number | null = SYNC_DELAYS.backoff[0]!
    try {
      delay = await this.tick(sessionId)
    } catch (error) {
      this.deps.log.error({ err: error, sessionId }, 'Fallo inesperado del sincronizador')
    } finally {
      this.running.delete(sessionId)
    }
    if (delay === null) this.stop(sessionId)
    else if (this.timers.has(sessionId)) this.schedule(sessionId, delay)
  }

  /** Una vuelta del sincronizador. Devuelve la espera hasta la próxima, o null para detenerse. */
  async tick(sessionId: string): Promise<number | null> {
    const { sessions, tokens, player, notify } = this.deps
    const session = sessions.findById(sessionId)
    if (!session || session.status === 'ended') return null

    let token: string
    let state: PlayerState | null
    try {
      token = await tokens.getAccessToken(session.hostSpotifyId)
      state = await player.getState(token)
    } catch (error) {
      return this.fail(session, error)
    }
    this.failures.delete(sessionId)

    if (!state?.device) {
      this.update(session, {
        isPlaying: false,
        item: state?.item ?? null,
        progressMs: state?.progressMs ?? 0,
        deviceName: null,
        syncStatus: 'no_device',
        lastError: null,
      })
      return SYNC_DELAYS.noDevice
    }

    await this.reconcile(session, state, token)

    const item = state.item
    const remaining = item ? item.durationMs - state.progressMs : Number.POSITIVE_INFINITY
    let delay: number
    if (!state.isPlaying) {
      delay = SYNC_DELAYS.paused
    } else if (session.queuedTrackId) {
      // Ya hay una enviada: se espera al cambio de canción.
      delay = clamp(remaining + 1_000)
    } else if (remaining <= this.deps.leadMs) {
      const pushed = await this.pushNext(session, token, state, remaining)
      // Si Spotify la rechazó, el error ya quedó registrado: no se pisa con "ok".
      if (!pushed.ok) return pushed.delay
      delay = pushed.delay
    } else {
      delay = clamp(remaining - this.deps.leadMs - 2_000)
    }

    this.update(session, {
      isPlaying: state.isPlaying,
      item,
      progressMs: state.progressMs,
      deviceName: state.device.name,
      syncStatus: state.isPlaying ? 'ok' : 'paused',
      lastError: null,
    })
    notify.playback(sessionId)
    return delay
  }

  /** Ajusta los estados de la cola a lo que Spotify dice que suena (R-SYNC). */
  private async reconcile(session: SessionState, state: PlayerState, token: string) {
    const { sessions, notify, player, now } = this.deps
    const uri = state.item?.uri
    const queued = session.queuedTrackId ? session.tracks.get(session.queuedTrackId) : undefined
    const playing = session.playingTrackId ? session.tracks.get(session.playingTrackId) : undefined

    if (queued && uri === trackUri(queued)) {
      sessions.markPlaying(session.id, queued.id)
      this.queuedDeadline.delete(session.id)
      notify.queue(session.id)
    } else if (playing && uri !== trackUri(playing)) {
      // Terminó, o el anfitrión cambió de canción en Spotify.
      sessions.finishPlaying(session.id)
    }

    const deadline = this.queuedDeadline.get(session.id)
    if (session.queuedTrackId && deadline !== undefined && now() > deadline) {
      const stillQueued = session.tracks.get(session.queuedTrackId)!
      const nativeQueue = await player.getQueueUris(token).catch(() => null)
      if (nativeQueue && !nativeQueue.includes(trackUri(stillQueued))) {
        // El anfitrión la saltó o vació su cola: la siguiente se elegirá de nuevo.
        sessions.skipQueued(session.id)
        this.queuedDeadline.delete(session.id)
        this.deps.log.info({ sessionId: session.id }, 'La canción enviada no sonó; se omite')
      } else {
        this.queuedDeadline.set(session.id, now() + SKIP_GRACE_MS)
      }
    }
  }

  /** R-SYNC-02: envía la primera de la cola a Spotify; si falla, vuelve a la cola. */
  private async pushNext(
    session: SessionState,
    token: string,
    state: PlayerState,
    remaining: number,
  ): Promise<{ ok: boolean; delay: number }> {
    const { sessions, notify, player, now, log } = this.deps
    const next = sessions.takeNext(session.id)
    if (!next) return { ok: true, delay: clamp(remaining + 1_000) }
    notify.queue(session.id)
    try {
      await player.addToQueue(token, trackUri(next), state.device?.id ?? undefined)
    } catch (error) {
      sessions.returnToQueue(session.id, next.id)
      notify.queue(session.id)
      return { ok: false, delay: this.fail(session, error) }
    }
    this.queuedDeadline.set(session.id, now() + remaining + SKIP_GRACE_MS)
    log.info({ sessionId: session.id, trackId: next.id }, 'Canción enviada a Spotify')
    return { ok: true, delay: clamp(remaining + 1_000) }
  }

  /** Errores de Spotify: la cola se conserva y se reintenta (R-SYNC-03). */
  private fail(session: SessionState, error: unknown): number {
    const known = error instanceof AppError ? error : null
    if (!known)
      this.deps.log.error({ err: error, sessionId: session.id }, 'Error de sincronización')
    const failures = (this.failures.get(session.id) ?? 0) + 1
    this.failures.set(session.id, failures)

    let status: SyncStatus = 'error'
    let delay = SYNC_DELAYS.backoff[Math.min(failures - 1, SYNC_DELAYS.backoff.length - 1)]!
    if (known?.code === 'SPOTIFY_RECONNECT_REQUIRED') {
      status = 'auth_error'
      delay = SYNC_DELAYS.blocked
    } else if (known?.code === 'PREMIUM_REQUIRED') {
      status = 'premium_required'
      delay = SYNC_DELAYS.blocked
    } else if (known?.code === 'NO_ACTIVE_DEVICE') {
      status = 'no_device'
      delay = SYNC_DELAYS.noDevice
    } else if (known?.details && typeof known.details.retryAfterSec === 'number') {
      status = 'rate_limited'
      delay = Math.max(delay, known.details.retryAfterSec * 1_000)
    }
    this.update(session, {
      syncStatus: status,
      lastError: known?.message ?? 'Spotify no responde. La cola sigue guardada.',
    })
    return delay
  }

  /** Guarda el estado leído y avisa al panel si cambió el estado de la conexión. */
  private update(session: SessionState, changes: Partial<SessionState['playback']>) {
    const before = session.playback.syncStatus
    const beforeError = session.playback.lastError
    const after = this.deps.sessions.setPlayback(session.id, {
      ...changes,
      observedAt: this.deps.now(),
    })
    if (after.syncStatus !== before || after.lastError !== beforeError) {
      this.deps.notify.sync(session.id)
      this.deps.notify.playback(session.id)
    }
  }
}
