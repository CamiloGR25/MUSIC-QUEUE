import type { TrackView } from '@musica/shared'
import { ExplicitBadge, TrackCover } from '../../components/track-bits.tsx'
import { formatDuration } from '../../lib/format.ts'

/**
 * Cola de pendientes en orden (R-COLA-01). En E4 el contador se vuelve el botón de voto
 * y la lista se reordena en vivo.
 */
export function QueueList({ queue }: { queue: TrackView[] }) {
  if (queue.length === 0) {
    return <p className="py-6 text-arena">Todavía no hay canciones. Pide la primera.</p>
  }
  return (
    <ol className="flex flex-col divide-y divide-mesa-alta" aria-label="Cola de canciones">
      {queue.map((track) => (
        <li key={track.id} className="flex items-center gap-3 py-3">
          <span
            className={`w-6 shrink-0 text-right font-bold tabular ${track.position === 1 ? 'text-bombillo' : 'text-arena'}`}
          >
            {track.position}
          </span>
          <TrackCover src={track.imageUrl} alt={`Portada de ${track.album}`} />
          <div className="flex min-w-0 flex-1 flex-col">
            <a
              href={track.spotifyUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate font-bold hover:underline"
              title="Abrir en Spotify"
            >
              {track.name}
            </a>
            <span className="flex items-center gap-1.5 text-meta text-arena">
              {track.explicit && <ExplicitBadge />}
              <span className="truncate">{track.artist}</span>
            </span>
            <span className="text-meta text-arena">
              La pidió {track.addedBy}, {formatDuration(track.durationMs)}
            </span>
          </div>
          <span
            className="flex min-h-12 min-w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-arena/40 tabular"
            aria-label={`${track.votes} ${track.votes === 1 ? 'voto' : 'votos'}`}
          >
            <span className="font-bold">{track.votes}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
