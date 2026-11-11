import type { TrackView } from '@musica/shared'
import { ThumbsUp } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type PointerEvent, type ReactNode, useRef, useState } from 'react'
import { ExplicitBadge, TrackCover } from '../../components/track-bits.tsx'
import { formatDuration } from '../../lib/format.ts'

/** Dos toques dentro de este tiempo cuentan como doble toque (celular) o doble clic (PC). */
export const DOUBLE_TAP_MS = 300

/**
 * Cola de pendientes en orden (R-COLA-01). Cuando una canción cambia de lugar se desliza a su
 * nueva posición (animación de layout, 250 ms; sin animación si el sistema pide reducir
 * movimiento, ver `MotionConfig` en main.tsx). La acción de la derecha la decide quien la usa:
 * votar (invitado) o quitar (anfitrión).
 *
 * Con `onDoubleTap`, un doble toque en cualquier parte de la fila (salvo sus botones) llama a esa
 * función y muestra un pulgar sobre la portada: el invitado lo usa para dar like.
 */
export function QueueList({
  queue,
  action,
  highlightId = null,
  onDoubleTap,
}: {
  queue: TrackView[]
  action: (track: TrackView) => ReactNode
  highlightId?: string | null
  onDoubleTap?: (track: TrackView) => void
}) {
  const lastTap = useRef<{ id: string; at: number } | null>(null)
  const [burst, setBurst] = useState<{ id: string; key: number } | null>(null)

  if (queue.length === 0) {
    return <p className="py-6 text-arena">Todavía no hay canciones. Pide la primera.</p>
  }

  const tap = (event: PointerEvent, track: TrackView) => {
    // Los botones de la fila (votar, quitar) tienen su propio toque.
    if (!onDoubleTap || (event.target as Element).closest('button, a')) return
    const now = performance.now()
    if (lastTap.current?.id === track.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
      lastTap.current = null
      setBurst({ id: track.id, key: now })
      onDoubleTap(track)
    } else {
      lastTap.current = { id: track.id, at: now }
    }
  }

  return (
    <ol className="flex flex-col" aria-label="Cola de canciones">
      {queue.map((track) => (
        <motion.li
          key={track.id}
          id={`track-${track.id}`}
          layout="position"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          onPointerUp={(event) => tap(event, track)}
          className={`flex items-center gap-3 border-b border-mesa-alta py-3 transition-colors duration-700 ${
            highlightId === track.id ? 'rounded-xl bg-hoja/15' : ''
          } ${
            // Sin zoom por doble toque en el celular ni selección de texto por doble clic.
            onDoubleTap ? 'touch-manipulation select-none' : ''
          }`}
        >
          <span
            className={`w-6 shrink-0 text-right font-bold tabular ${track.position === 1 ? 'text-bombillo' : 'text-arena'}`}
          >
            {track.position}
          </span>
          <div className="relative shrink-0">
            <TrackCover src={track.imageUrl} alt={`Portada de ${track.album}`} />
            <AnimatePresence>
              {burst?.id === track.id && (
                <motion.span
                  key={burst.key}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center text-hoja"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.25, 1.1, 1.4] }}
                  transition={{ duration: 0.7, times: [0, 0.3, 0.6, 1] }}
                  onAnimationComplete={() => setBurst(null)}
                >
                  <ThumbsUp
                    className="size-8 drop-shadow-[0_0_6px_rgba(0,0,0,0.8)]"
                    strokeWidth={2.5}
                  />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Sin enlace: tocar el nombre no debe sacar a nadie de la app al querer votar. */}
            <p className="truncate font-bold">{track.name}</p>
            <span className="flex items-center gap-1.5 text-meta text-arena">
              {track.explicit && <ExplicitBadge />}
              <span className="truncate">{track.artist}</span>
            </span>
            <span className="text-meta text-arena">
              La pidió {track.addedBy}, {formatDuration(track.durationMs)}
            </span>
          </div>
          {action(track)}
        </motion.li>
      ))}
    </ol>
  )
}
