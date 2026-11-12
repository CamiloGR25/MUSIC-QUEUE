import type { NowPlaying as NowPlayingData, UpcomingTrack } from '@musica/shared'
import { useEffect, useState } from 'react'
import { ExplicitBadge, TrackCover } from '../../components/track-bits.tsx'
import { formatDuration } from '../../lib/format.ts'
import { Garland } from './garland.tsx'

/**
 * Progreso actual: el servidor envía `progressMs` y cuándo lo leyó; aquí se avanza cada segundo
 * mientras suena, sin pedir nada a Spotify.
 */
export function useProgress(nowPlaying: NowPlayingData): number {
  const [now, setNow] = useState(() => Date.now())
  const playing = nowPlaying?.isPlaying ?? false
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [playing])
  if (!nowPlaying) return 0
  const elapsed = playing ? Math.max(0, now - Date.parse(nowPlaying.observedAt)) : 0
  return Math.min(nowPlaying.durationMs, nowPlaying.progressMs + elapsed)
}

/** "Sonando ahora" con la guirnalda y "Sigue" (docs/DISENO.md §9.5). */
export function NowPlaying({
  nowPlaying,
  next,
}: {
  nowPlaying: NowPlayingData
  next: UpcomingTrack | null
}) {
  const progressMs = useProgress(nowPlaying)

  return (
    <section className="flex flex-col gap-4" aria-label="Música">
      {nowPlaying ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <TrackCover src={nowPlaying.imageUrl} alt={`Portada de ${nowPlaying.name}`} size="md" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="text-bombillo">{nowPlaying.isPlaying ? 'Sonando ahora' : 'En pausa'}</p>
              <p className="truncate text-titulo font-bold">{nowPlaying.name}</p>
              <p className="truncate text-arena">{nowPlaying.artist}</p>
              {nowPlaying.addedBy && (
                <p className="text-meta text-arena">La pidió {nowPlaying.addedBy}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Garland progress={nowPlaying.durationMs ? progressMs / nowPlaying.durationMs : 0} />
            <span className="shrink-0 text-meta text-arena tabular">
              {formatDuration(progressMs)} / {formatDuration(nowPlaying.durationMs)}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-arena">
          Todavía no suena nada. La música empieza cuando el anfitrión la pone a sonar.
        </p>
      )}

      {next && (
        <div className="flex items-center gap-3 rounded-2xl bg-mesa-alta/70 px-3 py-2">
          <span className="w-12 shrink-0 font-bold text-bombillo">Sigue</span>
          <TrackCover src={next.imageUrl} alt={`Portada de ${next.album}`} />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate font-bold">{next.name}</p>
            <p className="flex items-center gap-1.5 text-meta text-arena">
              {next.explicit && <ExplicitBadge />}
              <span className="truncate">
                {next.artist}, la pidió {next.addedBy}
              </span>
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
