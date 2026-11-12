import type { DeviceView } from '@musica/shared'
import { AppError } from '../../lib/errors.ts'
import type { SpotifyPlayer } from '../../providers/spotify/player.ts'
import type { HostTokenStore } from '../host-auth/token-store.ts'
import { trackUri } from '../queue/views.ts'
import type { Notifier } from '../realtime/notifier.ts'
import type { SessionState, SessionStore } from '../sessions/store.ts'
import type { PlaybackSync } from './sync.ts'

type ControlDeps = {
  sessions: SessionStore
  tokens: HostTokenStore
  player: SpotifyPlayer
  notify: Notifier
  sync: PlaybackSync
}

/**
 * Controles del anfitrión sobre su Spotify (docs/DISENO.md §4.3). Después de cada uno, el
 * sincronizador vuelve a leer el estado enseguida.
 */
export class PlaybackControls {
  private readonly deps: ControlDeps

  constructor(deps: ControlDeps) {
    this.deps = deps
  }

  /**
   * R-SYNC-04: reanuda lo que estaba en pausa; si no hay nada cargado, arranca con la primera
   * de la cola. Nunca suena nada sin que el anfitrión lo pida.
   */
  async play(session: SessionState): Promise<void> {
    const { player, sessions, notify } = this.deps
    const token = await this.token(session)
    const state = await player.getState(token)
    if (state?.isPlaying) return
    const deviceId = session.deviceId ?? state?.device?.id ?? undefined

    if (state?.item) {
      await player.play(token, { deviceId })
    } else {
      const first = sessions.queue(session.id)[0]
      if (!first) {
        throw new AppError(409, 'NOTHING_TO_PLAY', 'Agrega canciones a la cola para empezar.')
      }
      await player.play(token, { deviceId, uris: [trackUri(first)] })
      sessions.markPlaying(session.id, first.id)
      notify.queue(session.id)
    }
    this.after(session)
  }

  async pause(session: SessionState): Promise<void> {
    await this.deps.player.pause(await this.token(session))
    this.after(session)
  }

  async next(session: SessionState): Promise<void> {
    await this.deps.player.next(await this.token(session))
    this.after(session)
  }

  async devices(
    session: SessionState,
  ): Promise<{ devices: DeviceView[]; selectedId: string | null }> {
    const devices = await this.deps.player.devices(await this.token(session))
    return { devices, selectedId: session.deviceId }
  }

  /** Lleva la música a ese dispositivo sin arrancarla (D-5). */
  async selectDevice(session: SessionState, deviceId: string): Promise<void> {
    const token = await this.token(session)
    const devices = await this.deps.player.devices(token)
    const device = devices.find((candidate) => candidate.id === deviceId)
    if (!device) {
      throw new AppError(
        409,
        'NO_ACTIVE_DEVICE',
        'Ese dispositivo ya no está disponible en Spotify.',
      )
    }
    await this.deps.player.transfer(token, deviceId)
    this.deps.sessions.setDevice(session.id, deviceId)
    this.after(session)
  }

  private token(session: SessionState): Promise<string> {
    return this.deps.tokens.getAccessToken(session.hostSpotifyId)
  }

  private after(session: SessionState): void {
    this.deps.notify.playback(session.id)
    this.deps.sync.poke(session.id)
  }
}
