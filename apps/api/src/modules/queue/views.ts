import type { Playback, SyncStatusView, TrackView, UpcomingTrack } from '@musica/shared'
import {
  participantName,
  type RankedTrack,
  type SessionState,
  type Track,
} from '../sessions/store.ts'

/** URI de Spotify de una canción de la cola. */
export const trackUri = (track: Pick<Track, 'spotifyTrackId'>) =>
  `spotify:track:${track.spotifyTrackId}`

function addedByName(track: Track, session: SessionState): string {
  const adder = session.participants.get(track.addedBy)
  return adder ? participantName(adder) : 'Invitado'
}

/** Canción de la cola tal como la ven invitados y anfitrión (docs/DISENO.md §4.1). */
export function toTrackView(track: RankedTrack, session: SessionState): TrackView {
  return { ...toUpcoming(track, session), position: track.position }
}

/** "Sigue": la canción enviada a Spotify, con los votos que tenía al quedar fija. */
export function toUpcoming(track: Track, session: SessionState): UpcomingTrack {
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
    votes: session.votes.get(track.id)?.size ?? 0,
    addedBy: addedByName(track, session),
  }
}

/** "Sonando ahora" y "Sigue" (docs/DISENO.md §4.1, §9.5). */
export function toPlayback(session: SessionState): Playback {
  const { playback } = session
  const playing = session.playingTrackId ? session.tracks.get(session.playingTrackId) : undefined
  const queued = session.queuedTrackId ? session.tracks.get(session.queuedTrackId) : undefined
  const item = playback.item
  const fromQueue = playing && item && trackUri(playing) === item.uri ? playing : undefined
  return {
    nowPlaying: item
      ? {
          source: fromQueue ? 'queue' : 'host',
          trackId: fromQueue?.id ?? null,
          name: item.name,
          artist: item.artist,
          imageUrl: item.imageUrl,
          durationMs: Math.max(0, Math.round(item.durationMs)),
          progressMs: Math.max(0, Math.round(playback.progressMs)),
          observedAt: new Date(playback.observedAt).toISOString(),
          isPlaying: playback.isPlaying,
          addedBy: fromQueue ? addedByName(fromQueue, session) : null,
        }
      : null,
    next: queued ? toUpcoming(queued, session) : null,
  }
}

export function toSyncStatus(session: SessionState): SyncStatusView {
  const { playback } = session
  return {
    status: playback.syncStatus,
    deviceName: playback.deviceName,
    lastError: playback.lastError,
  }
}
