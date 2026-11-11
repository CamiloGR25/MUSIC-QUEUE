import type { TrackView } from '@musica/shared'
import { participantName, type RankedTrack, type SessionState } from '../sessions/store.ts'

/** Canción de la cola tal como la ven invitados y anfitrión (docs/DISENO.md §4.1). */
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
